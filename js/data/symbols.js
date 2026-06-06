// 종목 마스터 — KOSPI 종목은 symbols-kr.js 로 분리(12차).
// 영문명·한글명·티커 매핑으로 통합 검색 지원.

import { SYMBOLS_KR } from './symbols-kr.js';
import { SYMBOLS_US_EXTRA } from './symbols-us-extra.js';
import { ETF_US_EXTRA } from './etf-us-extra.js';
import { getAllExtras } from './extras-store.js';
import { lookupKr } from './dart-corpcode-full.js';

const HARDCODED_SYMBOLS = [
  ...SYMBOLS_KR,

  // KR ETF (대표)
  { ticker: '069500', nameKr: 'KODEX 200', nameEn: 'KODEX 200 ETF', market: 'kr', exchange: 'KOSPI', sector: 'ETF', industry: '국내지수', type: 'etf' },
  { ticker: '102110', nameKr: 'TIGER 200', nameEn: 'TIGER 200 ETF', market: 'kr', exchange: 'KOSPI', sector: 'ETF', industry: '국내지수', type: 'etf' },
  { ticker: '360750', nameKr: 'TIGER 미국S&P500', nameEn: 'TIGER S&P500', market: 'kr', exchange: 'KOSPI', sector: 'ETF', industry: '해외지수', type: 'etf' },
  { ticker: '133690', nameKr: 'TIGER 미국나스닥100', nameEn: 'TIGER NASDAQ 100', market: 'kr', exchange: 'KOSPI', sector: 'ETF', industry: '해외지수', type: 'etf' },
  { ticker: '305720', nameKr: 'KODEX 2차전지산업', nameEn: 'KODEX Secondary Battery', market: 'kr', exchange: 'KOSPI', sector: 'ETF', industry: '섹터/테마', type: 'etf' },
  { ticker: '091160', nameKr: 'KODEX 반도체', nameEn: 'KODEX Semicon', market: 'kr', exchange: 'KOSPI', sector: 'ETF', industry: '섹터/테마', type: 'etf' },
  { ticker: '148020', nameKr: 'KBSTAR 200', nameEn: 'KBSTAR 200', market: 'kr', exchange: 'KOSPI', sector: 'ETF', industry: '국내지수', type: 'etf' },
  { ticker: '329200', nameKr: 'TIGER 리츠부동산인프라', nameEn: 'TIGER REITs', market: 'kr', exchange: 'KOSPI', sector: 'ETF', industry: '리츠/인프라', type: 'etf' },
  // 국내 테마 ETF
  { ticker: '364980', nameKr: 'TIGER KRX BBIG K-뉴딜', nameEn: 'TIGER BBIG K-New Deal', market: 'kr', exchange: 'KOSPI', sector: 'ETF', industry: '테마/빅테크', type: 'etf' },
  { ticker: '305540', nameKr: 'TIGER 2차전지테마', nameEn: 'TIGER Secondary Battery', market: 'kr', exchange: 'KOSPI', sector: 'ETF', industry: '테마/2차전지', type: 'etf' },
  { ticker: '139260', nameKr: 'TIGER 200 IT', nameEn: 'TIGER 200 IT', market: 'kr', exchange: 'KOSPI', sector: 'ETF', industry: '테마/IT', type: 'etf' },
  { ticker: '371460', nameKr: 'TIGER 차이나전기차SOLACTIVE', nameEn: 'TIGER China EV', market: 'kr', exchange: 'KOSPI', sector: 'ETF', industry: '테마/전기차', type: 'etf' },
  { ticker: '465680', nameKr: 'KODEX 미국우주항공', nameEn: 'KODEX US Aerospace & Defense', market: 'kr', exchange: 'KOSPI', sector: 'ETF', industry: '테마/우주항공', type: 'etf' },
  { ticker: '395160', nameKr: 'KODEX K-신재생에너지', nameEn: 'KODEX K-Renewable Energy', market: 'kr', exchange: 'KOSPI', sector: 'ETF', industry: '테마/클린에너지', type: 'etf' },
  { ticker: '457990', nameKr: 'TIGER 글로벌AI액티브', nameEn: 'TIGER Global AI', market: 'kr', exchange: 'KOSPI', sector: 'ETF', industry: '테마/AI', type: 'etf' },
  { ticker: '442320', nameKr: 'TIGER 미국빅테크TOP7', nameEn: 'TIGER US Big Tech TOP7', market: 'kr', exchange: 'KOSPI', sector: 'ETF', industry: '테마/빅테크', type: 'etf' },

  // ===== 미국 (S&P500 / 나스닥 일부) =====
  { ticker: 'AAPL', nameKr: '애플', nameEn: 'Apple', market: 'us', exchange: 'NASDAQ', sector: 'Technology', industry: 'Consumer Electronics', type: 'stock' },
  { ticker: 'MSFT', nameKr: '마이크로소프트', nameEn: 'Microsoft', market: 'us', exchange: 'NASDAQ', sector: 'Technology', industry: 'Software', type: 'stock' },
  { ticker: 'NVDA', nameKr: '엔비디아', nameEn: 'NVIDIA', market: 'us', exchange: 'NASDAQ', sector: 'Technology', industry: 'Semiconductors', type: 'stock' },
  { ticker: 'GOOGL', nameKr: '알파벳', nameEn: 'Alphabet', market: 'us', exchange: 'NASDAQ', sector: 'Communication', industry: 'Internet', type: 'stock' },
  { ticker: 'AMZN', nameKr: '아마존', nameEn: 'Amazon', market: 'us', exchange: 'NASDAQ', sector: 'Consumer Discretionary', industry: 'Internet Retail', type: 'stock' },
  { ticker: 'META', nameKr: '메타', nameEn: 'Meta Platforms', market: 'us', exchange: 'NASDAQ', sector: 'Communication', industry: 'Internet', type: 'stock' },
  { ticker: 'TSLA', nameKr: '테슬라', nameEn: 'Tesla', market: 'us', exchange: 'NASDAQ', sector: 'Consumer Discretionary', industry: 'Auto Manufacturers', type: 'stock' },
  { ticker: 'AMD', nameKr: 'AMD', nameEn: 'Advanced Micro Devices', market: 'us', exchange: 'NASDAQ', sector: 'Technology', industry: 'Semiconductors', type: 'stock' },
  { ticker: 'AVGO', nameKr: '브로드컴', nameEn: 'Broadcom', market: 'us', exchange: 'NASDAQ', sector: 'Technology', industry: 'Semiconductors', type: 'stock' },
  { ticker: 'TSM', nameKr: 'TSMC', nameEn: 'Taiwan Semiconductor', market: 'us', exchange: 'NYSE', sector: 'Technology', industry: 'Semiconductors', type: 'stock' },
  { ticker: 'JPM', nameKr: 'JP모건', nameEn: 'JPMorgan Chase', market: 'us', exchange: 'NYSE', sector: 'Financials', industry: 'Banks', type: 'stock' },
  { ticker: 'BAC', nameKr: '뱅크오브아메리카', nameEn: 'Bank of America', market: 'us', exchange: 'NYSE', sector: 'Financials', industry: 'Banks', type: 'stock' },
  { ticker: 'V', nameKr: '비자', nameEn: 'Visa', market: 'us', exchange: 'NYSE', sector: 'Financials', industry: 'Credit Services', type: 'stock' },
  { ticker: 'WMT', nameKr: '월마트', nameEn: 'Walmart', market: 'us', exchange: 'NYSE', sector: 'Consumer Staples', industry: 'Discount Stores', type: 'stock' },
  { ticker: 'KO', nameKr: '코카콜라', nameEn: 'Coca-Cola', market: 'us', exchange: 'NYSE', sector: 'Consumer Staples', industry: 'Beverages', type: 'stock' },

  // US ETF (대표)
  { ticker: 'SPY', nameKr: 'SPDR S&P500', nameEn: 'SPDR S&P 500 ETF', market: 'us', exchange: 'NYSE', sector: 'ETF', industry: 'Large Blend', type: 'etf' },
  { ticker: 'IVV', nameKr: 'iShares S&P500', nameEn: 'iShares Core S&P 500', market: 'us', exchange: 'NYSE', sector: 'ETF', industry: 'Large Blend', type: 'etf' },
  { ticker: 'VOO', nameKr: 'Vanguard S&P500', nameEn: 'Vanguard S&P 500 ETF', market: 'us', exchange: 'NYSE', sector: 'ETF', industry: 'Large Blend', type: 'etf' },
  { ticker: 'QQQ', nameKr: 'Invesco QQQ', nameEn: 'Invesco QQQ Trust', market: 'us', exchange: 'NASDAQ', sector: 'ETF', industry: 'Large Growth', type: 'etf' },
  { ticker: 'VTI', nameKr: 'Vanguard Total Market', nameEn: 'Vanguard Total Stock Market', market: 'us', exchange: 'NYSE', sector: 'ETF', industry: 'Total Market', type: 'etf' },
  { ticker: 'SCHD', nameKr: 'Schwab 배당 ETF', nameEn: 'Schwab US Dividend Equity', market: 'us', exchange: 'NYSE', sector: 'ETF', industry: 'Dividend', type: 'etf' },
  { ticker: 'SOXX', nameKr: 'iShares 반도체', nameEn: 'iShares Semiconductor', market: 'us', exchange: 'NASDAQ', sector: 'ETF', industry: 'Semiconductors', type: 'etf' },
  { ticker: 'TLT', nameKr: 'iShares 20+ 국채', nameEn: 'iShares 20+ Year Treasury', market: 'us', exchange: 'NASDAQ', sector: 'ETF', industry: 'Bonds', type: 'etf' },
  // 미국 테마 ETF
  { ticker: 'SMH', nameKr: 'VanEck 반도체', nameEn: 'VanEck Semiconductor', market: 'us', exchange: 'NASDAQ', sector: 'ETF', industry: '테마/반도체', type: 'etf' },
  { ticker: 'ITA', nameKr: 'iShares 항공우주방산', nameEn: 'iShares US Aerospace & Defense', market: 'us', exchange: 'NYSE', sector: 'ETF', industry: '테마/우주항공', type: 'etf' },
  { ticker: 'ARKK', nameKr: 'ARK 혁신기술', nameEn: 'ARK Innovation', market: 'us', exchange: 'NYSE', sector: 'ETF', industry: '테마/혁신성장', type: 'etf' },
  { ticker: 'LIT', nameKr: 'Global X 리튬·배터리', nameEn: 'Global X Lithium & Battery Tech', market: 'us', exchange: 'NYSE', sector: 'ETF', industry: '테마/2차전지', type: 'etf' },
  { ticker: 'DRIV', nameKr: 'Global X 자율주행·전기차', nameEn: 'Global X Autonomous & EV', market: 'us', exchange: 'NASDAQ', sector: 'ETF', industry: '테마/전기차', type: 'etf' },
  { ticker: 'ICLN', nameKr: 'iShares 클린에너지', nameEn: 'iShares Global Clean Energy', market: 'us', exchange: 'NASDAQ', sector: 'ETF', industry: '테마/클린에너지', type: 'etf' },
  { ticker: 'BOTZ', nameKr: 'Global X 로보틱스·AI', nameEn: 'Global X Robotics & AI', market: 'us', exchange: 'NASDAQ', sector: 'ETF', industry: '테마/로보틱스·AI', type: 'etf' },
  { ticker: 'MAGS', nameKr: 'Roundhill 매그니피센트7', nameEn: 'Roundhill Magnificent Seven', market: 'us', exchange: 'NASDAQ', sector: 'ETF', industry: '테마/빅테크', type: 'etf' },
  { ticker: 'IBIT', nameKr: 'iShares 비트코인', nameEn: 'iShares Bitcoin Trust', market: 'us', exchange: 'NASDAQ', sector: 'ETF', industry: '테마/크립토', type: 'etf' },
];

// 사전 확장(US 600) + LocalStorage 사용자 추가 종목을 자동 병합.
// 중복은 ticker 기준으로 먼저 들어온 항목 유지.
function mergeBy(arrs) {
  const seen = new Set();
  const out = [];
  for (const arr of arrs) {
    for (const s of arr) {
      if (!s || !s.ticker || seen.has(s.ticker)) continue;
      seen.add(s.ticker);
      out.push(s);
    }
  }
  return out;
}

export const SYMBOLS = mergeBy([HARDCODED_SYMBOLS, SYMBOLS_US_EXTRA, ETF_US_EXTRA, getAllExtras()]);

// 검색에서 외부 lookup 으로 추가된 종목을 런타임 SYMBOLS 에 즉시 반영.
// (SYMBOLS 는 모듈 로드 시 1회 구성되므로, 새 종목은 새로고침 전까지 이 함수로 등록해야
//  getSymbol·getPeers 등이 즉시 인식한다.)
export function registerExtraSymbol(sym) {
  if (!sym || !sym.ticker) return false;
  if (SYMBOLS.some(s => s.ticker === sym.ticker)) return false;
  SYMBOLS.push(sym);
  return true;
}

// 한글 자모 단순화 (정확 매치용 보조). 영문은 lowercase.
function norm(s) { return (s || '').toLowerCase().replace(/\s+/g, ''); }

// 부분일치(짧은 prefix) + 한 글자 오타 허용(subsequence) 매칭. 점수 반환.
function fuzzyScore(haystack, needle) {
  const h = norm(haystack), n = norm(needle);
  if (!h || !n) return 0;
  if (h === n) return 1000;
  if (h.startsWith(n)) return 500 - (h.length - n.length);
  const idx = h.indexOf(n);
  if (idx >= 0) return 300 - idx;
  // 짧은 query (5자 미만) 에서는 subsequence/오타 매칭이 우연 매칭을 너무 많이 만든다.
  // 예: "NASA" 4자가 Nasdaq, Bunge Global SA, Hanwha Aerospace 등에 모두 순서대로 등장.
  // 5자 이상 query 에서만 fuzzy 매칭 허용.
  if (n.length < 5) return 0;
  // subsequence 매칭: n의 모든 글자가 h에 순서대로 등장
  let i = 0;
  for (let c of h) { if (i < n.length && c === n[i]) i++; }
  if (i === n.length) return 100 - (h.length - n.length);
  // 1글자 오타 허용 (n의 한 글자를 빼면 부분일치)
  for (let k = 0; k < n.length; k++) {
    const m = n.slice(0, k) + n.slice(k + 1);
    if (h.includes(m)) return 50 - k;
  }
  return 0;
}

export function searchSymbols(query, marketFilter = 'all') {
  if (!query) return [];
  const q = query.trim();
  const scored = [];
  for (const s of SYMBOLS) {
    if (marketFilter !== 'all' && s.market !== marketFilter) continue;
    const score = Math.max(
      fuzzyScore(s.ticker, q),
      fuzzyScore(s.nameKr, q),
      fuzzyScore(s.nameEn, q),
    );
    if (score > 0) scored.push({ s, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 20).map(x => x.s);
}

export function suggestSymbols(query, limit = 8) {
  return searchSymbols(query, 'all').slice(0, limit);
}

export function getSymbol(ticker) {
  return SYMBOLS.find(s => s.ticker === ticker);
}

export function getPeers(ticker) {
  const sym = getSymbol(ticker);
  if (!sym) return [];
  // 1차: 같은 섹터+업종 동일 type
  let peers = SYMBOLS.filter(s => s.ticker !== ticker && s.type === sym.type && s.sector === sym.sector && s.industry === sym.industry);
  if (peers.length >= 3) return peers;
  // 2차: 같은 섹터
  peers = SYMBOLS.filter(s => s.ticker !== ticker && s.type === sym.type && s.sector === sym.sector);
  if (peers.length >= 3) return peers;
  // 3차 폴백: 같은 시장 + 같은 type
  return SYMBOLS.filter(s => s.ticker !== ticker && s.type === sym.type && s.market === sym.market).slice(0, 6);
}

/**
 * 검색 결과가 비었을 때 외부 lookup 시도.
 * 한국: dart-corpcode-full 에서 즉시 매칭.
 * 미국: ticker 가 6자리 미만 영문이면 Finnhub /stock/profile2 호출(비동기).
 *
 * @returns Promise<{ sym, source } | null>
 *   sym: SYMBOLS 와 동일한 형식의 객체.
 *   source: 'kr-corpcode' | 'us-finnhub'.
 */
export async function lookupExternal(query) {
  if (!query) return null;
  const q = String(query).trim();

  // 1차: KR lookup (한글/숫자 6자리/영문 회사명 모두 시도)
  const kr = lookupKr(q);
  if (kr) {
    return {
      sym: {
        ticker: kr.ticker,
        nameKr: kr.nameKr,
        nameEn: kr.nameEn || kr.nameKr,
        market: 'kr',
        exchange: 'KOSPI',         // corp_code 만으로는 시장 구분 어려움 → 추후 보완
        sector: '미분류',
        industry: '미분류',
        type: 'stock',
      },
      source: 'kr-corpcode',
    };
  }

  // 2차: US lookup (영문 ticker 패턴 — 1~5자 알파벳 + 선택적 점/하이픈)
  if (/^[A-Za-z][A-Za-z.\-]{0,4}$/.test(q)) {
    try {
      const { fhProfile } = await import('./adapters/finnhub.js');
      const p = await fhProfile(q.toUpperCase());
      if (p && p.name) {
        // ETF 자동 추정: 이름에 ETF/Fund/Trust 단어가 있거나, 시총·주식수가 둘 다 비어있음(전통 주식은 둘 다 채워짐).
        const looksLikeEtf =
          /etf|fund|trust/i.test(p.name || '') ||
          ((p.marketCapitalization == null || p.marketCapitalization === 0) &&
           (p.shareOutstanding == null || p.shareOutstanding === 0));

        return {
          sym: {
            ticker: q.toUpperCase(),
            nameKr: p.name,
            nameEn: p.name,
            market: 'us',
            exchange: p.exchange || 'NASDAQ',
            sector: looksLikeEtf ? 'ETF' : (p.finnhubIndustry || 'Unknown'),
            industry: p.finnhubIndustry || 'Unknown',
            type: looksLikeEtf ? 'etf' : 'stock',
            weburl: p.weburl || null,
            logo: p.logo || null,
          },
          source: 'us-finnhub',
        };
      }
    } catch (e) {
      console.warn('[lookupExternal] us fetch failed', e?.message);
    }
  }

  return null;
}
