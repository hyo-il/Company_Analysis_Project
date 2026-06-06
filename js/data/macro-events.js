// 글로벌 매크로 일정 정적 데이터 로더.
// macro-events.json 을 fetch 하여 메모리 캐시.
// 사용자가 분기마다 직접 갱신(공식 출처 참조).

let MACRO = { events: [], note: '', sources: {}, validUntil: null };

try {
  const res = await fetch(new URL('./macro-events.json', import.meta.url));
  if (res.ok) {
    const json = await res.json();
    if (json && Array.isArray(json.events)) MACRO = json;
  }
} catch (e) {
  console.warn('[macro-events] load failed', e?.message);
}

/**
 * 매크로 일정 이벤트를 캘린더 페이지가 쓰는 공통 이벤트 포맷으로 변환.
 * 기존 toEvent(adapters/calendar/finnhub.js) 와 동일한 키를 채운다.
 */
export function getMacroEvents({ from, to } = {}) {
  const f = from ? new Date(from) : new Date();
  const t = to ? new Date(to) : new Date(Date.now() + 90 * 86400e3);
  return MACRO.events
    .filter(e => {
      const d = new Date(e.date);
      return d >= f && d <= t;
    })
    .map(e => ({
      date: e.date,
      type: e.type,
      label: e.label,
      what: e.what,
      impact: e.impact,
      category: 'macro',                   // 기존 'company' 와 구분
      icon: e.region === 'us' ? '🇺🇸'
          : e.region === 'kr' ? '🇰🇷'
          : e.region === 'eu' ? '🇪🇺'
          : e.region === 'jp' ? '🇯🇵' : '🌐',
      ticker: null,
      tickerName: null,
      market: e.region,
      title: e.label,
      source: e.source || 'macro',
    }));
}

export function getMacroMeta() {
  return { validUntil: MACRO.validUntil, note: MACRO.note, sources: MACRO.sources };
}
