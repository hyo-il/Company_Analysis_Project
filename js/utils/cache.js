const PREFIX = 'ca:';

export function cacheGet(key) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function cacheSet(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch (e) { console.warn('cache set failed', e); }
}

export function cacheDel(key) {
  localStorage.removeItem(PREFIX + key);
}

export function cacheAll(prefix = '') {
  const out = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(PREFIX + prefix)) {
      out[k.slice(PREFIX.length)] = JSON.parse(localStorage.getItem(k));
    }
  }
  return out;
}
