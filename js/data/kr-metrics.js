// KR 종목 PER·PBR·PSR·EV-EBITDA 정적 로더 (scripts/fetch_kr_metrics.py 결과).
// 모듈 로드 시 1회 fetch + top-level await 로 메모리 캐시.
// 파일 없거나 fetch 실패 시 빈 객체로 안전 폴백 → 호출부는 자동 null.

let MET = { generatedAt: null, validUntil: null, tickerCount: 0, data: {}, failed: [] };

try {
  const res = await fetch(new URL('./kr-metrics.json', import.meta.url));
  if (res.ok) {
    const json = await res.json();
    if (json && json.data && typeof json.data === 'object') MET = json;
  }
} catch (e) {
  console.warn('[kr-metrics] load failed', e?.message);
}

export function getKrMetrics(ticker) {
  if (!ticker) return null;
  return MET.data?.[ticker] || null;
}

export function getKrMetricsMeta() {
  return {
    generatedAt: MET.generatedAt,
    validUntil: MET.validUntil,
    tickerCount: MET.tickerCount,
  };
}
