// Finnhub 통합 호출 어댑터.
// Cloudflare Worker 프록시 경유. 프록시 URL이 없으면 null 반환 → 호출자에서 빈 결과 처리.
// 429 (분당 60회 한도) 받으면 60초 회로 차단 + 사용자 토스트 안내.
import { getFinnhubProxyBase } from '../config.js';
import { showToast } from '../../components/toast.js';

const BACKOFF_KEY = '__finnhub_429_until';
const BACKOFF_MS = 60 * 1000;          // 60초 회로 차단
const TOAST_THROTTLE_MS = 30 * 1000;    // 토스트 30초에 1회만
let lastToastAt = 0;

function isInBackoff() {
  try {
    const raw = sessionStorage.getItem(BACKOFF_KEY);
    if (!raw) return false;
    return parseInt(raw, 10) > Date.now();
  } catch { return false; }
}

function startBackoff() {
  try {
    sessionStorage.setItem(BACKOFF_KEY, (Date.now() + BACKOFF_MS).toString());
  } catch {}
  const now = Date.now();
  if (now - lastToastAt > TOAST_THROTTLE_MS) {
    lastToastAt = now;
    showToast('Finnhub 무료 한도 초과 — 1분 후 자동 회복합니다', { type: 'info' });
  }
}

function baseUrl() {
  const proxy = getFinnhubProxyBase();
  if (!proxy) return null;
  return proxy + '/finnhub';
}

async function fetchJson(path, params) {
  const base = baseUrl();
  if (!base) return null;
  if (isInBackoff()) {
    console.warn('[finnhub] in 429 backoff, skip', path);
    return null;
  }
  const url = new URL(base + path);
  Object.entries(params).forEach(([k, v]) => {
    if (v != null && v !== '') url.searchParams.set(k, v);
  });
  try {
    const res = await fetch(url.toString());
    if (res.status === 429) {
      console.warn('[finnhub] HTTP 429 rate limited, start backoff', path);
      startBackoff();
      return null;
    }
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
export async function fhSearch(query) {
  return fetchJson('/api/v1/search', { q: query });
}
