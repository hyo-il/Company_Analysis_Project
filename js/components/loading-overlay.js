// CA 프로젝트 — 전역 로딩 오버레이
//
// 사용:
//   import { showLoading, hideLoading } from '../components/loading-overlay.js';
//   showLoading('🤖 AI 분석 중...');
//   try {
//     // 비동기 작업
//   } finally {
//     hideLoading();
//   }
//
// 동작: 화면 전체 덮는 반투명 오버레이 + 스피너 + 메시지.
// z-index 9999 로 모든 요소 위. pointer-events 로 클릭 차단.
// 중첩 호출 지원 (참조 카운터) — 여러 호출이 동시 진행돼도 마지막 hide 에서 숨김.

let overlayEl = null;
let activeCount = 0;

function ensureOverlay() {
  if (overlayEl) return overlayEl;

  // 스피너 애니메이션 style (1회만 삽입)
  if (!document.getElementById('global-loading-overlay-style')) {
    const style = document.createElement('style');
    style.id = 'global-loading-overlay-style';
    style.textContent = `
      @keyframes ca-loading-spin { to { transform: rotate(360deg); } }
      #global-loading-overlay {
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0, 0, 0, 0.4);
        z-index: 9999;
        display: none;
        align-items: center;
        justify-content: center;
        flex-direction: column;
        gap: 14px;
        color: white;
        font-size: 14px;
        cursor: wait;
      }
      #global-loading-overlay .ca-spinner {
        width: 44px;
        height: 44px;
        border: 3px solid rgba(255, 255, 255, 0.25);
        border-top-color: white;
        border-radius: 50%;
        animation: ca-loading-spin 0.8s linear infinite;
      }
      #global-loading-overlay .ca-loading-msg {
        font-weight: 500;
        text-shadow: 0 1px 2px rgba(0,0,0,0.3);
      }
    `;
    document.head.appendChild(style);
  }

  overlayEl = document.createElement('div');
  overlayEl.id = 'global-loading-overlay';
  overlayEl.setAttribute('role', 'status');
  overlayEl.setAttribute('aria-live', 'polite');
  overlayEl.innerHTML = `
    <div class="ca-spinner" aria-hidden="true"></div>
    <div class="ca-loading-msg" id="global-loading-message">처리 중...</div>
  `;
  document.body.appendChild(overlayEl);
  return overlayEl;
}

/**
 * 전역 로딩 오버레이 표시. 중첩 호출 지원.
 * @param {string} [message='처리 중...'] - 표시 메시지
 */
export function showLoading(message = '처리 중...') {
  const el = ensureOverlay();
  const msgEl = el.querySelector('#global-loading-message');
  if (msgEl) msgEl.textContent = message;
  activeCount++;
  el.style.display = 'flex';
}

/**
 * 전역 로딩 오버레이 숨김. 참조 카운터 0 이 될 때만 실제 숨김.
 */
export function hideLoading() {
  activeCount = Math.max(0, activeCount - 1);
  if (activeCount === 0 && overlayEl) {
    overlayEl.style.display = 'none';
  }
}

/**
 * 강제 초기화 (테스트·에러 복구용).
 */
export function resetLoading() {
  activeCount = 0;
  if (overlayEl) overlayEl.style.display = 'none';
}

/**
 * 오버레이 표시 중 메시지 갱신 (재시도 진행 상황 표시용).
 * 오버레이가 표시되지 않은 상태에서 호출하면 무시.
 * @param {string} message
 */
export function updateLoadingMessage(message) {
  if (!overlayEl || overlayEl.style.display === 'none') return;
  const msgEl = overlayEl.querySelector('#global-loading-message');
  if (msgEl) msgEl.textContent = message;
}
