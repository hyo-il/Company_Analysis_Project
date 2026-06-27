#!/usr/bin/env python3
"""
KR 종목 PER/PBR/PSR/EV-EBITDA 정적 수집 — yfinance + DART 결합.

용도:
    KR 종목의 밸류에이션 비율 활성화.
    한·미 종목 비교 (예: Micron vs SK하이닉스·삼성전자) 시 PER·PBR 등 비교 가능.

데이터 출처 (중요 — 1차 yfinance-only 시도 실패 후 결합 방식으로 전환):
    실측 결과 yfinance 의 KR 종목 (.KS/.KQ) Ticker.info 는
      - trailingPE (PER)·priceToBook (PBR) 를 **제공하지 않음** (항상 None).
      - priceToSalesTrailing12Months (PSR)·enterpriseToEbitda (EV/EBITDA)·
        marketCap·sharesOutstanding 은 제공.
    (대조군 US 종목 AAPL 은 trailingPE·priceToBook 정상 제공 → KR 한정 구조적 누락.)

    따라서:
      - PER  = yfinance marketCap / DART netIncome   (netIncome > 0 일 때만)
      - PBR  = yfinance marketCap / DART totalEquity  (totalEquity > 0 일 때만)
      - PSR, EV/EBITDA = yfinance 값 그대로
    PER·PBR 의 분자(marketCap)와 PSR·EV(yfinance) 는 동일 시세 기반이라 상호 일관.
    (검산: PBR/PER == DART ROE 로 산술 일관성 확인됨.)

    ⚠ 정직성 한계: 본 환경의 yfinance KR 시세가 실제 시세와 차이가 있을 수 있어
      절대 비율 수치의 실측 정합성은 보장하지 않음 (시세 출처 자체의 문제).
      회계 기준 차이 (K-IFRS vs US-GAAP)·환율 기준일 차이는 비교 페이지 안내문에 명시.

사용:
    cd /Users/hyone/Documents/ClaudeCode/Work/CompanyAnalysis
    python3 workspace/CA_Project/scripts/fetch_kr_metrics.py
    python3 workspace/CA_Project/scripts/fetch_kr_metrics.py --auto-push   # 2단계 패턴

출력:
    workspace/CA_Project/js/data/kr-metrics.json
    형식:
      {
        "generatedAt": "2026-06-14T...",
        "validUntil": "2026-09-14",
        "tickerCount": 341,
        "data": {
          "005930": {
            "per": 52.2,
            "pbr": 5.41,
            "psr": 6.09,
            "evEbitda": 15.21,
            "marketCap": 2360679650557952,
            "sharesOutstanding": 5764191903,
            "bookValue": 75690
          },
          ...
        },
        "failed": ["...", ...]
      }

운영 주기: 분기 1회 (재무 갱신 시점). 시세 변동 영향은 PER 정도라 분기로 충분.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path
from datetime import datetime, timedelta

try:
    import yfinance as yf
except ImportError:
    print("yfinance 가 설치되지 않았습니다. pip3 install yfinance", file=sys.stderr)
    sys.exit(2)

# === 경로 ===
REPO_ROOT     = Path(__file__).resolve().parent.parent
KR_DART_JSON  = REPO_ROOT / "js" / "data" / "kr-dart.json"
OUTPUT_JSON   = REPO_ROOT / "js" / "data" / "kr-metrics.json"

# 429 (Too Many Requests) 완화용 종목 간 대기 (초)
THROTTLE_SEC = 0.3

# === DART API 상수 (EPS3y 폴백용) ===
DART_BASE = "https://opendart.fss.or.kr"
DART_REQ_INTERVAL = 0.15   # 호출 간 대기 (분당 1000건 한도)
DART_KEY_PATH = Path.home() / ".secrets" / "opendart_key"
CORPCODE_JSON = REPO_ROOT / "js" / "data" / "dart-corpcode.json"
CORPCODE_FULL_JSON = REPO_ROOT / "js" / "data" / "dart-corpcode-full.json"

# 모듈 전역 — main() 진입 시 1회 로드
DART_API_KEY: str | None = None
DART_CORPMAP: dict[str, str] = {}


def _load_dart_key() -> str | None:
    """~/.secrets/opendart_key 에서 DART API 키 로드. 미가용 시 None (DART 폴백 비활성)."""
    if not DART_KEY_PATH.exists():
        return None
    try:
        return DART_KEY_PATH.read_text(encoding="utf-8").strip() or None
    except Exception:
        return None


def _load_corpmap() -> dict[str, str]:
    """ticker → corp_code 매핑 (코스피200 flat + 전체 byTicker). 실패 시 빈 dict.

    - dart-corpcode.json: {ticker: "corp_code"} (평면 문자열).
    - dart-corpcode-full.json: {byTicker: {ticker: {corp_code, nameKr, ...}}} (객체) → corp_code 추출.
    """
    corpmap: dict[str, str] = {}
    if CORPCODE_JSON.exists():
        try:
            flat = json.loads(CORPCODE_JSON.read_text(encoding="utf-8"))
            for t, c in flat.items():
                if isinstance(c, str) and c:
                    corpmap[t] = c
        except Exception:
            pass
    if CORPCODE_FULL_JSON.exists():
        try:
            full = json.loads(CORPCODE_FULL_JSON.read_text(encoding="utf-8"))
            for t, c in (full.get("byTicker") or {}).items():
                code = c.get("corp_code") if isinstance(c, dict) else c
                if code:
                    corpmap.setdefault(t, code)
        except Exception:
            pass
    return corpmap


def _fetch_dart_netincome(corp_code: str, year: int, api_key: str) -> float | None:
    """DART 사업보고서 (FY, 11011) 의 당기순이익 조회 — CFS 우선, OFS 폴백. 실패 시 None (원)."""
    params = urllib.parse.urlencode({
        "crtfc_key": api_key,
        "corp_code": corp_code,
        "bsns_year": str(year),
        "reprt_code": "11011",
    })
    url = f"{DART_BASE}/api/fnlttSinglAcnt.json?{params}"
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            d = json.loads(r.read().decode("utf-8"))
        if d.get("status") != "000":
            return None
        # CFS (연결) 우선, 없으면 OFS (별도)
        for fs_div in ("CFS", "OFS"):
            for it in d.get("list", []):
                if it.get("fs_div") != fs_div:
                    continue
                nm = it.get("account_nm", "")
                if nm in ("당기순이익", "당기순이익(손실)", "분기순이익", "분기순이익(손실)"):
                    amt = (it.get("thstrm_amount") or "").replace(",", "").strip()
                    if amt and amt != "-":
                        try:
                            return float(amt)
                        except ValueError:
                            continue
        return None
    except Exception:
        return None
    finally:
        time.sleep(DART_REQ_INTERVAL)


def _eps_growth_3y_dart(ticker: str, shares: float | None,
                        api_key: str, corpmap: dict) -> float | None:
    """DART 폴백 — 사업보고서 3년 netIncome / 현재 sharesOutstanding 으로 EPS 3년 성장률 평균.

    한계:
    - sharesOutstanding 은 현재 시점 값 (과거 분할·증자 영향 무시) — 한국 종목 분할 빈도 낮아 영향 미미.
    - 3년 중 한 해라도 미가용 (또는 적자) 시 None 반환.
    """
    if not shares or shares <= 0:
        return None
    corp_code = corpmap.get(ticker)
    if not corp_code:
        return None
    # 최근 3년 사업보고서 (현재년-1 부터 -3 까지)
    base_year = datetime.now().year - 1
    years = [base_year - i for i in range(3)]   # [base, base-1, base-2]

    eps_series = []
    for y in years:
        ni = _fetch_dart_netincome(corp_code, y, api_key)
        if ni is None:
            return None
        eps = ni / shares
        if eps <= 0:
            return None
        eps_series.append(eps)

    # eps_series = [최근, 중간, 과거]
    growths = []
    for i in range(len(eps_series) - 1):
        prev, curr = eps_series[i + 1], eps_series[i]
        if prev > 0:
            growths.append((curr / prev - 1) * 100)
    return round(sum(growths) / len(growths), 2) if growths else None


def load_kr_dart() -> dict[str, dict]:
    """kr-dart.json 의 재무 분모 로드 + TTM 계산.

    Returns: { ticker: { 'netIncome_ttm', 'revenue_ttm', 'totalEquity',
                         'netIncome_annual', 'revenue_annual', 'ttm_quarters' } }
    - TTM: timeseries 분기 4개 합 (가용 시).
    - 폴백: 연간 financials (timeseries 4개 미가용 시).
    """
    if not KR_DART_JSON.exists():
        print(f"kr-dart.json 없음: {KR_DART_JSON}", file=sys.stderr)
        return {}
    with KR_DART_JSON.open(encoding="utf-8") as f:
        d = json.load(f)

    def _ttm(series):
        """timeseries 분기 시리즈 → TTM (최근 4분기 합). 4개 미달이면 None."""
        if not isinstance(series, list): return None, 0
        valid = [x for x in series if x is not None]
        if len(valid) < 4: return None, len(valid)
        return sum(valid[-4:]), 4

    out = {}
    for t, e in (d.get("data") or {}).items():
        fin = e.get("financials") or {}
        ts = e.get("timeseries") or {}

        net_income_annual = fin.get("netIncome")
        revenue_annual    = fin.get("revenue")
        total_equity      = fin.get("totalEquity")

        ni_ttm, ni_q = _ttm(ts.get("netIncome"))
        rev_ttm, rev_q = _ttm(ts.get("revenue"))

        out[t] = {
            "netIncome_ttm":    ni_ttm,                              # 우선
            "revenue_ttm":      rev_ttm,                             # 우선
            "totalEquity":      total_equity,                        # 분기말
            "netIncome_annual": net_income_annual,                   # 폴백
            "revenue_annual":   revenue_annual,                      # 폴백
            "ttm_quarters":     {"netIncome": ni_q, "revenue": rev_q},
            "revenueGrowthYoY": fin.get("revenueGrowthYoY"),         # PEG 분모용
            "epsGrowth":        fin.get("epsGrowth"),                # PEG 폴백 분모용
        }
    return out


def _safe_float(v) -> float | None:
    if v is None: return None
    if isinstance(v, float) and math.isnan(v): return None
    try: return float(v)
    except Exception: return None


def _ratio(numer: float | None, denom: float | None, nd: int = 2) -> float | None:
    """numer/denom — 분모가 양수일 때만. 적자(음수 netIncome) 등은 None."""
    if numer is None or denom is None or denom <= 0:
        return None
    return round(numer / denom, nd)


def _median_price(tk, info) -> float | None:
    """yfinance 4개 메서드 시세 → 중앙값. 이상치 방지 (라-1)."""
    prices = []
    for v in (info.get('regularMarketPrice'),
              info.get('currentPrice'),
              info.get('previousClose')):
        x = _safe_float(v)
        if x and x > 0:
            prices.append(x)
    # fast_info
    try:
        fi = tk.fast_info
        x = _safe_float(getattr(fi, 'last_price', None))
        if x and x > 0:
            prices.append(x)
    except Exception:
        pass
    # history 마지막 종가
    try:
        h = tk.history(period='5d', interval='1d')
        if not h.empty:
            x = _safe_float(h['Close'].iloc[-1])
            if x and x > 0:
                prices.append(x)
    except Exception:
        pass
    if not prices:
        return None
    prices.sort()
    return prices[len(prices) // 2]   # 중앙값


def _eps_growth_3y(tk, ticker: str | None = None, shares: float | None = None,
                   api_key: str | None = None, corpmap: dict | None = None) -> float | None:
    """yfinance income_stmt 우선, 실패 시 DART 사업보고서 3년 폴백 (마-3)."""
    # 1. yfinance 우선
    try:
        is_ = tk.income_stmt
        if is_ is not None and not is_.empty:
            # Diluted EPS 우선, 없으면 Net Income / Diluted Shares 계산
            eps_row = None
            for name in ('Diluted EPS', 'Basic EPS'):
                if name in is_.index:
                    eps_row = is_.loc[name]
                    break
            if eps_row is None:
                ni_row = is_.loc['Net Income'] if 'Net Income' in is_.index else None
                ds_row = is_.loc['Diluted Average Shares'] if 'Diluted Average Shares' in is_.index else None
                if ni_row is not None and ds_row is not None:
                    eps_series = []
                    for col in is_.columns:
                        ni = _safe_float(ni_row.get(col))
                        ds = _safe_float(ds_row.get(col))
                        if ni and ds and ds > 0:
                            eps_series.append(ni / ds)
                        else:
                            eps_series.append(None)
                else:
                    eps_series = []
            else:
                eps_series = [_safe_float(v) for v in eps_row]
            valid = [x for x in eps_series if x is not None and x > 0]
            if len(valid) >= 4:
                # 가장 최근 3년 성장률 평균 (분기 YoY 가 아닌 연간 비교)
                growths = []
                for i in range(min(3, len(valid) - 1)):
                    prev, curr = valid[i+1], valid[i]
                    if prev != 0:
                        growths.append((curr / prev - 1) * 100)
                if growths:
                    return round(sum(growths) / len(growths), 2)
    except Exception:
        pass
    # 2. DART 폴백
    if ticker and api_key and corpmap:
        return _eps_growth_3y_dart(ticker, shares, api_key, corpmap)
    return None


def summarize_one(ticker: str, kr_dart: dict) -> dict | None:
    """yfinance Ticker.info(시세) + DART 재무 → 비율 dict (TTM 우선).

    PER = marketCap / TTM netIncome (폴백 연간), PSR = marketCap / TTM revenue
    (폴백 연간 → yfinance priceToSalesTrailing12Months), PBR = marketCap / totalEquity,
    EV/EBITDA 는 yfinance 값. _basis 키로 TTM/연간 사용 여부 명시.

    Returns: dict (per/pbr/psr/evEbitda 중 하나라도 가용 시) 또는 None (전 미가용).
    """
    dart_entry = kr_dart.get(ticker, {}) or {}

    # TTM 우선, 폴백은 연간
    net_income = _safe_float(dart_entry.get("netIncome_ttm")) \
        if dart_entry.get("netIncome_ttm") is not None else _safe_float(dart_entry.get("netIncome_annual"))
    revenue = _safe_float(dart_entry.get("revenue_ttm")) \
        if dart_entry.get("revenue_ttm") is not None else _safe_float(dart_entry.get("revenue_annual"))
    equity = _safe_float(dart_entry.get("totalEquity"))
    ni_basis  = "ttm" if dart_entry.get("netIncome_ttm") is not None else "annual"
    rev_basis = "ttm" if dart_entry.get("revenue_ttm")   is not None else "annual"

    try:
        # 한국 종목은 .KS (KOSPI) 또는 .KQ (KOSDAQ). 우선 .KS 시도, 시세 미가용 시 .KQ 폴백.
        for suffix in (".KS", ".KQ"):
            try:
                tk = yf.Ticker(ticker + suffix)
                info = tk.info or {}
                if not info or "symbol" not in info:
                    continue
                mc_info    = _safe_float(info.get("marketCap"))
                ev_ebitda  = _safe_float(info.get("enterpriseToEbitda"))
                psr_yf     = _safe_float(info.get("priceToSalesTrailing12Months"))
                # 시세 데이터가 전혀 없으면 (thin .KS 응답) 다음 접미로 (suffix 선택 로직 유지)
                if mc_info is None and psr_yf is None and ev_ebitda is None:
                    continue

                shares = _safe_float(info.get("sharesOutstanding"))

                # 라-1: 4개 메서드 중앙값 시세 × 주식수 → marketCap (이상치 방지), 실패 시 info.marketCap 폴백
                price = _median_price(tk, info)
                market_cap = (price * shares) if (price and shares) else mc_info
                forward_per   = _safe_float(info.get("forwardPE"))   # 마-2 (한국 종목 대부분 미제공)
                eps_growth_3y = _eps_growth_3y(tk, ticker=ticker, shares=shares,
                                               api_key=DART_API_KEY, corpmap=DART_CORPMAP)  # 마-3 (yfinance→DART 폴백)

                per = _ratio(market_cap, net_income)   # marketCap / TTM netIncome
                pbr = _ratio(market_cap, equity)       # marketCap / totalEquity
                psr = _ratio(market_cap, revenue)      # marketCap / TTM revenue
                if psr is None:                        # yfinance 폴백
                    psr = psr_yf

                # 마-1: PEG = PER / 성장률 (revenueGrowthYoY 우선, epsGrowth 폴백)
                growth = _safe_float(dart_entry.get("revenueGrowthYoY")) or _safe_float(dart_entry.get("epsGrowth"))
                peg = _ratio(per, growth) if (per is not None and growth and growth > 0) else None

                # 주당 순자산 (book value per share) = 자본총계 / 주식수 (DART 우선, 없으면 yfinance)
                book_value = round(equity / shares) if (equity and shares) else _safe_float(info.get("bookValue"))

                if per is None and pbr is None and psr is None and ev_ebitda is None:
                    continue
                return {
                    "per":         per,
                    "pbr":         pbr,
                    "psr":         psr,
                    "evEbitda":    ev_ebitda,
                    "peg":         peg,            # 신규 (마-1)
                    "forwardPer":  forward_per,    # 신규 (마-2)
                    "epsGrowth3y": eps_growth_3y,  # 신규 (마-3)
                    "marketCap":         market_cap,
                    "sharesOutstanding": shares,
                    "bookValue":         book_value,
                    "_basis": {
                        "netIncome": ni_basis,   # "ttm" 또는 "annual"
                        "revenue":   rev_basis,
                        "price":     "median" if price else "fallback",
                    },
                }
            except Exception:
                continue
        return None
    except Exception as e:
        print(f"  ! {ticker} 예외: {e}", file=sys.stderr)
        return None


# === 검증 및 알림 (1·2단계 패턴) ===
def _notify(title: str, message: str, ok: bool = True) -> None:
    import subprocess
    sound = "default" if ok else "Basso"
    safe_t = title.replace('"', "'")
    safe_m = message.replace('"', "'")
    script = f'display notification "{safe_m}" with title "{safe_t}" sound name "{sound}"'
    try:
        subprocess.run(["osascript", "-e", script], check=False, capture_output=True, timeout=5)
    except Exception:
        pass


def _validate(result, output_path) -> tuple[bool, str]:
    n_ok = result["tickerCount"]
    n_fail = len(result.get("failed", []))
    n_total = n_ok + n_fail
    size_kb = output_path.stat().st_size / 1024

    if n_total == 0 or n_ok / n_total < 0.85:
        return False, f"성공률 {n_ok}/{n_total} ({n_ok/max(n_total,1)*100:.1f}%) < 85%"
    if n_ok < 280:
        return False, f"성공 종목 {n_ok} < 280"

    # 핵심 5종 PER 또는 PBR 중 하나는 채워져야
    KEY = ["005930", "000660", "247540", "263750", "041510"]
    for t in KEY:
        d = result["data"].get(t)
        if not d:
            return False, f"핵심 종목 {t} 누락"
        if d.get("per") is None and d.get("pbr") is None:
            return False, f"핵심 종목 {t} PER·PBR 모두 미가용"

    if size_kb < 30:
        return False, f"파일 크기 {size_kb:.0f} KB < 30 KB"

    # TTM 채택 + 신규 지표 가용률 카운트 (투명성)
    n_ttm_ni = sum(1 for v in result["data"].values() if (v or {}).get("_basis", {}).get("netIncome") == "ttm")
    n_peg = sum(1 for v in result["data"].values() if v and v.get("peg") is not None)
    n_fpe = sum(1 for v in result["data"].values() if v and v.get("forwardPer") is not None)
    n_eps3y = sum(1 for v in result["data"].values() if v and v.get("epsGrowth3y") is not None)
    return True, f"성공 {n_ok}/{n_total} (TTM netIncome {n_ttm_ni}/{n_ok}, PEG {n_peg}, Fwd PER {n_fpe}, EPS3y {n_eps3y}, {size_kb:.0f} KB)"


def _auto_push(file_path, commit_subject: str) -> tuple[bool, str]:
    import subprocess
    repo_root = file_path.parent.parent.parent
    rel_path = file_path.relative_to(repo_root)

    def _git(*args, timeout=60):
        return subprocess.run(["git", "-C", str(repo_root), *args],
                              capture_output=True, timeout=timeout)

    try:
        r = _git("add", str(rel_path))
        if r.returncode != 0:
            return False, f"add 실패: {r.stderr.decode('utf-8', errors='ignore')[:100]}"
        r = _git("diff", "--cached", "--quiet")
        if r.returncode == 0:
            return True, "변경 없음 (스킵)"
        r = _git("commit", "-m", commit_subject, timeout=30)
        if r.returncode != 0:
            return False, f"commit 실패: {r.stderr.decode('utf-8', errors='ignore')[:100]}"
        r = _git("push", "origin", "main", timeout=120)
        if r.returncode != 0:
            return False, f"push 실패: {r.stderr.decode('utf-8', errors='ignore')[:100]}"
        return True, "푸시 완료"
    except subprocess.TimeoutExpired:
        return False, "타임아웃"
    except Exception as e:
        return False, f"예외: {str(e)[:80]}"


def _parse_args():
    p = argparse.ArgumentParser(description="KR 종목 비율 정적 수집 (yfinance 시세 + DART 재무 결합)")
    p.add_argument("--auto-push", action="store_true",
                   help="검증 통과 시 자동 git add/commit/push")
    return p.parse_args()


def main() -> int:
    global DART_API_KEY, DART_CORPMAP
    args = _parse_args()
    DART_API_KEY = _load_dart_key()
    DART_CORPMAP = _load_corpmap()
    if DART_API_KEY is None:
        print("[경고] DART API 키 미가용 — EPS3y DART 폴백 비활성 (yfinance 만 사용)", file=sys.stderr)
    else:
        print(f"DART 폴백 활성 — corpmap {len(DART_CORPMAP)} 종목")

    dart = load_kr_dart()
    if not dart:
        print("KR 재무 데이터 비어있음 (kr-dart.json 먼저 갱신 필요)", file=sys.stderr)
        return 2
    tickers = sorted(dart.keys())

    print(f"대상 ticker: {len(tickers)} 개 (yfinance .KS/.KQ 시세 + DART 재무)")
    print(f"출력: {OUTPUT_JSON}\n")

    data: dict[str, dict] = {}
    failed: list[str] = []

    for i, t in enumerate(tickers, 1):
        print(f"[{i:3}/{len(tickers)}] {t} ... ", end="", flush=True)
        summary = summarize_one(t, dart)   # 전체 dart 전달 (load_kr_dart TTM 구조)
        if summary is None:
            print("실패")
            failed.append(t)
            time.sleep(THROTTLE_SEC)
            continue
        data[t] = summary
        # 핵심 비율 한 줄
        per = summary.get("per")
        pbr = summary.get("pbr")
        print(f"OK (PER {per}, PBR {pbr})")
        time.sleep(THROTTLE_SEC)

    now = datetime.now()
    valid_until = (now + timedelta(days=90)).strftime("%Y-%m-%d")
    result = {
        "generatedAt": now.isoformat(timespec="seconds"),
        "validUntil": valid_until,
        "tickerCount": len(data),
        "data": data,
        "failed": failed,
    }

    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_JSON.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    size_kb = OUTPUT_JSON.stat().st_size // 1024
    print(f"\n저장: {OUTPUT_JSON} ({size_kb} KB)")
    print(f"성공: {len(data)}, 실패: {len(failed)}")

    # 검증 + 알림 + 자동 푸시
    ok, reason = _validate(result, OUTPUT_JSON)
    if not ok:
        print(f"\n[검증 실패] {reason}", file=sys.stderr)
        _notify("❌ KR 비율 갱신 실패", reason, ok=False)
        return 1

    print(f"\n[검증 통과] {reason}")

    if args.auto_push:
        subj = f"chore(data): kr-metrics 자동 갱신 — {reason}"
        push_ok, push_msg = _auto_push(OUTPUT_JSON, subj)
        if push_ok:
            if push_msg == "변경 없음 (스킵)":
                _notify("✅ KR 비율 갱신 통과 (변경 없음)", reason, ok=True)
            else:
                _notify("🚀 KR 비율 자동 푸시 완료", f"{reason} | {push_msg}", ok=True)
            return 0
        else:
            print(f"\n[푸시 실패] {push_msg}", file=sys.stderr)
            _notify("⚠ KR 비율 갱신 통과, 푸시 실패", push_msg, ok=False)
            return 1
    else:
        _notify("✅ KR 비율 갱신 통과", f"{reason}. 수동 푸시 가능.", ok=True)
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
