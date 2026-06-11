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
        return out
    except Exception as e:
        print(f"  ! {t} 예외: {e}", file=sys.stderr)
        return None


def main() -> int:
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
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
