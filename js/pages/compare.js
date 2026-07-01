import { getSymbol, getPeers, suggestSymbols, searchSymbols, lookupExternal, searchExternalMulti, registerExtraSymbol } from '../data/symbols.js';
import { addExtra } from '../data/extras-store.js';
import { getFinancials } from '../data/adapter.js';
import { fmtNum, fmtPct } from '../utils/format.js';
import { emptyState, loadingState, infoTip } from '../components/common.js';
import { peerMedian as median, peerPercentile as percentile } from '../utils/peer-percentile.js';
import { askGemini, getGeminiCacheMeta } from '../data/adapters/gemini.js';
import { showLoading, hideLoading, updateLoadingMessage } from '../components/loading-overlay.js';

const COMPARE_METRICS = [
  { key: 'per',              label: 'PER',           unit: 'x', lowerBetter: true,  group: 'valuation'     },
  { key: 'pbr',              label: 'PBR',           unit: 'x', lowerBetter: true,  group: 'valuation'     },
  { key: 'psr',              label: 'PSR',           unit: 'x', lowerBetter: true,  group: 'valuation'     },
  { key: 'evEbitda',         label: 'EV/EBITDA',     unit: 'x', lowerBetter: true,  group: 'valuation'     },
  { key: 'peg',              label: 'PEG',           unit: 'x', lowerBetter: true,  group: 'valuation'     },
  { key: 'forwardPer',       label: 'Forward PER',   unit: 'x', lowerBetter: true,  group: 'valuation'     },
  { key: 'roe',              label: 'ROE',           unit: '%', lowerBetter: false, group: 'profitability' },
  { key: 'opMargin',         label: '영업이익률',     unit: '%', lowerBetter: false, group: 'profitability' },
  { key: 'revenueGrowthYoY', label: '매출성장률(YoY)', unit: '%', lowerBetter: false, group: 'growth'        },
  { key: 'epsGrowth3y',      label: 'EPS 3년 성장률', unit: '%', lowerBetter: false, group: 'growth', clipAbs: 200 },
];

const COMPARE_GROUPS = [
  { id: 'valuation',     label: '밸류에이션', icon: '💰' },
  { id: 'profitability', label: '수익성',     icon: '📈' },
  { id: 'growth',        label: '성장성',     icon: '🚀' },
];

// 그룹 토글 상태 (메모리만 유지, 페이지 새로고침 시 전체 ON 리셋)
const groupState = { valuation: true, profitability: true, growth: true };

// 백분위 정렬 상태 (메모리만). active=false 시 기본 (지표 순).
let sortState = { active: false, direction: 'desc' };   // 'desc' = 백분위 높은 순

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

function fmtCell(v, unit, clipAbs = null) {
  if (v == null) return '—';
  // 극단값 클리핑 (예: EPS3y 절댓값 200% 초과 시 ">200%" 표시) — 표시 단계만, 통계는 원본 값
  if (clipAbs != null && Math.abs(v) > clipAbs) {
    const sign = v > 0 ? '>' : '<-';
    const suffix = unit === '%' ? '%' : 'x';
    return sign + clipAbs + suffix;
  }
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

      <div style="display:flex; align-items:center; gap:8px; margin-bottom:12px; flex-wrap:wrap;">
        <span style="font-size:13px; color:var(--text-muted);">표시 그룹</span>
        ${COMPARE_GROUPS.map(g => `
          <label style="display:inline-flex; align-items:center; gap:4px; font-size:12px; cursor:pointer; padding:3px 8px; border:1px solid var(--border); border-radius:12px; background:${groupState[g.id] ? 'var(--primary-soft)' : 'var(--surface)'};">
            <input type="checkbox" data-group-toggle="${g.id}" ${groupState[g.id] ? 'checked' : ''} style="margin:0;" />
            ${g.icon} ${g.label}
          </label>
        `).join('')}
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
            <th class="num peer-col" id="pct-header" style="cursor:pointer; user-select:none;" data-tooltip="클릭으로 백분위 기준 정렬 (그룹 내)">
              백분위 ${sortState.active ? (sortState.direction === 'desc' ? '↓' : '↑') : '↕'}
              ${infoTip('현재 종목이 지표 방향(낮을수록/높을수록 좋음)을 반영해 피어 그룹 내에서 얼마나 우수한지(%). 높을수록 우수합니다. 헤더 클릭으로 그룹 내 정렬.')}
            </th>
          </tr>
        </thead>
        <tbody>
          ${COMPARE_GROUPS.filter(g => groupState[g.id]).map(g => {
            let groupMetrics = COMPARE_METRICS.filter(m => m.group === g.id);
            if (!groupMetrics.length) return '';
            // 백분위 정렬 (그룹 내) — null 백분위는 항상 마지막
            if (sortState.active) {
              groupMetrics = [...groupMetrics]
                .map(m => ({
                  m,
                  pct: percentile(me[m.key], results.map(r => r.fin[m.key]), m.lowerBetter),
                }))
                .sort((a, b) => {
                  // null 백분위는 정렬 방향과 무관하게 항상 마지막
                  if (a.pct == null && b.pct == null) return 0;
                  if (a.pct == null) return 1;
                  if (b.pct == null) return -1;
                  const diff = b.pct - a.pct;   // desc 기본
                  return sortState.direction === 'desc' ? diff : -diff;
                })
                .map(x => x.m);
            }
            // 그룹 헤더 행 — colspan = 지표 + 종목들 + 중앙값 + 백분위
            const colCount = 1 + all.length + 2;
            const groupHeader = `<tr class="group-header" style="background:var(--bg-subtle); border-top:2px solid var(--border);">
              <td colspan="${colCount}" style="padding:6px 10px; font-weight:600; color:var(--text-muted); font-size:12px;">
                ${g.icon} ${g.label} (${groupMetrics.length}개)
              </td>
            </tr>`;
            const metricRows = groupMetrics.map(m => {
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
                      <span class="cell-num-val">${fmtCell(v, m.unit, m.clipAbs)}</span>
                    </span>
                  </td>`;
                }).join('')}
                <td class="num peer-col">${fmtCell(med, m.unit, m.clipAbs)}</td>
                <td class="num peer-col">${pct == null ? '—' : pct.toFixed(0) + '%'}</td>
              </tr>`;
            }).join('');
            return groupHeader + metricRows;
          }).join('')}
        </tbody>
      </table>
      </div>
      <div class="panel" id="gemini-compare-panel" style="margin-top:12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:8px;">
          <div class="panel-title" style="margin-bottom:0;">🤖 AI 비교 분석 (Gemini)</div>
          <div id="gemini-compare-actions" style="display:flex; gap:6px;">
            <button id="gemini-compare-fetch-btn" class="btn-primary" style="font-size:12px; padding:5px 12px;">AI 비교 분석 보기</button>
          </div>
        </div>
        <div id="gemini-compare-result" style="min-height:60px;">
          <p style="color:var(--text-muted); font-size:13px; margin:0;">현재 종목과 피어 그룹 비교 결과 AI 분석입니다. 위 버튼을 눌러 시작하세요.</p>
        </div>
        <p style="font-size:11px; color:var(--text-muted); margin-top:8px;">⚠ AI 생성 — 사실 검증 필요. 투자 권유 X.</p>
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

  // 그룹 토글
  container.querySelectorAll('[data-group-toggle]').forEach(input => {
    input.addEventListener('change', () => {
      groupState[input.dataset.groupToggle] = input.checked;
      renderCompare(container, { ticker });
    });
  });

  // 백분위 헤더 클릭 — 정렬 토글 (3단계: off → desc → asc → off)
  container.querySelector('#pct-header')?.addEventListener('click', () => {
    if (!sortState.active) {
      sortState = { active: true, direction: 'desc' };
    } else if (sortState.direction === 'desc') {
      sortState = { active: true, direction: 'asc' };
    } else {
      sortState = { active: false, direction: 'desc' };
    }
    renderCompare(container, { ticker });
  });

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

  // === Gemini 비교 분석 카드 초기화 ===
  if (document.getElementById('gemini-compare-panel')) {
    const cacheMeta = getGeminiCacheMeta(`compare:${sym.ticker}:v1`);
    if (cacheMeta.exists) {
      fetchAndRenderGeminiCompare(sym, peers, results, false);
    } else {
      _bindGeminiCompareButtons(sym, peers, results);
    }
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

async function fetchAndRenderGeminiCompare(sym, peers, results, forceRefresh = false) {
  const resultEl = document.getElementById('gemini-compare-result');
  const actionsEl = document.getElementById('gemini-compare-actions');
  if (!resultEl || !actionsEl) return;

  const cacheKey = `compare:${sym.ticker}:v1`;
  const cacheMeta = getGeminiCacheMeta(cacheKey);
  const willHitCache = !forceRefresh && cacheMeta.exists;

  resultEl.innerHTML = `<p style="color:var(--text-muted); font-size:13px; margin:0;">⏳ Gemini 비교 분석 중... (1~5초)</p>`;
  actionsEl.innerHTML = `<button class="btn-secondary" style="font-size:12px; padding:5px 12px;" disabled>분석 중…</button>`;

  if (!willHitCache) showLoading('🤖 AI 비교 분석 중... (1~5초)');
  try {
  const safeNum = (v, s = '') => (v == null || isNaN(v)) ? '미가용' : `${Number(v).toFixed(2)}${s}`;
  const me = results[0].fin;
  const peersLines = peers.map((p, i) => {
    const pf = results[i + 1]?.fin || {};
    return `- ${p.nameKr} (${p.ticker}): PER ${safeNum(pf.per)}배 · PBR ${safeNum(pf.pbr)}배 · ROE ${safeNum(pf.roe, '%')} · 영업이익률 ${safeNum(pf.opMargin, '%')}`;
  }).join('\n');

  const prompt = `당신은 한국 주식 시장 전문 애널리스트입니다. 아래 현재 종목과 피어 그룹을 상대적으로 비교 분석하세요.

# 분석 절차
1. 현재 종목의 밸류·수익성·성장을 피어 평균과 비교.
2. 상대적 강점·약점 도출 (구체적 수치 근거).
3. 투자 관점 결론.

# 현재 종목
- 종목명: ${sym.nameKr} (${sym.ticker})
- 산업: ${sym.sector || '미상'} · ${sym.industry || '미상'}
- PER: ${safeNum(me.per, '배')} · PBR: ${safeNum(me.pbr, '배')} · PSR: ${safeNum(me.psr, '배')} · PEG: ${safeNum(me.peg, '배')} · Forward PER: ${safeNum(me.forwardPer, '배')} · EV/EBITDA: ${safeNum(me.evEbitda, '배')}
- ROE: ${safeNum(me.roe, '%')} · 영업이익률: ${safeNum(me.opMargin, '%')}
- 매출성장 YoY: ${safeNum(me.revenueGrowthYoY, '%')} · EPS 3년 성장: ${safeNum(me.epsGrowth3y, '%')}

# 피어 그룹 (${peers.length}개)
${peersLines}

# 출력 형식 (반드시 이 형식 준수)
**[상대 위치]**
(피어 그룹 안에서 현재 종목의 밸류·수익성·성장이 어느 위치인지 한 줄.)

**[강점]** (피어 대비)
1. (강점 1 — 어떤 지표가 어떤 피어 대비 우수한지 구체적 수치)
2. (강점 2 — 동일 형식)

**[약점]** (피어 대비)
1. (약점 1 — 어떤 지표가 어떤 피어 대비 부족한지 구체적 수치)
2. (약점 2 — 동일 형식)

**[비교 결론]**
(피어 그룹 내에서 이 종목을 선택할 만한 이유 또는 다른 피어가 나은 이유. 1~2 문장.)

※ AI 생성 — 사실 검증 필요. 투자 권유 아님.`;

  const { text, error, fromCache, modelVersion, timestamp } = await askGemini(prompt, {
    cacheKey: `compare:${sym.ticker}:v1`,
    skipCache: forceRefresh,
    onRetry: (attempt, max) => {
      updateLoadingMessage(`🤖 AI 비교 분석 재시도 중... (${attempt}/${max})`);
    },
  });

  if (error) {
    resultEl.innerHTML = `<p style="color:var(--danger, #c00); font-size:13px; margin:0;">⚠ ${error}</p>`;
    actionsEl.innerHTML = `<button id="gemini-compare-fetch-btn" class="btn-primary" style="font-size:12px; padding:5px 12px;">다시 시도</button>`;
  } else if (text) {
    const safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    const cacheInfo = fromCache && timestamp
      ? `<span style="color:var(--text-muted); font-size:11px; margin-left:8px;">캐시됨 (${_fmtAgoCompare(timestamp)})</span>`
      : '';
    const modelInfo = modelVersion
      ? `<span style="color:var(--text-muted); font-size:11px;">모델: ${modelVersion}${cacheInfo}</span>`
      : cacheInfo;
    resultEl.innerHTML = `<div style="font-size:13px; line-height:1.6;">${safe}</div><div style="margin-top:8px;">${modelInfo}</div>`;
    actionsEl.innerHTML = `<button id="gemini-compare-refresh-btn" class="btn-secondary" style="font-size:12px; padding:5px 12px;">다시 분석</button>`;
  } else {
    resultEl.innerHTML = `<p style="color:var(--text-muted); font-size:13px; margin:0;">응답이 없습니다.</p>`;
    actionsEl.innerHTML = `<button id="gemini-compare-fetch-btn" class="btn-primary" style="font-size:12px; padding:5px 12px;">다시 시도</button>`;
  }

  _bindGeminiCompareButtons(sym, peers, results);
  } finally {
    if (!willHitCache) hideLoading();
  }
}

function _fmtAgoCompare(ts) {
  const min = Math.floor((Date.now() - ts) / 60000);
  if (min < 1) return '방금 전';
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return `${Math.floor(hr / 24)}일 전`;
}

function _bindGeminiCompareButtons(sym, peers, results) {
  document.getElementById('gemini-compare-fetch-btn')?.addEventListener('click', () => {
    fetchAndRenderGeminiCompare(sym, peers, results, false);
  });
  document.getElementById('gemini-compare-refresh-btn')?.addEventListener('click', () => {
    if (confirm('캐시를 무시하고 새로 분석하시겠어요? (호출 한도 사용)')) {
      fetchAndRenderGeminiCompare(sym, peers, results, true);
    }
  });
}
