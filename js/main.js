import './utils/tooltip.js';
import { renderSearch } from './pages/search.js';
import { renderAnalysis } from './pages/analysis.js';
import { renderCompare } from './pages/compare.js';
import { renderCalendar } from './pages/calendar.js';
import { renderHelp } from './pages/help.js';
import { renderHistory } from './pages/history.js';
import { renderEtf } from './pages/etf.js';
import { getWatchlist } from './data/watchlist.js';
import { getQuoteEOD } from './data/adapter.js';
import { getSymbol, suggestSymbols } from './data/symbols.js';
import { initDrawer } from './components/drawer.js';
import { destroyChartsIn } from './components/charts.js';

const ROUTE_TITLES = {
  analysis: '기업 분석',
  compare: '상대가치 비교',
  calendar: '주요 일정',
  help: '도움말',
  history: '개발 히스토리',
};

// 종목 파라미터를 받는 라우트
const TICKER_ROUTES = new Set(['analysis', 'compare']);

const state = {
  route: 'analysis',
  market: 'all',
  query: '',
  ticker: null, // 현재 라우트의 종목 (해시에서 도출)
  lastTicker: null, // 마지막으로 선택한 종목 — 다른 종목 라우트로 이동 시 이어줌
};

function panel(name) { return document.querySelector(`[data-panel="${name}"]`); }

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  if (!h) return { route: 'analysis', ticker: null };
  const [route, ticker] = h.split('/');
  return { route: ROUTE_TITLES[route] ? route : 'analysis', ticker: ticker || null };
}

function navigate(route, ticker = null) {
  const hash = ticker && TICKER_ROUTES.has(route)
    ? `#/${route}/${ticker}`
    : `#/${route}`;
  if (location.hash === hash) {
    applyRoute(); // 동일 경로면 재렌더
  } else {
    location.hash = hash;
  }
}

function applyRoute() {
  const { route, ticker } = parseHash();
  state.route = route;
  state.ticker = ticker;
  if (ticker) state.lastTicker = ticker;

  document.querySelectorAll('.nav-item').forEach(n => {
    if (n.dataset.route === route) n.setAttribute('aria-current', 'page');
    else n.removeAttribute('aria-current');
  });
  document.querySelectorAll('.route-panel').forEach(p => {
    const showing = p.dataset.panel === route;
    if (!showing && !p.hidden) destroyChartsIn(p);
    p.hidden = !showing;
  });
  document.getElementById('page-title').textContent = ROUTE_TITLES[route] || '';

  // 모바일 드로워 닫기
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('backdrop').classList.remove('open');

  render(route);
}

function currentTickerChip() {
  if (!state.ticker) return '';
  const sym = getSymbol(state.ticker);
  if (!sym) return '';
  return `<div class="current-ticker-chip">
    <span>현재 종목: <strong>${sym.nameKr}</strong> · ${sym.ticker}</span>
    <button class="clear-btn" id="clear-ticker" aria-label="종목 선택 해제" title="선택 해제">✕</button>
  </div>`;
}

function render(route) {
  const el = panel(route);
  if (!el) return;

  // 종목 라우트(분석/비교)
  if (TICKER_ROUTES.has(route)) {
    if (route === 'analysis') {
      if (!state.ticker) {
        // 종목 미선택 → 검색·결과 모드
        renderSearch(el, { query: state.query, market: state.market, onSelect: selectTicker });
        return;
      }
      const sym = getSymbol(state.ticker);
      if (sym && sym.type === 'etf') renderEtf(el, { ticker: state.ticker });
      else renderAnalysis(el, { ticker: state.ticker });
    } else {
      renderCompare(el, { ticker: state.ticker });
    }
    // 칩을 패널 최상단에 삽입
    if (state.ticker) {
      const chip = document.createElement('div');
      chip.innerHTML = currentTickerChip();
      el.insertBefore(chip.firstElementChild, el.firstChild);
      el.querySelector('#clear-ticker')?.addEventListener('click', () => {
        state.lastTicker = null;
        navigate(route, null);
      });
    }
    return;
  }

  switch (route) {
    case 'calendar': return renderCalendar(el);
    case 'help': return renderHelp(el);
    case 'history': return renderHistory(el);
  }
}

function selectTicker(ticker) {
  state.lastTicker = ticker;
  state.query = '';
  searchInput.value = '';
  navigate('analysis', ticker);
}

// ===== Wiring =====
document.querySelectorAll('.nav-item').forEach(n => {
  n.addEventListener('click', () => {
    const route = n.dataset.route;
    // 종목 라우트로 이동할 때는 마지막 선택 종목을 이어준다(없으면 빈 상태)
    const t = TICKER_ROUTES.has(route) ? state.lastTicker : null;
    navigate(route, t);
  });
});

document.getElementById('hamburger').addEventListener('click', () => {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('backdrop').classList.add('open');
});
document.getElementById('backdrop').addEventListener('click', () => {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('backdrop').classList.remove('open');
});

const searchInput = document.getElementById('global-search');
const suggestBox = document.getElementById('search-suggest');
const comboWrap = searchInput.parentElement;
let suggestList = [];
let suggestIdx = -1;
let searchTimer;

function closeSuggest() {
  suggestBox.hidden = true;
  comboWrap.setAttribute('aria-expanded', 'false');
  suggestIdx = -1;
}

function renderSuggest() {
  if (!suggestList.length) { closeSuggest(); return; }
  suggestBox.innerHTML = suggestList.map((s, i) => `
    <div class="suggest-item ${i === suggestIdx ? 'active' : ''}" data-ticker="${s.ticker}" role="option" aria-selected="${i === suggestIdx}">
      <div>
        <strong>${s.nameKr}</strong>
        <span class="meta">${s.nameEn}</span>
        <span class="suggest-badge ${s.type === 'etf' ? 'etf' : ''}">${s.type === 'etf' ? 'ETF' : '주식'}</span>
      </div>
      <div class="meta">${s.ticker} · ${s.market === 'kr' ? '국내' : '미국'}</div>
    </div>
  `).join('');
  suggestBox.hidden = false;
  comboWrap.setAttribute('aria-expanded', 'true');
  suggestBox.querySelectorAll('[data-ticker]').forEach(el => {
    el.addEventListener('mousedown', e => {
      e.preventDefault();
      selectTicker(el.dataset.ticker);
      searchInput.value = '';
      closeSuggest();
    });
  });
}

searchInput.addEventListener('input', e => {
  state.query = e.target.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const q = state.query.trim();
    suggestList = q ? suggestSymbols(q, 8) : [];
    suggestIdx = -1;
    renderSuggest();
    // 검색 모드(analysis without ticker)면 결과 목록 갱신, 그 외에는 자동완성만 표시
    if (state.route === 'analysis' && !state.ticker) {
      render('analysis');
    }
  }, 150);
});

let composing = false;
searchInput.addEventListener('compositionstart', () => { composing = true; });
searchInput.addEventListener('compositionend', () => {
  composing = false;
  // 조합 종료 시 자동완성 갱신
  state.query = searchInput.value;
  clearTimeout(searchTimer);
  const q = state.query.trim();
  suggestList = q ? suggestSymbols(q, 8) : [];
  suggestIdx = -1;
  renderSuggest();
});

searchInput.addEventListener('keydown', e => {
  // 한글 IME 조합 중 Enter는 확정용이므로 무시
  if (composing || e.isComposing || e.keyCode === 229) return;
  if (suggestList.length && !suggestBox.hidden) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      suggestIdx = (suggestIdx + 1) % suggestList.length;
      renderSuggest();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      suggestIdx = (suggestIdx - 1 + suggestList.length) % suggestList.length;
      renderSuggest();
      return;
    }
    if (e.key === 'Escape') { closeSuggest(); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (suggestIdx >= 0) {
        // 자동완성에서 ↑↓로 항목을 명시 선택한 경우만 → 기업 분석으로 이동
        selectTicker(suggestList[suggestIdx].ticker);
        searchInput.value = '';
      } else {
        // 일반 엔터: 검색 결과 목록 페이지로
        if (state.route === 'analysis' && !state.ticker) render('analysis');
        else navigate('analysis', null);
      }
      closeSuggest();
      return;
    }
  } else if (e.key === 'Enter') {
    if (state.route === 'analysis' && !state.ticker) render('analysis');
    else navigate('analysis', null);
  }
});

searchInput.addEventListener('blur', () => setTimeout(closeSuggest, 150));

document.querySelectorAll('input[name="market"]').forEach(r => {
  r.addEventListener('change', () => {
    state.market = r.value;
    if (state.route === 'analysis' && !state.ticker) render('analysis');
  });
});

window.addEventListener('hashchange', applyRoute);

// 우측 드로어 초기화
initDrawer({ onSelect: selectTicker });

// 앱 실행 시 관심 종목 EOD 자동 갱신
function autoRefresh() {
  getWatchlist().forEach(t => getQuoteEOD(t).catch(() => {}));
}

// 초기 진입
applyRoute();
autoRefresh();
