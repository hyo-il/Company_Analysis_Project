import { getProfile, getFinancials, getQuoteEOD, getNews, getCalendar, isConsensusAvailable, getHistoricalMetrics, getValuationHistory, getEtfsContaining } from '../data/adapter.js';
import { getPeers, getSymbol } from '../data/symbols.js';
import { toggleWatch, isWatched } from '../data/watchlist.js';
import { METRIC_CATEGORIES, SECTOR_PRIORITY } from '../data/metrics-meta.js';
import { fmtNum, fmtPct, fmtMoney, fmtChange, fmtInt, fmtDate } from '../utils/format.js';
import { metaBadge, infoTip, warnIcon, loadingState, errorState, emptyState } from '../components/common.js';
import { showToast } from '../components/toast.js';
import { computeFactorScores } from '../utils/scoring.js';
import { sparkline, bandChart, trendChart, destroyChartsIn } from '../components/charts.js';

export async function renderAnalysis(container, { ticker } = {}) {
  if (!ticker) {
    container.innerHTML = `<div class="panel">${emptyState('상단 검색창에서 종목을 검색·선택해 주세요.')}</div>`;
    return;
  }
  destroyChartsIn(container);
  container.innerHTML = loadingState();

  try {
    const sym0 = getSymbol(ticker);
    const isEtf = sym0?.type === 'etf';
    const [profile, quote, fin, news, cal, hist, valHist, etfRev] = await Promise.all([
      getProfile(ticker),
      getQuoteEOD(ticker),
      getFinancials(ticker),
      getNews(ticker),
      getCalendar(ticker),
      getHistoricalMetrics(ticker),
      getValuationHistory(ticker),
      isEtf ? Promise.resolve({ data: [] }) : getEtfsContaining(ticker),
    ]);

    const sym = sym0;
    const priority = SECTOR_PRIORITY[profile.data.sector] || [];
    const currency = profile.currency;
    const watched = isWatched(ticker);

    container.innerHTML = `
      <div class="panel">
        <div style="display:flex; align-items:flex-start; gap:16px; flex-wrap:wrap;">
          <div style="flex:1; min-width:240px;">
            <div style="display:flex; align-items:center; gap:8px;">
              <h2>${profile.data.nameKr} <span style="color:var(--text-muted); font-weight:400;">${profile.data.nameEn}</span></h2>
              <button class="star-btn ${watched ? 'active' : ''}" id="star-${ticker}" aria-label="관심 종목">${watched ? '★' : '☆'}</button>
            </div>
            <div style="color:var(--text-muted); margin-top:4px;">
              ${profile.data.ticker} · ${profile.data.exchange} · ${profile.data.sector} / ${profile.data.industry}
            </div>
            <p style="margin-top:12px;">${profile.data.description}</p>
            <div style="display:flex; gap:16px; flex-wrap:wrap; margin-top:8px; font-size:13px;">
              <div><span style="color:var(--text-muted)">시가총액</span> <strong>${fmtMoney(profile.data.marketCap, currency)}</strong></div>
              <div><span style="color:var(--text-muted)">상장주식수</span> <strong>${fmtInt(profile.data.sharesOutstanding)}</strong></div>
            </div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:24px; font-weight:700;">${fmtNum(quote.data.price)}</div>
            <div>${fmtChange(quote.data.changePct)}</div>
            <div style="margin-top:6px;">${metaBadge(quote)}</div>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-title">주요 지표 ${metaBadge(fin)}</div>
        <div style="font-size:12px; color:var(--text-muted); margin-bottom:10px;">
          ℹ️ 별도 표기가 없으면 모든 지표는 <strong>TTM(최근 12개월)·연결</strong> 기준입니다. 기준이 다른 항목에는 값 옆에 ${infoTip('이 지표는 표준 기준(TTM·연결)이 아닙니다. 마우스를 올리면 적용 기준이 표시됩니다.')} 표시가 붙습니다.
        </div>
        ${priority.length ? `<div style="background:var(--bg-subtle); border:1px solid var(--accent-line); padding:8px 12px; border-radius:6px; margin-bottom:12px; font-size:13px; color:var(--text);">
          <strong>📌 ${profile.data.sector} 업종 우선 지표:</strong> ${priority.map(k => `<span style="background:var(--surface); padding:2px 8px; border-radius:4px; margin:0 2px;">${labelOf(k)}</span>`).join('')}
        </div>` : ''}
        ${METRIC_CATEGORIES.map(cat => renderCategory(cat, fin.data, currency, priority)).join('')}
      </div>

      <div class="panel">
        <div class="panel-title">주요 지표 추이 ${infoTip('핵심 지표가 좋아지고 있는지 나빠지고 있는지 한눈에 보기 위한 최근 8분기 스파크라인입니다. 무료 시계열 데이터 범위 내에서 표시됩니다.')} ${metaBadge(hist)}</div>
        <div id="trends-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:12px;"></div>
      </div>

      <div class="panel">
        <div class="panel-title">역사적 밸류에이션 밴드 ${infoTip('이 회사 자신의 과거 PER/PBR과 비교해 지금이 비싼/싼 구간인지 보여줍니다. 평균선과 ±1 표준편차 밴드를 함께 표시. 과거가 미래를 보장하지 않습니다.')} ${metaBadge(valHist)}</div>
        <div id="valband-interpretation" style="margin-bottom:8px;"></div>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(320px, 1fr)); gap:16px;">
          <div>
            <div style="font-size:13px; font-weight:600; margin-bottom:4px;">PER 밴드 (${valHist.period})</div>
            <div style="height:200px;"><canvas id="valband-per"></canvas></div>
          </div>
          <div>
            <div style="font-size:13px; font-weight:600; margin-bottom:4px;">PBR 밴드 (${valHist.period})</div>
            <div style="height:200px;"><canvas id="valband-pbr"></canvas></div>
          </div>
        </div>
        <p style="font-size:11px; color:var(--text-muted); margin-top:8px;">⚠ 과거 데이터 기반 참고용 — 미래 수익을 보장하지 않습니다.</p>
      </div>

      <div class="panel">
        <div class="panel-title">AI 기업 분석 ${infoTip('규칙 기반으로 만든 사업 요약과 강점·약점·투자 포인트입니다(유료 LLM 미사용). 출처·기준일이 함께 표기되며 투자 권유가 아닙니다.')}</div>
        ${renderAIBusiness(profile.data, fin.data)}
        ${metaBadge(fin)}
      </div>

      <div class="panel">
        <div class="panel-title">퀀트 종합점수 (팩터 스코어) ${infoTip('같은 업종 안에서 이 회사가 가치·수익성·성장성·안정성에서 몇 등쯤인지 0~100점으로 환산한 참고용 점수입니다. 높을수록 동종업계 대비 펀더멘털이 상대적으로 좋다는 뜻이며, 투자 권유가 아닙니다.')}</div>
        ${renderScores(ticker, fin.data)}
      </div>

      <div class="panel">
        <div class="panel-title">AI 주가요인 (규칙 기반) ${infoTip('최근 주가가 왜 그렇게 움직였는지를 실제 실적·지표에 근거해 쉬운 말로 정리한 설명입니다(예측이 아닙니다). 출처·시점·면책을 함께 표시합니다.')}</div>
        ${renderAIFactors(profile.data, fin.data, quote.data)}
      </div>

      ${isEtf ? '' : `<div class="panel">
        <div class="panel-title">이 종목이 많이 포함된 ETF ${infoTip('무료 데이터로 일부 대표 ETF에서만 확인됩니다. 운용사·SEC 13F 등 공식 자료에서 추가 확인하세요.')}</div>
        ${renderEtfReverse(etfRev.data)}
      </div>`}

      <div class="panel">
        <div class="panel-title">최근 뉴스 ${metaBadge(news)}</div>
        ${news.data.length ? `<ul style="margin:0; padding-left:18px;">
          ${news.data.map(n => `<li>
            <a href="${n.url || '#'}" target="_blank" rel="noopener noreferrer">${n.title}</a>
            <span style="color:var(--text-muted)">— ${n.source}, ${fmtDate(n.date)}</span>
          </li>`).join('')}
        </ul>` : emptyState('뉴스 없음')}
      </div>

      <div class="panel">
        <div class="panel-title">주요 일정</div>
        ${renderSchedule(cal.data, cal.reason)}
      </div>

      <div class="panel">
        <div class="panel-title">리스크 정보 ${infoTip('이 회사가 흔들릴 수 있는 약점(사업 집중도, 환 노출, 소송·규제, 부채 만기 등)을 모아 보여주는 파트입니다. 무료 데이터로 확보 어려운 항목은 (!)로 표시됩니다.')}</div>
        <ul style="margin:0;">
          <li>사업 집중도(매출 상위 고객·제품·지역 의존도) ${warnIcon('무료 데이터로 세부 의존도 확보가 어려워 일부 항목은 표시되지 않습니다.')}</li>
          <li>환 노출(해외 매출 비중) — 추후 연동</li>
          <li>진행 중 소송·규제 플래그 — 추후 연동</li>
        </ul>
        <p style="margin-top:12px; font-size:12px; color:var(--text-muted);">
          ⚠ 본 정보는 참고용이며 투자 권유가 아닙니다. 컨센서스(증권사 추정치) 등 일부 항목은 무료 데이터 한계로 ${warnIcon('컨센서스는 무료 데이터로 확보가 어려워 실적 발표 결과로 대체합니다.')} 로 표시됩니다.
        </p>
      </div>
    `;

    const starBtn = container.querySelector(`#star-${ticker}`);
    starBtn?.addEventListener('click', () => {
      const on = toggleWatch(ticker);
      starBtn.classList.toggle('active', on);
      starBtn.textContent = on ? '★' : '☆';
      const label = `${profile.data.nameKr} (${ticker})`;
      showToast(on ? `${label}을(를) 관심 목록에 등록했습니다.` : `${label}을(를) 관심 목록에서 해제했습니다.`,
        { type: on ? 'success' : 'info' });
    });

    // 추이 미니차트
    renderTrends(container.querySelector('#trends-grid'), hist.data, currency);
    // 역사적 밸류에이션 밴드
    renderValuationBand(container, valHist.data);

    // 지난 일정 토글
    // 역방향 ETF 표 행 클릭 → 해당 ETF로 이동
    container.querySelectorAll('.etf-rev-row').forEach(tr => {
      const go = () => { location.hash = `#/analysis/${tr.dataset.ticker}`; };
      tr.addEventListener('click', go);
      tr.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
      });
    });

    container.querySelector('#toggle-past')?.addEventListener('click', e => {
      const past = container.querySelector('#past-events');
      const open = past.hasAttribute('hidden') ? false : true;
      if (open) { past.setAttribute('hidden', ''); e.target.textContent = '지난 일정 보기'; }
      else { past.removeAttribute('hidden'); e.target.textContent = '지난 일정 숨기기'; }
    });
  } catch (e) {
    console.error(e);
    container.innerHTML = errorState('데이터 로드 실패: ' + e.message);
  }
}

function renderTrends(grid, h, currency) {
  if (!grid) return;
  const headerMoney = v => fmtMoney(v, currency);
  // 차트 라벨용 축약 포맷 (1자리 소수 또는 정수)
  const chartMoney = v => {
    if (v == null || isNaN(v)) return '—';
    if (currency === 'KRW') {
      if (Math.abs(v) >= 1e12) return `${(v / 1e12).toFixed(1)}조`;
      if (Math.abs(v) >= 1e8) return `${Math.round(v / 1e8)}억`;
      return fmtInt(v);
    }
    if (Math.abs(v) >= 1e9) return `$${Math.round(v / 1e9)}B`;
    if (Math.abs(v) >= 1e6) return `$${Math.round(v / 1e6)}M`;
    return `$${fmtInt(v)}`;
  };
  const chartPct = v => (v == null || isNaN(v)) ? '—' : `${Number(v).toFixed(1)}%`;
  const chartInt = v => fmtInt(v);
  const items = [
    { key: 'revenue', label: '매출', fmt: headerMoney, chartFmt: chartMoney },
    { key: 'operatingIncome', label: '영업이익', fmt: headerMoney, chartFmt: chartMoney },
    { key: 'netIncome', label: '순이익', fmt: headerMoney, chartFmt: chartMoney },
    { key: 'eps', label: 'EPS', fmt: v => fmtNum(v, 0), chartFmt: chartInt },
    { key: 'ocf', label: 'OCF', fmt: headerMoney, chartFmt: chartMoney },
    { key: 'fcf', label: 'FCF', fmt: headerMoney, chartFmt: chartMoney },
    { key: 'roe', label: 'ROE', fmt: v => fmtPct(v), chartFmt: chartPct },
    { key: 'opMargin', label: '영업이익률', fmt: v => fmtPct(v), chartFmt: chartPct },
  ];
  grid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(260px, 1fr))';
  grid.innerHTML = items.map(it => {
    const series = h[it.key] || [];
    const last = series[series.length - 1];
    const first = series[0];
    const delta = first ? ((last - first) / Math.abs(first)) * 100 : 0;
    const dirCls = delta > 0 ? 'up' : delta < 0 ? 'down' : '';
    const sign = delta > 0 ? '▲' : delta < 0 ? '▼' : '–';
    return `<div style="border:1px solid var(--border); border-radius:6px; padding:10px;">
      <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px; color:var(--text-muted);">
        <span>${it.label}</span>
        <span class="${dirCls}" style="font-size:11px;">${sign} ${Math.abs(delta).toFixed(1)}%</span>
      </div>
      <div style="font-size:15px; font-weight:600; margin:2px 0;">${last == null ? '—' : it.fmt(last)}</div>
      <div style="height:110px;"><canvas id="trend-${it.key}"></canvas></div>
      <div style="font-size:10px; color:var(--text-muted); margin-top:2px;">최근 ${series.length}분기 추이</div>
    </div>`;
  }).join('');
  items.forEach(it => {
    const cv = grid.querySelector(`#trend-${it.key}`);
    if (cv && h[it.key]) trendChart(cv, h[it.key], h.labels, it.chartFmt);
  });
}

function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function stddev(arr) {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}
function interpretBand(current, series) {
  const m = mean(series), sd = stddev(series);
  const z = (current - m) / (sd || 1);
  if (z < -0.8) return { text: '저평가 구간 (과거 평균 대비 하단부)', cls: 'up' };
  if (z > 0.8) return { text: '고평가 구간 (과거 평균 대비 상단부)', cls: 'down' };
  return { text: '적정 구간 (과거 평균 부근)', cls: '' };
}

function renderValuationBand(container, vd) {
  const interp = container.querySelector('#valband-interpretation');
  const perInterp = interpretBand(vd.currentPer, vd.per);
  const pbrInterp = interpretBand(vd.currentPbr, vd.pbr);
  if (interp) {
    interp.innerHTML = `
      <div style="display:flex; gap:12px; flex-wrap:wrap; font-size:13px;">
        <div style="flex:1; min-width:240px; background:var(--bg-subtle); padding:8px 12px; border-radius:6px;">
          <div style="font-size:12px; color:var(--text-muted);">PER 현재 ${fmtNum(vd.currentPer, 1)} 배</div>
          <div class="${perInterp.cls}" style="font-weight:600;">${perInterp.text}</div>
        </div>
        <div style="flex:1; min-width:240px; background:var(--bg-subtle); padding:8px 12px; border-radius:6px;">
          <div style="font-size:12px; color:var(--text-muted);">PBR 현재 ${fmtNum(vd.currentPbr, 2)} 배</div>
          <div class="${pbrInterp.cls}" style="font-weight:600;">${pbrInterp.text}</div>
        </div>
      </div>`;
  }
  const renderOne = (canvasId, series, current, title) => {
    const cv = container.querySelector(canvasId);
    if (!cv) return;
    const m = mean(series), sd = stddev(series);
    const meanLine = series.map(() => m);
    const upper = series.map(() => m + sd);
    const lower = series.map(() => m - sd);
    bandChart(cv, { labels: vd.labels, values: series, meanLine, upperBand: upper, lowerBand: lower, title });
  };
  renderOne('#valband-per', vd.per, vd.currentPer, 'PER');
  renderOne('#valband-pbr', vd.pbr, vd.currentPbr, 'PBR');
}

function renderEtfReverse(rows) {
  if (!rows || !rows.length) {
    return `<p style="color:var(--text-muted); font-size:13px; margin:0;">
      현재 보유한 holdings 데이터로 이 종목이 잡힌 ETF가 없습니다. ${warnIcon('무료 데이터 한계로 일부 대표 ETF만 역인덱싱됩니다.')}
    </p>`;
  }
  const trs = rows.map(r => `<tr class="etf-rev-row" data-ticker="${r.etfTicker}" role="button" tabindex="0" style="cursor:pointer;">
    <td>${r.etfNameKr}</td>
    <td style="color:var(--text-muted); font-family:ui-monospace, SFMono-Regular, monospace; font-size:12px;">${r.etfTicker}</td>
    <td style="color:var(--text-muted); font-size:12px;">${r.market === 'kr' ? '국내' : r.market === 'us' ? '미국' : '—'}</td>
    <td class="num" style="color:var(--primary); ${r.weight >= 5 ? 'font-weight:700;' : ''}">${fmtPct(r.weight, 2)}</td>
  </tr>`).join('');
  return `<table class="metrics-table etf-reverse-table">
    <thead><tr>
      <th style="text-align:left;">ETF</th>
      <th style="text-align:left;">티커</th>
      <th style="text-align:left;">시장</th>
      <th class="num">이 종목 비중</th>
    </tr></thead>
    <tbody>${trs}</tbody>
  </table>
  <p style="font-size:11px; color:var(--text-muted); margin-top:6px;">행을 클릭하면 해당 ETF의 상세 화면으로 이동합니다.</p>`;
}

function renderScheduleReason(reason) {
  const map = {
    'no-key': '<strong>Finnhub API 키가 설정되지 않았습니다.</strong><p>도움말 &gt; 데이터 소스 설정에서 무료 키를 등록하면 미국 종목의 실적·배당 일정이 표시됩니다.</p><button class="btn-primary" onclick="location.hash=\'#/help\'">도움말로 가기</button>',
    'kr-not-supported': '<strong>한국 종목 일정은 아직 지원하지 않습니다.</strong><p>본 앱 구조 제약(서버/프록시 없음)으로, 후속 단계에서 별도 어댑터로 다룰 예정입니다.</p>',
    'fetch-failed': '<strong>Finnhub 호출이 실패했습니다.</strong><p>키가 유효한지·네트워크가 정상인지 확인 후 다시 시도하세요. 거짓 데이터를 채워 넣지 않습니다.</p>',
    'no-us-watch': '<strong>관심 종목에 미국 종목이 없습니다.</strong><p>미국 주식·ETF를 관심 등록하면 해당 종목의 실적·배당 일정이 표시됩니다.</p>',
  };
  const cls = reason === 'fetch-failed' ? 'cal-empty-banner warn' : 'cal-empty-banner';
  return map[reason] ? `<div class="${cls}">${map[reason]}</div>` : '';
}

function renderSchedule(events, reason) {
  if (!events.length) {
    const banner = renderScheduleReason(reason);
    return banner || emptyState('등록된 일정이 없습니다.');
  }
  const todayIso = new Date().toISOString().slice(0, 10);
  const upcoming = events.filter(e => e.date >= todayIso).sort((a, b) => a.date.localeCompare(b.date));
  const past = events.filter(e => e.date < todayIso).sort((a, b) => b.date.localeCompare(a.date));
  const row = e => `<tr>
    <td style="white-space:nowrap;">${fmtDate(e.date)}</td>
    <td>${e.icon || ''} ${e.title}</td>
    <td style="color:var(--text-muted)">${e.impact}</td>
  </tr>`;
  return `
    <h4 style="margin:8px 0; font-size:13px; color:var(--text-muted);">다가오는 일정 (${upcoming.length})</h4>
    ${upcoming.length ? `<table>
      <thead><tr><th style="width:110px;">날짜</th><th>이벤트</th><th>주가 영향 예시</th></tr></thead>
      <tbody>${upcoming.map(row).join('')}</tbody>
    </table>` : '<div style="color:var(--text-muted); font-size:13px;">앞으로 예정된 일정이 없습니다.</div>'}
    ${past.length ? `
      <div style="margin-top:14px;">
        <button class="btn-secondary" id="toggle-past">지난 일정 보기</button>
      </div>
      <div id="past-events" hidden style="margin-top:10px;">
        <h4 style="margin:8px 0; font-size:13px; color:var(--text-muted);">지난 일정 (${past.length})</h4>
        <table>
          <thead><tr><th style="width:110px;">날짜</th><th>이벤트</th><th>주가 영향 예시</th></tr></thead>
          <tbody>${past.map(row).join('')}</tbody>
        </table>
      </div>
    ` : ''}`;
}

function labelOf(key) {
  for (const cat of METRIC_CATEGORIES) {
    const m = cat.metrics.find(x => x.key === key);
    if (m) return m.label;
  }
  return key;
}

function fmtVal(val, unit, currency) {
  if (val == null) return '—';
  if (unit === 'flag') return val ? '✅ 진행' : '해당 없음';
  if (unit === '%') {
    if (val === 0) return '0%';
    return fmtPct(val);
  }
  if (unit === '배') return fmtNum(val, 2) + '배';
  if (unit === 'money') return fmtMoney(val, currency);
  if (unit === 'price') return fmtNum(val, 0);
  return fmtNum(val);
}

const DEFAULT_BASIS = 'TTM·연결';

function metricCell(m, data, currency, priority) {
  if (!m) return '<td></td><td></td>';
  const hi = priority.includes(m.key) ? 'background:var(--primary-soft);' : '';
  const basisDiffers = m.basis !== DEFAULT_BASIS;
  const basisMark = basisDiffers ? ` <span data-tooltip="기준: ${m.basis}" style="font-size:10px; color:var(--text-muted); border:1px solid var(--border); border-radius:3px; padding:0 4px; vertical-align:middle; cursor:help;">기준</span>` : '';
  return `<td style="${hi}">${m.label} ${infoTip(m.tip)}${basisMark}</td>
    <td class="num" style="${hi}"><strong>${fmtVal(data[m.key], m.unit, currency)}</strong></td>`;
}

function renderCategory(cat, data, currency, priority) {
  // 2개씩 묶어 한 행 = 4열(지표/값/지표/값)
  const rows = [];
  for (let i = 0; i < cat.metrics.length; i += 2) {
    rows.push([cat.metrics[i], cat.metrics[i + 1]]);
  }
  return `
    <div class="metrics-cat" style="margin-bottom:16px;">
      <h3 style="margin-bottom:8px; color:var(--primary);">${cat.title}</h3>
      <table class="metrics-table">
        <colgroup>
          <col style="width:30%"><col style="width:20%"><col style="width:30%"><col style="width:20%">
        </colgroup>
        <tbody>
          ${rows.map(([a, b]) => `<tr>
            ${metricCell(a, data, currency, priority)}
            ${metricCell(b, data, currency, priority)}
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function renderAIBusiness(profile, fin) {
  // 사업 쉬운 요약
  const summary = `${profile.nameKr}(${profile.ticker})는 ${profile.exchange}에 상장된 <strong>${profile.industry}</strong> 분야 ${profile.type === 'etf' ? 'ETF' : '기업'}입니다. ${profile.description}`;
  const scores = computeFactorScores(fin);
  // 강점·약점 도출
  const factorEntries = ['가치','수익성','성장성','안정성'].map(k => [k, scores[k]]);
  const sorted = [...factorEntries].sort((a, b) => b[1] - a[1]);
  const strengths = sorted.filter(([,v]) => v >= 60).map(([k]) => k);
  const weaknesses = sorted.filter(([,v]) => v < 40).map(([k]) => k);

  const evidenceLines = [];
  if (scores['수익성'] >= 60) evidenceLines.push(`수익성: ROE ${Number(fin.roe).toFixed(1)}%, 영업이익률 ${Number(fin.opMargin).toFixed(1)}%로 양호`);
  if (scores['성장성'] >= 60) evidenceLines.push(`성장성: 매출 YoY ${Number(fin.revenueGrowthYoY).toFixed(1)}%로 견조`);
  if (scores['가치'] >= 60) evidenceLines.push(`가치: PER ${Number(fin.per).toFixed(1)}배, PBR ${Number(fin.pbr).toFixed(1)}배로 저평가 영역`);
  if (scores['안정성'] < 40) evidenceLines.push(`안정성 부담: 부채비율 ${Number(fin.debtRatio).toFixed(0)}%`);
  if (scores['수익성'] < 40) evidenceLines.push(`수익성 부진: ROE ${Number(fin.roe).toFixed(1)}%`);

  const points = [];
  if (strengths.includes('성장성') && strengths.includes('수익성')) points.push('성장과 수익성을 동시에 갖춘 구조 — 프리미엄 밸류에이션이 정당화될 수 있음');
  if (strengths.includes('가치') && !weaknesses.includes('수익성')) points.push('밸류에이션이 저평가 영역이면서 수익성이 받쳐주는 형태 — 가치투자 관점 매력');
  if (weaknesses.includes('성장성') && weaknesses.includes('가치')) points.push('성장 둔화와 고밸류가 겹친 구간 — 보수적 접근');
  if (weaknesses.includes('안정성')) points.push('재무 안정성 점검 필요 — 부채 만기·이자보상 배율 확인');
  if (!points.length) points.push('극단치 없이 평이한 구간 — 업종/이벤트 모멘텀과 함께 살펴볼 것');

  return `
    <h4 style="margin:0 0 6px; font-size:13px; color:var(--primary);">📖 사업 쉬운 요약</h4>
    <p style="margin:0 0 12px;">${summary}</p>

    <h4 style="margin:0 0 6px; font-size:13px; color:var(--primary);">💪 강점·약점</h4>
    <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:8px;">
      <div style="flex:1; min-width:180px; background:#f0faf0; border:1px solid #cfe8cf; border-radius:6px; padding:10px;">
        <div style="font-size:12px; color:#2f7a2f; font-weight:600;">강점</div>
        ${strengths.length ? `<ul style="margin:4px 0 0; padding-left:18px;">${strengths.map(s => `<li>${s} (점수 ${scores[s]})</li>`).join('')}</ul>` : '<div style="color:var(--text-muted); font-size:13px; margin-top:4px;">두드러진 강점 없음</div>'}
      </div>
      <div style="flex:1; min-width:180px; background:#fff5f5; border:1px solid #f2c8c8; border-radius:6px; padding:10px;">
        <div style="font-size:12px; color:#a33; font-weight:600;">약점</div>
        ${weaknesses.length ? `<ul style="margin:4px 0 0; padding-left:18px;">${weaknesses.map(s => `<li>${s} (점수 ${scores[s]})</li>`).join('')}</ul>` : '<div style="color:var(--text-muted); font-size:13px; margin-top:4px;">큰 약점 없음</div>'}
      </div>
    </div>
    ${evidenceLines.length ? `<div style="font-size:12px; color:var(--text-muted); margin-bottom:8px;">근거: ${evidenceLines.join(' · ')}</div>` : ''}

    <h4 style="margin:8px 0 6px; font-size:13px; color:var(--primary);">🎯 투자 포인트</h4>
    <ul style="margin:0; padding-left:18px;">
      ${points.map(p => `<li>${p}</li>`).join('')}
    </ul>

    <p style="font-size:11px; color:var(--text-muted); margin:10px 0 0;">
      ⚠ 규칙 기반(템플릿) 분석이며 무료 데이터 한계가 있을 수 있습니다. 참고용이며 투자 권유가 아닙니다.
    </p>`;
}

function renderScores(ticker, fin) {
  const peers = getPeers(ticker).slice(0, 8);
  // peer 데이터를 모의로 가져오기 위해 평균값과 비교(여기서는 단순화)
  const scores = computeFactorScores(fin);
  return `
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:12px;">
      ${Object.entries(scores).map(([k, v]) => `
        <div style="border:1px solid var(--border); border-radius:6px; padding:12px; text-align:center;">
          <div style="color:var(--text-muted); font-size:12px;">${k}</div>
          <div style="font-size:22px; font-weight:700; color:var(--primary);">${Math.round(v)}</div>
        </div>
      `).join('')}
    </div>
    <p style="font-size:12px; color:var(--text-muted); margin-top:12px;">
      ⚠ 과거·현재 지표 기반 참고용 점수이며 미래 수익을 보장하지 않습니다.
    </p>`;
}

function renderAIFactors(p, f, q) {
  const lines = [];
  if (f.revenueGrowthYoY > 20) lines.push(`매출이 전년 대비 ${fmtPct(f.revenueGrowthYoY)} 성장하여 성장세가 두드러집니다.`);
  else if (f.revenueGrowthYoY < 0) lines.push(`매출이 전년 대비 ${fmtPct(f.revenueGrowthYoY)}로 역성장 구간입니다.`);
  if (f.opMargin > 20) lines.push(`영업이익률 ${fmtPct(f.opMargin)}로 수익성이 우수합니다.`);
  if (f.per < 12) lines.push(`PER ${fmtNum(f.per)}배로 시장 평균 대비 낮은 편입니다(저평가 가능성, 단 밸류 트랩 주의).`);
  if (f.per > 30) lines.push(`PER ${fmtNum(f.per)}배로 시장 대비 높은 편이며 성장 기대가 반영된 수준입니다.`);
  if (f.debtRatio > 150) lines.push(`부채비율 ${fmtPct(f.debtRatio)}로 재무 부담을 점검할 필요가 있습니다.`);
  if (!lines.length) lines.push('특기할 만한 극단치 없이 안정적인 지표 흐름입니다.');
  const consensusNote = isConsensusAvailable() ? '' : `<p style="font-size:12px; color:var(--text-muted);">${warnIcon('컨센서스(증권사 추정치)는 무료 데이터로 확보가 어려워, 어닝 서프라이즈/쇼크 분석은 제한됩니다.')} 컨센서스 기반 분석은 제공되지 않습니다.</p>`;
  return `
    <ul style="margin:0; padding-left:18px;">
      ${lines.map(l => `<li>${l}</li>`).join('')}
    </ul>
    ${consensusNote}
    <p style="font-size:12px; color:var(--text-muted); margin-top:8px;">⚠ 본 분석은 규칙 기반 템플릿으로 생성된 참고용 문장이며 투자 권유가 아닙니다.</p>`;
}
