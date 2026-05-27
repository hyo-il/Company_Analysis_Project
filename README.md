# CA — 기업·ETF 분석 (Company Analysis)

국내(KOSPI200)·미국(S&P500·NASDAQ) 기업·ETF의 핵심 지표·뉴스·일정을 한곳에서 보고, 동종업계 비교와 퀀트 점수로 상대적 위치를 파악할 수 있는 개인용 웹 분석 도구입니다.

> 참고용 정보 서비스이며 투자 권유가 아닙니다. 모든 투자 판단과 책임은 사용자에게 있습니다.

## 주요 기능

- **기업 분석** — 8개 카테고리(밸류에이션·수익성·성장성·규모·현금흐름·안정성·주주환원·시장) 지표, 분기 추이(막대), 역사적 PER/PBR 밴드, 규칙 기반 AI 사업 요약·강점/약점·투자 포인트, 4팩터 퀀트 점수.
- **ETF 상세** — 비용·규모·안정성, 상장폐지 위험 플래그, 구성 종목 표(종목명·티커·비중%) + 상위 10 집중도, 운용사 공식 페이지 링크. 구성 종목 행 클릭 시 그 종목의 풀 분석 모달.
- **상대가치 비교** — 동종업계 피어와 PER/PBR/PSR/EV·EBITDA/ROE/영업이익률을 표·레이더 차트로 비교.
- **주요 일정** — 월간 캘린더 + 종목별 일정. 미국 종목 실적·배당은 Finnhub 무료 API 실데이터로 연동(키 없으면 정직한 빈 상태).
- **관심 종목** — 우측 드로어, 등록·해제 시 토스트 피드백.
- **통합 검색** — 헤더 글로벌 검색 + 자동완성, "기업 분석" 단일 메뉴에서 검색·분석 통합.

## 기술 스택

- 순수 JavaScript (ESM) — 프레임워크/빌드 도구 없음
- CSS Variables 기반 연보라 테마 (`--primary #8B5CB0`, `--lavender #C7AADB`)
- [Chart.js 4](https://www.chartjs.org/) + chartjs-plugin-datalabels (CDN)
- 외부 API: [Finnhub](https://finnhub.io/) 무료 티어 (미국 종목 일정)

## 폴더 구조

```
workspace/CA_Project/
├── index.html
├── package.json
├── assets/                       # 로고·아이콘
├── css/style.css
└── js/
    ├── main.js                   # 라우터·전역 검색
    ├── components/               # toast, drawer, charts, holding-dialog, common
    ├── data/
    │   ├── adapter.js            # 통합 어댑터 (mock + 실연동)
    │   ├── adapters/calendar/finnhub.js
    │   ├── config.js             # API 키 localStorage 저장
    │   ├── holdings.js           # ETF 구성 종목 + 역방향 인덱스
    │   ├── symbols.js
    │   ├── watchlist.js
    │   └── metrics-meta.js
    ├── pages/                    # analysis, etf, compare, calendar, help, search, watchlist
    └── utils/                    # format, cache, scoring, tooltip
```

## 실행 방법

빌드 단계가 없습니다. 정적 파일을 그대로 서빙합니다.

```bash
cd workspace/CA_Project
python3 -m http.server 8000
# 또는
npx serve .
```

브라우저에서 `http://localhost:8000/` 접속.

## Finnhub API 키 설정 (선택)

미국 종목의 실적·배당 일정을 실데이터로 보고 싶다면:

1. https://finnhub.io/register 에서 무료 키 발급 (가입 전 Privacy/Terms 직접 확인)
2. 앱의 **도움말 > 데이터 소스 설정** 에서 키 입력 → 저장
3. NVDA·AAPL 등 미국 종목 분석 화면에서 실데이터 노출 확인

키는 이 PC의 localStorage에만 저장되며 외부로 전송되지 않습니다(브라우저에서 Finnhub로만 직접 호출).

키가 없거나, 한국 종목이거나, 호출이 실패하면 **가짜 데이터를 채워 넣지 않고 "데이터 없음"으로 정직히 표시**합니다.

## 데이터 원칙

- 모든 수치에는 출처(DART, SEC EDGAR, KRX, Finnhub 등)와 기준일이 함께 표기됩니다.
- 시세는 EOD(전일 종가) 기준, 일 1회 갱신.
- 무료 데이터로 확보 어려운 항목(예: 컨센서스, 한국 종목 일정, 매크로 지표)은 (!) 아이콘으로 한계를 명시합니다.

## 라이선스·면책

본 서비스는 정보 제공 목적의 참고 자료이며 투자 권유가 아닙니다. AI/규칙 기반 해설과 퀀트 점수는 과거·현재 지표에 기반한 참고용이며 미래 수익을 보장하지 않습니다.
