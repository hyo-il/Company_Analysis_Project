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
export function computeSwingScores({ fin, ts, calendar, marketKr, momentum }) {
  // 모멘텀 점수 산출 (1·3개월 가격 변화 + 이동평균 위치). momentum = us-candles 데이터 객체.
  let momentumScore = null;
  if (momentum) {
    const parts = [];

    // 1개월 변화: -15% = 0, 0% = 33, +30% = 100  → pctScore(v, -15, 30)
    const s1m = pctScore(momentum.change1m, -15, 30);
    if (s1m != null) parts.push(s1m);

    // 3개월 변화: -30% = 0, 0% = 33, +60% = 100  → pctScore(v, -30, 60)
    const s3m = pctScore(momentum.change3m, -30, 60);
    if (s3m != null) parts.push(s3m);

    // 이동평균 위치 4 케이스
    const { currentPrice, ma20, ma60 } = momentum;
    if (currentPrice != null && ma20 != null && ma60 != null) {
      const above20 = currentPrice > ma20;
      const ma20Above60 = ma20 > ma60;
      let maScore;
      if (above20 && ma20Above60)        maScore = 85;   // 강세 정렬
      else if (above20 && !ma20Above60)  maScore = 60;   // 약강세
      else if (!above20 && ma20Above60)  maScore = 40;   // 약세 가능성
      else                                maScore = 25;   // 약세 정렬
      parts.push(maScore);
    }

    if (parts.length) {
      momentumScore = Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
    }
  }

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

  // 변동성/강도 — 베타(US 만) + 52주 고저 위치(KR/US). KR 은 momentum.pos52 활용.
  let volatility = null;
  {
    // pos52: momentum 객체에 있으면 우선 사용 (KR/US 둘 다), 없으면 fin 에서 계산
    let pos52 = null;
    if (momentum && momentum.pos52 != null) {
      pos52 = momentum.pos52;
    } else if (fin && fin.high52 && fin.low52 && fin.high52 > fin.low52 && fin.price != null) {
      pos52 = (fin.price - fin.low52) / (fin.high52 - fin.low52);
    }

    // 베타: 현재는 US fin 만 가용 (KR fin 에는 없음)
    const beta = fin?.beta;

    let betaScore = null;
    if (beta != null && !isNaN(beta)) {
      if (beta >= 0.8 && beta <= 1.4) betaScore = 80;
      else if (beta < 0.5) betaScore = 35;
      else if (beta > 2.0) betaScore = 30;
      else betaScore = 55;
    }

    let posScore = null;
    if (pos52 != null) {
      if (pos52 >= 0.6 && pos52 <= 0.85)    posScore = 85;
      else if (pos52 >= 0.4 && pos52 < 0.6) posScore = 65;
      else if (pos52 > 0.85)                posScore = 60;
      else                                  posScore = 40;
    }

    const parts = [betaScore, posScore].filter(v => v != null);
    if (parts.length) volatility = Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
  }

  // 종합 — 가용 카테고리 평균
  const all = [momentumScore, earnings, events, volatility];
  const valid = all.filter(v => v != null);
  const total = valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : null;

  return {
    '모멘텀': momentumScore,
    '실적 모멘텀': earnings,
    '이벤트 임박': events,
    '변동성/강도': volatility,
    '종합': total,
    _meta: {
      momentumPending: momentumScore == null,   // 모멘텀 산출 불가/대기 (시세 데이터 없음)
      momentumUnavailableReason: momentum ? null : (marketKr ? 'kr-no-candle' : 'us-no-candle'),
      volatilityPartial: marketKr && volatility != null ? 'pos52-only-no-beta' : null,
      categoryCount: valid.length,
    },
  };
}

/**
 * 애널리스트 함정 경고 룰 — 단순 점수로 안 보이는 구조적 위험.
 * 각 룰은 (input) → boolean | object 반환.
 * 입력 데이터가 부족하면 false (미발동).
 */
export const WARNING_RULES = [
  {
    id: 'high-leverage-low-coverage',
    level: 'high',
    label: '차입경영 위험',
    icon: '⚠',
    check: (f) => {
      if (f.debtRatio == null || f.interestCoverage == null) return false;
      return f.debtRatio > 200 && f.interestCoverage < 3;
    },
    msg: (f) => `부채비율 ${f.debtRatio?.toFixed(0)}% + 이자보상 ${f.interestCoverage?.toFixed(1)}배 — ROE 가 부채 의존적이며 금리 인상 시 취약.`,
  },
  {
    id: 'interest-burden',
    level: 'high',
    label: '이자 부담 임계',
    icon: '🔴',
    check: (f) => f.interestCoverage != null && f.interestCoverage < 1.5,
    msg: (f) => `이자보상 ${f.interestCoverage?.toFixed(1)}배 — 본업 이익으로 이자 비용을 1.5배 이하로만 커버. 실적 둔화 시 즉시 위험.`,
  },
  {
    id: 'non-operating-dependence',
    level: 'mid',
    label: '영업외 이익 의존',
    icon: '⚠',
    check: (f) => {
      if (f.netIncome == null || f.operatingIncome == null || f.operatingIncome <= 0) return false;
      return f.netIncome > f.operatingIncome * 1.3;
    },
    msg: (f) => `순이익(${(f.netIncome/1e8).toFixed(0)}억) > 영업이익(${(f.operatingIncome/1e8).toFixed(0)}억) × 1.3 — 본업 외 이익(자산 매각·일회성 등) 비중이 큼.`,
  },
  {
    id: 'liquidity-risk',
    level: 'mid',
    label: '단기 유동성 위험',
    icon: '⚠',
    check: (f) => {
      if (f.currentRatio == null || f.debtRatio == null) return false;
      return f.currentRatio < 100 && f.debtRatio > 200;
    },
    msg: (f) => `유동비율 ${f.currentRatio?.toFixed(0)}% (1년 내 갚을 빚 > 1년 내 쓸 돈) + 부채비율 ${f.debtRatio?.toFixed(0)}% — 단기 유동성 압박.`,
  },
  {
    id: 'cash-quality-doubt',
    level: 'mid',
    label: '회계품질 의심',
    icon: '⚠',
    check: (f) => {
      if (f.netIncome == null || f.ocf == null || f.netIncome <= 0) return false;
      return f.netIncome > f.ocf * 1.5;
    },
    msg: (f) => `순이익 > 영업현금흐름 × 1.5 — 장부 이익 대비 실제 현금 회수가 약함. 매출채권·재고 누적 점검 필요.`,
  },
];

/**
 * 함정 경고 평가. 입력 부족 룰은 자동 스킵.
 * @returns Array<{ id, level, label, icon, msg }>
 */
export function computeWarnings(fin) {
  if (!fin) return [];
  const out = [];
  for (const rule of WARNING_RULES) {
    try {
      if (rule.check(fin)) {
        out.push({
          id: rule.id, level: rule.level,
          label: rule.label, icon: rule.icon,
          msg: rule.msg(fin),
        });
      }
    } catch { /* 입력 미달 — 스킵 */ }
  }
  return out;
}

export const DUPONT_TYPES = {
  margin: {
    label: '마진형',
    desc: '높은 수익성으로 ROE 달성 — 가격 결정력·브랜드·기술 우위 (예: 소프트웨어, 럭셔리)',
  },
  turnover: {
    label: '회전형',
    desc: '자산을 효율적으로 굴려 ROE 달성 — 박리다매·재고 회전 (예: 유통, 도소매)',
  },
  leverage: {
    label: '레버리지형',
    desc: '부채 활용으로 ROE 증폭 — 자기자본 대비 부채 의존도 큼 (예: 금융업, 유틸리티)',
  },
  balanced: {
    label: '균형형',
    desc: '세 요소가 평이 — 특정 우위 없이 무난한 구조',
  },
};

/**
 * DuPont 3요소 분해 + 유형 분류.
 * ROE = netMargin × assetTurnover × leverage
 *   netMargin = netIncome / revenue (배수, 0~1)
 *   assetTurnover = revenue / totalAssets (배수)
 *   leverage = totalAssets / totalEquity (배수)
 * @returns { netMargin, assetTurnover, leverage, roeCheck, type, typeLabel, typeDesc } | null
 */
export function computeDupont(fin) {
  if (!fin) return null;
  const { netIncome, revenue, totalAssets, totalEquity } = fin;
  // 모두 절대값 필요. 하나라도 없으면 분해 불가.
  if (revenue == null || totalAssets == null || totalEquity == null || netIncome == null) return null;
  if (revenue <= 0 || totalAssets <= 0 || totalEquity <= 0) return null;

  const netMargin = netIncome / revenue;           // 0.0556 = 5.56%
  const assetTurnover = revenue / totalAssets;      // 배수
  const leverage = totalAssets / totalEquity;       // 배수
  const roeCheck = netMargin * assetTurnover * leverage * 100;  // % 환산

  // 유형 분류 — 절대 임계값 기반
  let type = 'balanced';
  if (netMargin > 0.15 && assetTurnover < 1.0 && leverage < 3) type = 'margin';
  else if (assetTurnover > 1.5 && netMargin < 0.10) type = 'turnover';
  else if (leverage > 5) type = 'leverage';

  return {
    netMargin,
    assetTurnover,
    leverage,
    roeCheck: Math.round(roeCheck * 100) / 100,
    type,
    typeLabel: DUPONT_TYPES[type].label,
    typeDesc: DUPONT_TYPES[type].desc,
  };
}
