// 사용자가 검색 시 추가한 종목을 LocalStorage 에 누적.
// 친구 공유는 별도 동기화 단계 (추후 scripts/sync_extras.py 등).

const LS_KEY_KR = 'ca:extras:kr';
const LS_KEY_US = 'ca:extras:us';

function loadList(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function saveList(key, arr) {
  try { localStorage.setItem(key, JSON.stringify(arr)); } catch {}
}

export function getKrExtras() { return loadList(LS_KEY_KR); }
export function getUsExtras() { return loadList(LS_KEY_US); }

export function addExtra(sym) {
  if (!sym || !sym.ticker || !sym.market) return false;
  const lsKey = sym.market === 'kr' ? LS_KEY_KR : LS_KEY_US;
  const list = loadList(lsKey);
  if (list.find(s => s.ticker === sym.ticker)) return false;  // 중복 무시
  list.push(sym);
  saveList(lsKey, list);
  return true;
}

export function getAllExtras() {
  return [...getKrExtras(), ...getUsExtras()];
}
