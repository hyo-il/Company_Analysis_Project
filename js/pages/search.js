import { searchSymbols, getSymbol } from '../data/symbols.js';
import { getQuoteEOD } from '../data/adapter.js';
import { toggleWatch, isWatched } from '../data/watchlist.js';
import { showToast } from '../components/toast.js';
import { fmtNum, fmtChange } from '../utils/format.js';
import { emptyState } from '../components/common.js';

let currentMarket = 'all';

export function renderSearch(container, { query = '', market = 'all', onSelect } = {}) {
  currentMarket = market;
  if (!query) {
    container.innerHTML = `
      <div class="panel">
        <div class="empty-onboarding">
          <h3>기업 또는 ETF를 검색해 보세요</h3>
          <p>한글명·영문명·티커 모두 인식합니다. (예: 엔비디아 / NVIDIA / NVDA)</p>
        </div>
      </div>`;
    return;
  }

  const results = searchSymbols(query, market);
  if (results.length === 0) {
    container.innerHTML = `<div class="panel">${emptyState(`"${query}"에 대한 결과가 없습니다.`)}</div>`;
    return;
  }

  container.innerHTML = `
    <div class="panel">
      <div class="panel-title">검색 결과 (${results.length})</div>
      <table>
        <thead>
          <tr>
            <th style="width:32px"></th>
            <th>종목명</th>
            <th>티커</th>
            <th>시장</th>
            <th>섹터</th>
            <th class="num">현재가</th>
            <th class="num">등락</th>
          </tr>
        </thead>
        <tbody>
          ${results.map(s => `
            <tr data-ticker="${s.ticker}" style="cursor:pointer">
              <td><button class="star-btn ${isWatched(s.ticker) ? 'active' : ''}" data-watch="${s.ticker}" aria-label="관심 종목">${isWatched(s.ticker) ? '★' : '☆'}</button></td>
              <td><strong>${s.nameKr}</strong> <span style="color:var(--text-muted)">${s.nameEn}</span> ${s.type === 'etf' ? '<span class="suggest-badge etf">ETF</span>' : '<span class="suggest-badge">주식</span>'}</td>
              <td>${s.ticker}</td>
              <td>${s.market === 'kr' ? '국내' : '미국'} · ${s.exchange}</td>
              <td>${s.sector}${s.type === 'etf' ? ' · ' + s.industry : ''}</td>
              <td class="num" data-price="${s.ticker}">…</td>
              <td class="num" data-chg="${s.ticker}">…</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;

  // 시세 비동기 로드
  results.forEach(async s => {
    try {
      const q = await getQuoteEOD(s.ticker);
      const pCell = container.querySelector(`[data-price="${s.ticker}"]`);
      const cCell = container.querySelector(`[data-chg="${s.ticker}"]`);
      if (pCell) pCell.textContent = fmtNum(q.data.price, 2);
      if (cCell) cCell.innerHTML = fmtChange(q.data.changePct);
    } catch {}
  });

  // 이벤트
  container.querySelectorAll('tr[data-ticker]').forEach(tr => {
    tr.addEventListener('click', e => {
      if (e.target.closest('.star-btn')) return;
      onSelect && onSelect(tr.dataset.ticker);
    });
  });
  container.querySelectorAll('.star-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const t = btn.dataset.watch;
      const on = toggleWatch(t);
      btn.classList.toggle('active', on);
      btn.textContent = on ? '★' : '☆';
      const s = getSymbol(t);
      const label = s ? `${s.nameKr} (${s.ticker})` : t;
      showToast(on ? `${label}을(를) 관심 목록에 등록했습니다.` : `${label}을(를) 관심 목록에서 해제했습니다.`,
        { type: on ? 'success' : 'info' });
    });
  });
}
