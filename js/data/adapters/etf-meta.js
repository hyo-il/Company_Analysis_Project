// ETF 메타(TER·AUM·추적오차 등) — 무료로 확보 어려워 결정론적 mock.
// TODO: 운용사 공식 자료 기반 실연동 시 이 모듈을 교체.
export function mockEtfDetail(ticker) {
  let seed = 0;
  for (let i = 0; i < ticker.length; i++) seed = ((seed << 5) - seed + ticker.charCodeAt(i)) | 0;
  const rnd = (k, a, b) => {
    const x = Math.sin(seed + k) * 10000;
    return a + (x - Math.floor(x)) * (b - a);
  };
  return {
    ter: rnd(1, 0.03, 0.6),
    aum: rnd(2, 1e8, 5e11),
    trackingError: rnd(3, 0.05, 1.2),
    premiumDiscount: rnd(4, -0.5, 0.5),
    distributionYield: rnd(5, 0, 4),
    top10Concentration: rnd(6, 15, 70),
  };
}
