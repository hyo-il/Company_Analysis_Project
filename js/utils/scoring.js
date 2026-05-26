// 팩터 스코어 (0-100). 실제 운영에서는 동종업계 백분위/z-score, 윈저라이징, 섹터 중립화 적용.
// 여기서는 결정론적 단순 환산.

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
