// 우측 하단 토스트. 짧은 피드백 메시지.
let container = null;

function ensureContainer() {
  if (container) return container;
  container = document.createElement('div');
  container.id = 'toast-container';
  container.style.cssText = 'position:fixed; right:16px; bottom:16px; display:flex; flex-direction:column; gap:8px; z-index:9999; pointer-events:none;';
  document.body.appendChild(container);
  return container;
}

export function showToast(message, opts = {}) {
  const { type = 'info', timeoutMs = 2500 } = opts;
  const root = ensureContainer();
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.style.pointerEvents = 'auto';
  el.textContent = message;
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));

  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    el.classList.remove('show');
    setTimeout(() => el.remove(), 200);
  };
  el.addEventListener('click', remove);
  setTimeout(remove, timeoutMs);
  return el;
}
