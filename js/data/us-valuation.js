// US 종목 PER·PBR 5년 시계열 로더 (scripts/fetch_us_valuation.py 결과).
// 모듈 로드 시 1회 fetch + top-level await 로 메모리 캐시.
// 파일 없거나 fetch 실패 시 빈 객체로 안전 폴백 → 호출부는 자동 null.

let VAL = { generatedAt: null, validUntil: null, tickerCount: 0, data: {}, failed: [] };

try {
  const res = await fetch(new URL('./us-valuation.json', import.meta.url));
  if (res.ok) {
    const json = await res.json();
    if (json && json.data && typeof json.data === 'object') VAL = json;
  }
} catch (e) {
  console.warn('[us-valuation] load failed', e?.message);
}

export function getUsValuation(ticker) {
  if (!ticker) return null;
  return VAL.data?.[ticker.toUpperCase()] || null;
}

export function getUsValuationMeta() {
  return {
    generatedAt: VAL.generatedAt,
    validUntil: VAL.validUntil,
    tickerCount: VAL.tickerCount,
  };
}
