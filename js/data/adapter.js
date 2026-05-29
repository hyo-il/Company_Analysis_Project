// 데이터 어댑터 — 무료 API(DART, SEC EDGAR, KRX 등) 연동 전 mock 응답 제공.
// 모든 함수는 { data, source, asOf, currency } 구조로 반환한다.
//
// 실제 연동 시: js/data/adapters/dart.js, sec.js, krx.js 등을 만들어 이 모듈에서 라우팅.

import { getSymbol } from './symbols.js';
import { cacheGet, cacheSet } from '../utils/cache.js';
import { fhQuote, fhProfile, fhMetric, fhNews } from './adapters/finnhub.js';
export { getHoldings, getEtfsContaining, ISSUER_LINKS, HOLDINGS_MAP } from './holdings.js';

// TODO(15차/16차): getHistoricalMetrics·getValuationHistory를 financials-reported·candle 기반
// 실데이터로 교체 예정. 현재는 빈 결과(stub)를 반환하고 호출부에서 패널을 숨긴다.

const FRESH_DAYS = 2; // EOD 시세 신선도 기준

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}


// === 공개 어댑터 함수들 ===

export async function getProfile(ticker) {
  const sym = getSymbol(ticker);
  if (!sym) throw new Error('symbol not found');

  if (sym.market !== 'us') {
    return {
      data: {
        ticker: sym.ticker, nameKr: sym.nameKr, nameEn: sym.nameEn,
        exchange: sym.exchange, sector: sym.sector, industry: sym.industry,
        market: sym.market, type: sym.type,
        description: `${sym.nameKr}(${sym.ticker})는 ${sym.exchange}에 상장된 ${sym.industry} 기업입니다.`,
        marketCap: null, sharesOutstanding: null,
      },
      source: 'symbols.js (KR 실데이터 미지원)',
      asOf: todayISO(),
      currency: 'KRW',
      reason: 'kr-not-supported',
    };
  }

  const cacheKey = `profile:${ticker}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    const ageHours = (Date.now() - new Date(cached.asOf).getTime()) / 36e5;
    if (ageHours < 24 * 7) return cached;
  }

  const p = await fhProfile(ticker);
  const result = {
    data: {
      ticker: sym.ticker,
      nameKr: sym.nameKr,
      nameEn: p?.name || sym.nameEn,
      exchange: p?.exchange || sym.exchange,
      sector: p?.finnhubIndustry || sym.sector,
      industry: p?.finnhubIndustry || sym.industry,
      market: 'us', type: sym.type,
      description: `${sym.nameKr}(${sym.ticker})는 ${p?.exchange || sym.exchange}에 상장된 ${p?.finnhubIndustry || sym.industry} 기업입니다.` +
                   (p?.weburl ? ` 공식 사이트: ${p.weburl}` : ''),
      marketCap: p?.marketCapitalization != null ? p.marketCapitalization * 1e6 : null,
      sharesOutstanding: p?.shareOutstanding != null ? p.shareOutstanding * 1e6 : null,
      ipo: p?.ipo || null,
      logoUrl: p?.logo || null,
    },
    source: p ? 'Finnhub' : 'Finnhub (no data) + symbols.js',
    asOf: todayISO(),
    currency: 'USD',
    reason: p ? undefined : 'fetch-failed',
  };
  if (p) cacheSet(cacheKey, result);  // 실패는 캐시하지 않음(재시도 허용)
  return result;
}

export async function getQuoteEOD(ticker) {
  const sym = getSymbol(ticker);
  const cacheKey = `quote:${ticker}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    const ageHours = (Date.now() - new Date(cached.asOf).getTime()) / 36e5;
    if (ageHours < 24) return cached;
  }

  if (sym?.market !== 'us') {
    const result = {
      data: { price: null, changePct: null, volume: null },
      source: 'unavailable',
      asOf: todayISO(),
      currency: sym?.market === 'kr' ? 'KRW' : 'USD',
      reason: 'kr-not-supported',
    };
    cacheSet(cacheKey, result);
    return result;
  }

  const q = await fhQuote(ticker);
  if (!q || q.c == null) {
    // 실패/빈 응답은 캐시하지 않는다 — 일시적 실패가 캐시에 굳는 것을 방지(다음 조회 시 재시도).
    return {
      data: { price: null, changePct: null, volume: null },
      source: 'Finnhub (no data)',
      asOf: todayISO(),
      currency: 'USD',
      reason: 'fetch-failed',
    };
  }

  const result = {
    data: { price: q.c, changePct: q.dp, volume: null },
    source: 'Finnhub',
    asOf: q.t ? new Date(q.t * 1000).toISOString().slice(0, 10) : todayISO(),
    currency: 'USD',
  };
  cacheSet(cacheKey, result);
  return result;
}

export async function getFinancials(ticker) {
  const sym = getSymbol(ticker);
  const cacheKey = `fin:${ticker}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    const ageHours = (Date.now() - new Date(cached.asOf).getTime()) / 36e5;
    if (ageHours < 24) return cached;
  }

  if (sym?.market !== 'us') {
    const result = {
      data: emptyFinancials(),
      source: 'unavailable (KR 실데이터 미지원)',
      asOf: todayISO(),
      currency: 'KRW',
      basis: { period: '—', statement: '—', earnings: '—' },
      reason: 'kr-not-supported',
    };
    cacheSet(cacheKey, result);
    return result;
  }

  const m = await fhMetric(ticker);
  const metric = m?.metric || {};
  const data = {
    per: pickNum(metric, ['peTTM', 'peNormalizedAnnual', 'peBasicExclExtraTTM']),
    pbr: pickNum(metric, ['pbAnnual', 'pbQuarterly']),
    psr: pickNum(metric, ['psTTM', 'psAnnual']),
    pcr: pickNum(metric, ['pcfShareTTM']),
    peg: pickNum(metric, ['pegRatioTTM']),
    evEbitda: pickNum(metric, ['enterpriseValueOverEBITDATTM', 'evEbitTTM']),
    dividendYield: pickNum(metric, ['dividendYieldIndicatedAnnual', 'currentDividendYieldTTM']),
    roe: pickNum(metric, ['roeTTM', 'roeRfy']),
    roa: pickNum(metric, ['roaTTM', 'roaRfy']),
    roic: pickNum(metric, ['roicTTM']),
    opMargin: pickNum(metric, ['operatingMarginTTM', 'operatingMarginAnnual']),
    netMargin: pickNum(metric, ['netProfitMarginTTM', 'netProfitMarginAnnual']),
    ebitdaMargin: pickNum(metric, ['ebitdaMarginTTM']),
    revenueGrowthYoY: pickNum(metric, ['revenueGrowthTTMYoy', 'revenueGrowthQuarterlyYoy']),
    revenueGrowthQoQ: pickNum(metric, ['revenueGrowthQuarterlyQoq']),
    opGrowth: pickNum(metric, ['operatingIncomeCAGR5Y']),
    epsGrowth: pickNum(metric, ['epsGrowthTTMYoy', 'epsGrowthQuarterlyYoy']),
    revenue: null, operatingIncome: null, netIncome: null,
    eps: pickNum(metric, ['epsTTM', 'epsBasicExclExtraItemsTTM']),
    bps: pickNum(metric, ['bookValuePerShareAnnual']),
    ocf: null, fcf: null,
    debtRatio: pickNum(metric, ['totalDebtTotalEquityQuarterly', 'totalDebtTotalEquityAnnual']),
    currentRatio: pickNum(metric, ['currentRatioQuarterly', 'currentRatioAnnual']),
    interestCoverage: null,
    netDebtEbitda: pickNum(metric, ['netDebtTotalEquityAnnual']),
    dps: pickNum(metric, ['dividendPerShareAnnual']),
    payoutRatio: pickNum(metric, ['payoutRatioTTM', 'payoutRatioAnnual']),
    buybackFlag: null,
    beta: pickNum(metric, ['beta']),
    high52: pickNum(metric, ['52WeekHigh']),
    low52: pickNum(metric, ['52WeekLow']),
    foreignOwnership: null,
  };
  const result = {
    data,
    source: m ? 'Finnhub /stock/metric' : 'Finnhub (no data)',
    asOf: todayISO(),
    currency: 'USD',
    basis: { period: 'TTM/Annual mixed', statement: '연결', earnings: '지배주주' },
    reason: m ? undefined : 'fetch-failed',
  };
  if (m) cacheSet(cacheKey, result);  // 실패는 캐시하지 않음(재시도 허용)
  return result;
}

export async function getNews(ticker) {
  const sym = getSymbol(ticker);
  const cacheKey = `news:${ticker}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    const ageHours = (Date.now() - new Date(cached.asOf).getTime()) / 36e5;
    if (ageHours < 6) return cached;
  }

  if (sym?.market !== 'us') {
    const result = {
      data: [],
      source: 'unavailable (KR 실데이터 미지원)',
      asOf: todayISO(),
      reason: 'kr-not-supported',
    };
    cacheSet(cacheKey, result);
    return result;
  }

  const today = new Date();
  const from = new Date(today.getTime() - 14 * 86400000).toISOString().slice(0, 10);
  const to = today.toISOString().slice(0, 10);
  const arr = await fhNews(ticker, from, to);

  if (!Array.isArray(arr) || arr.length === 0) {
    // fetch 실패와 '진짜 뉴스 없음'이 합쳐지므로 캐시하지 않는다(다음 조회 재시도).
    return {
      data: [],
      source: 'Finnhub (no news)',
      asOf: to,
      reason: 'no-news',
    };
  }

  const mapped = arr.slice(0, 12).map(n => ({
    title: n.headline,
    source: n.source || 'Finnhub',
    date: n.datetime ? new Date(n.datetime * 1000).toISOString().slice(0, 10) : to,
    tag: 'neutral',
    url: n.url,
    summary: n.summary,
  }));
  const result = {
    data: mapped,
    source: 'Finnhub /company-news',
    asOf: to,
  };
  cacheSet(cacheKey, result);
  return result;
}

// 유틸 — Finnhub metric 응답에서 첫 번째 유효 키 선택
function pickNum(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v != null && !isNaN(Number(v))) return Number(v);
  }
  return null;
}

function emptyFinancials() {
  return Object.fromEntries([
    'per','pbr','psr','pcr','peg','evEbitda','dividendYield',
    'roe','roa','roic','opMargin','netMargin','ebitdaMargin',
    'revenueGrowthYoY','revenueGrowthQoQ','opGrowth','epsGrowth',
    'revenue','operatingIncome','netIncome','eps','bps','ocf','fcf',
    'debtRatio','currentRatio','interestCoverage','netDebtEbitda',
    'dps','payoutRatio','buybackFlag','beta','high52','low52','foreignOwnership',
  ].map(k => [k, null]));
}

import { fetchEarnings, fetchDividends } from './adapters/calendar/finnhub.js';
import { getFinnhubProxyBase } from './config.js';
import { getWatchlist } from './watchlist.js';

// MOCK 일정은 사용자 혼선을 줄이기 위해 11차에서 완전 제거됨.
// TODO: 한국 종목(KIND/DART)·매크로(FRED/ECOS) 실연동은 CORS 제약으로 별도 프록시 서버 필요 — 후속 단계.
const CAL_TTL_MS = 60 * 60 * 1000; // 1시간
const CAL_EMPTY_TTL_MS = 5 * 60 * 1000; // 빈 결과는 5분만 캐시

function cacheGetWithTTL(key) {
  const v = cacheGet(key);
  if (!v || !v._cachedAt) return null;
  const ttl = v.data && v.data.length ? CAL_TTL_MS : CAL_EMPTY_TTL_MS;
  if (Date.now() - v._cachedAt > ttl) return null;
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

function emptyResult(reason) {
  return { data: [], source: 'Finnhub', asOf: todayISO(), reason };
}

export async function getCalendar(ticker = null, { from, to } = {}) {
  const f = from || isoOffset(-30);
  const t = to || isoOffset(45);
  const proxyBase = getFinnhubProxyBase();
  const mode = proxyBase ? 'proxy' : 'none';
  const cacheKey = `calendar:${mode}:${ticker || 'all'}:${f}:${t}`;
  const cached = cacheGetWithTTL(cacheKey);
  if (cached) return cached;

  if (mode === 'none') {
    const res = emptyResult('no-key');
    cacheSetWithTTL(cacheKey, res);
    return res;
  }

  let events = [];
  let fetchFailed = false;

  if (ticker) {
    const sym = getSymbol(ticker);
    if (sym?.market !== 'us') {
      const res = emptyResult('kr-not-supported');
      cacheSetWithTTL(cacheKey, res);
      return res;
    }
    try {
      const [earn, div] = await Promise.all([
        fetchEarnings({ ticker, from: f, to: t }),
        fetchDividends({ ticker, from: f, to: t }),
      ]);
      events = [...earn, ...div];
    } catch {
      fetchFailed = true;
    }
  } else {
    const usWatchTickers = getWatchlist().filter(tk => getSymbol(tk)?.market === 'us');
    if (!usWatchTickers.length) {
      const res = emptyResult('no-us-watch');
      cacheSetWithTTL(cacheKey, res);
      return res;
    }
    try {
      const all = await Promise.all(usWatchTickers.flatMap(tk => [
        fetchEarnings({ ticker: tk, from: f, to: t }),
        fetchDividends({ ticker: tk, from: f, to: t }),
      ]));
      events = all.flat();
    } catch {
      fetchFailed = true;
    }
  }

  if (fetchFailed) {
    const res = emptyResult('fetch-failed');
    cacheSetWithTTL(cacheKey, res);
    return res;
  }

  const result = {
    data: events.sort((a, b) => a.date.localeCompare(b.date)),
    source: 'Finnhub',
    asOf: todayISO(),
  };
  cacheSetWithTTL(cacheKey, result);
  return result;
}

export function isConsensusAvailable() {
  // 무료 데이터로는 컨센서스 확보 어려움
  return false;
}

// 분기 추이 — 실연동 전까지 빈 결과(stub). 호출부에서 패널 숨김.
export async function getHistoricalMetrics(ticker, points = 8) {
  return {
    data: { labels: [], revenue: [], operatingIncome: [], netIncome: [],
            eps: [], ocf: [], fcf: [], roe: [], opMargin: [] },
    source: 'pending',
    asOf: todayISO(),
    reason: 'timeseries-pending',
  };
}

// 과거 PER/PBR 밸류 밴드 — 실연동 전까지 빈 결과(stub). 호출부에서 패널 숨김.
export async function getValuationHistory(ticker, months = 60) {
  return {
    data: { labels: [], per: [], pbr: [], currentPer: null, currentPbr: null },
    source: 'pending',
    asOf: todayISO(),
    reason: 'valuation-pending',
  };
}
