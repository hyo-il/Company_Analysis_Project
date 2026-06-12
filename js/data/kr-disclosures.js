// KR 종목 OpenDART 공시 정적 로더 (scripts/fetch_dart_disclosures.py 결과).
// 모듈 로드 시 1회 fetch + top-level await 로 메모리 캐시.
// 파일 없거나 fetch 실패 시 빈 객체로 안전 폴백 → 호출부는 자동 빈 결과.

let DIS = { generatedAt: null, windowDays: 30, tickerCount: 0, data: {}, failed: [] };

try {
  const res = await fetch(new URL('./kr-disclosures.json', import.meta.url));
  if (res.ok) {
    const json = await res.json();
    if (json && json.data && typeof json.data === 'object') DIS = json;
  }
} catch (e) {
  console.warn('[kr-disclosures] load failed', e?.message);
}

export function getKrDisclosures(ticker) {
  if (!ticker) return null;
  return DIS.data?.[ticker] || null;
}

export function getKrDisclosuresMeta() {
  return {
    generatedAt: DIS.generatedAt,
    windowDays: DIS.windowDays,
    tickerCount: DIS.tickerCount,
  };
}
