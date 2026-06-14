// US 종목 한글·영문 별칭 매핑 로더. lookupExternal 보강용.
// 모듈 로드 시 1회 fetch + top-level await. 파일 없으면 빈 결과 폴백.

let DATA = { aliases: [] };

try {
  const res = await fetch(new URL('./symbols-us-aliases.json', import.meta.url));
  if (res.ok) {
    const json = await res.json();
    if (json && Array.isArray(json.aliases)) DATA = json;
  }
} catch (e) {
  console.warn('[symbols-us-aliases] load failed', e?.message);
}

// 정규화: 공백·점 제거 + 소문자
function norm(s) {
  return String(s || '').replace(/[\s.\-]/g, '').toLowerCase();
}

// 인덱스: 정규화된 keyword → ticker
const IDX = new Map();
for (const a of DATA.aliases) {
  for (const k of (a.keywords || [])) {
    const n = norm(k);
    if (n && !IDX.has(n)) IDX.set(n, a.ticker);
  }
}

/** query 정확 매칭 → ticker (null = 매칭 실패) */
export function lookupUsAlias(query) {
  if (!query) return null;
  return IDX.get(norm(query)) || null;
}
