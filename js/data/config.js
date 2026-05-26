// 외부 API 키는 localStorage에만 저장(브라우저 외부로 전송하지 않음).
export const API_KEYS = { FINNHUB: 'finnhub' };

export function getApiKey(name) {
  try { return localStorage.getItem(`ca:apiKey:${name}`) || ''; }
  catch { return ''; }
}

export function setApiKey(name, value) {
  try {
    if (value) localStorage.setItem(`ca:apiKey:${name}`, value);
    else localStorage.removeItem(`ca:apiKey:${name}`);
  } catch {}
}
