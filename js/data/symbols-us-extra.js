// 미국 종목 사전 확장 데이터 (scripts/fetch_us_symbols_extra.py 결과, S&P500 + NASDAQ100).
// symbols.js 의 SYMBOLS 배열에 자동 병합되어 검색·분석에서 동일하게 사용된다.

let SYMS_EXTRA = [];

try {
  const res = await fetch(new URL('./symbols-us-extra.json', import.meta.url));
  if (res.ok) {
    const json = await res.json();
    if (json && Array.isArray(json.symbols)) SYMS_EXTRA = json.symbols;
  }
} catch (e) {
  console.warn('[symbols-us-extra] load failed', e?.message);
}

export const SYMBOLS_US_EXTRA = SYMS_EXTRA;
