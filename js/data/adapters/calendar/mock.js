// MOCK 캘린더 — Finnhub 키 미설정/실패 시 fallback.
// (이전 adapter.js getCalendar의 mock 로직을 그대로 이전)
import { getSymbol } from '../../symbols.js';

function rnd(seed, min, max) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return min + (x - Math.floor(x)) * (max - min);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function buildMockEvents(ticker = null) {
  const today = new Date();
  const events = [];
  const types = [
    { type: 'earnings', label: '실적 발표', what: '회사가 한 분기 동안 얼마를 벌었는지 공식 발표하는 날.', impact: '실제 실적이 시장 기대치(컨센서스)보다 높으면 어닝 서프라이즈로 ↑, 낮으면 어닝 쇼크로 ↓ 압력이 발생합니다.', category: 'company', icon: '📊' },
    { type: 'dividend', label: '배당락일', what: '이날 매수해도 배당 권리가 없는 첫 날.', impact: '이론적으로 배당금만큼 주가가 자연 조정 ↓.', category: 'company', icon: '💰' },
    { type: 'buyback', label: '자사주 매입', what: '회사가 자기 주식을 시장에서 사들이는 발표.', impact: '유통 주식수가 줄어 주당 가치가 올라간다는 기대로 보통 ↑.', category: 'company', icon: '🔁' },
    { type: 'lockup', label: '락업 해제', what: '상장 직후 일정 기간 매도가 금지됐던 대주주·임직원 물량의 매도 가능일.', impact: '대량 매도 가능 물량이 풀려 단기 수급 부담 → 하락 압력 ↓.', category: 'company', icon: '🔓' },
    { type: 'fomc', label: 'FOMC', what: '미국 연방준비제도(Fed)가 기준금리를 결정하는 회의.', impact: '금리 인상은 미래 이익 가치를 낮춰 성장주에 부담 ↓, 인하는 ↑. 발언(점도표)도 영향.', category: 'common', icon: '🏛️' },
    { type: 'cpi', label: 'CPI 발표', what: '소비자물가지수 — 물가 상승률 발표.', impact: '예상보다 높으면 금리 인상 우려로 위험자산 ↓, 둔화하면 ↑.', category: 'common', icon: '📈' },
    { type: 'kmpc', label: '금통위', what: '한국은행 금융통화위원회 — 한국 기준금리 결정.', impact: 'FOMC와 유사: 인상 시 성장주 ↓, 인하 시 ↑.', category: 'common', icon: '🏛️' },
    { type: 'jobs', label: '고용지표 발표', what: '미국 비농업 고용·실업률 등 노동시장 지표.', impact: '강한 고용은 경기 호조 신호지만 금리 인상 우려도 자극 — 양면적.', category: 'common', icon: '👷' },
  ];
  const companyTickers = ['AAPL', 'NVDA', 'MSFT', '005930', '000660', 'TSLA', 'GOOGL'];
  for (let i = 0; i < 24; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + Math.floor(rnd(i + 1, -10, 45)));
    const t = types[i % types.length];
    const isCompany = t.category === 'company';
    const evTicker = isCompany ? (i % 4 === 0 && ticker ? ticker : companyTickers[i % companyTickers.length]) : null;
    const sym = evTicker ? getSymbol(evTicker) : null;
    events.push({
      date: d.toISOString().slice(0, 10),
      type: t.type, label: t.label, what: t.what, impact: t.impact,
      category: t.category, icon: t.icon,
      ticker: evTicker,
      tickerName: sym?.nameKr || null,
      market: sym ? sym.market : (i % 2 === 0 ? 'kr' : 'us'),
      title: sym ? `${sym.nameKr} ${t.label}` : t.label,
      source: isCompany ? 'IR 공시 (MOCK)' : '경제지표 캘린더 (MOCK)',
    });
  }
  return events.sort((a, b) => a.date.localeCompare(b.date));
}

export function buildMockResult(ticker = null) {
  return {
    data: buildMockEvents(ticker),
    source: 'IR/매크로 캘린더 (MOCK)',
    asOf: todayISO(),
    hasFallback: true,
    note: '무료 실데이터 미수신 — 임시 MOCK 데이터로 표시 중',
  };
}
