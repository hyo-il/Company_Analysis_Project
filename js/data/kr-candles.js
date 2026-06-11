// KR 종목 시세 시계열 요약 데이터 로더 (scripts/fetch_kr_candles.py 결과).
// us-candles.js 와 동일 구조. KR 전용 함수명으로 충돌 방지.

let CANDLES = { generatedAt: null, validUntil: null, tickerCount: 0, data: {}, failed: [] };

try {
  const res = await fetch(new URL('./kr-candles.json', import.meta.url));
  if (res.ok) {
    const json = await res.json();
    if (json && json.data && typeof json.data === 'object') CANDLES = json;
  }
} catch (e) {
  console.warn('[kr-candles] load failed', e?.message);
}

export function getKrMomentumData(ticker) {
  if (!ticker) return null;
  // KR 은 ticker 가 6자리 숫자 (예: '005930')
  return CANDLES.data?.[ticker] || null;
}

export function getKrCandlesMeta() {
  return {
    generatedAt: CANDLES.generatedAt,
    validUntil: CANDLES.validUntil,
    tickerCount: CANDLES.tickerCount,
    failedCount: (CANDLES.failed || []).length,
  };
}
