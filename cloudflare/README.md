# Cloudflare Worker — Finnhub 프록시

이 폴더의 `worker.js`는 Cloudflare Workers 대시보드에 배포된 코드의 보관본입니다.

## 배포된 Worker
- URL: https://ca-finnhub-proxy.yhug76.workers.dev
- 환경변수(대시보드에서만 설정 — 코드/Git에 절대 두지 말 것):
  - `FINNHUB_KEY` (Secret) — Finnhub 본인 키
  - `ALLOWED_ORIGINS` (Text) — 콤마로 구분한 허용 Origin
    · `https://hyo-il.github.io,http://localhost:8000,http://127.0.0.1:8000`

## 허용 경로 (worker.js의 `ALLOWED_PATHS`)
- `/api/v1/calendar/earnings` — 실적 캘린더
- `/api/v1/stock/dividend` — 배당 이력
- `/api/v1/quote` — 실시간 시세(c, dp, pc 등)
- `/api/v1/stock/profile2` — 회사 프로필(시총·산업·로고 등)
- `/api/v1/stock/metric` — 주요 펀더멘털 지표(PER/ROE 등)
- `/api/v1/stock/financials-reported` — 분기 재무제표
- `/api/v1/company-news` — 회사 뉴스

이 외 경로는 403 Path not allowed를 반환합니다(화이트리스트 정책).

## 보안 한계 (정직 안내)
- Origin 헤더는 위조 가능. 절대 차단이 아니라 일반 도용을 줄이는 1차 방어선입니다.
- 도용 의심 시 Cloudflare 대시보드에서 키 회전(rotate) 또는 Worker 비활성화로 즉시 차단할 수 있습니다.
- Cloudflare Workers / Finnhub 무료 한도는 시점에 따라 변동되므로 각 공식 페이지에서 직접 확인.

## 업데이트 절차
1) `worker.js`를 수정.
2) Cloudflare 대시보드 → Workers → ca-finnhub-proxy → Edit code 에 복붙.
3) Save and Deploy.
