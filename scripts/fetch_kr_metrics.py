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
                market_cap = _safe_float(info.get("marketCap"))
                ev_ebitda  = _safe_float(info.get("enterpriseToEbitda"))
                psr_yf     = _safe_float(info.get("priceToSalesTrailing12Months"))
                # 시세 데이터가 전혀 없으면 (thin .KS 응답) 다음 접미로
                if market_cap is None and psr_yf is None and ev_ebitda is None:
                    continue

                shares = _safe_float(info.get("sharesOutstanding"))

                per = _ratio(market_cap, net_income)   # marketCap / TTM netIncome
                pbr = _ratio(market_cap, equity)       # marketCap / totalEquity
                psr = _ratio(market_cap, revenue)      # marketCap / TTM revenue
                if psr is None:                        # yfinance 폴백
                    psr = psr_yf

                # 주당 순자산 (book value per share) = 자본총계 / 주식수 (DART 우선, 없으면 yfinance)
                book_value = round(equity / shares) if (equity and shares) else _safe_float(info.get("bookValue"))

                if per is None and pbr is None and psr is None and ev_ebitda is None:
                    continue
                return {
                    "per":      per,
                    "pbr":      pbr,
                    "psr":      psr,
                    "evEbitda": ev_ebitda,
                    "marketCap":         market_cap,
                    "sharesOutstanding": shares,
                    "bookValue":         book_value,
                    "_basis": {
                        "netIncome": ni_basis,   # "ttm" 또는 "annual"
                        "revenue":   rev_basis,
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

    # TTM 채택 카운트 (투명성)
    n_ttm_ni = sum(1 for v in result["data"].values() if (v or {}).get("_basis", {}).get("netIncome") == "ttm")
    return True, f"성공 {n_ok}/{n_total} (TTM netIncome {n_ttm_ni}/{n_ok}, {size_kb:.0f} KB)"


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
    args = _parse_args()
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
