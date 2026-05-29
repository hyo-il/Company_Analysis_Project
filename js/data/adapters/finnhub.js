// Finnhub 통합 호출 어댑터.
// Cloudflare Worker 프록시 경유. 프록시 URL이 없으면 null 반환 → 호출자에서 빈 결과 처리.
import { getFinnhubProxyBase } from '../config.js';

function baseUrl() {
  const proxy = getFinnhubProxyBase();
  if (!proxy) return null;
  return proxy + '/finnhub';
}

async function fetchJson(path, params) {
  const base = baseUrl();
  if (!base) return null;
  const url = new URL(base + path);
  Object.entries(params).forEach(([k, v]) => {
    if (v != null && v !== '') url.searchParams.set(k, v);
  });
  try {
    const res = await fetch(url.toString());
    if (!res.ok) {
      console.warn('[finnhub] HTTP', res.status, path);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.warn('[finnhub] fetch failed', path, e.message);
    return null;
  }
}

export async function fhQuote(ticker) {
  return fetchJson('/api/v1/quote', { symbol: ticker });
}
export async function fhProfile(ticker) {
  return fetchJson('/api/v1/stock/profile2', { symbol: ticker });
}
export async function fhMetric(ticker) {
  return fetchJson('/api/v1/stock/metric', { symbol: ticker, metric: 'all' });
}
export async function fhFinancialsReported(ticker) {
  return fetchJson('/api/v1/stock/financials-reported', { symbol: ticker, freq: 'quarterly' });
}
export async function fhNews(ticker, from, to) {
  return fetchJson('/api/v1/company-news', { symbol: ticker, from, to });
}
