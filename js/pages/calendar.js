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
        ${dayEvents.slice(0, 3).map(e => {
          const idx = all.indexOf(e);
          const cls = e.category === 'common' ? 'common' : 'company';
          return `<div class="cal-event-chip ${cls}" data-event-idx="${idx}" title="${e.title}">
            <span aria-hidden="true">${e.icon || '•'}</span><span>${e.title}</span>
          </div>`;
        }).join('')}
        ${dayEvents.length > 3 ? `<div style="font-size:10px; color:var(--text-muted); margin-top:2px;">+${dayEvents.length - 3}</div>` : ''}
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

  drawGrid();
}
