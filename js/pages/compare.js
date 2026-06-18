import { getSymbol, getPeers, suggestSymbols, searchSymbols, lookupExternal, searchExternalMulti, registerExtraSymbol } from '../data/symbols.js';
import { addExtra } from '../data/extras-store.js';
import { getFinancials } from '../data/adapter.js';
import { fmtNum, fmtPct } from '../utils/format.js';
import { emptyState, loadingState, infoTip } from '../components/common.js';
import { peerMedian as median, peerPercentile as percentile } from '../utils/peer-percentile.js';

const COMPARE_METRICS = [
  { key: 'per', label: 'PER', unit: 'x', lowerBetter: true },
  { key: 'pbr', label: 'PBR', unit: 'x', lowerBetter: true },
  { key: 'psr', label: 'PSR', unit: 'x', lowerBetter: true },
  { key: 'evEbitda', label: 'EV/EBITDA', unit: 'x', lowerBetter: true },
  { key: 'roe', label: 'ROE', unit: '%', lowerBetter: false },
  { key: 'opMargin', label: '영업이익률', unit: '%', lowerBetter: false },
  { key: 'revenueGrowthYoY', label: '매출성장률(YoY)', unit: '%', lowerBetter: false },
];

// 현재 종목별 사용자 조정 피어 목록 (메모리)
const peerState = {}; // { [ticker]: { excluded: Set, added: Set } }

const MAX_AUTO_PEERS = 7;   // 자동 피어 최대 (사용자 1개 추가 공간 + 8 까지 자연 표시)

function getEffectivePeers(ticker) {
  const st = peerState[ticker] || { excluded: new Set(), added: new Set() };
  // 자동 피어 풀을 먼저 MAX_AUTO_PEERS 로 제한 → 사용자 X 클릭 시 슬롯이 줄어듦
  const autoBase = getPeers(ticker).slice(0, MAX_AUTO_PEERS);
  const auto = autoBase.filter(s => !st.excluded.has(s.ticker));
  const added = [...st.added].map(t => getSymbol(t)).filter(Boolean).filter(s => !st.excluded.has(s.ticker));
  const seen = new Set();
  return [...auto, ...added].filter(s => (seen.has(s.ticker) ? false : (seen.add(s.ticker), true)));
}

function fmtCell(v, unit) {
  if (v == null) return '—';
  return unit === '%' ? fmtPct(v) : fmtNum(v, 2) + 'x';
}

export async function renderCompare(container, { ticker } = {}) {
  if (!ticker) {
    container.innerHTML = `<div class="panel">${emptyState('비교할 종목을 먼저 검색해 선택해 주세요.')}</div>`;
    return;
  }
  if (!peerState[ticker]) peerState[ticker] = { excluded: new Set(), added: new Set() };
  container.innerHTML = loadingState('피어 데이터를 불러오는 중…');

  const sym = getSymbol(ticker);
  if (!sym) { container.innerHTML = emptyState('종목 정보를 찾지 못했습니다.'); return; }

  const peers = getEffectivePeers(ticker);
  const all = [sym, ...peers];
  const results = await Promise.all(all.map(s =>
    getFinancials(s.ticker).then(r => ({ sym: s, fin: r.data })).catch(() => ({ sym: s, fin: {} }))
  ));

  const me = results[0].fin;
  const peerOnly = results.slice(1).map(r => r.fin);
  const peerPer = median(peerOnly.map(p => p.per));
  const peerRoe = median(peerOnly.map(p => p.roe));
  let summary = '피어 데이터가 부족합니다.';
  if (peerOnly.length && me.per != null && me.roe != null && peerPer != null && peerRoe != null) {
    if (me.per < peerPer && me.roe > peerRoe) summary = '이익은 업계보다 잘 내는데 주가는 더 싸게 거래 중';
    else if (me.per > peerPer && me.roe > peerRoe) summary = '수익성은 우수하나 밸류에이션은 업계보다 높음';
    else if (me.per < peerPer && me.roe < peerRoe) summary = '주가는 싸지만 수익성도 낮음 (밸류 트랩 주의)';
    else summary = '밸류·수익성 모두 업계 평균 수준';
  }

  container.innerHTML = `
    <div class="panel">
      <div class="panel-title">동종업계 상대가치 비교 — ${sym.nameKr}
        <span style="font-weight:400; color:var(--text-muted); font-size:12px;">(${sym.sector} · ${sym.industry})</span>
      </div>
      <p style="font-size:12px; color:var(--text-muted); margin:0 0 10px;">
        분석 페이지의 점수 카드는 동종업계 4곳만 비교합니다. 이 표는 자동 피어 + 사용자가 추가한 피어를 함께 비교합니다.
      </p>
      <p style="background:var(--primary-soft); padding:10px 14px; border-radius:6px; margin:0 0 12px;">
        <strong>종합 한 줄 평:</strong> ${summary}
      </p>

      <div style="display:flex; align-items:center; gap:8px; margin-bottom:12px; flex-wrap:wrap;">
        <span style="font-size:13px; color:var(--text-muted);">피어 그룹 (${peers.length})</span>
        ${peers.map(p => `<span style="display:inline-flex; align-items:center; gap:4px; background:var(--bg-subtle); padding:3px 4px 3px 8px; border-radius:12px; font-size:12px; border:1px solid var(--border);">
          ${p.nameKr}
          <button class="clear-btn" data-remove-peer="${p.ticker}" aria-label="피어 제외" title="피어에서 제외" style="background:none; border:none; cursor:pointer; color:var(--text-muted); padding:0 4px;">✕</button>
        </span>`).join('')}
        <div style="position:relative;">
          <input type="search" id="peer-add-input" placeholder="+ 피어 추가" style="font-size:12px; padding:4px 8px; border:1px solid var(--border); border-radius:12px; width:120px;" autocomplete="off"/>
          <div id="peer-add-suggest" style="position:absolute; top:100%; left:0; background:var(--surface); border:1px solid var(--border); border-radius:6px; box-shadow:0 4px 12px rgba(0,0,0,0.08); margin-top:4px; min-width:200px; max-height:200px; overflow-y:auto; z-index:10; display:none;"></div>
        </div>
        <button id="peer-add-modal-btn" class="btn-secondary" style="font-size:12px; padding:3px 10px;">+ 비교군 모달</button>
        <button id="peer-clear-all-btn" class="btn-secondary" style="font-size:12px; padding:3px 10px;" ${peers.length === 0 ? 'disabled' : ''}>모두 삭제</button>
      </div>

      ${peers.length === 0 ? emptyState('피어 종목이 없습니다. 위 입력창에서 피어를 추가해 보세요.') : `
      <div class="compare-table-wrap">
      <table class="compare-table">
        <thead>
          <tr>
            <th>지표 ${infoTip('대표값은 중앙값(median)을 기본으로 사용합니다. 평균은 적자기업·이상치가 끼면 왜곡되기 쉽습니다.')}</th>
            ${all.map((s, i) => `<th class="num peer-col ${i === 0 ? 'current-col' : ''}">
              ${s.nameKr}
              ${i === 0 ? '<div style="font-size:10px; color:var(--primary); font-weight:600; margin-top:2px;">현재 종목</div>' : ''}
            </th>`).join('')}
            <th class="num peer-col">중앙값</th>
            <th class="num peer-col">백분위 ${infoTip('현재 종목이 지표 방향(낮을수록/높을수록 좋음)을 반영해 피어 그룹 내에서 얼마나 우수한지(%). 높을수록 우수합니다.')}</th>
          </tr>
        </thead>
        <tbody>
          ${COMPARE_METRICS.map(m => {
            const vals = results.map(r => r.fin[m.key]);
            const med = median(vals);
            const pct = percentile(me[m.key], vals, m.lowerBetter);
            const valid = vals.filter(v => v != null && !isNaN(v));
            const bestVal = valid.length ? (m.lowerBetter ? Math.min(...valid) : Math.max(...valid)) : null;
            return `<tr>
              <td><strong>${m.label}</strong> <span style="font-size:11px; color:var(--text-muted);">(${m.lowerBetter ? '낮을수록 우수' : '높을수록 우수'})</span></td>
              ${vals.map((v, i) => {
                const isBest = bestVal != null && v === bestVal;
                const isCurrent = i === 0;
                const cls = ['num', 'peer-col', isCurrent ? 'current-col' : '', isBest ? 'best-value' : ''].filter(Boolean).join(' ');
                const tip = isBest ? ' data-tooltip="피어 그룹 내 가장 우수한 값"' : '';
                const badge = isBest ? '<span class="best-badge" aria-label="동종업계 대비 우수">우수</span>' : '';
                return `<td class="${cls}"${tip}>
                  <span class="cell-flex">
                    <span class="cell-badge-slot">${badge}</span>
                    <span class="cell-num-val">${fmtCell(v, m.unit)}</span>
                  </span>
                </td>`;
              }).join('')}
              <td class="num peer-col">${fmtCell(med, m.unit)}</td>
              <td class="num peer-col">${pct == null ? '—' : pct.toFixed(0) + '%'}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      </div>
      <div style="display:flex; gap:16px; font-size:12px; color:var(--text-muted); margin-top:10px; flex-wrap:wrap;">
        <span><span style="display:inline-block; width:12px; height:12px; background:var(--primary-soft); border-radius:3px; vertical-align:middle; margin-right:4px;"></span>지표별 최우수 값</span>
        <span><span style="display:inline-block; width:12px; height:12px; background:var(--bg-subtle); border-left:2px solid var(--primary); vertical-align:middle; margin-right:4px;"></span>현재 선택 종목 열</span>
      </div>
      <p style="font-size:12px; color:var(--text-muted); margin-top:12px;">
        ※ 단순 PER 저점이 곧 저평가는 아닙니다(밸류 트랩). 성장성·수익성과 함께 보세요.<br />
        ※ 해외 피어 비교 시 회계기준(K-IFRS/US-GAAP)·환율 기준일 차이가 있을 수 있습니다.
      </p>
      `}
    </div>`;

  // 피어 제외
  container.querySelectorAll('[data-remove-peer]').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = btn.dataset.removePeer;
      peerState[ticker].excluded.add(t);
      peerState[ticker].added.delete(t);
      renderCompare(container, { ticker });
    });
  });

  // 모두 삭제 — 현재 보이는 피어 모두 excluded 처리 + added 클리어
  container.querySelector('#peer-clear-all-btn')?.addEventListener('click', () => {
    peers.forEach(p => peerState[ticker].excluded.add(p.ticker));
    peerState[ticker].added.clear();
    renderCompare(container, { ticker });
  });

  // 비교군 일괄 추가 모달
  container.querySelector('#peer-add-modal-btn')?.addEventListener('click', () => {
    openPeerAddModal(container, ticker, peers);
  });

  // 피어 추가 자동완성
  const input = container.querySelector('#peer-add-input');
  const suggest = container.querySelector('#peer-add-suggest');
  if (input) {
    let t;
    input.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const q = input.value.trim();
        if (!q) { suggest.style.display = 'none'; return; }
        const list = suggestSymbols(q, 6).filter(s => s.ticker !== ticker && !peers.find(p => p.ticker === s.ticker));
        if (!list.length) { suggest.style.display = 'none'; return; }
        suggest.innerHTML = list.map(s => `<div data-add="${s.ticker}" style="padding:6px 10px; cursor:pointer; font-size:13px;">
          <strong>${s.nameKr}</strong> <span style="color:var(--text-muted)">${s.ticker} · ${s.market === 'kr' ? '국내' : '미국'}</span>
        </div>`).join('');
        suggest.style.display = 'block';
        suggest.querySelectorAll('[data-add]').forEach(el => {
          el.addEventListener('mouseenter', () => el.style.background = 'var(--primary-soft)');
          el.addEventListener('mouseleave', () => el.style.background = '');
          el.addEventListener('click', () => {
            peerState[ticker].added.add(el.dataset.add);
            peerState[ticker].excluded.delete(el.dataset.add);
            renderCompare(container, { ticker });
          });
        });
      }, 150);
    });
    input.addEventListener('blur', () => setTimeout(() => suggest.style.display = 'none', 200));
  }
}

function openPeerAddModal(container, ticker, currentPeers) {
  const existing = document.getElementById('peer-add-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'peer-add-modal';
  modal.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.4); z-index:1000; display:flex; align-items:center; justify-content:center;';
  modal.innerHTML = `
    <div style="background:var(--surface); border-radius:8px; padding:20px; width:90%; max-width:520px; max-height:80vh; display:flex; flex-direction:column;">
      <h3 style="margin:0 0 6px; font-size:16px;">비교군 관리</h3>
      <p style="margin:0 0 12px; font-size:12px; color:var(--text-muted);">
        체크된 종목이 비교군에 포함됩니다. 등록된 종목을 언체크하면 제거되고, 검색 결과를 체크하면 추가됩니다.
      </p>
      <input id="peer-modal-input" type="search" placeholder="종목명·티커 검색 (한국어·영문)" autofocus
             style="width:100%; padding:8px 12px; border:1px solid var(--border); border-radius:6px; font-size:14px; margin-bottom:8px;"/>
      <div style="overflow-y:auto; flex:1; min-height:200px; max-height:55vh; border:1px solid var(--border); border-radius:6px; padding:0;">
        <div style="padding:8px 10px; background:var(--bg-subtle); font-size:12px; color:var(--text-muted); font-weight:600;">
          🔍 검색 결과
        </div>
        <div id="peer-modal-search-section" style="padding:4px;"></div>

        <div style="padding:8px 10px; background:var(--bg-subtle); font-size:12px; color:var(--text-muted); font-weight:600; border-top:1px solid var(--border);">
          ✨ 추가 예정 <span id="peer-modal-pending-count" style="color:var(--text-muted); font-weight:400;"></span>
        </div>
        <div id="peer-modal-pending-section" style="padding:4px;"></div>

        <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 10px; background:var(--bg-subtle); font-size:12px; color:var(--text-muted); font-weight:600; border-top:1px solid var(--border);">
          <span>⭐ 현재 등록된 비교군 <span id="peer-modal-current-count" style="color:var(--text-muted); font-weight:400;"></span></span>
          <button id="peer-modal-clear-all" class="btn-secondary" style="font-size:11px; padding:2px 8px;">전체 해제</button>
        </div>
        <div id="peer-modal-current-section" style="padding:4px;"></div>
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:12px;">
        <span id="peer-modal-summary" style="font-size:12px; color:var(--text-muted);"></span>
        <div style="display:flex; gap:8px;">
          <button class="btn-secondary" id="peer-modal-cancel">취소</button>
          <button class="btn-primary" id="peer-modal-apply">변경사항 저장</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // 초기 selected = 현재 피어 모두 체크된 상태
  const selected = new Set(currentPeers.map(p => p.ticker));
  const input = modal.querySelector('#peer-modal-input');
  const summaryEl = modal.querySelector('#peer-modal-summary');

  function updateSummary() {
    const currentTickers = new Set(currentPeers.map(p => p.ticker));
    const toAdd = [...selected].filter(t => !currentTickers.has(t)).length;
    const toRemove = [...currentTickers].filter(t => !selected.has(t)).length;
    summaryEl.textContent = (toAdd + toRemove === 0) ? '변경 없음' : `추가 ${toAdd} · 제거 ${toRemove}`;
  }

  function renderItem(s) {
    const checked = selected.has(s.ticker) ? 'checked' : '';
    let badge = '';
    if (s.src === 'current') badge = '<span style="font-size:10px; background:#e6f4ea; color:#1e8e3e; padding:1px 6px; border-radius:8px; margin-left:6px;">등록됨</span>';
    else if (s.src === 'alias') badge = '<span style="font-size:10px; background:#fff3d6; color:#946800; padding:1px 6px; border-radius:8px; margin-left:6px;">별칭</span>';
    else if (s.src === 'external') badge = '<span style="font-size:10px; background:var(--primary-soft); color:var(--primary); padding:1px 6px; border-radius:8px; margin-left:6px;">외부</span>';
    return `<label style="display:block; padding:6px 8px; cursor:pointer; font-size:13px;">
      <input type="checkbox" data-ticker="${s.ticker}" ${checked} style="margin-right:8px;"/>
      <strong>${s.name}</strong> <span style="color:var(--text-muted)">${s.ticker} · ${s.market === 'kr' ? '국내' : '미국'}</span>${badge}
    </label>`;
  }

  // 검색 결과 마지막 상태 보관 (재렌더 시 사용)
  let lastSearchItems = [];

  function renderPendingSection() {
    const sec = modal.querySelector('#peer-modal-pending-section');
    const cnt = modal.querySelector('#peer-modal-pending-count');
    const currentTickers = new Set(currentPeers.map(p => p.ticker));
    const pendingTickers = [...selected].filter(t => !currentTickers.has(t));
    cnt.textContent = `(${pendingTickers.length})`;
    if (!pendingTickers.length) {
      sec.innerHTML = '<p style="color:var(--text-muted); font-size:12px; padding:10px;">검색 결과에서 체크한 종목이 여기에 표시됩니다.</p>';
      return;
    }
    const items = pendingTickers.map(t => {
      const sym = getSymbol(t);
      // 마스터에 없으면 lastSearchItems 에서 찾기 (외부 결과)
      const fromSearch = lastSearchItems.find(s => s.ticker === t);
      const name = sym?.nameKr || fromSearch?.name || t;
      const market = sym?.market || fromSearch?.market || 'us';
      const src = fromSearch?.src === 'external' ? 'external' : (fromSearch?.src === 'alias' ? 'alias' : 'master');
      return { ticker: t, name, market, src };
    });
    sec.innerHTML = items.map(renderItem).join('');
    bindCheckboxes(sec);
  }

  function rerenderAll() {
    renderSearchSection(lastSearchItems);
    renderPendingSection();
    renderCurrentSection();
    updateSummary();
  }

  function bindCheckboxes(rootEl) {
    rootEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) selected.add(cb.dataset.ticker);
        else selected.delete(cb.dataset.ticker);
        rerenderAll();   // 모든 섹션 재렌더 (3섹션 동기화)
      });
    });
  }

  function renderCurrentSection() {
    const sec = modal.querySelector('#peer-modal-current-section');
    const cnt = modal.querySelector('#peer-modal-current-count');
    cnt.textContent = `(${currentPeers.length})`;
    if (!currentPeers.length) {
      sec.innerHTML = '<p style="color:var(--text-muted); font-size:12px; padding:10px;">아직 등록된 비교군이 없습니다.</p>';
      return;
    }
    const items = currentPeers.map(p => ({ ticker: p.ticker, name: p.nameKr, market: p.market, src: 'current' }));
    sec.innerHTML = items.map(renderItem).join('');
    bindCheckboxes(sec);
  }

  function renderSearchSection(searchItems) {
    const sec = modal.querySelector('#peer-modal-search-section');
    if (!searchItems || searchItems.length === 0) {
      sec.innerHTML = '<p style="color:var(--text-muted); font-size:12px; padding:10px;">위 검색창에 종목명·티커를 입력하세요. (한국어·영문 모두 가능)</p>';
      return;
    }
    const currentTickers = new Set(currentPeers.map(p => p.ticker));
    // currentPeers + selected (추가 예정) 모두 제외
    const filtered = searchItems.filter(s => !currentTickers.has(s.ticker) && !selected.has(s.ticker));
    if (!filtered.length) {
      sec.innerHTML = '<p style="color:var(--text-muted); font-size:12px; padding:10px;">검색 결과가 이미 모두 등록·추가 예정입니다.</p>';
      return;
    }
    sec.innerHTML = filtered.map(renderItem).join('');
    bindCheckboxes(sec);
  }

  // 초기 렌더 — 3 섹션
  rerenderAll();

  // 검색 입력
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = input.value.trim();
      if (!q) { lastSearchItems = []; rerenderAll(); return; }   // 빈 검색 → 검색 결과 비움

      const exclude = new Set([ticker]);

      // 1차: 마스터
      const master = searchSymbols(q, 'all').filter(s => !exclude.has(s.ticker)).slice(0, 10);

      // 2차: 별칭 단일
      let aliasHit = null;
      if (master.length === 0) {
        try {
          const found = await lookupExternal(q);
          if (found?.sym && !exclude.has(found.sym.ticker)) aliasHit = found.sym;
        } catch {}
      }

      // 3차: 외부 다중
      let extras = [];
      if (master.length + (aliasHit ? 1 : 0) < 6) {
        try {
          const ext = await searchExternalMulti(q);
          extras = ext.filter(e => !exclude.has(e.ticker) && !master.find(m => m.ticker === e.ticker) && e.ticker !== aliasHit?.ticker);
        } catch {}
      }

      const searchItems = [
        ...master.map(s => ({ ticker: s.ticker, name: s.nameKr, market: s.market, src: 'master' })),
        ...(aliasHit ? [{ ticker: aliasHit.ticker, name: aliasHit.nameKr, market: aliasHit.market, src: 'alias' }] : []),
        ...extras.map(e => ({ ticker: e.ticker, name: e.name, market: 'us', src: 'external' })),
      ];

      lastSearchItems = searchItems;
      rerenderAll();
    }, 180);
  });

  modal.querySelector('#peer-modal-cancel').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });   // 외부 클릭 닫기

  // 헤더의 selected 일괄 비우기 버튼
  modal.querySelector('#peer-modal-clear-all').addEventListener('click', () => {
    selected.clear();
    rerenderAll();
  });

  modal.querySelector('#peer-modal-apply').addEventListener('click', async () => {
    const currentTickers = new Set(currentPeers.map(p => p.ticker));
    const toAdd = [...selected].filter(t => !currentTickers.has(t));
    const toRemove = [...currentTickers].filter(t => !selected.has(t));

    // 추가
    for (const t of toAdd) {
      const sym = getSymbol(t);
      if (!sym) {
        try {
          const found = await lookupExternal(t);
          if (found?.sym) {
            addExtra(found.sym);
            registerExtraSymbol(found.sym);
          }
        } catch {}
      }
      peerState[ticker].added.add(t);
      peerState[ticker].excluded.delete(t);
    }

    // 제거
    for (const t of toRemove) {
      peerState[ticker].excluded.add(t);
      peerState[ticker].added.delete(t);
    }

    modal.remove();
    renderCompare(container, { ticker });
  });
}
