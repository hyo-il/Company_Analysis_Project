// US 종목 시계열 요약 데이터 로더 (scripts/fetch_us_candles.py 결과).
// 모듈 로드 시 1회 fetch + 메모리 캐시. 사용자 PC 에서 주간 갱신.

let CANDLES = { generatedAt: null, validUntil: null, tickerCount: 0, data: {}, failed: [] };

try {
  const res = await fetch(new URL('./us-candles.json', import.meta.url));
  if (res.ok) {
    const json = await res.json();
    if (json && json.data && typeof json.data === 'object') CANDLES = json;
  }
} catch (e) {
  console.warn('[us-candles] load failed', e?.message);
}

/**
 * 단일 종목 모멘텀 요약 데이터.
 * 형식: { currentPrice, lastUpdated, change1m, change3m, change6m,
 *         high52, low52, ma20, ma60, pos52 } | null
 */
export function getMomentumData(ticker) {
  if (!ticker) return null;
  return CANDLES.data?.[ticker.toUpperCase()] || null;
}

export function getCandlesMeta() {
  return {
    generatedAt: CANDLES.generatedAt,
    validUntil: CANDLES.validUntil,
    tickerCount: CANDLES.tickerCount,
    failedCount: (CANDLES.failed || []).length,
  };
}
