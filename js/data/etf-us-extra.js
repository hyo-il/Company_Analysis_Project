// 미국 인기 ETF 사전 목록 (scripts/build_etf_us_extra.py 결과).
// Finnhub 무료 플랜이 ETF 프로필을 반환하지 않아 별도 큐레이션 목록으로 보유.
// symbols.js 의 SYMBOLS 배열에 자동 병합되어 검색·분석에서 동일하게 사용된다.

let ETFS_EXTRA = [];

try {
  const res = await fetch(new URL('./etf-us-extra.json', import.meta.url));
  if (res.ok) {
    const json = await res.json();
    if (json && Array.isArray(json.symbols)) ETFS_EXTRA = json.symbols;
  }
} catch (e) {
  console.warn('[etf-us-extra] load failed', e?.message);
}

export const ETF_US_EXTRA = ETFS_EXTRA;
