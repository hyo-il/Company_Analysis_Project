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
