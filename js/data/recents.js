const KEY = 'ca:recents';
const MAX = 20;

function read() {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(arr) ? arr.filter(x => x && typeof x.ticker === 'string') : [];
  } catch { return []; }
}
function write(arr) {
  try { localStorage.setItem(KEY, JSON.stringify(arr.slice(0, MAX))); }
  catch (e) { console.warn('[recents] write failed', e.message); }
}

export function getRecents() { return read(); }
export function pushRecent(ticker) {
  if (!ticker) return;
  const arr = read().filter(x => x.ticker !== ticker);
  arr.unshift({ ticker, viewedAt: new Date().toISOString() });
  write(arr);
}
export function removeRecent(ticker) {
  write(read().filter(x => x.ticker !== ticker));
}
export function clearRecents() { write([]); }
