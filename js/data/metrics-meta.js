// 기획서 4.2.2 — 8개 카테고리 · 쉬운 설명 툴팁 · 기준 표기
export const METRIC_CATEGORIES = [
  {
    id: 'valuation', title: '① 밸류에이션 (가격이 싼가 비싼가)',
    metrics: [
      { key: 'per', label: 'PER', basis: 'TTM·연결', unit: '배', tip: '회사가 1년에 10억 버는데 회사 전체 가격(시가총액)이 200억이면 PER 20배예요. 쉽게 말해 "이 가격으로 사면 회사가 버는 돈으로 본전 뽑는 데 20년 걸린다"는 뜻. 숫자가 낮을수록 싸게 사는 거예요.' },
      { key: 'pbr', label: 'PBR', basis: '연결', unit: '배', tip: '회사 안에 자본(재산) 100억이 들어있는데 회사 가격이 200억이면 PBR 2배예요. 가진 재산보다 시장에서 몇 배로 쳐주냐 보는 건데, 1배보다 낮으면 가진 재산보다도 싸게 파는 셈이에요.' },
      { key: 'psr', label: 'PSR', basis: 'TTM·연결', unit: '배', tip: '아직 이익이 별로 없는 회사 볼 때 써요. 1년에 100억 파는데 회사 가격이 300억이면 PSR 3배. 매출 대비 얼마에 거래되나 보는 거예요.' },
      { key: 'pcr', label: 'PCR', basis: 'TTM·연결', unit: '배', tip: 'PER랑 똑같은데 \'이익\' 대신 \'통장에 실제로 들어온 현금\' 기준이에요. 장부 이익 말고 진짜 현금 버는 힘을 보고 싶을 때 써요.' },
      { key: 'peg', label: 'PEG', basis: 'TTM·연결', unit: '배', tip: 'PER가 좀 높아 보여도 그만큼 빨리 크면 괜찮잖아요? PER를 이익 크는 속도로 나눈 값이에요. 1보다 낮으면 성장하는 거에 비해 싼 편.' },
      { key: 'evEbitda', label: 'EV/EBITDA', basis: 'TTM·연결', unit: '배', tip: '빚 많은 회사랑 적은 회사를 공평하게 비교하려고 써요. 회사 통째로 사는 값을 현금성 이익으로 나눈 건데, 낮을수록 싼 거예요.' },
      { key: 'dividendYield', label: '배당수익률', basis: 'TTM', unit: '%', tip: '주식 사두면 은행 이자처럼 1년에 몇 % 배당 받나예요. 100만원어치 샀는데 3만원 받으면 3%죠.' },
    ],
  },
  {
    id: 'profitability', title: '② 수익성 (돈을 잘 버는가)',
    metrics: [
      { key: 'roe', label: 'ROE', basis: 'TTM·연결', unit: '%', tip: '자! 이게 얼마 번 거예요? 100억 넣어서 10억 벌었으면 수익률 10%잖아요. 그게 ROE예요. 내 돈으로 얼마나 잘 굴렸나 보는 거라 높을수록 좋아요.' },
      { key: 'roa', label: 'ROA', basis: 'TTM·연결', unit: '%', tip: 'ROE랑 비슷한데, 내 돈만이 아니라 빌린 돈까지 합친 전 재산으로 얼마 벌었나 보는 거예요.' },
      { key: 'opMargin', label: '영업이익률', basis: 'TTM·연결', unit: '%', tip: '100원어치 팔아서 본업으로 몇 원 남겼나예요. 20원 남기면 20%.' },
      { key: 'netMargin', label: '순이익률', basis: 'TTM·연결', unit: '%', tip: '100원 팔아서 세금·이자까지 다 떼고 최종 몇 원 남았나예요.' },
      { key: 'roic', label: 'ROIC', basis: 'TTM·연결', unit: '%', tip: '사업에 실제로 집어넣은 돈으로 얼마 벌었나예요. 빚으로 부풀린 착시를 빼고 진짜 실력을 보는 거죠.' },
      { key: 'ebitdaMargin', label: 'EBITDA 마진', basis: 'TTM·연결', unit: '%', tip: '100원 팔아서 현금으로 실제 몇 원 남겼나예요 (공장 같은 설비 비용 빼기 전 기준).' },
    ],
  },
  {
    id: 'growth', title: '③ 성장성 (이익이 늘고 있는가)',
    metrics: [
      { key: 'revenueGrowthYoY', label: '매출 성장률(YoY)', basis: '전년 동분기', unit: '%', tip: '매출이 작년 같은 때보다 얼마나 늘었나예요. 쑥쑥 크는 회사인지 보는 거죠.' },
      { key: 'revenueGrowthQoQ', label: '매출 성장률(QoQ)', basis: '전분기', unit: '%', tip: '바로 전 분기보다 매출이 얼마나 늘었나예요.' },
      { key: 'opGrowth', label: '영업이익 성장률', basis: 'YoY', unit: '%', tip: '본업으로 버는 이익이 얼마나 빨리 늘고 있나예요.' },
      { key: 'epsGrowth', label: 'EPS 성장률', basis: 'YoY', unit: '%', tip: '내 한 주가 벌어주는 돈이 얼마나 늘고 있나예요.' },
    ],
  },
  {
    id: 'scale', title: '④ 손익·주당 규모',
    metrics: [
      { key: 'revenue', label: '매출액', basis: 'TTM·연결', unit: 'money', tip: '얼마 팔았나(매출). 회사 덩치를 보는 거예요.' },
      { key: 'operatingIncome', label: '영업이익', basis: 'TTM·연결', unit: 'money', tip: '본업으로 얼마 남겼나.' },
      { key: 'netIncome', label: '순이익', basis: 'TTM·연결', unit: 'money', tip: '최종 얼마 벌었나.' },
      { key: 'eps', label: 'EPS', basis: 'TTM·연결·지배', unit: 'price', tip: '내가 가진 한 주가 1년에 벌어준 돈이에요.' },
      { key: 'bps', label: 'BPS', basis: '연결·지배', unit: 'price', tip: '내가 가진 한 주에 회사 재산이 얼마나 들어있나예요.' },
    ],
  },
  {
    id: 'cashflow', title: '⑤ 현금흐름 (장부 이익이 진짜 현금인가)',
    metrics: [
      { key: 'ocf', label: '영업활동현금흐름(OCF)', basis: 'TTM·연결', unit: 'money', tip: '장부상 이익 말고 본업으로 통장에 진짜 들어온 돈이에요. 이익은 난다는데 현금이 안 들어오면 좀 의심해봐야 해요.' },
      { key: 'fcf', label: '잉여현금흐름(FCF)', basis: 'TTM·연결', unit: 'money', tip: 'FCF = 영업활동현금흐름(OCF) − 자본적지출(CapEx). 벌어서 투자할 거 다 하고 손에 남은 진짜 여윳돈이에요. 이 돈으로 배당도 주고 자사주도 사요.' },
    ],
  },
  {
    id: 'stability', title: '⑥ 안정성 (망할 위험은 없는가)',
    metrics: [
      { key: 'debtRatio', label: '부채비율', basis: '연결', unit: '%', tip: '내 돈 대비 빌린 돈이 얼마나 많나예요. 너무 높으면 빚 갚느라 휘청할 수 있어요.' },
      { key: 'currentRatio', label: '유동비율', basis: '연결', unit: '%', tip: '곧 갚을 빚 대비 곧 쓸 수 있는 돈이 얼마나 되나예요. 100% 넘으면 당장은 괜찮은 편.' },
      { key: 'interestCoverage', label: '이자보상배율', basis: 'TTM·연결', unit: '배', tip: '1년 번 이익으로 이자를 몇 번 갚을 수 있나예요. 1배도 안 되면 이자도 못 내는 위험한 상태.' },
      { key: 'netDebtEbitda', label: '순차입금/EBITDA', basis: 'TTM·연결', unit: '배', tip: '지금 버는 현금으로 빚 다 갚으려면 몇 년 걸리나예요. 낮을수록 안전.' },
    ],
  },
  {
    id: 'shareholder', title: '⑦ 주주환원',
    metrics: [
      { key: 'dps', label: '주당배당금(DPS)', basis: 'TTM', unit: 'price', tip: '내가 가진 한 주당 실제로 받는 배당금(현금)이에요.' },
      { key: 'payoutRatio', label: '배당성향', basis: 'TTM', unit: '%', tip: '회사가 번 돈 중에 몇 %를 주주한테 배당으로 나눠주나예요.' },
      { key: 'buybackFlag', label: '자사주 매입·소각', basis: '최근 12개월', unit: 'flag', tip: '회사가 자기 주식을 사서 없애는 거예요. 유통 주식수가 줄어 내 몫이 커지는 효과 — 보통 호재로 봅니다.' },
    ],
  },
  {
    id: 'market', title: '⑧ 시장·수급·변동성',
    metrics: [
      { key: 'beta', label: '베타', basis: '52주', unit: '배', tip: '시장이 출렁일 때 이 주식이 얼마나 더 출렁이나예요. 1보다 크면 시장보다 더 널뛰는 주식.' },
      { key: 'high52', label: '52주 최고', basis: '52주', unit: 'price', tip: '최근 1년 동안 주가가 찍은 천장이에요.' },
      { key: 'low52', label: '52주 최저', basis: '52주', unit: 'price', tip: '최근 1년 동안 주가가 찍은 바닥이에요.' },
      { key: 'foreignOwnership', label: '외국인 보유 비중', basis: '최근', unit: '%', tip: '외국인 같은 큰손들이 이 주식을 얼마나 들고 있나예요.' },
    ],
  },
];

// 지표별 "좋음/나쁨" 판정 임계치.
// dir: 'low'  -> 값이 낮을수록 좋음 (good: <=, bad: >=)
// dir: 'high' -> 값이 높을수록 좋음 (good: >=, bad: <=)
export const METRIC_THRESHOLDS = {
  // 낮을수록 좋음
  per: { dir: 'low', good: 12, bad: 25 },
  pbr: { dir: 'low', good: 1, bad: 3 },
  psr: { dir: 'low', good: 2, bad: 6 },
  pcr: { dir: 'low', good: 10, bad: 20 },
  peg: { dir: 'low', good: 1, bad: 2 },
  evEbitda: { dir: 'low', good: 8, bad: 15 },
  debtRatio: { dir: 'low', good: 50, bad: 150 },
  netDebtEbitda: { dir: 'low', good: 1, bad: 4 },
  // 높을수록 좋음
  roe: { dir: 'high', good: 15, bad: 5 },
  roa: { dir: 'high', good: 7, bad: 2 },
  roic: { dir: 'high', good: 12, bad: 4 },
  opMargin: { dir: 'high', good: 15, bad: 3 },
  netMargin: { dir: 'high', good: 10, bad: 2 },
  ebitdaMargin: { dir: 'high', good: 20, bad: 5 },
  revenueGrowthYoY: { dir: 'high', good: 15, bad: 0 },
  revenueGrowthQoQ: { dir: 'high', good: 5, bad: -3 },
  opGrowth: { dir: 'high', good: 15, bad: 0 },
  epsGrowth: { dir: 'high', good: 15, bad: 0 },
  interestCoverage: { dir: 'high', good: 8, bad: 1.5 },
  currentRatio: { dir: 'high', good: 150, bad: 100 },
  dividendYield: { dir: 'high', good: 3, bad: 0.5 },
};

export function classifyMetric(key, value) {
  const t = METRIC_THRESHOLDS[key];
  if (!t || value == null || !isFinite(value)) return '';
  if (t.dir === 'low') {
    if (value <= t.good) return 'good';
    if (value >= t.bad) return 'bad';
  } else {
    if (value >= t.good) return 'good';
    if (value <= t.bad) return 'bad';
  }
  return '';
}

export const SECTOR_PRIORITY = {
  '금융': ['pbr', 'roe', 'dividendYield'],
  '은행': ['pbr', 'roe', 'dividendYield'],
  'Financials': ['pbr', 'roe', 'dividendYield'],
  '인터넷': ['revenueGrowthYoY', 'psr', 'opMargin'],
  'Technology': ['revenueGrowthYoY', 'psr', 'opMargin'],
  'Communication': ['revenueGrowthYoY', 'psr', 'opMargin'],
  '반도체': ['evEbitda', 'opMargin', 'revenueGrowthYoY'],
  '자동차': ['evEbitda', 'opMargin', 'debtRatio'],
  '화학': ['evEbitda', 'opMargin', 'debtRatio'],
  'Consumer Staples': ['roe', 'opMargin', 'dividendYield'],
  'Consumer Discretionary': ['revenueGrowthYoY', 'opMargin', 'roic'],
  'ETF': [],
};
