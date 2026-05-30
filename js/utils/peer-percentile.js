// 동종업계 비교용 유틸. compare.js와 analysis.js(점수 카드)에서 공유.
export const MAX_PEERS = 4;
export const MIN_PEERS = 3;

// 자기 자신 포함 N+1 묶음에서 자기보다 낮은 값 비율로 백분위 계산.
// lowerBetter=true (예: PER) 이면 방향 반전.
// 동률 처리는 단순 less-than 카운팅.
export function peerPercentile(myVal, peerVals, lowerBetter = false) {
  const valid = (peerVals || []).filter(v => v != null && !isNaN(v));
  if (myVal == null || isNaN(myVal) || valid.length < MIN_PEERS) return null;
  const below = valid.filter(v => v < myVal).length;
  const pct = (below / valid.length) * 100;
  return lowerBetter ? 100 - pct : pct;
}

export function peerMedian(peerVals) {
  const a = (peerVals || []).filter(v => v != null && !isNaN(v)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// 0~100 백분위를 0~4(=5단계) 정수 막대 칸 수로 환산.
export function toBars5(pct) {
  if (pct == null) return null;
  return Math.max(0, Math.min(4, Math.round(pct / 25)));
}
