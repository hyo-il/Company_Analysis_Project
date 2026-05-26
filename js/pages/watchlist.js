import { getWatchlist, toggleWatch } from '../data/watchlist.js';
import { getSymbol } from '../data/symbols.js';
import { getQuoteEOD, getFinancials } from '../data/adapter.js';
import { computeFactorScores } from '../utils/scoring.js';
import { fmtNum, fmtChange, fmtPct, fmtMoney } from '../utils/format.js';
import { emptyState } from '../components/common.js';
import { showToast } from '../components/toast.js';

export async function renderWatchlist(container, { onSelect } = {}) {
  const tickers = getWatchlist();
  if (!tickers.length) {
    container.innerHTML = `<div class="panel">
      <div class="empty-onboarding">
        <h3>관심 종목이 비어 있어요</h3>
        <p>검색 결과나 기업 분석 화면에서 ★를 눌러 관심 종목을 추가해 보세요.</p>
        <p style="margin-top:8px; font-size:12px;">관심 종목은 매일 자동 갱신 대상이 되며, 한 화면에서 핵심 지표를 비교할 수 있어요.</p>
      </div>
    </div>`;
    return;
  }

  container.innerHTML = `
    <div class="panel">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <div class="panel-title" style="margin:0;">관심 종목 (${tickers.length})</div>
        <button class="btn-secondary" id="refresh-watch">수동 새로고침</button>
      </div>
      <table>
        <thead><tr>
          <th></th><th>종목</th><th>시장</th>
          <th class="num">현재가</th><th class="num">등락</th>
          <th class="num">PER</th><th class="num">ROE</th>
          <th class="num">시총</th><th class="num">종합점수</th>
        </tr></thead>
        <tbody id="watch-tbody">
          ${tickers.map(t => `<tr data-ticker="${t}" style="cursor:pointer"><td colspan="9">불러오는 중…</td></tr>`).join('')}
        </tbody>
      </table>
      <p style="font-size:12px; color:var(--text-muted); margin-top:8px;">앱 실행 시 자동으로 캐시 기준일을 확인해 오래된 항목만 갱신합니다.</p>
    </div>`;

  const tbody = container.querySelector('#watch-tbody');
  const rows = await Promise.all(tickers.map(async t => {
    const sym = getSymbol(t);
    if (!sym) return null;
    const [q, f] = await Promise.all([getQuoteEOD(t), getFinancials(t)]);
    const scores = computeFactorScores(f.data);
    return { sym, q: q.data, f: f.data, score: scores['종합'], currency: q.currency };
  }));

  tbody.innerHTML = rows.filter(Boolean).map(r => `
    <tr data-ticker="${r.sym.ticker}" style="cursor:pointer">
      <td><button class="star-btn active" data-watch="${r.sym.ticker}">★</button></td>
      <td><strong>${r.sym.nameKr}</strong> <span style="color:var(--text-muted)">${r.sym.ticker}</span></td>
      <td>${r.sym.market === 'kr' ? '국내' : '미국'}</td>
      <td class="num">${fmtNum(r.q.price)}</td>
      <td class="num">${fmtChange(r.q.changePct)}</td>
      <td class="num">${fmtNum(r.f.per, 1)}</td>
      <td class="num">${fmtPct(r.f.roe, 1)}</td>
      <td class="num">${fmtMoney(r.f.revenue * 5, r.currency)}</td>
      <td class="num"><strong style="color:var(--primary)">${r.score}</strong></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('tr[data-ticker]').forEach(tr => {
    tr.addEventListener('click', e => {
      if (e.target.closest('.star-btn')) return;
      onSelect && onSelect(tr.dataset.ticker);
    });
  });
  tbody.querySelectorAll('.star-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = btn.dataset.watch;
      const on = toggleWatch(t);
      const s = getSymbol(t);
      const label = s ? `${s.nameKr} (${s.ticker})` : t;
      showToast(on ? `${label}을(를) 관심 목록에 등록했습니다.` : `${label}을(를) 관심 목록에서 해제했습니다.`,
        { type: on ? 'success' : 'info' });
      renderWatchlist(container, { onSelect });
    });
  });

  container.querySelector('#refresh-watch')?.addEventListener('click', () => {
    tickers.forEach(t => localStorage.removeItem('ca:quote:' + t));
    renderWatchlist(container, { onSelect });
  });
}
