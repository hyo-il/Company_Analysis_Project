import { getWatchlist } from '../data/watchlist.js';
import { getSymbol } from '../data/symbols.js';
import { getQuoteEOD, getFinancials } from '../data/adapter.js';
import { fmtNum, fmtChange, fmtPct } from '../utils/format.js';
import { cacheGet, cacheSet } from '../utils/cache.js';

const STATE_KEY = 'drawer-open';

export function initDrawer({ onSelect }) {
  const drawer = document.getElementById('right-drawer');
  const handle = document.getElementById('drawer-handle');
  const closeBtn = document.getElementById('drawer-close');
  const body = document.getElementById('drawer-body');

  function setOpen(open) {
    drawer.classList.toggle('open', open);
    handle.style.display = open ? 'none' : 'block';
    cacheSet(STATE_KEY, open);
    if (open) renderBody();
  }

  async function renderBody() {
    const tickers = getWatchlist();
    if (!tickers.length) {
      body.innerHTML = `<div style="padding:20px; text-align:center; color:var(--text-muted); font-size:13px;">
        관심 종목이 없습니다.<br/>검색 결과나 상세 화면에서 ★를 눌러 추가하세요.
      </div>`;
      return;
    }
    body.innerHTML = tickers.map(t => `<div class="drawer-item" data-ticker="${t}">로딩…</div>`).join('');
    for (const t of tickers) {
      const sym = getSymbol(t);
      if (!sym) continue;
      try {
        const [q, f] = await Promise.all([getQuoteEOD(t), getFinancials(t)]);
        const el = body.querySelector(`[data-ticker="${t}"]`);
        if (!el) continue;
        el.innerHTML = `
          <div class="drawer-item-name">${sym.nameKr} <span style="color:var(--text-muted); font-weight:400; font-size:11px;">${t}</span></div>
          <div class="drawer-item-meta">
            <span>${fmtNum(q.data.price)} ${fmtChange(q.data.changePct)}</span>
            <span style="color:var(--text-muted);">PER ${fmtNum(f.data.per, 1)} · ROE ${fmtPct(f.data.roe, 1)}</span>
          </div>`;
      } catch {}
    }
    body.querySelectorAll('.drawer-item').forEach(el => {
      el.addEventListener('click', () => {
        onSelect && onSelect(el.dataset.ticker);
      });
    });
  }

  handle.addEventListener('click', () => setOpen(true));
  closeBtn.addEventListener('click', () => setOpen(false));
  window.addEventListener('watchlist-changed', () => {
    if (drawer.classList.contains('open')) renderBody();
  });

  // 초기 상태 복원
  setOpen(cacheGet(STATE_KEY) === true);

  return { refresh: renderBody, setOpen };
}
