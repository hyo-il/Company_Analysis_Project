// 데이터 어댑터 — 무료 API(DART, SEC EDGAR, KRX 등) 연동 전 mock 응답 제공.
// 모든 함수는 { data, source, asOf, currency } 구조로 반환한다.
//
// 실제 연동 시: js/data/adapters/dart.js, sec.js, krx.js 등을 만들어 이 모듈에서 라우팅.

import { getSymbol } from './symbols.js';
import { cacheGet, cacheSet } from '../utils/cache.js';
import { fhQuote, fhProfile, fhMetric, fhNews } from './adapters/finnhub.js';
import { dartCompany, dartFnlttSinglAcnt } from './adapters/dart.js';
import { getCorpCode } from './dart-corpcode.js';
import { extractAccounts, buildKRFinancials } from './dart-derive.js';
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
    const cacheKey = `profile:${ticker}`;
    const cached = cacheGet(cacheKey);
    if (cached) {
      const ageHours = (Date.now() - new Date(cached.asOf).getTime()) / 36e5;
      if (ageHours < 24 * 7) return cached;
    }

    const corpCode = getCorpCode(ticker);
    if (!corpCode) {
      return {
        data: {
          ticker: sym.ticker, nameKr: sym.nameKr, nameEn: sym.nameEn,
          exchange: sym.exchange, sector: sym.sector, industry: sym.industry,
          market: sym.market, type: sym.type,
          description: `${sym.nameKr}(${sym.ticker})는 ${sym.exchange}에 상장된 ${sym.industry} 기업입니다.`,
          marketCap: null, sharesOutstanding: null,
        },
        source: 'symbols.js (corp_code 매핑 없음)',
        asOf: todayISO(),
        currency: 'KRW',
        reason: 'kr-no-corpcode',
      };
    }

    const dart = await dartCompany(corpCode);
    const co = dart?.[0] || dart?.list?.[0] || dart;
    const result = {
      data: {
        ticker: sym.ticker,
        nameKr: co?.corp_name || sym.nameKr,
        nameEn: co?.corp_name_eng || sym.nameEn,
        exchange: sym.exchange,
        sector: sym.sector,
        industry: co?.induty_code ? `${sym.industry} (KSIC ${co.induty_code})` : sym.industry,
        market: 'kr', type: sym.type,
        description: `${sym.nameKr}(${sym.ticker})는 ${sym.exchange}에 상장된 ${sym.industry} 기업입니다.` +
                     (co?.hm_url ? ` 공식 사이트: ${co.hm_url}` : ''),
        marketCap: null, sharesOutstanding: null,
        ceo: co?.ceo_nm || null,
        established: co?.est_dt || null,
        fiscalMonth: co?.acc_mt || null,
      },
      source: dart ? 'OpenDART /company' : 'OpenDART (no data) + symbols.js',
      asOf: todayISO(),
      currency: 'KRW',
      reason: dart ? undefined : 'fetch-failed',
    };
    if (dart) cacheSet(cacheKey, result);
    return result;
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
    const corpCode = getCorpCode(ticker);
    if (!corpCode) {
      return {
        data: emptyFinancials(),
        source: 'unavailable (corp_code 매핑 없음)',
        asOf: todayISO(),
        currency: 'KRW',
        basis: { period: '—', statement: '—', earnings: '—' },
        reason: 'kr-no-corpcode',
      };
    }

    const now = new Date();
    const lastYear = now.getFullYear() - 1;
    const prevYear = now.getFullYear() - 2;
    const settled = await Promise.allSettled([
      dartFnlttSinglAcnt(corpCode, lastYear, '11011'),
      dartFnlttSinglAcnt(corpCode, prevYear, '11011'),
    ]);
    const latestY = settled[0].status === 'fulfilled' ? settled[0].value : null;
    const prevY   = settled[1].status === 'fulfilled' ? settled[1].value : null;
    const latestY_ext = extractAccounts(latestY);
    const prevY_ext = extractAccounts(prevY);

    const data = buildKRFinancials({
      latestQ: null, yoyQ: null,
      latestY: latestY_ext, prevY: prevY_ext,
    });
    // 연간 YoY 보강
    if (latestY_ext && prevY_ext) {
      if (prevY_ext.revenue) {
        data.revenueGrowthYoY = ((latestY_ext.revenue / prevY_ext.revenue) - 1) * 100;
      }
      if (prevY_ext.operatingIncome) {
        data.opGrowth = ((latestY_ext.operatingIncome / prevY_ext.operatingIncome) - 1) * 100;
      }
      if (prevY_ext.netIncome) {
        data.epsGrowth = ((latestY_ext.netIncome / prevY_ext.netIncome) - 1) * 100;
      }
    }

    const ok = !!latestY_ext;
    const result = {
      data,
      source: ok ? 'OpenDART /fnlttSinglAcnt' : 'OpenDART (no data)',
      asOf: todayISO(),
      currency: 'KRW',
      basis: { period: `${lastYear} 사업보고서`, statement: '연결', earnings: '지배주주' },
      reason: ok ? undefined : 'fetch-failed',
    };
    if (ok) cacheSet(cacheKey, result);
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

// 분기 추이. US는 stub(15차 이후), KR은 OpenDART 분기 환산.
export async function getHistoricalMetrics(ticker, points = 8) {
  const sym = getSymbol(ticker);
  const emptyData = { labels: [], revenue: [], operatingIncome: [], netIncome: [],
                      eps: [], ocf: [], fcf: [], roe: [], opMargin: [] };

  if (sym?.market === 'us') {
    return { data: emptyData, source: 'pending', asOf: todayISO(), reason: 'timeseries-pending' };
  }

  const corpCode = getCorpCode(ticker);
  if (!corpCode) {
    return { data: emptyData, source: 'unavailable', asOf: todayISO(), reason: 'kr-no-corpcode' };
  }

  // 최근 1년치 분기 4개로 축소 (회로 차단기 보호 + 무료 한도 절약)
  const now = new Date();
  const year = now.getFullYear() - 1;
  const reportCodes = ['11013', '11012', '11014', '11011']; // 1Q누적, 반기, 3Q누적, 연간

  const settled = await Promise.allSettled(
    reportCodes.map(rc => dartFnlttSinglAcnt(corpCode, year, rc))
  );
  const reports = {};
  reportCodes.forEach((rc, i) => {
    reports[rc] = settled[i].status === 'fulfilled' ? extractAccounts(settled[i].value) : null;
  });

  const q1  = reports['11013'];
  const h1  = reports['11012'];
  const q3c = reports['11014'];
  const fy  = reports['11011'];

  const single = [
    { label: `${String(year).slice(2)}Q1`, src: q1 },
    { label: `${String(year).slice(2)}Q2`, src: subtract(h1, q1) },
    { label: `${String(year).slice(2)}Q3`, src: subtract(q3c, h1) },
    { label: `${String(year).slice(2)}Q4`, src: subtract(fy, q3c) },
  ];

  const labels = [];
  const quarters = { revenue: [], operatingIncome: [], netIncome: [], ocf: [] };
  for (const s of single) {
    if (!s.src) continue;
    labels.push(s.label);
    quarters.revenue.push(s.src.revenue ?? null);
    quarters.operatingIncome.push(s.src.operatingIncome ?? null);
    quarters.netIncome.push(s.src.netIncome ?? null);
    quarters.ocf.push(s.src.ocf ?? null);
  }

  if (!labels.length) {
    return { data: emptyData, source: 'OpenDART (no data)', asOf: todayISO(), reason: 'fetch-failed' };
  }

  return {
    data: {
      labels,
      revenue: quarters.revenue,
      operatingIncome: quarters.operatingIncome,
      netIncome: quarters.netIncome,
      ocf: quarters.ocf,
      eps: [], fcf: [], roe: [], opMargin: [],
    },
    source: 'OpenDART /fnlttSinglAcnt (분기 환산)',
    asOf: todayISO(),
  };
}

function subtract(a, b) {
  if (!a) return null;
  if (!b) return a; // Q1만 단독(누적 없음)인 경우
  const out = {};
  for (const k of ['revenue','operatingIncome','netIncome','ocf']) {
    if (a[k] != null && b[k] != null) out[k] = a[k] - b[k];
    else if (a[k] != null) out[k] = a[k];
  }
  return out;
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
