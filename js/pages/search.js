import { searchSymbols, getSymbol, lookupExternal, registerExtraSymbol } from '../data/symbols.js';
import { addExtra } from '../data/extras-store.js';
import { getQuoteEOD } from '../data/adapter.js';
import { toggleWatch, isWatched } from '../data/watchlist.js';
import { showToast } from '../components/toast.js';
import { fmtNum, fmtChange } from '../utils/format.js';

let currentMarket = 'all';

// 외부 lookup 시도 후 "추가" 제안 UI 를 container 에 렌더. 빈 결과 분기에서 재사용.
async function tryLookupAndOfferAdd(container, query, onSelect) {
  const found = await lookupExternal(query);
  if (!found) {
    container.innerHTML = `<div class="panel" style="padding:24px; text-align:center; color:var(--text-muted);">
      "${query}" 에 해당하는 외부 종목을 찾지 못했습니다.
    </div>`;
    return;
  }
  const { sym, source } = found;
  container.innerHTML = `<div class="panel" style="padding:16px;">
    <p style="margin:0 0 8px;">
      외부에서 발견: <strong>${sym.nameKr}</strong> (${sym.ticker} · ${sym.market === 'kr' ? '국내' : '미국'} · ${sym.type === 'etf' ? 'ETF' : '주식'})
      <span style="color:var(--text-muted); font-size:11px; margin-left:6px;">[${source}]</span>
    </p>
    <p style="margin:0 0 12px; font-size:12px; color:var(--text-muted);">
      이 종목을 추가하시겠습니까? (본인 브라우저에 저장됩니다)
    </p>
    <button id="btn-add-extra" class="btn-primary">추가하고 분석 보기</button>
  </div>`;
  document.getElementById('btn-add-extra')?.addEventListener('click', () => {
    const added = addExtra(sym);
    registerExtraSymbol(sym);
    showToast(added ? `${sym.nameKr} 추가됨` : '이미 추가된 종목입니다', { type: 'info' });
    if (onSelect) onSelect(sym.ticker);
    else location.hash = `#/analysis/${sym.ticker}`;
  });
}

export async function renderSearch(container, { query = '', market = 'all', onSelect } = {}) {
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
    // 빈 결과 — 외부 lookup 시도 (한국 corp_code / 미국 Finnhub)
    container.innerHTML = `<div class="panel" style="padding:24px; text-align:center; color:var(--text-muted);">
      "${query}" 에 해당하는 종목을 마스터에서 찾지 못했습니다. 외부에서 확인 중...
    </div>`;
    await tryLookupAndOfferAdd(container, query, onSelect);
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

  // 결과 테이블 아래에 보조 "외부에서 찾기" 안내 — 사용자가 찾는 정확한 종목이 없을 수도 있으므로.
  const extraLookupPanel = document.createElement('div');
  extraLookupPanel.className = 'panel';
  extraLookupPanel.style.cssText = 'margin-top:8px; padding:14px; text-align:center;';
  extraLookupPanel.innerHTML = `
    <p style="margin:0 0 8px; font-size:13px; color:var(--text-muted);">
      찾으시는 종목이 위 결과에 없나요? 검색어 "<strong>${query}</strong>" 그대로 외부에서 한 번 더 찾아볼 수 있습니다.
    </p>
    <button id="btn-external-lookup" class="btn-secondary">이 검색어로 외부에서 찾기</button>
    <button id="btn-external-lookup-multi" class="btn-secondary" style="margin-left:8px;">외부에서 다중 결과 보기</button>
  `;
  container.appendChild(extraLookupPanel);

  extraLookupPanel.querySelector('#btn-external-lookup')?.addEventListener('click', async () => {
    extraLookupPanel.innerHTML = `<p style="color:var(--text-muted); font-size:13px;">"${query}" 외부 확인 중...</p>`;
    // 결과 페이지 전체를 lookup 결과로 교체하지 않고, 보조 패널만 갱신.
    const found = await lookupExternal(query);
    if (!found) {
      extraLookupPanel.innerHTML = `<p style="color:var(--text-muted); font-size:13px;">
        "${query}" 에 해당하는 외부 종목을 찾지 못했습니다.
      </p>`;
      return;
    }
    const { sym, source } = found;
    extraLookupPanel.innerHTML = `
      <p style="margin:0 0 8px;">
        외부에서 발견: <strong>${sym.nameKr}</strong> (${sym.ticker} · ${sym.market === 'kr' ? '국내' : '미국'} · ${sym.type === 'etf' ? 'ETF' : '주식'})
        <span style="color:var(--text-muted); font-size:11px; margin-left:6px;">[${source}]</span>
      </p>
      <button id="btn-add-extra-aux" class="btn-primary">추가하고 분석 보기</button>
    `;
    extraLookupPanel.querySelector('#btn-add-extra-aux')?.addEventListener('click', () => {
      const added = addExtra(sym);
      registerExtraSymbol(sym);
      showToast(added ? `${sym.nameKr} 추가됨` : '이미 추가된 종목입니다', { type: 'info' });
      if (onSelect) onSelect(sym.ticker);
      else location.hash = `#/analysis/${sym.ticker}`;
    });
  });

  extraLookupPanel.querySelector('#btn-external-lookup-multi')?.addEventListener('click', async () => {
    extraLookupPanel.innerHTML = `<p style="color:var(--text-muted); font-size:13px;">"${query}" 외부 다중 검색 중...</p>`;
    const { searchExternalMulti, lookupExternal, registerExtraSymbol } = await import('../data/symbols.js');
    const list = await searchExternalMulti(query);
    if (!list.length) {
      extraLookupPanel.innerHTML = `<p style="color:var(--text-muted); font-size:13px;">외부에서 추가 결과를 찾지 못했습니다.</p>`;
      return;
    }
    extraLookupPanel.innerHTML = `
      <p style="margin:0 0 8px; font-size:13px;">외부 검색 결과 ${list.length}건 — 선택해서 추가하세요:</p>
      <div style="max-height:240px; overflow-y:auto; border:1px solid var(--border); border-radius:6px; padding:6px;">
        ${list.map(e => `<label style="display:block; padding:6px; cursor:pointer; font-size:13px;">
          <input type="checkbox" data-multi="${e.ticker}" style="margin-right:8px;"/>
          <strong>${e.name}</strong> <span style="color:var(--text-muted)">${e.ticker} · ${e.type || ''}</span>
        </label>`).join('')}
      </div>
      <button id="btn-multi-add" class="btn-primary" style="margin-top:8px;">선택 추가</button>
    `;
    extraLookupPanel.querySelector('#btn-multi-add')?.addEventListener('click', async () => {
      const checks = extraLookupPanel.querySelectorAll('input[data-multi]:checked');
      if (!checks.length) { showToast('선택된 종목이 없습니다', { type: 'info' }); return; }
      let added = 0;
      const { addExtra } = await import('../data/extras-store.js');
      for (const c of checks) {
        const t = c.dataset.multi;
        const found = await lookupExternal(t);
        if (found?.sym) {
          addExtra(found.sym);
          registerExtraSymbol(found.sym);
          added++;
        }
      }
      showToast(`${added}개 종목 추가됨`, { type: 'success' });
      extraLookupPanel.innerHTML = `<p style="color:var(--text-muted); font-size:13px;">${added}개 추가 완료.</p>`;
    });
  });

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
