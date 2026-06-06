#!/usr/bin/env python3
"""
S&P500 + NASDAQ100 사전 확장 — Finnhub /stock/profile2 호출.

용도:
    검색·분석 화면에서 즉시 사용 가능한 미국 대형주 마스터 확장.
    SYMBOLS_US (현재 symbols.js 하드코딩 약 20개) 외 추가 약 500여 개.

사용:
    export FINNHUB_KEY="$(cat ~/.secrets/finnhub_key)"
    python3 scripts/fetch_us_symbols_extra.py
    → js/data/symbols-us-extra.json 생성 (repo: CA_Project/scripts 에서 실행)

출력 형식:
    {
      "generatedAt": "2026-06-05T12:30:00",
      "count": 587,
      "symbols": [
        { "ticker": "AAPL", "nameKr": "Apple Inc", "nameEn": "Apple Inc",
          "market": "us", "exchange": "NASDAQ", "sector": "Technology",
          "industry": "Consumer Electronics", "type": "stock",
          "weburl": "https://www.apple.com/", "logo": "..." },
        ...
      ]
    }

호출량: 약 500여 × 1회 = 분당 약 55회 한도로 약 10분 소요.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path
from datetime import datetime

REPO_ROOT = Path(__file__).resolve().parent.parent  # CA_Project/ (git repo root)
OUTPUT_JSON = REPO_ROOT / "js" / "data" / "symbols-us-extra.json"

FINNHUB_BASE = "https://finnhub.io/api/v1"
REQ_INTERVAL_SEC = 1.1     # 분당 약 55 호출 (안전 마진)
RETRY_COUNT = 2


# === S&P500 + NASDAQ-100 ticker 목록 (중복 제거) ===
# 시점에 따라 편입·편출이 있으므로 1~2년에 1회 갱신 권장.
# 출처: S&P 500, Nasdaq-100 구성종목 (공개 자료 기준, 2026-05 시점 근사).
# Finnhub 표기 규칙: 클래스주는 점 표기 (BRK.B, BF.B). 합병·티커변경 반영.
TICKERS = sorted(set([
    # ── Information Technology ──
    "AAPL", "MSFT", "NVDA", "AVGO", "ORCL", "CRM", "ADBE", "AMD", "CSCO", "ACN",
    "INTC", "IBM", "TXN", "QCOM", "INTU", "NOW", "AMAT", "ADI", "MU", "LRCX",
    "KLAC", "SNPS", "CDNS", "NXPI", "MCHP", "FTNT", "PANW", "ANSS", "ROP", "MSI",
    "GLW", "HPQ", "HPE", "DELL", "WDC", "STX", "KEYS", "TEL", "APH", "TDY",
    "ZBRA", "TRMB", "JNPR", "FFIV", "AKAM", "NTAP", "SWKS", "QRVO", "MPWR", "ON",
    "TER", "ENPH", "FSLR", "GEN", "PTC", "TYL", "CDW", "JBL", "SMCI", "ANET",
    "CRWD", "GDDY", "EPAM", "FICO", "IT", "CTSH", "VRSN", "WDAY", "GFS", "ARM",
    "APP", "PLTR",
    # ── Communication Services ──
    "GOOGL", "GOOG", "META", "NFLX", "DIS", "CMCSA", "T", "VZ", "TMUS", "CHTR",
    "EA", "TTWO", "WBD", "OMC", "IPG", "LYV", "MTCH", "NWSA", "NWS", "FOXA",
    "FOX", "PARA",
    # ── Consumer Discretionary ──
    "AMZN", "TSLA", "HD", "MCD", "NKE", "LOW", "SBUX", "BKNG", "TJX", "ORLY",
    "AZO", "ROST", "MAR", "GM", "F", "HLT", "YUM", "CMG", "DHI", "LEN",
    "NVR", "PHM", "GRMN", "EBAY", "APTV", "LVS", "WYNN", "MGM", "RCL", "CCL",
    "NCLH", "DRI", "EXPE", "ULTA", "BBY", "DPZ", "POOL", "TSCO", "KMX", "BWA",
    "LKQ", "WHR", "HAS", "RL", "TPR", "MHK", "DECK", "LULU", "GPC", "ABNB",
    "DASH", "CZR", "BLDR", "HRB",
    # ── Consumer Staples ──
    "PG", "KO", "PEP", "COST", "WMT", "PM", "MO", "MDLZ", "CL", "KMB",
    "GIS", "KHC", "STZ", "SYY", "KR", "HSY", "MKC", "ADM", "KDP", "MNST",
    "CHD", "CLX", "TSN", "CAG", "CPB", "HRL", "SJM", "K", "TAP", "BF.B",
    "LW", "BG", "DG", "DLTR", "TGT", "WBA", "KVUE",
    # ── Energy ──
    "XOM", "CVX", "COP", "EOG", "SLB", "MPC", "PSX", "VLO", "OXY", "WMB",
    "KMI", "OKE", "HAL", "BKR", "DVN", "FANG", "HES", "CTRA", "APA", "EQT",
    "TRGP", "TPL",
    # ── Financials ──
    "BRK.B", "JPM", "V", "MA", "BAC", "WFC", "GS", "MS", "AXP", "SPGI",
    "BLK", "C", "SCHW", "CB", "PGR", "MMC", "CME", "ICE", "AON", "PNC",
    "USB", "TFC", "AJG", "MET", "AIG", "PRU", "TRV", "AFL", "ALL", "MSCI",
    "BK", "STT", "COF", "DFS", "FI", "GPN", "PYPL", "MCO", "NDAQ", "CBOE",
    "FITB", "HBAN", "RF", "CFG", "KEY", "MTB", "NTRS", "WRB", "CINF", "HIG",
    "PFG", "L", "GL", "AIZ", "BRO", "RJF", "AMP", "TROW", "IVZ", "BEN",
    "WTW", "ACGL", "EG", "JKHY", "FDS", "MKTX", "COIN",
    # ── Health Care ──
    "LLY", "UNH", "JNJ", "MRK", "ABBV", "TMO", "ABT", "DHR", "PFE", "AMGN",
    "BMY", "ISRG", "MDT", "GILD", "VRTX", "REGN", "CI", "CVS", "ELV", "HUM",
    "ZTS", "BSX", "SYK", "BDX", "HCA", "MCK", "CAH", "COR", "EW", "IDXX",
    "IQV", "A", "RMD", "BIIB", "MTD", "WST", "DXCM", "ZBH", "BAX", "STE",
    "WAT", "HOLX", "COO", "MRNA", "ALGN", "MOH", "CNC", "DGX", "LH", "PODD",
    "TECH", "RVTY", "CRL", "INCY", "UHS", "DVA", "HSIC", "XRAY", "VTRS", "SOLV",
    "GEHC",
    # ── Industrials ──
    "GE", "CAT", "RTX", "HON", "UNP", "BA", "LMT", "DE", "UPS", "ADP",
    "GD", "NOC", "ETN", "ITW", "EMR", "CSX", "NSC", "FDX", "PH", "TT",
    "GWW", "CARR", "OTIS", "PCAR", "CMI", "ROK", "AME", "FAST", "PAYX", "ODFL",
    "CTAS", "VRSK", "WM", "RSG", "EFX", "DOV", "IR", "XYL", "HWM", "AXON",
    "LHX", "TDG", "URI", "FTV", "CPRT", "WAB", "BR", "JCI", "PWR", "EXPD",
    "JBHT", "CHRW", "SNA", "SWK", "PNR", "ALLE", "NDSN", "ROL", "MAS", "IEX",
    "TXT", "HII", "GNRC", "PAYC", "J", "ACM", "EME", "FBIN", "DAY", "CSGP",
    "GEV", "VLTO",
    # ── Materials ──
    "LIN", "APD", "SHW", "FCX", "ECL", "NEM", "NUE", "DOW", "DD", "CTVA",
    "PPG", "VMC", "MLM", "ALB", "IFF", "LYB", "STLD", "CF", "MOS", "FMC",
    "EMN", "CE", "AMCR", "AVY", "PKG", "IP", "BALL", "SW",
    # ── Real Estate ──
    "PLD", "AMT", "EQIX", "WELL", "SPG", "PSA", "O", "CCI", "DLR", "CBRE",
    "EXR", "AVB", "VTR", "EQR", "INVH", "IRM", "SBAC", "WY", "ARE", "MAA",
    "ESS", "KIM", "UDR", "HST", "REG", "BXP", "FRT", "CPT", "DOC", "VICI",
    # ── Utilities ──
    "NEE", "SO", "DUK", "CEG", "AEP", "SRE", "D", "EXC", "XEL", "PEG",
    "ED", "EIX", "WEC", "AWK", "DTE", "ETR", "PPL", "FE", "AEE", "ATO",
    "CMS", "CNP", "NI", "LNT", "EVRG", "ES", "PNW", "NRG", "AES", "PCG",
    # ── NASDAQ-100 추가 (S&P500 외 또는 보강) ──
    "PDD", "MELI", "ASML", "AZN", "ADSK", "DDOG", "TEAM", "ZS", "MDB", "CCEP",
    "BIDU", "JD", "ARGX", "TTD", "CSGP",
]))


def fetch_profile(ticker: str, key: str) -> dict | None:
    url = f"{FINNHUB_BASE}/stock/profile2?symbol={ticker}&token={key}"
    for attempt in range(RETRY_COUNT + 1):
        try:
            with urllib.request.urlopen(url, timeout=10) as r:
                body = r.read().decode("utf-8")
            data = json.loads(body)
            return data if data else None
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
            if attempt < RETRY_COUNT:
                time.sleep(0.5 * (attempt + 1))
                continue
            print(f"  ! {ticker}: {e}", file=sys.stderr)
            return None


def load_key() -> str | None:
    key = os.environ.get("FINNHUB_KEY")
    if key:
        return key.strip()
    key_file = Path.home() / ".secrets" / "finnhub_key"
    if key_file.exists():
        try:
            return key_file.read_text(encoding="utf-8").strip()
        except Exception:
            pass
    return None


def main() -> int:
    key = load_key()
    if not key:
        print(
            "Finnhub 키가 설정되지 않았습니다. 다음 중 하나로 설정하세요.\n"
            "  1) 환경변수: export FINNHUB_KEY=\"...\"\n"
            "  2) 키 파일: ~/.secrets/finnhub_key (chmod 600)\n",
            file=sys.stderr,
        )
        return 2

    print(f"대상 ticker: {len(TICKERS)} 개")
    print(f"호출 간격: {REQ_INTERVAL_SEC}s (분당 약 {int(60 / REQ_INTERVAL_SEC)} 호출)")
    print(f"출력: {OUTPUT_JSON}\n")

    symbols: list[dict] = []
    failed: list[str] = []

    for i, ticker in enumerate(TICKERS, 1):
        print(f"[{i:3}/{len(TICKERS)}] {ticker} ... ", end="", flush=True)
        p = fetch_profile(ticker, key)
        if not p or not p.get("name"):
            print("실패")
            failed.append(ticker)
            time.sleep(REQ_INTERVAL_SEC)
            continue

        name_en = p.get("name", ticker)
        symbols.append({
            "ticker": ticker,
            "nameKr": name_en,                  # 미국 종목은 영문명 그대로
            "nameEn": name_en,
            "market": "us",
            "exchange": p.get("exchange", "NASDAQ"),
            "sector": p.get("finnhubIndustry", "Unknown"),
            "industry": p.get("finnhubIndustry", "Unknown"),
            "type": "stock",
            "weburl": p.get("weburl") or None,
            "logo": p.get("logo") or None,
            "ipo": p.get("ipo") or None,
        })
        print(f"OK ({name_en})")
        time.sleep(REQ_INTERVAL_SEC)

    result = {
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "count": len(symbols),
        "symbols": symbols,
    }

    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_JSON.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n저장: {OUTPUT_JSON} ({OUTPUT_JSON.stat().st_size // 1024} KB)")
    print(f"성공: {len(symbols)}, 실패: {len(failed)}")
    if failed:
        print(f"실패 ticker: {failed}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
