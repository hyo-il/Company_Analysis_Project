// 모든 [data-tooltip] 요소에 대해 document.body에 fixed로 툴팁을 띄운다.
// 부모의 overflow에 잘리지 않고, 뷰포트 경계에서 자동 클램프된다.

let tipEl = null;
let currentTarget = null;

function ensureTip() {
  if (tipEl) return tipEl;
  tipEl = document.createElement('div');
  tipEl.className = 'ca-tooltip';
  tipEl.setAttribute('role', 'tooltip');
  tipEl.style.visibility = 'hidden';
  document.body.appendChild(tipEl);
  return tipEl;
}

function position(target) {
  const tip = ensureTip();
  const r = target.getBoundingClientRect();
  tip.style.visibility = 'hidden';
  tip.style.left = '0px';
  tip.style.top = '0px';
  // 우선 측정
  const tw = tip.offsetWidth;
  const th = tip.offsetHeight;
  const margin = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // 기본: 아이콘 위쪽 중앙
  let top = r.top - th - margin;
  let left = r.left + r.width / 2 - tw / 2;
  let placement = 'top';

  // 위가 안 되면 아래
  if (top < margin) {
    top = r.bottom + margin;
    placement = 'bottom';
  }
  // 그래도 안 되면 오른쪽
  if (top + th > vh - margin) {
    top = Math.max(margin, r.top + r.height / 2 - th / 2);
    left = r.right + margin;
    placement = 'right';
    if (left + tw > vw - margin) {
      left = r.left - tw - margin;
      placement = 'left';
    }
  }

  // 가로 클램프
  left = Math.max(margin, Math.min(left, vw - tw - margin));
  top = Math.max(margin, Math.min(top, vh - th - margin));

  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
  tip.dataset.placement = placement;
  tip.style.visibility = 'visible';
}

function show(target) {
  const text = target.getAttribute('data-tooltip');
  if (!text) return;
  const tip = ensureTip();
  tip.textContent = text;
  currentTarget = target;
  position(target);
}

function hide() {
  if (tipEl) tipEl.style.visibility = 'hidden';
  currentTarget = null;
}

document.addEventListener('mouseover', e => {
  const t = e.target.closest('[data-tooltip]');
  if (t) show(t);
});
document.addEventListener('mouseout', e => {
  const t = e.target.closest('[data-tooltip]');
  if (t && t === currentTarget) hide();
});
document.addEventListener('focusin', e => {
  const t = e.target.closest('[data-tooltip]');
  if (t) show(t);
});
document.addEventListener('focusout', e => {
  const t = e.target.closest('[data-tooltip]');
  if (t && t === currentTarget) hide();
});
window.addEventListener('scroll', hide, true);
window.addEventListener('resize', hide);

// 키보드 접근성: [data-tooltip] 요소들이 포커스를 받을 수 있게 tabindex 자동 부여
function ensureTabbable() {
  document.querySelectorAll('[data-tooltip]:not([tabindex])').forEach(el => {
    if (el.tagName !== 'BUTTON' && el.tagName !== 'A' && el.tagName !== 'INPUT') {
      el.setAttribute('tabindex', '0');
    }
  });
}
const mo = new MutationObserver(ensureTabbable);
mo.observe(document.body, { childList: true, subtree: true });
ensureTabbable();
