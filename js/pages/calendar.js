import { getCalendar } from '../data/adapter.js';
import { getWatchlist } from '../data/watchlist.js';
import { fmtDate } from '../utils/format.js';

export function renderReasonBanner(reason, dataLen) {
  if (reason === 'no-key') {
    return `<div class="cal-empty-banner">
      <strong>현재 프록시 URL이 설정되지 않았습니다.</strong>
      <p>도움말 → 데이터 소스 설정에서 Worker URL을 확인하거나, 운영자에게 문의하세요.</p>
      <button class="btn-primary" data-go-help="1">도움말로 가기</button>
    </div>`;
  }
  if (reason === 'no-us-watch') {
    return `<div class="cal-empty-banner">
      <strong>관심 종목에 미국 종목이 없습니다.</strong>
      <p>미국 주식·ETF를 관심 등록하면 해당 종목의 실적·배당 일정이 여기에 표시됩니다.</p>
    </div>`;
  }
  if (reason === 'kr-not-supported') {
    return `<div class="cal-empty-banner">
      <strong>한국 종목의 일정은 본 앱 구조 제약(서버/프록시 없음)으로 아직 지원하지 않습니다.</strong>
      <p>후속 단계에서 별도 어댑터로 다룰 예정입니다.</p>
    </div>`;
  }
  if (reason === 'fetch-failed') {
    return `<div class="cal-empty-banner warn">
      <strong>Finnhub 호출이 실패했습니다.</strong>
      <p>키가 유효한지, 네트워크가 정상인지 확인 후 다시 시도하세요. 거짓 데이터를 채워 넣지 않습니다.</p>
    </div>`;
  }
  if (!dataLen) {
    return `<div class="cal-empty-banner"><strong>현재 표시할 일정이 없습니다.</strong></div>`;
  }
  return '';
}

let region = 'all';
let onlyWatch = false;
let cursor = new Date();
cursor.setDate(1);

export async function renderCalendar(container) {
  const calRes = await getCalendar();
  const all = calRes.data;
  const watch = getWatchlist();
  const reasonBanner = renderReasonBanner(calRes.reason, all.length);
  const sourceLine = `<div style="font-size:11px; color:var(--text-muted); margin-top:6px;">출처: ${calRes.source} · 기준일: ${calRes.asOf}</div>`;

  let upcomingFilter = 'all';   // 모달 카테고리 필터 상태

  container.innerHTML = `
    <div class="panel">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:12px;">
        <div style="display:flex; gap:8px; align-items:center;">
          <button class="btn-secondary" id="cal-prev" aria-label="이전 달">‹</button>
          <strong id="cal-title" style="font-size:16px;">${cursor.getFullYear()}년 ${cursor.getMonth() + 1}월</strong>
          <button class="btn-secondary" id="cal-next" aria-label="다음 달">›</button>
        </div>
        <div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
          <div class="market-toggle" role="radiogroup" aria-label="지역 필터">
            <label><input type="radio" name="cal-region" value="all" ${region==='all'?'checked':''}/><span>전체</span></label>
            <label><input type="radio" name="cal-region" value="kr" ${region==='kr'?'checked':''}/><span>국내</span></label>
            <label><input type="radio" name="cal-region" value="us" ${region==='us'?'checked':''}/><span>해외</span></label>
          </div>
          <label class="cal-checkbox-label">
            <input type="checkbox" id="only-watch" ${onlyWatch?'checked':''}/>
            <span>관심 종목만</span>
          </label>
          <button id="open-upcoming" class="upcoming-chip" style="background:var(--primary-soft); border:1px solid var(--accent-line); padding:6px 12px; border-radius:6px; cursor:pointer; font-size:12px; color:var(--primary); display:inline-flex; align-items:center; gap:6px;">
            <span>📋 다가오는 일정</span>
            <span id="upcoming-chip-summary" style="font-weight:500;">…</span>
          </button>
        </div>
      </div>

      <div class="event-legend" style="margin-bottom:10px;">
        <span><span class="swatch" style="background:var(--event-common-soft); border:1px solid #c8d8e8;"></span>공통 일정 (매크로)</span>
        <span><span class="swatch" style="background:var(--event-company-soft); border:1px solid #d8c0e3;"></span>기업 일정</span>
      </div>

      ${reasonBanner}
      <div id="cal-grid"></div>
      <p style="font-size:12px; color:var(--text-muted); margin-top:10px;">
        💡 날짜의 빈 공간을 누르면 그 날의 일정 목록이, 일정 칩을 누르면 해당 일정의 상세 정보가 열립니다.
      </p>
      ${sourceLine}
    </div>

    <dialog id="event-dialog" style="border:none; border-radius:8px; padding:0; max-width:520px; width:90vw;">
      <div style="padding:20px;">
        <div id="dialog-content"></div>
        <div style="text-align:right; margin-top:16px;">
          <button class="btn-primary" id="close-dialog">닫기</button>
        </div>
      </div>
    </dialog>

    <dialog id="upcoming-dialog" style="border:none; border-radius:10px; padding:0; max-width:720px; width:92vw;">
      <div style="padding:14px 20px; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center;">
        <strong style="font-size:16px;">다가오는 일정 (1~3개월)</strong>
        <button id="close-upcoming" style="background:none; border:none; font-size:20px; cursor:pointer; color:var(--text-muted);">✕</button>
      </div>
      <div style="padding:12px 20px; display:flex; gap:6px; flex-wrap:wrap; border-bottom:1px solid var(--border); background:var(--bg-subtle);">
        <button class="upcoming-filter" data-filter="all">전체</button>
        <button class="upcoming-filter" data-filter="macro">매크로</button>
        <button class="upcoming-filter" data-filter="company">실적·배당</button>
        <button class="upcoming-filter" data-filter="watch">관심 종목</button>
      </div>
      <div id="upcoming-dialog-body" style="padding:14px 20px; max-height:60vh; overflow-y:auto;"></div>
    </dialog>`;

  function filtered() {
    return all.filter(e => {
      if (region !== 'all' && e.market !== region) return false;
      if (onlyWatch && (!e.ticker || !watch.includes(e.ticker))) return false;
      return true;
    });
  }

  function drawGrid() {
    const grid = container.querySelector('#cal-grid');
    const y = cursor.getFullYear(), m = cursor.getMonth();
    const first = new Date(y, m, 1).getDay();
    const days = new Date(y, m + 1, 0).getDate();
    const today = new Date().toISOString().slice(0, 10);
    const events = filtered();

    let html = `<div style="display:grid; grid-template-columns:repeat(7,1fr); gap:1px; background:var(--border);">`;
    ['일','월','화','수','목','금','토'].forEach(d => {
      html += `<div style="background:var(--bg-subtle); padding:8px; text-align:center; font-weight:600; font-size:12px;">${d}</div>`;
    });
    for (let i = 0; i < first; i++) html += `<div style="background:var(--surface); min-height:80px;"></div>`;
    for (let d = 1; d <= days; d++) {
      const iso = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const dayEvents = events.filter(e => e.date === iso);
      const isToday = iso === today;
      const hasEvents = dayEvents.length > 0;
      html += `<div class="cal-day-cell ${isToday ? 'today' : ''}">
        <button type="button" class="cal-day-number ${isToday ? 'today' : ''}" data-date="${iso}"
          title="${hasEvents ? `${dayEvents.length}건 일정 보기` : '해당 날짜에 등록된 일정이 없습니다'}"
          aria-label="${y}년 ${m+1}월 ${d}일 일정 보기">${d}</button>
        ${(() => {
          // 우선순위 정렬: 매크로 → 관심 종목 → 그 외. 셀당 최대 5건.
          const watchSet = new Set(watch);
          const score = e => (e.category === 'macro' ? 0 : (e.ticker && watchSet.has(e.ticker) ? 1 : 2));
          const sorted = [...dayEvents].sort((a, b) => score(a) - score(b));
          const MAX_PER_DAY = 5;
          const visible = sorted.slice(0, MAX_PER_DAY);
          const overflow = sorted.length - visible.length;
          const chips = visible.map(e => {
            const idx = all.indexOf(e);
            // 매크로·공통은 'common'(강조 색), 기업 일정은 'company'.
            const cls = e.category === 'company' ? 'company' : 'common';
            return `<div class="cal-event-chip ${cls}" data-event-idx="${idx}" title="${e.title}">
              <span aria-hidden="true">${e.icon || '•'}</span><span>${e.title}</span>
            </div>`;
          }).join('');
          const more = overflow > 0
            ? `<div class="cal-day-more" data-date="${iso}" style="font-size:11px; color:var(--text-muted); padding:2px 6px; text-align:center; cursor:pointer;">+ ${overflow} 더보기</div>`
            : '';
          return chips + more;
        })()}
      </div>`;
    }
    html += `</div>`;
    grid.innerHTML = html;

    // 날짜 숫자 클릭 → 일정 리스트
    grid.querySelectorAll('.cal-day-number').forEach(btn => {
      btn.addEventListener('click', () => {
        const date = btn.dataset.date;
        const list = events.filter(e => e.date === date);
        if (!list.length) return;
        showDateList(date, list);
      });
    });

    // 일정 칩 클릭 → 상세 (stopPropagation)
    grid.querySelectorAll('.cal-event-chip').forEach(chip => {
      chip.addEventListener('click', e => {
        e.stopPropagation();
        const idx = Number(chip.dataset.eventIdx);
        showEventDetail(all[idx]);
      });
    });

    // "+ N 더보기" 클릭 → 그날 일정 다이얼로그 (기존 흐름 재사용)
    grid.querySelectorAll('.cal-day-more').forEach(more => {
      more.addEventListener('click', e => {
        e.stopPropagation();
        const date = more.dataset.date;
        const list = events.filter(ev => ev.date === date);
        if (list.length) showDateList(date, list);
      });
    });

    updateUpcomingChip();
  }

  function updateUpcomingChip() {
    const today = new Date(); today.setHours(0,0,0,0);
    const upcoming = filtered()
      .filter(e => new Date(e.date) >= today)
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    const total = upcoming.length;
    const nearest = upcoming[0];
    const summary = container.querySelector('#upcoming-chip-summary');
    if (!summary) return;
    if (!total) {
      summary.textContent = '없음';
      return;
    }
    const day = Math.floor((new Date(nearest.date) - today) / 86400e3);
    const nearestLabel = nearest.ticker
      ? `${nearest.tickerName || nearest.ticker} ${nearest.label}`
      : nearest.label;
    const short = nearestLabel.length > 18 ? nearestLabel.slice(0, 18) + '…' : nearestLabel;
    summary.textContent = `${total}건 · ${short} D-${day}`;
  }

  function drawUpcomingGroups() {
    const body = container.querySelector('#upcoming-dialog-body');
    if (!body) return;
    const watchSet = new Set(watch);
    const today = new Date(); today.setHours(0,0,0,0);
    const upcoming = filtered()
      .filter(e => new Date(e.date) >= today)
      .filter(e => {
        if (upcomingFilter === 'macro') return e.category === 'macro';
        if (upcomingFilter === 'company') return e.category !== 'macro';
        if (upcomingFilter === 'watch') return e.ticker && watchSet.has(e.ticker);
        return true;
      })
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    const buckets = [
      { label: '이번 주',   days: [0, 7],   key: 'wk' },
      { label: '2주 내',    days: [8, 14],  key: 'm1' },
      { label: '1개월 내',  days: [15, 30], key: 'm2' },
      { label: '2~3개월',   days: [31, 90], key: 'm3' },
    ];
    const day = e => Math.floor((new Date(e.date) - today) / 86400e3);

    body.innerHTML = buckets.map(b => {
      const items = upcoming.filter(e => {
        const d = day(e);
        return d >= b.days[0] && d <= b.days[1];
      });
      if (!items.length) return '';
      const rows = items.slice(0, 8).map(e => {
        const d = day(e);
        const isWatch = e.ticker && watchSet.has(e.ticker);
        const bg = e.category === 'macro' ? '#FAEEDA' : isWatch ? '#E1F5EE' : '#EEEDFE';
        const border = e.category === 'macro' ? '#BA7517' : isWatch ? '#0F6E56' : '#534AB7';
        const txt = e.category === 'macro' ? '#633806' : isWatch ? '#04342C' : '#26215C';
        const labelLeft = e.ticker
          ? `<strong>${e.tickerName || e.ticker}</strong> ${e.label}`
          : `<strong>${e.label}</strong>`;
        return `
          <div style="padding:7px 10px; background:${bg}; border-left:3px solid ${border}; border-radius:6px; display:flex; justify-content:space-between; align-items:center; gap:8px;">
            <span style="font-size:13px; color:${txt};">${labelLeft}</span>
            <span style="font-size:11px; color:${border}; font-weight:500; white-space:nowrap;">D-${d} · ${e.date.slice(5)}</span>
          </div>
        `;
      }).join('');
      const more = items.length > 8
        ? `<div style="padding:6px 10px; font-size:11px; color:var(--text-muted); text-align:center;">+ ${items.length - 8} 더보기 (월간 그리드 참조)</div>`
        : '';
      return `
        <div style="display:grid; grid-template-columns:80px 1fr; gap:14px; margin-bottom:10px;">
          <div style="text-align:center; padding-top:4px;">
            <div style="font-size:11px; color:var(--text-muted); font-weight:500;">D-${b.days[0]}~${b.days[1]}</div>
            <div style="font-size:13px; font-weight:500; margin-top:2px;">${b.label}</div>
          </div>
          <div style="display:flex; flex-direction:column; gap:5px;">${rows}${more}</div>
        </div>
      `;
    }).filter(Boolean).join('') || `<div style="font-size:13px; color:var(--text-muted); padding:12px; text-align:center;">다가오는 일정이 없습니다.</div>`;
  }

  function showDateList(date, list) {
    const html = `
      <h3 style="margin-bottom:12px;">${fmtDate(date)} 일정 (${list.length})</h3>
      ${list.map((e, i) => {
        const cls = e.category === 'common' ? 'common' : 'company';
        const globalIdx = all.indexOf(e);
        return `<div class="cal-event-chip ${cls}" data-detail-idx="${globalIdx}" style="margin-bottom:6px; padding:8px 10px; font-size:13px; white-space:normal;">
          <span aria-hidden="true">${e.icon || '•'}</span>
          <div style="flex:1;">
            <strong>${e.title}</strong>
            <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">${e.category === 'common' ? '공통' : '기업'} · ${e.market === 'kr' ? '국내' : '해외'}</div>
          </div>
        </div>`;
      }).join('')}
      <p style="font-size:12px; color:var(--text-muted); margin-top:8px;">항목을 클릭하면 상세 정보가 표시됩니다.</p>`;
    showDialog(html);
    // 리스트 항목 클릭 → 상세
    container.querySelectorAll('[data-detail-idx]').forEach(el => {
      el.addEventListener('click', () => {
        showEventDetail(all[Number(el.dataset.detailIdx)]);
      });
    });
  }

  function showEventDetail(e) {
    const isCompany = e.category === 'company';
    const accent = isCompany ? 'var(--event-company)' : 'var(--event-common)';
    const html = `
      <div style="border-left:4px solid ${accent}; padding-left:12px;">
        <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px;">
          ${isCompany ? '기업 일정' : '공통 일정 (매크로)'}
        </div>
        <h3 style="margin:4px 0 8px;">${e.icon || ''} ${e.title}</h3>
        <table style="font-size:13px;">
          <tbody>
            <tr><td style="color:var(--text-muted); width:90px;">날짜</td><td><strong>${fmtDate(e.date)}</strong></td></tr>
            <tr><td style="color:var(--text-muted);">유형</td><td>${e.label}</td></tr>
            ${e.ticker ? `<tr><td style="color:var(--text-muted);">종목</td><td><strong>${e.tickerName || e.ticker}</strong> (${e.ticker})</td></tr>` : ''}
            <tr><td style="color:var(--text-muted);">지역</td><td>${e.market === 'kr' ? '국내' : '해외'}</td></tr>
            <tr><td style="color:var(--text-muted);">출처</td><td>${e.source || '—'}</td></tr>
          </tbody>
        </table>
        ${e.what ? `<div style="margin-top:12px; padding:10px 12px; background:var(--primary-soft); border-radius:6px;">
          <div style="font-weight:600; margin-bottom:4px;">💡 이게 무슨 이벤트인가요?</div>
          <div style="font-size:13px;">${e.what}</div>
        </div>` : ''}
        <div style="margin-top:8px; padding:10px 12px; background:var(--bg-subtle); border-radius:6px;">
          <div style="font-weight:600; margin-bottom:4px;">📌 주가에 어떤 영향을 줄 수 있나요?</div>
          <div style="font-size:13px;">${e.impact}</div>
        </div>
        <p style="font-size:11px; color:var(--text-muted); margin-top:10px;">
          ⚠ 일반적인 시장 메커니즘에 근거한 방향성 예시이며, 실제 결과는 시장 상황·기대치에 따라 달라질 수 있습니다.
        </p>
      </div>`;
    showDialog(html);
  }

  function showDialog(content) {
    container.querySelector('#dialog-content').innerHTML = content;
    const dlg = container.querySelector('#event-dialog');
    if (!dlg.open) dlg.showModal();
  }

  container.querySelector('#close-dialog').addEventListener('click', () => {
    container.querySelector('#event-dialog').close();
  });
  container.querySelector('#cal-prev').addEventListener('click', () => {
    cursor.setMonth(cursor.getMonth() - 1);
    container.querySelector('#cal-title').textContent = `${cursor.getFullYear()}년 ${cursor.getMonth() + 1}월`;
    drawGrid();
  });
  container.querySelector('#cal-next').addEventListener('click', () => {
    cursor.setMonth(cursor.getMonth() + 1);
    container.querySelector('#cal-title').textContent = `${cursor.getFullYear()}년 ${cursor.getMonth() + 1}월`;
    drawGrid();
  });
  container.querySelectorAll('input[name="cal-region"]').forEach(r => {
    r.addEventListener('change', () => { region = r.value; drawGrid(); });
  });
  container.querySelector('#only-watch').addEventListener('change', e => {
    onlyWatch = e.target.checked; drawGrid();
  });

  container.querySelector('[data-go-help]')?.addEventListener('click', () => {
    location.hash = '#/help';
  });

  // 다가오는 일정 모달 — 필터 버튼 인라인 스타일 칠하기(.upcoming-filter CSS 미정의).
  function paintUpcomingFilters() {
    container.querySelectorAll('.upcoming-filter').forEach(btn => {
      const active = btn.dataset.filter === upcomingFilter;
      btn.style.cssText = `padding:5px 12px; font-size:12px; border-radius:6px; cursor:pointer; border:1px solid ${active ? 'var(--primary)' : 'var(--border)'}; background:${active ? 'var(--primary)' : 'var(--surface)'}; color:${active ? '#fff' : 'var(--text)'};`;
    });
  }
  paintUpcomingFilters();

  container.querySelector('#open-upcoming')?.addEventListener('click', () => {
    drawUpcomingGroups();   // 모달 열리기 전 본문 채움
    container.querySelector('#upcoming-dialog')?.showModal();
  });
  container.querySelector('#close-upcoming')?.addEventListener('click', () => {
    container.querySelector('#upcoming-dialog')?.close();
  });
  container.querySelectorAll('.upcoming-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      upcomingFilter = btn.dataset.filter;
      paintUpcomingFilters();
      drawUpcomingGroups();
    });
  });

  drawGrid();
}
