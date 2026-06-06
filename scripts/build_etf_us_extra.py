#!/usr/bin/env python3
"""
미국 인기 ETF 사전 목록 → etf-us-extra.json 생성.

배경:
    Finnhub 무료 플랜 /stock/profile2 는 ETF 를 일절 반환하지 않는다(name=None).
    따라서 미국 ETF 는 API 수집이 불가능 → 검증된 인기 ETF 를 큐레이션 목록으로
    직접 보유하고, symbols-us-extra.json 과 동일한 형식으로 내보내 SYMBOLS 에 병합한다.

특징:
    - 네트워크/키 불필요. 아래 ETFS 목록만으로 JSON 을 생성(결정적·재현 가능).
    - 1~2년에 1회 인기 종목 변동에 맞춰 ETFS 목록을 갱신하면 됨.

사용:
    python3 scripts/build_etf_us_extra.py
    → js/data/etf-us-extra.json 생성 (repo: CA_Project/scripts 에서 실행)

출력 형식 (symbols-us-extra.json 과 동일 — 동일 mergeBy 로 병합):
    {
      "generatedAt": "2026-06-06T12:00:00",
      "count": 150,
      "symbols": [
        { "ticker": "SPY", "nameKr": "SPDR S&P 500 ETF Trust",
          "nameEn": "SPDR S&P 500 ETF Trust", "market": "us",
          "exchange": "NYSE Arca", "sector": "ETF",
          "industry": "Large Blend", "type": "etf",
          "weburl": null, "logo": null },
        ...
      ]
    }
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from datetime import datetime

REPO_ROOT = Path(__file__).resolve().parent.parent  # CA_Project/ (git repo root)
OUTPUT_JSON = REPO_ROOT / "js" / "data" / "etf-us-extra.json"

# === 큐레이션된 인기 미국 ETF ===
# (ticker, 이름, 카테고리(industry), 상장거래소)
# 카테고리는 화면 표시·피어 그룹용 라벨. 중복 ticker 는 자동 제거.
# symbols.js 마스터에 이미 있는 ETF(SPY·QQQ·VOO·VTI·SCHD·SOXX·SMH·TLT·ITA·ARKK·
#   LIT·DRIV·ICLN·BOTZ·MAGS·IBIT·IVV)도 포함하되, 앱 병합(mergeBy)에서 먼저 들어온
#   하드코딩 항목이 우선하므로 충돌 없음.
ETFS: list[tuple[str, str, str, str]] = [
    # ── 브로드 마켓 (대형 혼합) ──
    ("SPY",  "SPDR S&P 500 ETF Trust",            "Large Blend",  "NYSE Arca"),
    ("IVV",  "iShares Core S&P 500 ETF",          "Large Blend",  "NYSE Arca"),
    ("VOO",  "Vanguard S&P 500 ETF",              "Large Blend",  "NYSE Arca"),
    ("SPLG", "SPDR Portfolio S&P 500 ETF",        "Large Blend",  "NYSE Arca"),
    ("VTI",  "Vanguard Total Stock Market ETF",   "Total Market", "NYSE Arca"),
    ("ITOT", "iShares Core S&P Total US Stock",    "Total Market", "NYSE Arca"),
    ("SCHB", "Schwab US Broad Market ETF",        "Total Market", "NYSE Arca"),
    ("SCHX", "Schwab US Large-Cap ETF",           "Large Blend",  "NYSE Arca"),
    ("DIA",  "SPDR Dow Jones Industrial Average",  "Large Blend",  "NYSE Arca"),
    # ── 나스닥 / 성장 ──
    ("QQQ",  "Invesco QQQ Trust",                 "Large Growth", "NASDAQ"),
    ("QQQM", "Invesco NASDAQ 100 ETF",            "Large Growth", "NASDAQ"),
    ("VUG",  "Vanguard Growth ETF",               "Large Growth", "NYSE Arca"),
    ("SCHG", "Schwab US Large-Cap Growth ETF",    "Large Growth", "NYSE Arca"),
    ("IWF",  "iShares Russell 1000 Growth ETF",   "Large Growth", "NYSE Arca"),
    ("MGK",  "Vanguard Mega Cap Growth ETF",      "Large Growth", "NYSE Arca"),
    ("VGT",  "Vanguard Information Technology ETF","Sector/Tech",  "NYSE Arca"),
    ("MAGS", "Roundhill Magnificent Seven ETF",   "Theme/BigTech","NASDAQ"),
    # ── 가치 / 배당 ──
    ("SCHD", "Schwab US Dividend Equity ETF",     "Dividend",     "NYSE Arca"),
    ("VYM",  "Vanguard High Dividend Yield ETF",  "Dividend",     "NYSE Arca"),
    ("VIG",  "Vanguard Dividend Appreciation ETF","Dividend",     "NYSE Arca"),
    ("DGRO", "iShares Core Dividend Growth ETF",  "Dividend",     "NYSE Arca"),
    ("NOBL", "ProShares S&P 500 Dividend Aristocrats","Dividend", "BATS"),
    ("DVY",  "iShares Select Dividend ETF",       "Dividend",     "NASDAQ"),
    ("HDV",  "iShares Core High Dividend ETF",    "Dividend",     "NYSE Arca"),
    ("SPYD", "SPDR Portfolio S&P 500 High Div",   "Dividend",     "NYSE Arca"),
    ("JEPI", "JPMorgan Equity Premium Income ETF","Income",       "NYSE Arca"),
    ("JEPQ", "JPMorgan Nasdaq Equity Premium Inc","Income",       "NASDAQ"),
    ("DIVO", "Amplify CWP Enhanced Dividend Inc", "Income",       "NYSE Arca"),
    ("VTV",  "Vanguard Value ETF",                "Large Value",  "NYSE Arca"),
    ("IWD",  "iShares Russell 1000 Value ETF",    "Large Value",  "NYSE Arca"),
    ("SCHV", "Schwab US Large-Cap Value ETF",     "Large Value",  "NYSE Arca"),
    # ── 중소형주 ──
    ("IWM",  "iShares Russell 2000 ETF",          "Small Cap",    "NYSE Arca"),
    ("IJR",  "iShares Core S&P Small-Cap ETF",    "Small Cap",    "NYSE Arca"),
    ("VB",   "Vanguard Small-Cap ETF",            "Small Cap",    "NYSE Arca"),
    ("VO",   "Vanguard Mid-Cap ETF",              "Mid Cap",      "NYSE Arca"),
    ("IJH",  "iShares Core S&P Mid-Cap ETF",      "Mid Cap",      "NYSE Arca"),
    ("MDY",  "SPDR S&P MidCap 400 ETF Trust",     "Mid Cap",      "NYSE Arca"),
    # ── 국제 / 신흥국 ──
    ("VEA",  "Vanguard FTSE Developed Markets",   "International","NYSE Arca"),
    ("IEFA", "iShares Core MSCI EAFE ETF",        "International","BATS"),
    ("EFA",  "iShares MSCI EAFE ETF",             "International","NYSE Arca"),
    ("VXUS", "Vanguard Total International Stock", "International","NASDAQ"),
    ("VEU",  "Vanguard FTSE All-World ex-US ETF", "International","NYSE Arca"),
    ("VWO",  "Vanguard FTSE Emerging Markets ETF","Emerging Mkts","NYSE Arca"),
    ("IEMG", "iShares Core MSCI Emerging Markets", "Emerging Mkts","NYSE Arca"),
    ("EEM",  "iShares MSCI Emerging Markets ETF", "Emerging Mkts","NYSE Arca"),
    ("ACWI", "iShares MSCI ACWI ETF",             "Global",       "NASDAQ"),
    ("VT",   "Vanguard Total World Stock ETF",    "Global",       "NYSE Arca"),
    ("INDA", "iShares MSCI India ETF",            "Country",      "BATS"),
    ("MCHI", "iShares MSCI China ETF",            "Country",      "NASDAQ"),
    ("EWJ",  "iShares MSCI Japan ETF",            "Country",      "NYSE Arca"),
    ("EWY",  "iShares MSCI South Korea ETF",      "Country",      "NYSE Arca"),
    # ── 섹터 SPDR ──
    ("XLK",  "Technology Select Sector SPDR",     "Sector/Tech",      "NYSE Arca"),
    ("XLF",  "Financial Select Sector SPDR",      "Sector/Financials","NYSE Arca"),
    ("XLE",  "Energy Select Sector SPDR",         "Sector/Energy",    "NYSE Arca"),
    ("XLV",  "Health Care Select Sector SPDR",    "Sector/Health",    "NYSE Arca"),
    ("XLY",  "Consumer Discretionary SPDR",       "Sector/ConsDisc",  "NYSE Arca"),
    ("XLP",  "Consumer Staples Select SPDR",      "Sector/Staples",   "NYSE Arca"),
    ("XLI",  "Industrial Select Sector SPDR",     "Sector/Industrials","NYSE Arca"),
    ("XLB",  "Materials Select Sector SPDR",      "Sector/Materials", "NYSE Arca"),
    ("XLU",  "Utilities Select Sector SPDR",      "Sector/Utilities", "NYSE Arca"),
    ("XLRE", "Real Estate Select Sector SPDR",    "Sector/RealEstate","NYSE Arca"),
    ("XLC",  "Communication Services SPDR",       "Sector/Comm",      "NYSE Arca"),
    # ── 반도체 / 테크 테마 ──
    ("SMH",  "VanEck Semiconductor ETF",          "Theme/Semis",  "NASDAQ"),
    ("SOXX", "iShares Semiconductor ETF",         "Theme/Semis",  "NASDAQ"),
    ("XSD",  "SPDR S&P Semiconductor ETF",        "Theme/Semis",  "NYSE Arca"),
    ("IGV",  "iShares Expanded Tech-Software ETF","Theme/Software","BATS"),
    ("SKYY", "First Trust Cloud Computing ETF",   "Theme/Cloud",  "NASDAQ"),
    ("CIBR", "First Trust NASDAQ Cybersecurity",  "Theme/Cyber",  "NASDAQ"),
    ("HACK", "Amplify Cybersecurity ETF",         "Theme/Cyber",  "NYSE Arca"),
    ("FINX", "Global X FinTech ETF",              "Theme/FinTech","NASDAQ"),
    # ── 혁신 / 테마 ──
    ("ARKK", "ARK Innovation ETF",                "Theme/Innovation","BATS"),
    ("ARKG", "ARK Genomic Revolution ETF",        "Theme/Genomics",  "BATS"),
    ("ARKW", "ARK Next Generation Internet ETF",  "Theme/Internet",  "BATS"),
    ("BOTZ", "Global X Robotics & AI ETF",        "Theme/Robotics-AI","NASDAQ"),
    ("ROBO", "ROBO Global Robotics & Automation", "Theme/Robotics-AI","NYSE Arca"),
    ("IRBO", "iShares Robotics & AI Multisector", "Theme/Robotics-AI","NYSE Arca"),
    ("LIT",  "Global X Lithium & Battery Tech",   "Theme/Battery",   "NYSE Arca"),
    ("DRIV", "Global X Autonomous & EV ETF",      "Theme/EV",        "NASDAQ"),
    ("ICLN", "iShares Global Clean Energy ETF",   "Theme/CleanEnergy","NASDAQ"),
    ("TAN",  "Invesco Solar ETF",                 "Theme/Solar",     "NYSE Arca"),
    ("MOAT", "VanEck Morningstar Wide Moat ETF",  "Theme/Quality",   "BATS"),
    ("BUG",  "Global X Cybersecurity ETF",        "Theme/Cyber",     "NASDAQ"),
    # ── 항공우주 / 방산 ──
    ("ITA",  "iShares US Aerospace & Defense ETF","Aerospace/Defense","BATS"),
    ("PPA",  "Invesco Aerospace & Defense ETF",   "Aerospace/Defense","NYSE Arca"),
    ("XAR",  "SPDR S&P Aerospace & Defense ETF",  "Aerospace/Defense","NYSE Arca"),
    # ── 부동산 ──
    ("VNQ",  "Vanguard Real Estate ETF",          "Real Estate",  "NYSE Arca"),
    ("SCHH", "Schwab US REIT ETF",                "Real Estate",  "NYSE Arca"),
    ("IYR",  "iShares US Real Estate ETF",        "Real Estate",  "NYSE Arca"),
    # ── 팩터 / 저변동성 ──
    ("USMV", "iShares MSCI USA Min Vol Factor",   "Factor",       "BATS"),
    ("SPLV", "Invesco S&P 500 Low Volatility ETF","Factor",       "NYSE Arca"),
    ("QUAL", "iShares MSCI USA Quality Factor",   "Factor",       "BATS"),
    ("MTUM", "iShares MSCI USA Momentum Factor",  "Factor",       "BATS"),
    ("VLUE", "iShares MSCI USA Value Factor ETF", "Factor",       "BATS"),
    # ── 채권 ──
    ("BND",  "Vanguard Total Bond Market ETF",    "Bonds",        "NASDAQ"),
    ("AGG",  "iShares Core US Aggregate Bond ETF","Bonds",        "NYSE Arca"),
    ("BNDX", "Vanguard Total International Bond",  "Bonds",        "NASDAQ"),
    ("TLT",  "iShares 20+ Year Treasury Bond ETF","Bonds/Treasury","NASDAQ"),
    ("IEF",  "iShares 7-10 Year Treasury Bond",   "Bonds/Treasury","NASDAQ"),
    ("SHY",  "iShares 1-3 Year Treasury Bond ETF","Bonds/Treasury","NASDAQ"),
    ("SGOV", "iShares 0-3 Month Treasury Bond",   "Bonds/Treasury","NYSE Arca"),
    ("BIL",  "SPDR Bloomberg 1-3 Month T-Bill",   "Bonds/Treasury","NYSE Arca"),
    ("TIP",  "iShares TIPS Bond ETF",             "Bonds",        "NYSE Arca"),
    ("LQD",  "iShares iBoxx Investment Grade Corp","Bonds/Credit","NYSE Arca"),
    ("VCIT", "Vanguard Intermediate-Term Corp",   "Bonds/Credit", "NASDAQ"),
    ("HYG",  "iShares iBoxx High Yield Corp Bond","Bonds/Credit", "NYSE Arca"),
    ("JNK",  "SPDR Bloomberg High Yield Bond ETF","Bonds/Credit", "NYSE Arca"),
    ("MUB",  "iShares National Muni Bond ETF",    "Bonds/Muni",   "NYSE Arca"),
    # ── 원자재 / 금 ──
    ("GLD",  "SPDR Gold Shares",                  "Gold/Commodity","NYSE Arca"),
    ("IAU",  "iShares Gold Trust",                "Gold/Commodity","NYSE Arca"),
    ("GLDM", "SPDR Gold MiniShares Trust",        "Gold/Commodity","NYSE Arca"),
    ("SLV",  "iShares Silver Trust",              "Gold/Commodity","NYSE Arca"),
    ("PDBC", "Invesco Optimum Yield Diversified", "Commodity",    "NASDAQ"),
    ("USO",  "United States Oil Fund LP",         "Commodity",    "NYSE Arca"),
    # ── 크립토 ──
    ("IBIT", "iShares Bitcoin Trust ETF",         "Crypto",       "NASDAQ"),
    ("FBTC", "Fidelity Wise Origin Bitcoin Fund", "Crypto",       "BATS"),
    ("GBTC", "Grayscale Bitcoin Trust ETF",       "Crypto",       "NYSE Arca"),
    ("BITO", "ProShares Bitcoin Strategy ETF",    "Crypto",       "NYSE Arca"),
    ("ETHA", "iShares Ethereum Trust ETF",        "Crypto",       "NASDAQ"),
    # ── 레버리지 / 인버스 (인기 종목 한정) ──
    ("TQQQ", "ProShares UltraPro QQQ",            "Leveraged",    "NASDAQ"),
    ("SQQQ", "ProShares UltraPro Short QQQ",      "Leveraged",    "NASDAQ"),
    ("SOXL", "Direxion Daily Semiconductor Bull 3X","Leveraged",  "NYSE Arca"),
    ("TLTW", "iShares 20+ Year Treasury BuyWrite","Income",       "BATS"),
    ("UPRO", "ProShares UltraPro S&P 500",        "Leveraged",    "NYSE Arca"),
]


def build_symbols() -> list[dict]:
    seen: set[str] = set()
    out: list[dict] = []
    for ticker, name, category, exchange in ETFS:
        if ticker in seen:
            continue
        seen.add(ticker)
        out.append({
            "ticker": ticker,
            "nameKr": name,          # ETF 는 영문명 그대로 (symbols-us-extra 와 동일 방침)
            "nameEn": name,
            "market": "us",
            "exchange": exchange,
            "sector": "ETF",
            "industry": category,
            "type": "etf",
            "weburl": None,
            "logo": None,
        })
    return out


def main() -> int:
    symbols = build_symbols()
    result = {
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "count": len(symbols),
        "symbols": symbols,
    }
    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_JSON.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"저장: {OUTPUT_JSON} ({OUTPUT_JSON.stat().st_size // 1024} KB, {len(symbols)} ETF)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
