import { getSymbol, getPeers, suggestSymbols } from '../data/symbols.js';
import { getFinancials } from '../data/adapter.js';
import { fmtNum, fmtPct } from '../utils/format.js';
import { emptyState, loadingState, infoTip } from '../components/common.js';

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

function getEffectivePeers(ticker) {
  const auto = getPeers(ticker);
  const st = peerState[ticker] || { excluded: new Set(), added: new Set() };
  const added = [...st.added].map(t => getSymbol(t)).filter(Boolean);
  const combined = [...auto, ...added].filter(s => !st.excluded.has(s.ticker));
  // 중복 제거
  const seen = new Set();
  return combined.filter(s => (seen.has(s.ticker) ? false : (seen.add(s.ticker), true))).slice(0, 8);
}

function median(arr) {
  const a = arr.filter(v => v != null && !isNaN(v)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function percentile(val, arr, lowerBetter) {
  const a = arr.filter(v => v != null && !isNaN(v)).sort((x, y) => x - y);
  if (!a.length || val == null) return null;
  const below = a.filter(v => v < val).length;
  const pct = (below / a.length) * 100;
  return lowerBetter ? 100 - pct : pct;
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
