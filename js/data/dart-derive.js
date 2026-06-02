// DART 단일회사 주요계정 응답 → 화면용 재무 객체로 변환.

const ACCOUNT_MAP = {
  // DART 계정명 → 내부 키. 회사별 표기 차이를 흡수.
  '매출액':            'revenue',
  '수익(매출액)':       'revenue',
  '매출':              'revenue',
  '영업이익':           'operatingIncome',
  '영업이익(손실)':     'operatingIncome',
  '당기순이익':         'netIncome',
  '당기순이익(손실)':   'netIncome',
  '자산총계':           'totalAssets',
  '부채총계':           'totalLiabilities',
  '자본총계':           'totalEquity',
  '영업활동 현금흐름':  'ocf',
  '영업활동으로 인한 현금흐름': 'ocf',
};

// 한 보고서의 list 배열에서 연결재무제표(CFS) 우선으로 핵심 계정 추출.
export function extractAccounts(report) {
  if (!report?.list?.length) return null;
  const cfs = report.list.filter(r => r.fs_div === 'CFS');
  const ofs = report.list.filter(r => r.fs_div === 'OFS');
  const list = cfs.length ? cfs : ofs;

  const out = {};
  for (const r of list) {
    const key = ACCOUNT_MAP[r.account_nm];
    if (!key) continue;
    const amount = parseAmount(r.thstrm_amount);
    if (amount != null) out[key] = amount;
  }
  return Object.keys(out).length ? out : null;
}

function parseAmount(s) {
  if (s == null || s === '' || s === '-') return null;
  const n = Number(String(s).replace(/,/g, ''));
  return isFinite(n) ? n : null;
}

// 4개 보고서로부터 화면 카드용 재무 객체 생성.
export function buildKRFinancials({ latestQ, yoyQ, latestY, prevY }) {
  const fin = emptyKR();

  // 절대 지표 (최신 연간 우선, 없으면 최신 분기)
  const ref = latestY || latestQ;
  if (ref) {
    fin.revenue = ref.revenue ?? null;
    fin.operatingIncome = ref.operatingIncome ?? null;
    fin.netIncome = ref.netIncome ?? null;
    fin.ocf = ref.ocf ?? null;

    if (ref.revenue && ref.operatingIncome != null) {
      fin.opMargin = (ref.operatingIncome / ref.revenue) * 100;
    }
    if (ref.revenue && ref.netIncome != null) {
      fin.netMargin = (ref.netIncome / ref.revenue) * 100;
    }
    if (ref.totalEquity && ref.netIncome != null) {
      fin.roe = (ref.netIncome / ref.totalEquity) * 100;
    }
    if (ref.totalAssets && ref.netIncome != null) {
      fin.roa = (ref.netIncome / ref.totalAssets) * 100;
    }
    if (ref.totalEquity && ref.totalLiabilities != null) {
      fin.debtRatio = (ref.totalLiabilities / ref.totalEquity) * 100;
    }
  }

  // YoY 성장 — 분기 단독 값 비교(latestQ vs yoyQ)
  if (latestQ && yoyQ) {
    if (yoyQ.revenue && latestQ.revenue != null) {
      fin.revenueGrowthYoY = ((latestQ.revenue / yoyQ.revenue) - 1) * 100;
    }
    if (yoyQ.operatingIncome != null && latestQ.operatingIncome != null && yoyQ.operatingIncome !== 0) {
      fin.opGrowth = ((latestQ.operatingIncome / yoyQ.operatingIncome) - 1) * 100;
    }
    if (yoyQ.netIncome != null && latestQ.netIncome != null && yoyQ.netIncome !== 0) {
      fin.epsGrowth = ((latestQ.netIncome / yoyQ.netIncome) - 1) * 100;
    }
  }

  return fin;
}

function emptyKR() {
  // 기존 emptyFinancials와 같은 키 구조. 채우지 않은 항목은 null 유지 → null 숨김 정책으로 자동 처리.
  return Object.fromEntries([
    'per','pbr','psr','pcr','peg','evEbitda','dividendYield',
    'roe','roa','roic','opMargin','netMargin','ebitdaMargin',
    'revenueGrowthYoY','revenueGrowthQoQ','opGrowth','epsGrowth',
    'revenue','operatingIncome','netIncome','eps','bps','ocf','fcf',
    'debtRatio','currentRatio','interestCoverage','netDebtEbitda',
    'dps','payoutRatio','buybackFlag','beta','high52','low52','foreignOwnership',
  ].map(k => [k, null]));
}
