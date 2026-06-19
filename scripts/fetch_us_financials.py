#!/usr/bin/env python3
"""
US 종목 재무 절대값 정적 수집 — yfinance.

용도:
    Finnhub /stock/metric 은 비율만 제공 → 함정 경고·DuPont 분해의 US 활성화를 위해
    매출·총자산·자본·순이익·OCF 절대값을 별도 수집.

사용:
    cd /Users/hyone/Documents/ClaudeCode/Work/CompanyAnalysis
    python3 workspace/CA_Project/scripts/fetch_us_financials.py

출력:
    workspace/CA_Project/js/data/us-financials.json
    형식:
      {
        "generatedAt": "2026-06-11T...",
        "validUntil": "2026-09-11",
        "tickerCount": 600,
        "data": {
          "AAPL": {
            "revenue": 391035000000,
            "operatingIncome": 123216000000,
            "netIncome": 93736000000,
            "totalAssets": 364980000000,
            "totalLiabilities": 308030000000,
            "totalEquity": 56950000000,
            "ocf": 118254000000,
            "fiscalYear": 2024
          },
          ...
        },
        "failed": ["TICKER1", ...]
      }

호출량 절약:
    yfinance Ticker.info 활용 (재무제표 한 번에 받음). 종목당 약 0.3~0.5초.
    Yahoo 차단 우려 시 sleep 추가 (현재는 미설정 — yfinance 내부 throttle).

운영 주기: 분기 1회 (사업보고서 갱신 시점).
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path
from datetime import datetime, timedelta

try:
    import yfinance as yf
except ImportError:
    print("yfinance 가 설치되지 않았습니다. pip3 install yfinance", file=sys.stderr)
    sys.exit(2)

# === 경로 ===
REPO_ROOT = Path(__file__).resolve().parent.parent  # workspace/CA_Project/
SYMBOLS_US_EXTRA_JSON = REPO_ROOT / "js" / "data" / "symbols-us-extra.json"
ETF_US_EXTRA_JSON = REPO_ROOT / "js" / "data" / "etf-us-extra.json"
OUTPUT_JSON = REPO_ROOT / "js" / "data" / "us-financials.json"

# 하드코딩 US 종목 (symbols.js 와 동기화)
HARDCODED_US = [
    "AAPL", "MSFT", "NVDA", "GOOGL", "GOOG", "AMZN", "META", "TSLA",
    "AMD", "AVGO", "TSM", "JPM", "BAC", "V", "WMT", "KO",
    "BK", "FI", "MMC", "PARA",   # 4종목 보강 후 (이 작업 전에 추가됐다면 자동 포함됨)
    # 4순위 가 보강 (2026-06-12)
    "UBER", "LYFT", "SNAP", "PINS", "SHOP", "SQ", "SOFI", "HOOD",
    "SNOW", "U", "NET", "OKTA", "DKNG", "RBLX", "RIVN", "LCID",
    "NIO", "XPEV", "BABA", "TME", "SE", "GRAB", "DOCN", "TWLO",
    "ZM", "ROKU", "SPOT", "ETSY", "BNTX", "NVAX",
]


def load_tickers() -> list[str]:
    tickers: set[str] = set(HARDCODED_US)
    if SYMBOLS_US_EXTRA_JSON.exists():
        d = json.loads(SYMBOLS_US_EXTRA_JSON.read_text(encoding="utf-8"))
        for s in d.get("symbols", []):
            t = s.get("ticker")
            if t:
                tickers.add(t)
    # ETF 는 fundamentals 가 없는 경우가 많아 제외 (DuPont·함정 경고는 stock 기준)
    return sorted(tickers)


def _latest(df, *names) -> float | None:
    """재무제표 DataFrame 에서 주어진 라인 항목의 최신(첫 열) 유효값을 반환.

    yfinance 1.2.x 의 .balance_sheet / .income_stmt / .cashflow 는 행=계정, 열=결산일(최신순).
    info 딕셔너리에는 totalAssets·operatingIncome 등 절대값이 더 이상 없어 statement 에서 직접 추출.
    """
    if df is None or getattr(df, "empty", True):
        return None
    for nm in names:
        if nm in df.index:
            for v in df.loc[nm]:
                if v is not None and not (isinstance(v, float) and math.isnan(v)):
                    return float(v)
    return None


def _col_to_label(col) -> str | None:
    """datetime 컬럼명 → 'YYQn' 라벨 변환 ('2025-03-31' → '25Q1')."""
    try:
        y = col.year % 100
        m = col.month
        q = (m - 1) // 3 + 1
        return f"{y:02d}Q{q}"
    except Exception:
        return None


def _quarterly_series(df, *names) -> list[float | None] | None:
    """분기 DataFrame 의 첫 매칭 라인을 최대 4 분기 시계열로 반환 (최신 → 과거).

    DataFrame 형태: 행=계정, 열=분기 결산일(최신순). yfinance 1.2.x quarterly_*.
    """
    if df is None or getattr(df, "empty", True):
        return None
    for nm in names:
        if nm in df.index:
            row = df.loc[nm]
            series = []
            for v in row[:4]:  # 최대 4 분기
                if v is None or (isinstance(v, float) and math.isnan(v)):
                    series.append(None)
                else:
                    series.append(float(v))
            return series
    return None


def summarize_one(ticker_obj, t: str) -> dict | None:
    """yfinance Ticker → 절대값 요약 dict.

    절대값(totalAssets·operatingIncome 등)은 statement 우선, info 는 보조 폴백.
    """
    try:
        info = ticker_obj.info or {}
        # statement 들 (각 속성 접근이 Yahoo 호출 유발 — 예외 시 None)
        try:    bs = ticker_obj.balance_sheet
        except Exception: bs = None
        try:    is_ = ticker_obj.income_stmt
        except Exception: is_ = None
        try:    cf = ticker_obj.cashflow
        except Exception: cf = None

        revenue = _latest(is_, "Total Revenue", "Operating Revenue") or info.get("totalRevenue")
        operating_income = _latest(is_, "Operating Income", "EBIT")
        net_income = (_latest(is_, "Net Income", "Net Income Common Stockholders")
                      or info.get("netIncomeToCommon") or info.get("netIncome"))
        total_assets = _latest(bs, "Total Assets")
        total_liabilities = _latest(bs, "Total Liabilities Net Minority Interest")
        equity = _latest(bs, "Stockholders Equity", "Total Equity Gross Minority Interest")
        if equity is None and info.get("bookValue") and info.get("sharesOutstanding"):
            equity = info["bookValue"] * info["sharesOutstanding"]   # 폴백: 주당순자산×주식수
        ocf = _latest(cf, "Operating Cash Flow") or info.get("operatingCashflow")

        # 부채 폴백: 자산−자본 역산
        if total_liabilities is None and total_assets is not None and equity is not None:
            total_liabilities = total_assets - equity

        # 결산연도: balance_sheet 최신 열 우선
        fiscal_year = None
        if bs is not None and not getattr(bs, "empty", True) and len(bs.columns):
            try:    fiscal_year = bs.columns[0].year
            except Exception: fiscal_year = None
        if fiscal_year is None and info.get("lastFiscalYearEnd"):
            try:    fiscal_year = datetime.fromtimestamp(info["lastFiscalYearEnd"]).year
            except Exception: fiscal_year = None

        if revenue is None and net_income is None:
            return None

        out = {
            "revenue": revenue,
            "operatingIncome": operating_income,
            "netIncome": net_income,
            "totalAssets": total_assets,
            "totalLiabilities": total_liabilities,
            "totalEquity": equity,
            "ocf": ocf,
            "fiscalYear": fiscal_year,
        }
        # 모두 None 이면 제외
        if not any(v is not None for v in out.values() if isinstance(v, (int, float))):
            return None

        # === 분기 시계열 수집 ===
        try:    q_is  = ticker_obj.quarterly_income_stmt
        except Exception: q_is = None
        try:    q_cf  = ticker_obj.quarterly_cashflow
        except Exception: q_cf = None

        # labels 는 quarterly_income_stmt 의 컬럼 (최대 4 분기, 최신순)
        ts_labels: list[str] = []
        if q_is is not None and not getattr(q_is, "empty", True):
            for col in q_is.columns[:4]:
                lbl = _col_to_label(col)
                if lbl:
                    ts_labels.append(lbl)

        if ts_labels:
            ts_revenue  = _quarterly_series(q_is, "Total Revenue", "Operating Revenue") or [None] * len(ts_labels)
            ts_op_inc   = _quarterly_series(q_is, "Operating Income", "EBIT") or [None] * len(ts_labels)
            ts_net_inc  = _quarterly_series(q_is, "Net Income", "Net Income Common Stockholders") or [None] * len(ts_labels)
            ts_ocf      = _quarterly_series(q_cf, "Operating Cash Flow") or [None] * len(ts_labels)

            # opMargin 계산 — revenue·operatingIncome 둘 다 있는 분기만 채움
            ts_op_margin = []
            for r, o in zip(ts_revenue, ts_op_inc):
                if r and o is not None and r != 0:
                    ts_op_margin.append(round(o / r * 100, 2))
                else:
                    ts_op_margin.append(None)

            # 길이 정합성 보강 — labels 와 동일 길이로 자름
            n = len(ts_labels)
            out["timeseries"] = {
                "labels":          ts_labels,
                "revenue":         ts_revenue[:n],
                "operatingIncome": ts_op_inc[:n],
                "netIncome":       ts_net_inc[:n],
                "ocf":             ts_ocf[:n],
                "opMargin":        ts_op_margin[:n],
            }
        # 시계열 미가용 시 timeseries 키 자체를 빼서 adapter 가 빈 결과로 처리하게 함

        return out
    except Exception as e:
        print(f"  ! {t} 예외: {e}", file=sys.stderr)
        return None


def _notify(title: str, message: str, ok: bool = True) -> None:
    """macOS 알림 (osascript). 실패해도 무시."""
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

    if n_total == 0 or n_ok / n_total < 0.97:
        return False, f"성공률 {n_ok}/{n_total} ({n_ok/max(n_total,1)*100:.1f}%) < 97%"
    if n_ok < 480:
        return False, f"성공 종목 {n_ok} < 480"

    # timeseries 가용성 ≥ 96%
    with_ts = sum(1 for v in result["data"].values() if v and v.get("timeseries"))
    if with_ts / max(n_ok, 1) < 0.96:
        return False, f"timeseries 가용 {with_ts}/{n_ok} ({with_ts/max(n_ok,1)*100:.1f}%) < 96%"

    # 핵심 5종: revenue + timeseries labels 채워짐
    KEY = ["AAPL", "MSFT", "NVDA", "JPM", "BAC"]
    for t in KEY:
        d = result["data"].get(t)
        if not d:
            return False, f"핵심 종목 {t} 누락"
        if not d.get("revenue") or d.get("revenue") <= 0:
            return False, f"핵심 종목 {t} revenue 미가용"
        ts = d.get("timeseries") or {}
        if not ts.get("labels") or len(ts["labels"]) < 4:
            return False, f"핵심 종목 {t} timeseries 4분기 미달"

    if size_kb < 480:
        return False, f"파일 크기 {size_kb:.0f} KB < 480 KB"

    return True, f"성공 {n_ok}/{n_total}, 시계열 가용 {with_ts}/{n_ok} ({size_kb:.0f} KB)"


def _auto_push(file_path, commit_subject: str) -> tuple[bool, str]:
    """검증 통과 시 자동 git add → commit → push.

    Returns: (ok: bool, message: str)
    - 변경 사항 없으면 (True, "변경 없음 (스킵)")
    - 푸시 성공 시 (True, "푸시 완료")
    - 실패 시 (False, 에러 메시지 100자)
    """
    import subprocess
    repo_root = file_path.parent.parent.parent   # workspace/CA_Project
    rel_path = file_path.relative_to(repo_root)

    def _git(*args, timeout=60):
        return subprocess.run(
            ["git", "-C", str(repo_root), *args],
            capture_output=True, timeout=timeout
        )

    try:
        # 1. add
        r = _git("add", str(rel_path))
        if r.returncode != 0:
            return False, f"add 실패: {r.stderr.decode('utf-8', errors='ignore')[:100]}"

        # 2. 변경 사항 확인 — staged diff 비어있으면 스킵
        r = _git("diff", "--cached", "--quiet")
        if r.returncode == 0:
            return True, "변경 없음 (스킵)"

        # 3. commit
        r = _git("commit", "-m", commit_subject, timeout=30)
        if r.returncode != 0:
            return False, f"commit 실패: {r.stderr.decode('utf-8', errors='ignore')[:100]}"

        # 4. push
        r = _git("push", "origin", "main", timeout=120)
        if r.returncode != 0:
            return False, f"push 실패: {r.stderr.decode('utf-8', errors='ignore')[:100]}"

        return True, "푸시 완료"
    except subprocess.TimeoutExpired:
        return False, "타임아웃 (60s+)"
    except Exception as e:
        return False, f"예외: {str(e)[:80]}"


def _parse_args():
    import argparse
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--auto-push", action="store_true",
                   help="검증 통과 시 자동 git add/commit/push (기본: 수동)")
    return p.parse_args()


def main() -> int:
    args = _parse_args()
    tickers = load_tickers()
    print(f"대상 ticker: {len(tickers)} 개 (stock 만)")
    print(f"출력: {OUTPUT_JSON}\n")

    data: dict[str, dict] = {}
    failed: list[str] = []

    for i, t in enumerate(tickers, 1):
        print(f"[{i:3}/{len(tickers)}] {t} ... ", end="", flush=True)
        try:
            tk = yf.Ticker(t)
            summary = summarize_one(tk, t)
            if summary is None:
                print("실패")
                failed.append(t)
                continue
            data[t] = summary
            print("OK")
        except Exception as e:
            print(f"예외: {e}")
            failed.append(t)

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
    if failed[:10]:
        print(f"실패 예시(상위 10): {failed[:10]}")

    ok, reason = _validate(result, OUTPUT_JSON)
    if not ok:
        print(f"\n[검증 실패] {reason}", file=sys.stderr)
        _notify("❌ US 재무 갱신 실패", reason, ok=False)
        return 1

    print(f"\n[검증 통과] {reason}")

    # 자동 푸시 분기 (--auto-push 일 때만)
    if args.auto_push:
        subj = f"chore(data): us-financials 자동 갱신 — {reason}"
        push_ok, push_msg = _auto_push(OUTPUT_JSON, subj)
        if push_ok:
            if push_msg == "변경 없음 (스킵)":
                _notify("✅ us-financials 갱신 통과 (변경 없음)", reason, ok=True)
            else:
                _notify("🚀 us-financials 자동 푸시 완료", f"{reason} | {push_msg}", ok=True)
            return 0
        else:
            print(f"\n[푸시 실패] {push_msg}", file=sys.stderr)
            _notify("⚠ us-financials 갱신 통과, 푸시 실패", push_msg, ok=False)
            return 1
    else:
        _notify("✅ US 재무 갱신 통과", f"{reason}. 수동 푸시 가능.", ok=True)
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
