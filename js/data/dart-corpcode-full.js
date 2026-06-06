// 한국 종목 lookup 사전 데이터 (scripts/fetch_dart_corpcode_full.py 결과).
// 검색 화면에서 SYMBOLS 마스터에 없는 한국 종목을 즉시 찾기 위한 인덱스.

let DATA = { byTicker: {}, byName: {}, count: 0 };

try {
  const res = await fetch(new URL('./dart-corpcode-full.json', import.meta.url));
  if (res.ok) {
    const json = await res.json();
    if (json && json.byTicker) DATA = json;
  }
} catch (e) {
  console.warn('[dart-corpcode-full] load failed', e?.message);
}

export function lookupKrByTicker(ticker) {
  return DATA.byTicker?.[ticker] || null;
}

export function lookupKrByName(name) {
  if (!name) return null;
  const ticker = DATA.byName?.[name.trim().toLowerCase()];
  return ticker ? { ticker, ...DATA.byTicker[ticker] } : null;
}

export function lookupKr(query) {
  if (!query) return null;
  const q = String(query).trim();
  // 6자리 숫자면 ticker, 아니면 이름으로 시도.
  if (/^\d{6}$/.test(q)) return lookupKrByTicker(q) ? { ticker: q, ...DATA.byTicker[q] } : null;
  return lookupKrByName(q);
}
