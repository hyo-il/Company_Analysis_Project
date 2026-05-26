// 데이터 어댑터 — 무료 API(DART, SEC EDGAR, KRX 등) 연동 전 mock 응답 제공.
// 모든 함수는 { data, source, asOf, currency } 구조로 반환한다.
//
// 실제 연동 시: js/data/adapters/dart.js, sec.js, krx.js 등을 만들어 이 모듈에서 라우팅.

import { getSymbol } from './symbols.js';
import { cacheGet, cacheSet } from '../utils/cache.js';
export { getHoldings, getEtfsContaining, ISSUER_LINKS, HOLDINGS_MAP } from './holdings.js';

const FRESH_DAYS = 2; // EOD 시세 신선도 기준

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function asOfRecent() {
  // 평일 기준 가장 최근 영업일 mock
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

// 결정론적 의사난수 (티커별로 항상 같은 값)
function seedFromTicker(t) {
  let h = 0;
  for (let i = 0; i < t.length; i++) h = ((h << 5) - h + t.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function rnd(seed, min, max) {
  const x = Math.sin(seed) * 10000;
  const f = x - Math.floor(x);
  return min + f * (max - min);
}

function mockFinancials(ticker) {
  const seed = seedFromTicker(ticker);
  const per = rnd(seed, 8, 35);
  const pbr = rnd(seed + 1, 0.6, 6);
  const roe = rnd(seed + 2, 4, 28);
  return {
    per, pbr,
    psr: rnd(seed + 3, 0.8, 8),
    pcr: rnd(seed + 4, 5, 20),
    peg: rnd(seed + 5, 0.5, 3),
    evEbitda: rnd(seed + 6, 5, 25),
    dividendYield: rnd(seed + 7, 0, 5),
    roe,
    roa: roe * 0.6,
    roic: roe * 0.8,
    opMargin: rnd(seed + 8, 5, 35),
    netMargin: rnd(seed + 9, 3, 28),
    ebitdaMargin: rnd(seed + 10, 10, 45),
    revenueGrowthYoY: rnd(seed + 11, -10, 40),
    revenueGrowthQoQ: rnd(seed + 12, -5, 15),
    opGrowth: rnd(seed + 13, -15, 50),
    epsGrowth: rnd(seed + 14, -10, 45),
    revenue: rnd(seed + 15, 1e10, 5e11),
    operatingIncome: rnd(seed + 16, 1e9, 1e11),
    netIncome: rnd(seed + 17, 5e8, 8e10),
    eps: rnd(seed + 18, 100, 8000),
    bps: rnd(seed + 19, 5000, 80000),
    ocf: rnd(seed + 20, 1e9, 1.2e11),
    fcf: rnd(seed + 21, 5e8, 8e10),
    debtRatio: rnd(seed + 22, 20, 180),
    currentRatio: rnd(seed + 23, 80, 280),
    interestCoverage: rnd(seed + 24, 1, 30),
    netDebtEbitda: rnd(seed + 25, -1, 5),
    dps: rnd(seed + 26, 0, 3000),
    payoutRatio: rnd(seed + 27, 0, 70),
    buybackFlag: rnd(seed + 32, 0, 1) > 0.5,
    beta: rnd(seed + 28, 0.5, 1.8),
    high52: rnd(seed + 29, 50000, 200000),
    low52: rnd(seed + 30, 30000, 100000),
    foreignOwnership: rnd(seed + 31, 5, 60),
  };
}

// === 공개 어댑터 함수들 ===

export async function getProfile(ticker) {
  const sym = getSymbol(ticker);
  if (!sym) throw new Error('symbol not found');
  return {
    data: {
      ticker: sym.ticker,
      nameKr: sym.nameKr,
      nameEn: sym.nameEn,
      exchange: sym.exchange,
      sector: sym.sector,
      industry: sym.industry,
      market: sym.market,
      type: sym.type,
      description: `${sym.nameKr}(${sym.ticker})는 ${sym.exchange}에 상장된 ${sym.industry} 기업입니다.`,
      marketCap: rnd(seedFromTicker(ticker) + 99, 1e10, 3e12),
      sharesOutstanding: rnd(seedFromTicker(ticker) + 100, 1e7, 2e10),
    },
    source: sym.market === 'kr' ? 'DART/KRX' : 'SEC EDGAR',
    asOf: asOfRecent(),
    currency: sym.market === 'kr' ? 'KRW' : 'USD',
  };
}

export async function getQuoteEOD(ticker) {
  const cacheKey = `quote:${ticker}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    const ageDays = (Date.now() - new Date(cached.asOf).getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays < FRESH_DAYS) return cached;
  }
  const sym = getSymbol(ticker);
  const seed = seedFromTicker(ticker);
  const price = rnd(seed + 200, sym?.market === 'kr' ? 10000 : 50, sym?.market === 'kr' ? 800000 : 800);
  const change = rnd(seed + Math.floor(Date.now() / 86400000), -5, 5);
  const result = {
    data: {
      price: Math.round(price * 100) / 100,
      changePct: Math.round(change * 100) / 100,
      volume: Math.floor(rnd(seed + 201, 1e5, 1e8)),
    },
    source: sym?.market === 'kr' ? 'KRX' : 'Public EOD',
    asOf: asOfRecent(),
    currency: sym?.market === 'kr' ? 'KRW' : 'USD',
  };
  cacheSet(cacheKey, result);
  return result;
}

export async function getFinancials(ticker) {
  const cacheKey = `fin:${ticker}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  const sym = getSymbol(ticker);
  const result = {
    data: mockFinancials(ticker),
    source: sym?.market === 'kr' ? 'DART' : 'SEC EDGAR',
    asOf: asOfRecent(),
    currency: sym?.market === 'kr' ? 'KRW' : 'USD',
    basis: { period: 'TTM', statement: '연결', earnings: '지배주주' },
  };
  cacheSet(cacheKey, result);
  return result;
}

export async function getNews(ticker) {
  const sym = getSymbol(ticker);
  const q = encodeURIComponent(sym?.nameKr || ticker);
  // mock: 실제 운영 시 RSS·뉴스 API 결과의 url을 그대로 사용한다.
  const searchUrl = `https://news.google.com/search?q=${q}&hl=ko`;
  return {
    data: [
      { title: `${sym?.nameKr || ticker}, 분기 실적 발표 임박`, source: '뉴스피드', date: asOfRecent(), tag: 'neutral', url: searchUrl },
      { title: `${sym?.nameKr || ticker} 관련 업계 동향 분석`, source: '뉴스피드', date: asOfRecent(), tag: 'neutral', url: searchUrl },
      { title: `애널리스트, ${sym?.nameKr || ticker} 목표가 조정`, source: '뉴스피드', date: asOfRecent(), tag: 'positive', url: searchUrl },
    ],
    source: 'RSS Aggregate',
    asOf: asOfRecent(),
  };
}

import { fetchEarnings, fetchDividends } from './adapters/calendar/finnhub.js';
import { buildMockResult, buildMockEvents } from './adapters/calendar/mock.js';
import { getApiKey, API_KEYS } from './config.js';
import { getWatchlist } from './watchlist.js';

const CAL_TTL_MS = 60 * 60 * 1000; // 1시간

function cacheGetWithTTL(key) {
  const v = cacheGet(key);
  if (!v || !v._cachedAt) return null;
  if (Date.now() - v._cachedAt > CAL_TTL_MS) return null;
  return v;
}
function cacheSetWithTTL(key, value) {
  cacheSet(key, { ...value, _cachedAt: Date.now() });
}

function isoOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// 기업 실적·배당 1차 실연동(Finnhub). 한국 종목·매크로는 1단계 미구현 — MOCK fallback.
// TODO: 한국 종목(KIND/DART)은 CORS 제약으로 별도 프록시 서버가 필요. 매크로(FRED/ECOS)도 후속 단계.
export async function getCalendar(ticker = null, { from, to } = {}) {
  const f = from || isoOffset(-30);
  const t = to || isoOffset(45);
  const cacheKey = `calendar:${ticker || 'all'}:${f}:${t}`;
  const cached = cacheGetWithTTL(cacheKey);
  if (cached) return cached;

  const apiKey = getApiKey(API_KEYS.FINNHUB);
  let realEvents = [];

  if (apiKey) {
    if (ticker) {
      const sym = getSymbol(ticker);
      if (sym?.market === 'us') {
        const [earn, div] = await Promise.all([
          fetchEarnings({ ticker, from: f, to: t, apiKey }),
          fetchDividends({ ticker, from: f, to: t, apiKey }),
        ]);
        realEvents = [...earn, ...div];
      }
    } else {
      // 전체 일정 — 관심 종목의 미국 종목들로 실데이터 수집
      const usWatchTickers = getWatchlist().filter(tk => getSymbol(tk)?.market === 'us');
      if (usWatchTickers.length) {
        const all = await Promise.all(usWatchTickers.flatMap(tk => [
          fetchEarnings({ ticker: tk, from: f, to: t, apiKey }),
          fetchDividends({ ticker: tk, from: f, to: t, apiKey }),
        ]));
        realEvents = all.flat();
      }
    }
  }

  if (!realEvents.length) {
    const mock = buildMockResult(ticker);
    cacheSetWithTTL(cacheKey, mock);
    return mock;
  }

  // 매크로/한국 등 미구현 영역은 mock에서 보강(매크로 이벤트만 추출).
  const macro = buildMockEvents(ticker).filter(e => e.category === 'common');
  const merged = [...realEvents, ...macro].sort((a, b) => a.date.localeCompare(b.date));
  const result = {
    data: merged,
    source: 'Finnhub + 매크로 MOCK',
    asOf: todayISO(),
    hasFallback: macro.length > 0,
    note: macro.length ? '기업 실적·배당은 실데이터(Finnhub), 매크로·한국 일정은 MOCK입니다.' : '',
  };
  cacheSetWithTTL(cacheKey, result);
  return result;
}

export function isConsensusAvailable() {
  // 무료 데이터로는 컨센서스 확보 어려움
  return false;
}

// 최근 N분기/연도 추이 (결정론적 mock). 실제 운영에서는 SEC EDGAR/DART 시계열로 교체.
export async function getHistoricalMetrics(ticker, points = 8) {
  const seed = seedFromTicker(ticker);
  const base = mockFinancials(ticker);
  const labels = [];
  const now = new Date();
  for (let i = points - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - i * 3);
    labels.push(`${String(d.getFullYear()).slice(2)}Q${Math.floor(d.getMonth() / 3) + 1}`);
  }
  const gen = (key, vol = 0.15) => labels.map((_, i) => {
    const wave = Math.sin((seed + i + key.length) * 0.7) * vol;
    const trend = (i / labels.length - 0.5) * vol * 0.6;
    return base[key] * (1 + wave + trend);
  });
  return {
    data: {
      labels,
      revenue: gen('revenue'),
      operatingIncome: gen('operatingIncome', 0.25),
      netIncome: gen('netIncome', 0.3),
      eps: gen('eps', 0.2),
      ocf: gen('ocf', 0.2),
      fcf: gen('fcf', 0.3),
      roe: gen('roe', 0.1),
      opMargin: gen('opMargin', 0.08),
    },
    source: getSymbol(ticker)?.market === 'kr' ? 'DART' : 'SEC EDGAR',
    asOf: asOfRecent(),
  };
}

// 과거 PER/PBR 시계열 (60개월 mock).
export async function getValuationHistory(ticker, months = 60) {
  const seed = seedFromTicker(ticker);
  const base = mockFinancials(ticker);
  const labels = [];
  const per = [];
  const pbr = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - i);
    labels.push(`${String(d.getFullYear()).slice(2)}.${String(d.getMonth() + 1).padStart(2, '0')}`);
    const w1 = Math.sin((seed + i) * 0.3) * 0.25;
    const w2 = Math.sin((seed + i) * 0.15 + 1) * 0.2;
    per.push(base.per * (1 + w1 + w2));
    pbr.push(base.pbr * (1 + w1 * 0.7));
  }
  return {
    data: { labels, per, pbr, currentPer: base.per, currentPbr: base.pbr },
    source: getSymbol(ticker)?.market === 'kr' ? 'KRX + DART' : 'EOD + SEC',
    asOf: asOfRecent(),
    period: `${months}개월`,
  };
}
