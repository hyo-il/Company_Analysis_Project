// ETF 구성 종목(holdings) 데이터·역방향 인덱스 어댑터.
// 무료 데이터로 확보 가능한 대표 ETF만 mock 형태로 보유. 실연동 시 KRX/iShares/Vanguard 등에서 교체.
import { cacheGet, cacheSet } from '../utils/cache.js';
import { getSymbol } from './symbols.js';

function asOfRecent() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

// [name, ticker, weight%] — 비중 내림차순으로 작성
export const HOLDINGS_MAP = {
  '069500': [
    ['삼성전자', '005930', 28.5], ['SK하이닉스', '000660', 7.2], ['LG에너지솔루션', '373220', 3.8],
    ['삼성바이오로직스', '207940', 2.6], ['현대차', '005380', 2.4], ['셀트리온', '068270', 2.1],
    ['POSCO홀딩스', '005490', 1.9], ['KB금융', '105560', 1.7], ['NAVER', '035420', 1.6], ['카카오', '035720', 1.4],
  ],
  '102110': [
    ['삼성전자', '005930', 28.4], ['SK하이닉스', '000660', 7.1], ['LG에너지솔루션', '373220', 3.7],
    ['삼성바이오로직스', '207940', 2.6], ['현대차', '005380', 2.3], ['셀트리온', '068270', 2.0],
    ['POSCO홀딩스', '005490', 1.9], ['KB금융', '105560', 1.7], ['NAVER', '035420', 1.6], ['기아', '000270', 1.4],
  ],
  'SPY': [
    ['Apple', 'AAPL', 7.2], ['Microsoft', 'MSFT', 6.8], ['NVIDIA', 'NVDA', 5.1], ['Amazon', 'AMZN', 3.5],
    ['Meta', 'META', 2.4], ['Alphabet A', 'GOOGL', 2.1], ['Alphabet C', 'GOOG', 1.8], ['Berkshire B', 'BRK.B', 1.7],
    ['Tesla', 'TSLA', 1.5], ['Eli Lilly', 'LLY', 1.4],
  ],
  'IVV': [
    ['Apple', 'AAPL', 7.2], ['Microsoft', 'MSFT', 6.8], ['NVIDIA', 'NVDA', 5.1], ['Amazon', 'AMZN', 3.5],
    ['Meta', 'META', 2.4], ['Alphabet A', 'GOOGL', 2.1], ['Alphabet C', 'GOOG', 1.8], ['Berkshire B', 'BRK.B', 1.7],
    ['Tesla', 'TSLA', 1.5], ['Eli Lilly', 'LLY', 1.4],
  ],
  'VOO': [
    ['Apple', 'AAPL', 7.1], ['Microsoft', 'MSFT', 6.7], ['NVIDIA', 'NVDA', 5.0], ['Amazon', 'AMZN', 3.5],
    ['Meta', 'META', 2.4], ['Alphabet A', 'GOOGL', 2.1], ['Berkshire B', 'BRK.B', 1.7],
    ['Tesla', 'TSLA', 1.5], ['Eli Lilly', 'LLY', 1.4], ['JPMorgan', 'JPM', 1.3],
  ],
  'QQQ': [
    ['Apple', 'AAPL', 8.9], ['Microsoft', 'MSFT', 8.4], ['NVIDIA', 'NVDA', 6.2], ['Amazon', 'AMZN', 4.7],
    ['Meta', 'META', 4.5], ['Broadcom', 'AVGO', 4.2], ['Tesla', 'TSLA', 3.1], ['Costco', 'COST', 2.6],
    ['Alphabet A', 'GOOGL', 2.5], ['Alphabet C', 'GOOG', 2.4],
  ],
  'SOXX': [
    ['NVIDIA', 'NVDA', 9.5], ['Broadcom', 'AVGO', 8.9], ['AMD', 'AMD', 7.8], ['Qualcomm', 'QCOM', 6.4],
    ['Intel', 'INTC', 5.1], ['Texas Instruments', 'TXN', 4.6], ['Lam Research', 'LRCX', 4.3],
    ['Applied Materials', 'AMAT', 4.2], ['Micron', 'MU', 3.9], ['KLA', 'KLAC', 3.7],
  ],
  'SMH': [
    ['NVIDIA', 'NVDA', 19.8], ['TSMC', 'TSM', 11.4], ['Broadcom', 'AVGO', 7.2], ['AMD', 'AMD', 5.1],
    ['ASML', 'ASML', 4.9], ['Qualcomm', 'QCOM', 4.6], ['Texas Instruments', 'TXN', 4.4],
    ['Applied Materials', 'AMAT', 4.2], ['Lam Research', 'LRCX', 3.9], ['Micron', 'MU', 3.6],
  ],
  'VTI': [
    ['Apple', 'AAPL', 6.4], ['Microsoft', 'MSFT', 6.0], ['NVIDIA', 'NVDA', 4.5], ['Amazon', 'AMZN', 3.1],
    ['Meta', 'META', 2.1], ['Alphabet A', 'GOOGL', 1.9], ['Berkshire B', 'BRK.B', 1.5],
    ['Tesla', 'TSLA', 1.3], ['Eli Lilly', 'LLY', 1.3], ['JPMorgan', 'JPM', 1.2],
  ],
};

export const ISSUER_LINKS = {
  SPY: 'https://www.ssga.com/us/en/intermediary/etfs/spy',
  IVV: 'https://www.ishares.com/us/products/239726/',
  VOO: 'https://investor.vanguard.com/etf/profile/VOO',
  QQQ: 'https://www.invesco.com/qqq-etf/en/about.html',
  VTI: 'https://investor.vanguard.com/etf/profile/VTI',
  SCHD: 'https://www.schwabassetmanagement.com/products/schd',
  SOXX: 'https://www.ishares.com/us/products/239705/',
  SMH: 'https://www.vaneck.com/us/en/investments/semiconductor-etf-smh/',
  TLT: 'https://www.ishares.com/us/products/239454/',
  ARKK: 'https://www.ark-funds.com/funds/arkk/',
};

export async function getHoldings(ticker) {
  const cacheKey = `holdings:${ticker}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  const raw = HOLDINGS_MAP[ticker] || [];
  const data = raw
    .map(([name, tk, weight]) => ({ name, ticker: tk, weight }))
    .sort((a, b) => b.weight - a.weight);
  const result = {
    data,
    source: 'Issuer Page (mock)',
    asOf: asOfRecent(),
    note: '무료 데이터 한계로 일부 ETF만 제공됩니다.',
  };
  cacheSet(cacheKey, result);
  return result;
}

// 역방향 인덱스: 이 종목을 보유한 ETF 목록.
export async function getEtfsContaining(ticker, { minWeight = 0.5 } = {}) {
  const cacheKey = `etf-reverse:${ticker}:${minWeight}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  const rows = [];
  for (const [etfTicker, holdings] of Object.entries(HOLDINGS_MAP)) {
    for (const [, holdingTicker, weight] of holdings) {
      if (holdingTicker === ticker && weight >= minWeight) {
        const sym = getSymbol(etfTicker);
        rows.push({
          etfTicker,
          etfNameKr: sym?.nameKr || etfTicker,
          etfNameEn: sym?.nameEn || '',
          market: sym?.market || '',
          weight,
          source: 'Issuer Page (mock)',
        });
        break;
      }
    }
  }
  rows.sort((a, b) => b.weight - a.weight);
  const result = {
    data: rows.slice(0, 20),
    source: 'Holdings reverse index (mock)',
    asOf: asOfRecent(),
    note: '무료 데이터로 일부 대표 ETF에 한정됩니다.',
  };
  cacheSet(cacheKey, result);
  return result;
}
