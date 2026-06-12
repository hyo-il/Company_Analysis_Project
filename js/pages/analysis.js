import { getProfile, getFinancials, getQuoteEOD, getNews, getCalendar, isConsensusAvailable, getHistoricalMetrics, getValuationHistory, getEtfsContaining } from '../data/adapter.js';
import { getKRDartMeta } from '../data/kr-dart.js';
import { getPeers, getSymbol } from '../data/symbols.js';
import { toggleWatch, isWatched } from '../data/watchlist.js';
import { METRIC_CATEGORIES, SECTOR_PRIORITY } from '../data/metrics-meta.js';
import { fmtNum, fmtPct, fmtMoney, fmtChange, fmtInt, fmtDate } from '../utils/format.js';
import { metaBadge, infoTip, warnIcon, loadingState, errorState, emptyState } from '../components/common.js';
import { showToast } from '../components/toast.js';
import { computeFactorScores, computePeerScores, SWING_FACTOR_CATEGORIES, computeSwingScores, computeWarnings, computeDupont } from '../utils/scoring.js';
import { getMomentumData, getCandlesMeta } from '../data/us-candles.js';
import { getKrMomentumData, getKrCandlesMeta } from '../data/kr-candles.js';
import { MAX_PEERS, MIN_PEERS, toBars5 } from '../utils/peer-percentile.js';
import { bandChart, trendChart, destroyChartsIn } from '../components/charts.js';
import { pushRecent } from '../data/recents.js';

// 투자 기간 모드 (장기/스윙) — 사용자 선호 LocalStorage 저장
const INVEST_MODE_KEY = 'ca:invest-mode';

function getInvestMode() {
  try { return localStorage.getItem(INVEST_MODE_KEY) === 'swing' ? 'swing' : 'long'; }
  catch { return 'long'; }
}
function setInvestMode(mode) {
  try { localStorage.setItem(INVEST_MODE_KEY, mode); } catch {}
}

// 규칙 기반 해설용 임계치 (팩터 점수·지표)
const FACTOR_STRONG = 60;        // 이 점수 이상이면 강점
const FACTOR_WEAK = 40;          // 이 점수 미만이면 약점
const REV_GROWTH_STRONG = 20;    // 매출 YoY 성장률(%) — 두드러진 성장
const REV_GROWTH_NEGATIVE = 0;   // 매출 YoY 성장률(%) — 역성장 기준
const OP_MARGIN_STRONG = 20;     // 영업이익률(%) — 우수
const PER_LOW = 12;              // PER — 저평가 영역
const PER_HIGH = 30;             // PER — 고평가/성장기대
const DEBT_RATIO_HIGH = 150;     // 부채비율(%) — 재무 부담

export async function renderAnalysis(container, { ticker } = {}) {
  if (!ticker) {
    container.innerHTML = `<div class="panel">${emptyState('상단 검색창에서 종목을 검색·선택해 주세요.')}</div>`;
    return;
  }
  destroyChartsIn(container);
  pushRecent(ticker);
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
    // 백분위 점수 카드용 피어 fin (자동 피어 최대 MAX_PEERS명)
    const peerSyms = getPeers(ticker).filter(p => p.ticker !== ticker).slice(0, MAX_PEERS);
    const peerFinsRaw = await Promise.all(
      peerSyms.map(p => getFinancials(p.ticker).then(r => r?.data || null).catch(() => null))
    );
    const validPeerFins = peerFinsRaw.filter(f => f);

    const priority = SECTOR_PRIORITY[profile.data.sector] || [];
    const currency = profile.currency;
    const watched = isWatched(ticker);
    const hasTrends = !!(hist?.data?.labels?.length);
    const hasValband = !!(valHist?.data?.labels?.length);
    // KR 미지원·호출 실패 시 점수/AI 해설은 의미 없으므로 섹션 자체를 숨김(5-D)
    const scoresUsable = fin?.reason !== 'kr-not-supported' && fin?.reason !== 'fetch-failed';
    // 백분위 점수(가치·수익성·성장성·안정성·종합). 피어 부족 시 카테고리·종합 모두 null.
    const peerScores = scoresUsable ? computePeerScores(fin.data, validPeerFins) : null;
    const krDartGen = getKRDartMeta().generatedAt?.slice(0, 10);
    const krNoticeHtml = (sym && sym.market !== 'us') ? `
      <div class="panel" style="border-left:4px solid var(--primary); background:var(--bg-subtle);">
        <strong>한국 종목 안내</strong>
        <p style="margin:6px 0 0; font-size:13px;">
          이 종목의 재무 정보는 OpenDART 사업보고서를 사전 수집한 데이터입니다(분기 단위 갱신). 시세·뉴스·PER/PBR 등 주가 기반 지표는 시세 소스 연동(2단계) 후 활성화됩니다.
        </p>
        ${krDartGen ? `<p style="margin:4px 0 0; font-size:11px; color:var(--text-muted);">수집 기준일: ${krDartGen}</p>` : ''}
      </div>` : '';

    container.innerHTML = krNoticeHtml + `
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

      ${hasTrends ? `<div class="panel">
        <div class="panel-title">주요 지표 추이 ${infoTip('핵심 지표가 좋아지고 있는지 나빠지고 있는지 한눈에 보기 위한 최근 8분기 스파크라인입니다.')} ${metaBadge(hist)}</div>
        <div id="trends-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:12px;"></div>
      </div>` : ''}

      ${hasValband ? `<div class="panel">
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
      </div>` : ''}

      ${scoresUsable ? `<div class="panel">
        <div class="panel-title">AI 기업 분석 ${infoTip('규칙 기반으로 만든 사업 요약과 강점·약점·투자 포인트입니다(유료 LLM 미사용). 출처·기준일이 함께 표기되며 투자 권유가 아닙니다.')}</div>
        ${renderAIBusiness(profile.data, fin.data, peerScores)}
        ${metaBadge(fin)}
      </div>

      <div class="panel" id="scores-panel">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:8px;">
          <div class="panel-title" style="margin-bottom:0;">퀀트 종합점수 ${infoTip('동종업계 비교 또는 절대 환산 기반 참고용 점수. 미래 수익을 보장하지 않습니다.')}</div>
          <div style="display:inline-flex; background:var(--bg-subtle); border-radius:6px; padding:3px;" role="tablist" aria-label="투자 기간 모드">
            <button id="mode-long"  class="mode-tab ${getInvestMode()==='long' ?'active':''}" style="background:${getInvestMode()==='long' ?'var(--surface)':'transparent'}; border:none; padding:5px 12px; font-size:12px; color:${getInvestMode()==='long' ?'var(--primary)':'var(--text-muted)'}; ${getInvestMode()==='long' ?'font-weight:500;':''} border-radius:5px; cursor:pointer;">장기</button>
            <button id="mode-swing" class="mode-tab ${getInvestMode()==='swing'?'active':''}" style="background:${getInvestMode()==='swing'?'var(--surface)':'transparent'}; border:none; padding:5px 12px; font-size:12px; color:${getInvestMode()==='swing'?'var(--primary)':'var(--text-muted)'}; ${getInvestMode()==='swing'?'font-weight:500;':''} border-radius:5px; cursor:pointer;">스윙 1~3개월</button>
          </div>
        </div>
        ${renderScores(ticker, fin.data, validPeerFins, hist?.data, cal?.data, sym?.market === 'kr')}
      </div>

      <div class="panel" id="warnings-panel" style="display:${getInvestMode() === 'long' ? '' : 'none'};">
        <div class="panel-title">⚠ 함정 신호 점검 ${infoTip('애널리스트가 경계하는 구조적 위험 5가지 — 단순 점수에서 안 보이는 함정을 자동 감지합니다.')}</div>
        ${renderWarnings(fin.data)}
        <p style="font-size:11px; color:var(--text-muted); margin-top:10px;">
          ⚠ 룰 기반 자동 감지. 산업·시점에 따라 의미가 다를 수 있어 참고용입니다. 투자 권유 아님.
        </p>
      </div>

      <div class="panel" id="dupont-panel" style="display:${getInvestMode() === 'long' ? '' : 'none'};">
        <div class="panel-title">🧬 DuPont 분해 ${infoTip('ROE 를 순이익률 × 자산회전율 × 재무레버리지 세 요소로 분해해 ROE 의 출처를 보여줍니다. 같은 ROE 라도 어디서 나오는지에 따라 회사 특성과 위험도가 다릅니다.')}</div>
        ${renderDupont(fin.data)}
        <p style="font-size:11px; color:var(--text-muted); margin-top:10px;">
          ⚠ 절대 임계값 기반 분류. 산업·시점에 따라 의미가 다를 수 있어 참고용입니다.
        </p>
      </div>

      <div class="panel">
        <div class="panel-title">AI 주가요인 (규칙 기반) ${infoTip('최근 주가가 왜 그렇게 움직였는지를 실제 실적·지표에 근거해 쉬운 말로 정리한 설명입니다(예측이 아닙니다). 출처·시점·면책을 함께 표시합니다.')}</div>
        ${renderAIFactors(profile.data, fin.data, quote.data)}
      </div>` : ''}

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

    // 투자 기간 모드 토글 (장기/스윙) — 점수 카드만 부분 리렌더 (스크롤 보존)
    bindModeToggle(container, ticker);

    // 추이 미니차트 (데이터 있을 때만)
    if (hasTrends) renderTrends(container.querySelector('#trends-grid'), hist.data, currency);
    // 역사적 밸류에이션 밴드 (데이터 있을 때만)
    if (hasValband) renderValuationBand(container, valHist.data);

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

/**
 * 점수 카드 패널만 부분 리렌더. 토글 클릭 시 호출.
 * 데이터는 어댑터 캐시 활용으로 빠르게 재조회. 페이지 전체를 다시 그리지 않으므로 스크롤 위치 보존.
 */
async function rerenderScoresPanel(container, ticker) {
  const panel = container.querySelector('#scores-panel');
  if (!panel) return;

  // (1) 로딩 표시 — 헤더(토글 포함)만 유지, 본문은 스피너로 교체
  const header = panel.querySelector(':scope > div:first-child');
  panel.innerHTML = '';
  if (header) panel.appendChild(header);
  const loading = document.createElement('div');
  loading.id = 'scores-loading';
  loading.style.cssText = 'padding:24px; text-align:center; color:var(--text-muted); font-size:13px;';
  loading.innerHTML = `
    <div style="display:inline-block; width:24px; height:24px; border:2px solid var(--border); border-top-color:var(--primary); border-radius:50%; animation:ca-spin 0.7s linear infinite;"></div>
    <div style="margin-top:8px;">점수 계산 중...</div>
  `;
  panel.appendChild(loading);
  bindModeToggle(container, ticker);   // 헤더 유지되지만 안전 위해 재바인딩 + 활성 표시 갱신

  // (2) 데이터 재조회 (캐시 적중 시 즉시 반환)
  const sym = getSymbol(ticker);
  const marketKr = sym?.market === 'kr';
  const [finR, histR, calR] = await Promise.all([
    getFinancials(ticker).catch(() => null),
    getHistoricalMetrics(ticker).catch(() => ({ data: null })),
    getCalendar(ticker).catch(() => ({ data: [] })),
  ]);

  // peer 는 장기 모드에서만 필요
  let validPeerFins = [];
  if (getInvestMode() === 'long') {
    const peers = getPeers(ticker).filter(p => p.ticker !== ticker).slice(0, MAX_PEERS);
    const peerFinsRaw = await Promise.all(peers.map(p =>
      getFinancials(p.ticker).then(r => r?.data || null).catch(() => null)
    ));
    validPeerFins = peerFinsRaw.filter(f => f);
  }

  // (3) 본문 렌더 — 헤더는 유지하고 그 아래만 교체
  panel.querySelector('#scores-loading')?.remove();
  panel.insertAdjacentHTML('beforeend',
    renderScores(ticker, finR?.data, validPeerFins, histR?.data, calR?.data, marketKr));

  bindModeToggle(container, ticker);   // 본문 교체 후 토글 재바인딩

  // 함정 경고 패널은 장기 모드 전용 — 모드 전환 시 보이/숨김
  const warningsPanel = container.querySelector('#warnings-panel');
  if (warningsPanel) {
    warningsPanel.style.display = getInvestMode() === 'long' ? '' : 'none';
  }
  const dupontPanel = container.querySelector('#dupont-panel');
  if (dupontPanel) {
    dupontPanel.style.display = getInvestMode() === 'long' ? '' : 'none';
  }
}

/**
 * 모드 토글 버튼에 클릭 핸들러 바인딩 + 활성 표시 갱신.
 * 중복 바인딩 방지를 위해 cloneNode 로 기존 리스너 제거 후 재등록.
 */
function bindModeToggle(container, ticker) {
  ['mode-long', 'mode-swing'].forEach(id => {
    const btn = container.querySelector(`#${id}`);
    if (!btn) return;
    const cloned = btn.cloneNode(true);
    btn.parentNode.replaceChild(cloned, btn);
    cloned.addEventListener('click', () => {
      const target = id === 'mode-long' ? 'long' : 'swing';
      if (getInvestMode() === target) return;
      setInvestMode(target);
      rerenderScoresPanel(container, ticker);
    });
  });
  paintModeTabs(container);
}

/** 현재 모드에 맞춰 토글 버튼 활성 스타일 갱신(부분 리렌더 시 헤더가 재생성되지 않으므로 필요). */
function paintModeTabs(container) {
  const mode = getInvestMode();
  [['mode-long', 'long'], ['mode-swing', 'swing']].forEach(([id, m]) => {
    const btn = container.querySelector(`#${id}`);
    if (!btn) return;
    const active = mode === m;
    btn.style.cssText = `background:${active ? 'var(--surface)' : 'transparent'}; border:none; padding:5px 12px; font-size:12px; color:${active ? 'var(--primary)' : 'var(--text-muted)'}; ${active ? 'font-weight:500;' : ''} border-radius:5px; cursor:pointer;`;
    btn.classList.toggle('active', active);
  });
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
    { key: 'revenue',         label: '매출',                  tip: '회사가 1년(또는 분기)에 판 총금액. 회사 덩치를 보여줘요.',
      fmt: headerMoney, chartFmt: chartMoney },
    { key: 'operatingIncome', label: '영업이익',              tip: '본업으로 판매·관리비를 빼고 남은 이익. 본업 수익성을 봐요.',
      fmt: headerMoney, chartFmt: chartMoney },
    { key: 'netIncome',       label: '순이익',                tip: '세금·이자까지 다 떼고 최종 남은 이익.',
      fmt: headerMoney, chartFmt: chartMoney },
    { key: 'eps',             label: '주당순이익(EPS)',       tip: '내가 가진 한 주가 1년에 벌어준 돈이에요. Earnings Per Share.',
      fmt: v => fmtNum(v, 0), chartFmt: chartInt },
    { key: 'ocf',             label: '영업현금흐름(OCF)',     tip: '장부 이익 말고 본업으로 통장에 진짜 들어온 현금. 이익은 난다는데 현금이 안 들어오면 좀 의심해봐야 해요. Operating Cash Flow.',
      fmt: headerMoney, chartFmt: chartMoney },
    { key: 'fcf',             label: '잉여현금흐름(FCF)',     tip: '영업현금흐름(OCF) − 자본적지출(CapEx). 벌어서 투자할 거 다 하고 손에 남은 진짜 여윳돈이에요. 이 돈으로 배당도 주고 자사주도 사요. Free Cash Flow.',
      fmt: headerMoney, chartFmt: chartMoney },
    { key: 'roe',             label: '자기자본이익률(ROE)',   tip: '내 돈(자본) 100원으로 1년에 몇 원 벌었나. 높을수록 자본 운용이 효율적이에요. Return on Equity.',
      fmt: v => fmtPct(v), chartFmt: chartPct },
    { key: 'opMargin',        label: '영업이익률',            tip: '100원어치 팔아서 본업으로 몇 원 남겼나. 20원 남기면 20%.',
      fmt: v => fmtPct(v), chartFmt: chartPct },
  ];
  grid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(260px, 1fr))';
  // 모든 값이 null/undefined 이거나 배열이 비면 카드 제외 (KR ROE·FCF·EPS 등 자동 숨김)
  const visibleItems = items.filter(it => {
    const series = h[it.key];
    return Array.isArray(series) && series.some(v => v != null);
  });
  grid.innerHTML = visibleItems.map(it => {
    const series = h[it.key] || [];
    const last = series[series.length - 1];
    const first = series[0];
    const delta = first ? ((last - first) / Math.abs(first)) * 100 : 0;
    const dirCls = delta > 0 ? 'up' : delta < 0 ? 'down' : '';
    const sign = delta > 0 ? '▲' : delta < 0 ? '▼' : '–';
    return `<div style="border:1px solid var(--border); border-radius:6px; padding:10px;">
      <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px; color:var(--text-muted);">
        <span>${it.label} ${it.tip ? infoTip(it.tip) : ''}</span>
        <span class="${dirCls}" style="font-size:11px;">${sign} ${Math.abs(delta).toFixed(1)}%</span>
      </div>
      <div style="font-size:15px; font-weight:600; margin:2px 0;">${last == null ? '—' : it.fmt(last)}</div>
      <div style="height:110px;"><canvas id="trend-${it.key}"></canvas></div>
      <div style="font-size:10px; color:var(--text-muted); margin-top:2px;">최근 ${series.length}분기 추이</div>
    </div>`;
  }).join('');
  visibleItems.forEach(it => {
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
    'no-key': '<strong>현재 프록시 URL이 설정되지 않았습니다.</strong><p>도움말 → 데이터 소스 설정에서 Worker URL을 확인하거나, 운영자에게 문의하세요.</p><button class="btn-primary" onclick="location.hash=\'#/help\'">도움말로 가기</button>',
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
  // null 지표는 행 자체를 출력하지 않는다. 값이 있는 지표만 남김.
  const visible = cat.metrics.filter(m => data[m.key] != null);
  // 카테고리 전체가 null이면 카드 자체를 출력하지 않음.
  if (!visible.length) return '';
  // 2개씩 묶어 한 행 = 4열(지표/값/지표/값)
  const rows = [];
  for (let i = 0; i < visible.length; i += 2) {
    rows.push([visible[i], visible[i + 1]]);
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

function renderAIBusiness(profile, fin, peerScores) {
  // 사업 쉬운 요약
  const summary = `${profile.nameKr}(${profile.ticker})는 ${profile.exchange}에 상장된 <strong>${profile.industry}</strong> 분야 ${profile.type === 'etf' ? 'ETF' : '기업'}입니다. ${profile.description}`;
  // 강점·약점은 백분위 점수 기반(피어 부족 카테고리는 자동 제외).
  const scores = peerScores || computeFactorScores(fin);
  const factorEntries = ['가치','수익성','성장성','안정성']
    .map(k => [k, scores[k]])
    .filter(([, v]) => v != null);
  const sorted = [...factorEntries].sort((a, b) => b[1] - a[1]);
  const strengths = sorted.filter(([,v]) => v >= FACTOR_STRONG).map(([k]) => k);
  const weaknesses = sorted.filter(([,v]) => v < FACTOR_WEAK).map(([k]) => k);

  const evidenceLines = [];
  if (scores['수익성'] >= FACTOR_STRONG) evidenceLines.push(`수익성: ROE ${Number(fin.roe).toFixed(1)}%, 영업이익률 ${Number(fin.opMargin).toFixed(1)}%로 양호`);
  if (scores['성장성'] >= FACTOR_STRONG) evidenceLines.push(`성장성: 매출 YoY ${Number(fin.revenueGrowthYoY).toFixed(1)}%로 견조`);
  if (scores['가치'] >= FACTOR_STRONG) evidenceLines.push(`가치: PER ${Number(fin.per).toFixed(1)}배, PBR ${Number(fin.pbr).toFixed(1)}배로 저평가 영역`);
  if (scores['안정성'] < FACTOR_WEAK) evidenceLines.push(`안정성 부담: 부채비율 ${Number(fin.debtRatio).toFixed(0)}%`);
  if (scores['수익성'] < FACTOR_WEAK) evidenceLines.push(`수익성 부진: ROE ${Number(fin.roe).toFixed(1)}%`);

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

function scoreCardHtml({ key, score, note, rank, totalGroup }) {
  const isNull = score == null;
  const bars = isNull ? null : toBars5(score);
  const display = isNull ? '—' : score;
  const barRow = isNull
    ? `<div style="height:10px;"></div>`
    : `<div style="display:flex; gap:3px; justify-content:center; margin-top:6px;">
         ${[0,1,2,3,4].map(i => `<span style="display:inline-block; width:14px; height:6px; border-radius:2px; background:${i < bars ? 'var(--primary)' : 'var(--border)'};"></span>`).join('')}
       </div>`;
  const rankBadge = (rank != null && totalGroup != null)
    ? `<div style="font-size:11px; color:var(--primary); margin-top:4px; font-weight:600;">${totalGroup}곳 중 ${rank}위</div>`
    : '';
  return `<div style="border:1px solid var(--border); border-radius:6px; padding:12px; text-align:center;">
    <div style="color:var(--text-muted); font-size:12px;">${key}</div>
    <div style="font-size:22px; font-weight:700; color:${isNull ? 'var(--text-muted)' : 'var(--primary)'};">${display}</div>
    ${barRow}
    ${rankBadge}
    ${note ? `<div style="font-size:10px; color:var(--text-muted); margin-top:4px;">${note}</div>` : ''}
  </div>`;
}

function renderWarnings(fin) {
  const warnings = computeWarnings(fin);
  if (!warnings.length) {
    return `
      <div style="padding:14px; background:var(--bg-subtle); border-radius:6px; font-size:13px; color:var(--text-muted); text-align:center;">
        ✓ 분석가가 경계하는 5가지 함정 신호는 발견되지 않았습니다.
        <div style="font-size:11px; margin-top:4px;">차입경영·이자부담·영업외 의존·유동성·회계품질 — 모두 정상 범위.</div>
      </div>
    `;
  }
  return warnings.map(w => {
    const bg = w.level === 'high' ? '#fff5f5' : '#fffaf0';
    const border = w.level === 'high' ? '#fecaca' : '#fed7aa';
    const titleColor = w.level === 'high' ? '#c53030' : '#c05621';
    return `
      <div style="padding:12px 14px; background:${bg}; border:1px solid ${border}; border-radius:6px; margin-bottom:8px;">
        <div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">
          <span style="font-size:14px;">${w.icon}</span>
          <strong style="font-size:13px; color:${titleColor};">${w.label}</strong>
        </div>
        <div style="font-size:12px; color:var(--text); line-height:1.5;">${w.msg}</div>
      </div>
    `;
  }).join('');
}

function renderDupont(fin) {
  const dp = computeDupont(fin);
  if (!dp) {
    return `
      <div style="padding:14px; background:var(--bg-subtle); border-radius:6px; font-size:13px; color:var(--text-muted); text-align:center;">
        DuPont 분해는 매출·총자산·자본·순이익 절대값이 필요합니다.
        <div style="font-size:11px; margin-top:4px;">현재 종목은 절대값 일부가 미제공이라 분해를 표시하지 않습니다.</div>
      </div>
    `;
  }

  const typeColor =
    dp.type === 'margin'    ? '#0F6E56' :     // 진한 청록 (마진형)
    dp.type === 'turnover'  ? '#185FA5' :     // 진한 파랑 (회전형)
    dp.type === 'leverage'  ? '#A32D2D' :     // 진한 빨강 (레버리지형)
                              '#5F5E5A';      // 회색 (균형형)
  const typeBg =
    dp.type === 'margin'    ? '#E1F5EE' :
    dp.type === 'turnover'  ? '#E6F1FB' :
    dp.type === 'leverage'  ? '#FCEBEB' :
                              'var(--bg-subtle)';

  // 세 요소의 상대 막대 (시각화) — 각 요소의 절대값을 적당히 정규화
  // netMargin 은 비율로 변환 (5% = 5점)
  const m = dp.netMargin * 100;          // %
  const t = dp.assetTurnover;            // 배수
  const l = dp.leverage;                 // 배수
  const maxScale = Math.max(m * 4, t * 30, l * 6, 30);  // 시각 비교용 스케일

  return `
    <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:14px;">
      <span style="background:${typeBg}; color:${typeColor}; padding:6px 14px; border-radius:6px; font-weight:500; font-size:13px;">
        ${dp.typeLabel}
      </span>
      <span style="font-size:12px; color:var(--text-muted);">${dp.typeDesc}</span>
    </div>
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:12px; margin-bottom:10px;">
      <div style="background:var(--bg-subtle); border-radius:6px; padding:12px; text-align:center;">
        <div style="font-size:12px; color:var(--text-muted); margin-bottom:4px;">① 순이익률</div>
        <div style="font-size:18px; font-weight:500;">${m.toFixed(2)}%</div>
        <div style="height:4px; background:var(--border); border-radius:2px; margin:8px 4px 0; overflow:hidden;">
          <div style="height:100%; width:${Math.min(100, m * 4)}%; background:var(--primary);"></div>
        </div>
        <div style="font-size:10px; color:var(--text-muted); margin-top:4px;">매출 100원당 ${m.toFixed(1)}원 남김</div>
      </div>
      <div style="background:var(--bg-subtle); border-radius:6px; padding:12px; text-align:center;">
        <div style="font-size:12px; color:var(--text-muted); margin-bottom:4px;">② 자산회전율</div>
        <div style="font-size:18px; font-weight:500;">${t.toFixed(2)}회</div>
        <div style="height:4px; background:var(--border); border-radius:2px; margin:8px 4px 0; overflow:hidden;">
          <div style="height:100%; width:${Math.min(100, t * 30)}%; background:var(--primary);"></div>
        </div>
        <div style="font-size:10px; color:var(--text-muted); margin-top:4px;">자산 1원으로 매출 ${t.toFixed(2)}원 발생</div>
      </div>
      <div style="background:var(--bg-subtle); border-radius:6px; padding:12px; text-align:center;">
        <div style="font-size:12px; color:var(--text-muted); margin-bottom:4px;">③ 재무레버리지</div>
        <div style="font-size:18px; font-weight:500;">${l.toFixed(2)}배</div>
        <div style="height:4px; background:var(--border); border-radius:2px; margin:8px 4px 0; overflow:hidden;">
          <div style="height:100%; width:${Math.min(100, l * 10)}%; background:var(--primary);"></div>
        </div>
        <div style="font-size:10px; color:var(--text-muted); margin-top:4px;">자본 1원으로 자산 ${l.toFixed(2)}원 운용</div>
      </div>
    </div>
    <div style="padding:10px 12px; background:var(--bg-subtle); border-radius:6px; font-size:12px; color:var(--text); text-align:center;">
      ROE 재산출 검증: <strong>${m.toFixed(2)}% × ${t.toFixed(2)} × ${l.toFixed(2)} ≈ ${dp.roeCheck}%</strong>
      <span style="font-size:11px; color:var(--text-muted); margin-left:6px;">(실제 ROE 와 비교)</span>
    </div>
  `;
}

function renderScores(ticker, fin, peerFins, ts, calendar, marketKr) {
  const mode = getInvestMode();
  if (mode === 'swing') {
    return renderSwingScores({ ticker, fin, ts, calendar, marketKr });
  }
  const usable = (peerFins || []).filter(f => f);
  if (usable.length < MIN_PEERS) {
    return `<div style="padding:12px;color:var(--text-muted);font-size:13px;">
      동종업계 비교 대상이 ${usable.length}곳뿐이라 점수를 표시하지 않습니다 (최소 ${MIN_PEERS}곳 필요).
      <div style="margin-top:4px;font-size:11px;">상대가치 비교 메뉴에서 피어 그룹을 직접 보강할 수 있습니다.</div>
    </div>`;
  }

  const peerScores = computePeerScores(fin, usable);
  const absoluteScores = computeFactorScores(fin); // 배당 점수만 사용

  // 종합 백분위 → 본인 포함 N+1명 안에서의 순위 (100점=1위, 0점=마지막)
  const totalPct = peerScores['종합'];
  const totalGroup = 1 + usable.length;
  const totalRank = totalPct == null
    ? null
    : Math.max(1, Math.min(totalGroup, totalGroup - Math.round((totalPct / 100) * (totalGroup - 1))));

  const cards = [
    { key: '가치',     score: peerScores['가치'] },
    { key: '수익성',   score: peerScores['수익성'] },
    { key: '성장성',   score: peerScores['성장성'] },
    { key: '안정성',   score: peerScores['안정성'] },
    { key: '배당',     score: absoluteScores['배당'], note: '절대 기준' },
    { key: '종합',     score: totalPct, rank: totalRank, totalGroup },
  ];

  const peerSyms = getPeers(ticker).filter(p => p.ticker !== ticker).slice(0, MAX_PEERS);
  const peerNames = peerSyms.slice(0, usable.length).map(s => s.nameKr).join(', ');
  const compareHref = `#/compare/${ticker}`;

  return `
    <div style="font-size:12px; color:var(--text-muted); margin-bottom:10px;">
      <strong style="color:var(--primary);">동종업계 ${usable.length}곳</strong>과 비교한 점수입니다. (피어: ${peerNames})
    </div>
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:12px;">
      ${cards.map(c => scoreCardHtml(c)).join('')}
    </div>
    <div style="margin-top:12px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
      <span style="font-size:12px; color:var(--text-muted);">
        배당은 산업별 정책 차이가 커서 절대 기준(배당수익률 0~5%)으로 표시합니다.
      </span>
      <a href="${compareHref}" style="font-size:12px; color:var(--primary); text-decoration:none; padding:4px 10px; border:1px solid var(--accent-line); border-radius:4px;">
        동종업계 비교 표 보기 →
      </a>
    </div>
    <p style="font-size:12px; color:var(--text-muted); margin-top:8px;">
      ⚠ 과거·현재 지표 기반 참고용 점수이며 미래 수익을 보장하지 않습니다.
    </p>`;
}

function renderSwingScores({ ticker, fin, ts, calendar, marketKr }) {
  const momentumData = marketKr ? getKrMomentumData(ticker) : getMomentumData(ticker);
  const scores = computeSwingScores({ fin, ts, calendar, marketKr, momentum: momentumData });

  const cards = [
    {
      key: '모멘텀',
      score: scores['모멘텀'],
      note: scores._meta.momentumPending
        ? (scores._meta.momentumUnavailableReason === 'kr-no-candle'
            ? 'kr-candles 수집 실패 종목 (KR)'
            : '시세 데이터 부족 (수집 누락)')
        : null,
    },
    {
      key: '실적 모멘텀',
      score: scores['실적 모멘텀'],
      note: scores['실적 모멘텀'] == null ? '데이터 부족' : null,
    },
    {
      key: '이벤트 임박',
      score: scores['이벤트 임박'],
      note: null,
    },
    {
      key: '변동성/강도',
      score: scores['변동성/강도'],
      note: scores['변동성/강도'] == null
        ? '시세 데이터 미가용'
        : (scores._meta.volatilityPartial === 'pos52-only-no-beta'
            ? '베타 미수집 (KR) — 52주 위치만 반영'
            : null),
    },
    { key: '종합', score: scores['종합'], note: null, isTotal: true },
  ];

  const krNotice = marketKr
    ? (momentumData
        ? `<div style="font-size:12px; color:var(--text-muted); margin-bottom:10px;">
             한국 종목 모멘텀: yfinance 시세 연동 가용 (변동성 카드는 베타 미수집으로 52주 위치만 반영).
           </div>`
        : `<div style="font-size:12px; color:var(--text-muted); margin-bottom:10px;">
             이 종목은 kr-candles 수집 실패 종목입니다(상장폐지·합병 등). 모멘텀·변동성 카드 미가용.
           </div>`)
    : `<div style="font-size:12px; color:var(--text-muted); margin-bottom:10px;">
         스윙(1~3개월) 관점의 4 카테고리 점수입니다.
       </div>`;

  return `
    ${krNotice}
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:12px;">
      ${cards.map(c => swingScoreCardHtml(c)).join('')}
    </div>
    ${(() => {
      const meta = marketKr ? getKrCandlesMeta() : getCandlesMeta();
      return meta.generatedAt
        ? `<p style="font-size:11px; color:var(--text-muted); margin-top:4px;">
             시계열 출처: yfinance ${marketKr ? '(KR)' : '(US)'} · 수집 ${meta.generatedAt.slice(0,10)} · ${meta.tickerCount} 종목
           </p>`
        : '';
    })()}
    <p style="font-size:12px; color:var(--text-muted); margin-top:8px;">
      ⚠ 가용 카테고리만 종합 점수에 반영됩니다(${scores._meta.categoryCount}/4 카테고리). 미래 수익을 보장하지 않습니다.
    </p>
  `;
}

function swingScoreCardHtml({ key, score, note, isTotal }) {
  const isNull = score == null;
  const display = isNull ? '—' : score;
  const bars = isNull ? null : Math.max(0, Math.min(4, Math.round(score / 25)));
  const accent = isTotal ? 'var(--primary)' : 'var(--text)';
  const bg = isTotal ? 'var(--primary-soft)' : 'var(--bg-subtle)';
  return `
    <div style="background:${bg}; border-radius:6px; padding:12px; text-align:center;">
      <div style="font-size:12px; color:var(--text-muted); margin-bottom:4px;">${key}</div>
      <div style="font-size:22px; font-weight:500; color:${accent};">${display}</div>
      ${isNull ? '' : `
        <div style="display:flex; gap:3px; justify-content:center; margin-top:6px;">
          ${[0,1,2,3,4].map(i => `<span style="display:inline-block; width:14px; height:6px; border-radius:2px; background:${i < bars ? 'var(--primary)' : 'var(--border)'};"></span>`).join('')}
        </div>
      `}
      ${note ? `<div style="font-size:10px; color:var(--text-muted); margin-top:6px; line-height:1.3;">${note}</div>` : ''}
    </div>
  `;
}

function renderAIFactors(p, f, q) {
  const lines = [];
  if (f.revenueGrowthYoY > REV_GROWTH_STRONG) lines.push(`매출이 전년 대비 ${fmtPct(f.revenueGrowthYoY)} 성장하여 성장세가 두드러집니다.`);
  else if (f.revenueGrowthYoY < REV_GROWTH_NEGATIVE) lines.push(`매출이 전년 대비 ${fmtPct(f.revenueGrowthYoY)}로 역성장 구간입니다.`);
  if (f.opMargin > OP_MARGIN_STRONG) lines.push(`영업이익률 ${fmtPct(f.opMargin)}로 수익성이 우수합니다.`);
  if (f.per < PER_LOW) lines.push(`PER ${fmtNum(f.per)}배로 시장 평균 대비 낮은 편입니다(저평가 가능성, 단 밸류 트랩 주의).`);
  if (f.per > PER_HIGH) lines.push(`PER ${fmtNum(f.per)}배로 시장 대비 높은 편이며 성장 기대가 반영된 수준입니다.`);
  if (f.debtRatio > DEBT_RATIO_HIGH) lines.push(`부채비율 ${fmtPct(f.debtRatio)}로 재무 부담을 점검할 필요가 있습니다.`);
  if (!lines.length) lines.push('특기할 만한 극단치 없이 안정적인 지표 흐름입니다.');
  const consensusNote = isConsensusAvailable() ? '' : `<p style="font-size:12px; color:var(--text-muted);">${warnIcon('컨센서스(증권사 추정치)는 무료 데이터로 확보가 어려워, 어닝 서프라이즈/쇼크 분석은 제한됩니다.')} 컨센서스 기반 분석은 제공되지 않습니다.</p>`;
  return `
    <ul style="margin:0; padding-left:18px;">
      ${lines.map(l => `<li>${l}</li>`).join('')}
    </ul>
    ${consensusNote}
    <p style="font-size:12px; color:var(--text-muted); margin-top:8px;">⚠ 본 분석은 규칙 기반 템플릿으로 생성된 참고용 문장이며 투자 권유가 아닙니다.</p>`;
}
