import { getWatchlist, removeFromWatch } from '../data/watchlist.js';
import { getRecents, removeRecent, clearRecents } from '../data/recents.js';
import { getSymbol } from '../data/symbols.js';
import { getQuoteEOD } from '../data/adapter.js';
import { fmtNum, fmtChange } from '../utils/format.js';
import { showToast } from './toast.js';

let onSelectCb = null;
let activeTab = 'watch';

export function initDrawer({ onSelect }) {
  onSelectCb = onSelect;
  document.getElementById('tab-watch').addEventListener('click', () => switchTab('watch'));
  document.getElementById('tab-recent').addEventListener('click', () => switchTab('recent'));
  document.getElementById('drawer-handle').addEventListener('click', openDrawer);
  document.getElementById('drawer-close').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });
  window.addEventListener('watchlist-changed', () => { if (activeTab === 'watch') renderWatch(); });
  renderActive();
}

function openDrawer() {
  document.getElementById('right-drawer').classList.add('open');
  renderActive();
}
function closeDrawer() {
  document.getElementById('right-drawer').classList.remove('open');
}

function switchTab(name) {
  activeTab = name;
  ['watch', 'recent'].forEach(n => {
    const tab = document.getElementById(`tab-${n}`);
    const panel = document.getElementById(`drawer-${n}`);
    tab.classList.toggle('active', n === name);
    tab.setAttribute('aria-selected', n === name);
    panel.hidden = n !== name;
  });
  renderActive();
}

function renderActive() {
  if (activeTab === 'watch') renderWatch();
  else renderRecent();
}

function renderWatch() {
  const el = document.getElementById('drawer-watch');
  const list = getWatchlist();
  if (!list.length) {
    el.innerHTML = `<div style="padding:16px;color:var(--text-muted);font-size:13px;">
      관심 종목이 없습니다. 어디서나 ★를 눌러 추가하세요.
      <div style="margin-top:6px;font-size:11px;">(이 목록은 본인 브라우저에만 저장됩니다.)</div>
    </div>`;
    return;
  }
  el.innerHTML = `<ul class="drawer-list">${list.map(itemWatch).join('')}</ul>`;
  wireWatch(el);
  loadQuotes(el, list);
}

function renderRecent() {
  const el = document.getElementById('drawer-recent');
  const list = getRecents();
  if (!list.length) {
    el.innerHTML = `<div style="padding:16px;color:var(--text-muted);font-size:13px;">
      최근 조회한 종목이 없습니다.
      <div style="margin-top:6px;font-size:11px;">기업 분석 페이지를 열면 자동 기록됩니다(최대 20개).</div>
    </div>`;
    return;
  }
  el.innerHTML = `
    <div style="display:flex;justify-content:flex-end;padding:6px 12px 0;">
      <button id="recent-clear" style="background:none;border:none;color:var(--text-muted);font-size:11px;cursor:pointer;">모두 지우기</button>
    </div>
    <ul class="drawer-list">${list.map(itemRecent).join('')}</ul>
  `;
  document.getElementById('recent-clear').addEventListener('click', () => {
    clearRecents();
    renderRecent();
    showToast('최근 조회 목록을 비웠습니다.', { type: 'info' });
  });
  wireRecent(el);
  loadQuotes(el, list.map(r => r.ticker));
}

function itemWatch(t) {
  const sym = getSymbol(t);
  if (!sym) return '';
  return `<li class="drawer-item" data-ticker="${t}">
    <div class="drawer-item-main">
      <strong>${sym.nameKr}</strong>
      <span style="color:var(--text-muted);font-size:12px;">${sym.ticker} · ${sym.market === 'kr' ? '국내' : '미국'}</span>
    </div>
    <div class="drawer-item-quote" data-quote="${t}">…</div>
    <button class="drawer-item-remove" data-remove="${t}" aria-label="관심 해제">×</button>
  </li>`;
}

function itemRecent(r) {
  const sym = getSymbol(r.ticker);
  if (!sym) return '';
  return `<li class="drawer-item" data-ticker="${r.ticker}">
    <div class="drawer-item-main">
      <strong>${sym.nameKr}</strong>
      <span style="color:var(--text-muted);font-size:12px;">${sym.ticker} · ${rel(r.viewedAt)}</span>
    </div>
    <div class="drawer-item-quote" data-quote="${r.ticker}">…</div>
    <button class="drawer-item-remove" data-remove-recent="${r.ticker}" aria-label="제거">×</button>
  </li>`;
}

function rel(iso) {
  if (!iso) return '';
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}일 전`;
  return new Date(iso).toLocaleDateString('ko-KR');
}

function wireWatch(el) {
  el.querySelectorAll('.drawer-item').forEach(li => {
    li.addEventListener('click', e => {
      if (e.target.closest('[data-remove]')) return;
      onSelectCb && onSelectCb(li.dataset.ticker);
    });
  });
  el.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      removeFromWatch(btn.dataset.remove);
      renderWatch();
      showToast('관심 목록에서 해제되었습니다.', { type: 'info' });
    });
  });
}

function wireRecent(el) {
  el.querySelectorAll('.drawer-item').forEach(li => {
    li.addEventListener('click', e => {
      if (e.target.closest('[data-remove-recent]')) return;
      onSelectCb && onSelectCb(li.dataset.ticker);
    });
  });
  el.querySelectorAll('[data-remove-recent]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      removeRecent(btn.dataset.removeRecent);
      renderRecent();
    });
  });
}

async function loadQuotes(el, tickers) {
  tickers.forEach(async t => {
    try {
      const q = await getQuoteEOD(t);
      const cell = el.querySelector(`[data-quote="${t}"]`);
      if (!cell) return;
      const p = q?.data?.price;
      const c = q?.data?.changePct;
      cell.innerHTML = p == null
        ? `<span style="color:var(--text-muted);font-size:11px;">—</span>`
        : `<div style="text-align:right;">
             <div style="font-size:12px;">${fmtNum(p)}</div>
             <div style="font-size:11px;">${fmtChange(c)}</div>
           </div>`;
    } catch {}
  });
}
