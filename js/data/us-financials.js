// US 종목 재무 절대값 로더 (scripts/fetch_us_financials.py 결과).
// 모듈 로드 시 1회 fetch + top-level await 로 메모리 캐시.
// 파일 없거나 fetch 실패 시 빈 객체로 안전 폴백 → 호출부는 자동 null.

let FIN = { generatedAt: null, validUntil: null, tickerCount: 0, data: {}, failed: [] };

try {
  const res = await fetch(new URL('./us-financials.json', import.meta.url));
  if (res.ok) {
    const json = await res.json();
    if (json && json.data && typeof json.data === 'object') FIN = json;
  }
} catch (e) {
  console.warn('[us-financials] load failed', e?.message);
}

export function getUsFinancials(ticker) {
  if (!ticker) return null;
  return FIN.data?.[ticker.toUpperCase()] || null;
}

export function getUsFinancialsMeta() {
  return {
    generatedAt: FIN.generatedAt,
    validUntil: FIN.validUntil,
    tickerCount: FIN.tickerCount,
  };
}
