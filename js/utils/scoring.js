// 팩터 스코어 (0-100). 실제 운영에서는 동종업계 백분위/z-score, 윈저라이징, 섹터 중립화 적용.
// 여기서는 결정론적 단순 환산.
import { peerPercentile } from './peer-percentile.js';

// 백분위 점수 카드용 카테고리 정의. compare.js의 COMPARE_METRICS와 일관성 유지.
export const FACTOR_CATEGORIES = [
  {
    name: '가치',
    metrics: [
      { key: 'per',       label: 'PER',       lowerBetter: true  },
      { key: 'pbr',       label: 'PBR',       lowerBetter: true  },
      { key: 'evEbitda',  label: 'EV/EBITDA', lowerBetter: true  },
    ],
  },
  {
    name: '수익성',
    metrics: [
      { key: 'roe',       label: 'ROE',         lowerBetter: false },
      { key: 'roic',      label: 'ROIC',        lowerBetter: false },
      { key: 'opMargin',  label: '영업이익률',  lowerBetter: false },
    ],
  },
  {
    name: '성장성',
    metrics: [
      { key: 'revenueGrowthYoY', label: '매출 YoY',      lowerBetter: false },
      { key: 'opGrowth',         label: '영업이익 성장', lowerBetter: false },
      { key: 'epsGrowth',        label: 'EPS 성장',      lowerBetter: false },
    ],
  },
  {
    name: '안정성',
    metrics: [
      { key: 'debtRatio',        label: '부채비율',    lowerBetter: true  },
      { key: 'currentRatio',     label: '유동비율',    lowerBetter: false },
      { key: 'interestCoverage', label: '이자보상',    lowerBetter: false },
    ],
  },
];

export const SWING_FACTOR_CATEGORIES = [
  { name: '모멘텀',     desc: '1·3개월 가격 추세 + 이동평균 위치 (candle 연동 후 활성화)' },
  { name: '실적 모멘텀', desc: '최근 분기 매출·이익 성장 + 분기별 추세' },
  { name: '이벤트 임박', desc: '30·90일 내 다가오는 실적·배당·매크로 일정 임박도' },
  { name: '변동성/강도', desc: '베타·52주 고저 위치 — 진폭과 강세 강도' },
];

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// 낮을수록 좋은 지표는 inverse
function score(v, low, high, inverse = false) {
  if (v == null || isNaN(v)) return 50;
  const t = clamp((v - low) / (high - low), 0, 1);
  return Math.round((inverse ? 1 - t : t) * 100);
}

export function computeFactorScores(fin) {
  const value = Math.round((
    score(fin.per, 5, 40, true) +
    score(fin.pbr, 0.5, 6, true) +
    score(fin.evEbitda, 4, 25, true)
  ) / 3);
  const profitability = Math.round((
    score(fin.roe, 0, 30) +
    score(fin.roic, 0, 30) +
    score(fin.opMargin, 0, 35)
  ) / 3);
  const growth = Math.round((
    score(fin.revenueGrowthYoY, -10, 40) +
    score(fin.opGrowth, -15, 50) +
    score(fin.epsGrowth, -10, 45)
  ) / 3);
  const stability = Math.round((
    score(fin.debtRatio, 20, 200, true) +
    score(fin.currentRatio, 80, 280) +
    score(fin.interestCoverage, 0, 20)
  ) / 3);
  const dividend = score(fin.dividendYield, 0, 5);
  const total = Math.round((value + profitability + growth + stability) / 4);
  return { '가치': value, '수익성': profitability, '성장성': growth, '안정성': stability, '배당': dividend, '종합': total };
}

// 동종업계 백분위 기반 점수. 카테고리 내 지표별 백분위 평균.
// 한 지표라도 본인 또는 피어 데이터가 부족하면 그 지표는 제외.
// 카테고리 내 모든 지표가 null이면 그 카테고리도 null.
export function computePeerScores(myFin, peerFinList) {
  const peerCount = (peerFinList || []).length;
  const categoryScores = {};
  const perCategoryNulls = {};

  for (const cat of FACTOR_CATEGORIES) {
    const perMetric = cat.metrics.map(m => {
      const peerVals = peerFinList.map(p => p?.[m.key]);
      return peerPercentile(myFin?.[m.key], peerVals, m.lowerBetter);
    });
    const valid = perMetric.filter(v => v != null);
    perCategoryNulls[cat.name] = perMetric.length - valid.length;
    categoryScores[cat.name] = valid.length
      ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length)
      : null;
  }

  const catVals = Object.values(categoryScores).filter(v => v != null);
  const total = catVals.length
    ? Math.round(catVals.reduce((a, b) => a + b, 0) / catVals.length)
    : null;

  return {
    ...categoryScores,
    '종합': total,
    _meta: { peerCount, perCategoryNulls },
  };
}

// 0~100 절대 환산용 보조
function clamp01(x) { return Math.max(0, Math.min(1, x)); }
function pctScore(v, low, high) {
  if (v == null || isNaN(v)) return null;
  return Math.round(clamp01((v - low) / (high - low)) * 100);
}

/**
 * 스윙(1~3개월) 점수 계산.
 * 입력:
 *   fin       — adapter.getFinancials().data (베타·52주·성장률 등)
 *   ts        — adapter.getHistoricalMetrics().data (분기 시계열)
 *   calendar  — getCalendar(ticker).data (다가오는 일정 배열)
 *   marketKr  — KR 종목 여부 (시세 미연동 카테고리 표시용)
 * 반환:
 *   { '모멘텀': null|number, '실적 모멘텀': ..., '이벤트 임박': ..., '변동성/강도': ..., '종합': ..., _meta }
 */
export function computeSwingScores({ fin, ts, calendar, marketKr }) {
  // 모멘텀 — candle 미연동: KR/US 모두 null + 'pending' 표기
  const momentum = null;

  // 실적 모멘텀 — 최근 분기 YoY + 분기별 추세
  let earnings = null;
  if (fin) {
    const revenueY = fin.revenueGrowthYoY;
    const opGrowth = fin.opGrowth;
    const epsGrowth = fin.epsGrowth;
    const parts = [revenueY, opGrowth, epsGrowth].filter(v => v != null && !isNaN(v));
    if (parts.length) {
      const avg = parts.reduce((a, b) => a + b, 0) / parts.length;
      // -10% = 20점, 0% = 50, 20% = 80, 50%+ = 95
      earnings = pctScore(avg, -15, 50);
    }
  }
  // 분기별 추세(KR 시계열 있으면 보강)
  if (earnings != null && ts && Array.isArray(ts.revenue) && ts.revenue.length >= 4) {
    const r = ts.revenue.filter(v => v != null);
    if (r.length >= 4) {
      const lastTwoAvg = (r[r.length - 1] + r[r.length - 2]) / 2;
      const firstTwoAvg = (r[0] + r[1]) / 2;
      if (firstTwoAvg > 0) {
        const trend = ((lastTwoAvg / firstTwoAvg) - 1) * 100;
        const trendScore = pctScore(trend, -10, 30);
        if (trendScore != null) earnings = Math.round((earnings + trendScore) / 2);
      }
    }
  }

  // 이벤트 임박 — 가장 임박한 일정의 D-day 기반
  let events = 30;   // 일정 없음 시 낮은 기본 점수
  if (calendar && Array.isArray(calendar) && calendar.length) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const upcoming = calendar
      .filter(e => new Date(e.date) >= today)
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    if (upcoming.length) {
      const day = Math.floor((new Date(upcoming[0].date) - today) / 86400e3);
      if (day <= 7)       events = 95;
      else if (day <= 14) events = 80;
      else if (day <= 30) events = 65;
      else if (day <= 60) events = 45;
      else                events = 30;
    }
  }

  // 변동성/강도 — 베타 + 52주 고저 위치 (US 만 가능)
  let volatility = null;
  if (!marketKr && fin) {
    const beta = fin.beta;
    const hi52 = fin.high52;
    const lo52 = fin.low52;
    const price = fin.price ?? null;   // 일부 fin 에 없을 수 있음. null 허용.

    // 베타 50점: 0.8~1.4 적정(70~85), 그 외 감점
    let betaScore = null;
    if (beta != null && !isNaN(beta)) {
      if (beta >= 0.8 && beta <= 1.4) betaScore = 80;
      else if (beta < 0.5) betaScore = 35;          // 너무 둔감
      else if (beta > 2.0) betaScore = 30;          // 너무 변동성 큼 (위험)
      else betaScore = 55;
    }

    // 52주 위치 50점: 60~85% 가 강세(70~90), 90%+ 는 조정 위험
    let posScore = null;
    if (hi52 != null && lo52 != null && hi52 > lo52 && price != null) {
      const pos = (price - lo52) / (hi52 - lo52);
      if (pos >= 0.6 && pos <= 0.85)      posScore = 85;
      else if (pos >= 0.4 && pos < 0.6)   posScore = 65;
      else if (pos > 0.85)                posScore = 60;   // 추격 매수 위험
      else                                posScore = 40;   // 약세
    }

    const parts = [betaScore, posScore].filter(v => v != null);
    if (parts.length) volatility = Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
  }

  // 종합 — 가용 카테고리 평균
  const all = [momentum, earnings, events, volatility];
  const valid = all.filter(v => v != null);
  const total = valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : null;

  return {
    '모멘텀': momentum,
    '실적 모멘텀': earnings,
    '이벤트 임박': events,
    '변동성/강도': volatility,
    '종합': total,
    _meta: {
      momentumPending: true,            // candle 연동 후 활성화 안내용
      volatilityUnavailable: !!marketKr,
      categoryCount: valid.length,
    },
  };
}
