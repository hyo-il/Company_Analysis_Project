// Cloudflare Worker 프록시 — 친구 무설정 즉시 사용을 위해 운영 URL을 DEFAULT에 박는다.
// 실제 API 키는 코드에 없고 Worker의 환경변수에만 존재.
// (12차) 개인 키 모드는 제거. 프록시 URL만 관리.
export const PROXY = {
  BASE_KEY: 'finnhubProxyBase',
  DEFAULT: 'https://ca-finnhub-proxy.yhug76.workers.dev',
};

export function getFinnhubProxyBase() {
  try {
    const v = localStorage.getItem(`ca:${PROXY.BASE_KEY}`);
    if (v && v.trim()) return v.trim().replace(/\/$/, '');
  } catch {}
  return PROXY.DEFAULT || '';
}

export function setFinnhubProxyBase(url) {
  try {
    const trimmed = (url || '').trim().replace(/\/$/, '');
    if (trimmed) localStorage.setItem(`ca:${PROXY.BASE_KEY}`, trimmed);
    else localStorage.removeItem(`ca:${PROXY.BASE_KEY}`);
  } catch {}
}

export function clearFinnhubProxyBase() {
  try { localStorage.removeItem(`ca:${PROXY.BASE_KEY}`); } catch {}
}

export function isUsingDefaultProxy() {
  try {
    return !localStorage.getItem(`ca:${PROXY.BASE_KEY}`) && !!PROXY.DEFAULT;
  } catch { return !!PROXY.DEFAULT; }
}
