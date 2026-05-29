// Finnhub 무료 티어 — earnings calendar / dividend.
// 약관·커버리지·호출 한도는 시점에 따라 변동될 수 있음. (단정 금지)
// 실패 시 throw 하지 않고 빈 배열을 반환 — 호출자에서 fallback 결정.
import { getSymbol } from '../../symbols.js';
import { getFinnhubProxyBase } from '../../config.js';

// 12차: Cloudflare Worker 프록시 단일 모드.
// 프록시 base가 비어 있으면 즉시 빈 배열을 반환(개인 키 fallback 제거).
function resolveBase() {
  const proxy = getFinnhubProxyBase();
  return proxy ? proxy + '/finnhub/api/v1' : '';
}

const EARNINGS_META = {
  type: 'earnings', label: '실적 발표', icon: '📊',
  what: '회사가 한 분기 동안 얼마를 벌었는지 공식 발표하는 날.',
  impact: '실제 실적이 시장 기대치(컨센서스)보다 높으면 어닝 서프라이즈로 ↑, 낮으면 어닝 쇼크로 ↓ 압력이 발생합니다.',
};
const DIVIDEND_META = {
  type: 'dividend', label: '배당락일', icon: '💰',
  what: '이날 매수해도 배당 권리가 없는 첫 날.',
  impact: '이론적으로 배당금만큼 주가가 자연 조정 ↓.',
};

function toEvent(meta, { ticker, date, extra = '' }) {
  const sym = getSymbol(ticker);
  return {
    date,
    type: meta.type,
    label: meta.label,
    what: meta.what,
    impact: meta.impact,
    category: 'company',
    icon: meta.icon,
    ticker,
    tickerName: sym?.nameKr || null,
    market: sym?.market || 'us',
    title: sym ? `${sym.nameKr} ${meta.label}${extra ? ` (${extra})` : ''}` : `${ticker} ${meta.label}`,
    source: 'Finnhub',
  };
}

async function safeFetch(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[finnhub] ${res.status} ${res.statusText}`);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.warn('[finnhub] fetch failed', e.message);
    return null;
  }
}

export async function fetchEarnings({ ticker, from, to }) {
  const baseUrl = resolveBase();
  if (!baseUrl) return [];
  const url = new URL(baseUrl + '/calendar/earnings');
  url.searchParams.set('from', from);
  url.searchParams.set('to', to);
  if (ticker) url.searchParams.set('symbol', ticker);
  const json = await safeFetch(url.toString());
  const list = json?.earningsCalendar || [];
  return list
    .filter(r => r.date)
    .map(r => toEvent(EARNINGS_META, { ticker: r.symbol || ticker, date: r.date }));
}

export async function fetchDividends({ ticker, from, to }) {
  if (!ticker) return [];
  const baseUrl = resolveBase();
  if (!baseUrl) return [];
  const url = new URL(baseUrl + '/stock/dividend');
  url.searchParams.set('symbol', ticker);
  url.searchParams.set('from', from);
  url.searchParams.set('to', to);
  const json = await safeFetch(url.toString());
  if (!Array.isArray(json)) return [];
  return json
    .filter(r => r.date)
    .map(r => toEvent(DIVIDEND_META, {
      ticker: r.symbol || ticker,
      date: r.date,
      extra: r.amount != null ? `$${r.amount}` : '',
    }));
}
