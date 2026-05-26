// 보유 종목 풀 분석 모달.
// ETF 구성 종목 행 클릭 시, 그 종목의 기업 분석(또는 ETF 상세)을 dialog 안에 렌더.
import { getSymbol } from '../data/symbols.js';
import { destroyChartsIn } from './charts.js';

let dialogEl = null;
let bodyEl = null;
let titleEl = null;
let openFullBtn = null;
let closeBtn = null;
let currentTicker = null;

function ensureDialog() {
  if (dialogEl) return;
  dialogEl = document.createElement('dialog');
  dialogEl.id = 'holding-analysis-dialog';
  dialogEl.setAttribute('aria-labelledby', 'holding-analysis-title');
  dialogEl.innerHTML = `
    <header class="dialog-header">
      <span class="title" id="holding-analysis-title">종목 분석</span>
      <span class="spacer"></span>
      <button type="button" class="btn-secondary" id="holding-open-full">전체 화면으로 보기</button>
      <button type="button" class="btn-secondary" id="holding-close" aria-label="닫기">✕</button>
    </header>
    <section class="dialog-body route-panel" id="holding-analysis-body"></section>
  `;
  document.body.appendChild(dialogEl);
  bodyEl = dialogEl.querySelector('#holding-analysis-body');
  titleEl = dialogEl.querySelector('#holding-analysis-title');
  openFullBtn = dialogEl.querySelector('#holding-open-full');
  closeBtn = dialogEl.querySelector('#holding-close');

  closeBtn.addEventListener('click', () => dialogEl.close());
  openFullBtn.addEventListener('click', () => {
    const t = currentTicker;
    dialogEl.close();
    if (t) location.hash = `#/analysis/${t}`;
  });
  // backdrop 클릭으로 닫기
  dialogEl.addEventListener('click', e => {
    if (e.target === dialogEl) dialogEl.close();
  });
  dialogEl.addEventListener('close', () => {
    if (bodyEl) {
      destroyChartsIn(bodyEl);
      bodyEl.innerHTML = '';
    }
    currentTicker = null;
  });
}

export async function openHoldingAnalysisDialog(ticker) {
  if (!ticker) return;
  ensureDialog();
  // 동적 import로 순환 의존 회피 (analysis.js ↔ etf.js)
  const [{ renderAnalysis }, { renderEtf }] = await Promise.all([
    import('../pages/analysis.js'),
    import('../pages/etf.js'),
  ]);

  // 이전 차트 정리
  destroyChartsIn(bodyEl);
  bodyEl.innerHTML = '';
  currentTicker = ticker;

  const sym = getSymbol(ticker);
  titleEl.textContent = sym ? `${sym.nameKr} · ${sym.ticker}` : ticker;

  if (!dialogEl.open) dialogEl.showModal();
  // 첫 포커스를 닫기 버튼에 (접근성)
  closeBtn.focus();

  if (sym && sym.type === 'etf') renderEtf(bodyEl, { ticker });
  else renderAnalysis(bodyEl, { ticker });
}
