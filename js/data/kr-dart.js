// 사전 수집된 한국 종목 재무 데이터 (scripts/fetch_dart_data.py 결과).
// 파일 없거나 fetch 실패 시 빈 객체로 안전 폴백 → 호출부는 kr-no-data 폴백.
// 모듈 로드 시 1회 fetch + top-level await 로 메모리 캐시.

let KR_DART = { generatedAt: null, baseYear: null, data: {} };

try {
  const res = await fetch(new URL('./kr-dart.json', import.meta.url));
  if (res.ok) {
    const json = await res.json();
    if (json && typeof json === 'object' && json.data) KR_DART = json;
  }
} catch (e) {
  console.warn('[kr-dart] load failed', e?.message);
}

export function getKRDartEntry(ticker) {
  return KR_DART.data?.[ticker] || null;
}

export function hasKRDartEntry(ticker) {
  return !!KR_DART.data?.[ticker];
}

export function getKRDartMeta() {
  return { generatedAt: KR_DART.generatedAt, baseYear: KR_DART.baseYear };
}
