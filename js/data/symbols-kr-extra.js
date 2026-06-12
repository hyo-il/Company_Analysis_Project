// KR 종목 마스터 확장 — KOSDAQ150 인덱스 구성종목 (코스피200 외).
// 출처: 한국거래소 KOSDAQ150 (2026-01-23 기준, 나무위키 정리), DART corp_code 매핑.
// 모듈 로드 시 1회 fetch + top-level await 로 메모리 캐시. 실패 시 빈 배열 폴백.

let DATA = { count: 0, symbols: [] };

try {
  const res = await fetch(new URL('./symbols-kr-extra.json', import.meta.url));
  if (res.ok) {
    const json = await res.json();
    if (json && Array.isArray(json.symbols)) DATA = json;
  }
} catch (e) {
  console.warn('[symbols-kr-extra] load failed', e?.message);
}

// SYMBOLS_KR_EXTRA — symbols.js 의 KR 마스터 병합에 사용. 각 항목에 표준 필드 추가.
export const SYMBOLS_KR_EXTRA = DATA.symbols.map(s => ({
  ticker: s.ticker,
  nameKr: s.nameKr,
  nameEn: s.nameEn || s.nameKr,
  market: 'kr',
  exchange: 'KOSDAQ',
  sector: 'KOSDAQ150',
  industry: '미분류',
  type: 'stock',
  kosdaq150: true,
}));

export function getSymbolsKrExtraMeta() {
  return { count: DATA.count, generatedAt: DATA.generatedAt, source: DATA.source };
}
