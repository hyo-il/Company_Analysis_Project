// 한국 종목 ticker → OpenDART corp_code 매핑.
// 파일이 없거나 fetch 실패 시 빈 맵으로 안전 폴백(호출부는 hasCorpCode=false로 kr-no-corpcode 폴백).
// 모듈 로드 시 1회 fetch 후 메모리 캐시(top-level await).

let CORPCODE_MAP = {};
try {
  const res = await fetch(new URL('./dart-corpcode.json', import.meta.url));
  if (res.ok) {
    const json = await res.json();
    if (json && typeof json === 'object') CORPCODE_MAP = json;
  }
} catch (e) {
  console.warn('[dart-corpcode] load failed', e?.message);
}

export function getCorpCode(ticker) {
  return CORPCODE_MAP[ticker] || null;
}

export function hasCorpCode(ticker) {
  return !!CORPCODE_MAP[ticker];
}
