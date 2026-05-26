import { cacheGet, cacheSet } from '../utils/cache.js';

const KEY = 'watchlist';

export function getWatchlist() {
  return cacheGet(KEY) || [];
}

export function isWatched(ticker) {
  return getWatchlist().includes(ticker);
}

export function toggleWatch(ticker) {
  const list = getWatchlist();
  const idx = list.indexOf(ticker);
  if (idx >= 0) list.splice(idx, 1);
  else list.push(ticker);
  cacheSet(KEY, list);
  window.dispatchEvent(new CustomEvent('watchlist-changed'));
  return list.includes(ticker);
}
