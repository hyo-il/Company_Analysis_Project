// US 종목 재무 절대값 로더 (scripts/fetch_us_financials.py 결과).
// 모듈 로드 시 1회 fetch + top-level await 로 메모리 캐시.
// 파일 없거나 fetch 실패 시 빈 객체로 안전 폴백 → 호출부는 자동 null.

let FIN = { generatedAt: null, validUntil: null, tickerCount: 0, data: {}, failed: [] };

try {
  const res = await fetch(new URL('./us-financials.json', import.meta.url));
  if (res.ok) {
    const json = await res.json();
    if (json && json.data && typeof json.data === 'object') FIN = json;
  }
} catch (e) {
  console.warn('[us-financials] load failed', e?.message);
}

// 방어용 — 역순 timeseries (이전 스크립트 산출물) 자동 교정.
// 분기 라벨 '25Q1' < '26Q1' 비교로 정순 여부 판단. 정순 저장된 데이터엔 no-op.
for (const ticker of Object.keys(FIN.data || {})) {
  const ts = FIN.data[ticker]?.timeseries;
  if (!ts || !Array.isArray(ts.labels) || ts.labels.length < 2) continue;
  // 첫 라벨이 마지막 라벨보다 크면 역순 → 정순으로 뒤집기
  if (ts.labels[0] > ts.labels[ts.labels.length - 1]) {
    ts.labels = ts.labels.slice().reverse();
    for (const key of ['revenue', 'operatingIncome', 'netIncome', 'ocf', 'opMargin']) {
      if (Array.isArray(ts[key])) ts[key] = ts[key].slice().reverse();
    }
  }
}

export function getUsFinancials(ticker) {
  if (!ticker) return null;
  return FIN.data?.[ticker.toUpperCase()] || null;
}

export function getUsFinancialsMeta() {
  return {
    generatedAt: FIN.generatedAt,
    validUntil: FIN.validUntil,
    tickerCount: FIN.tickerCount,
  };
}
