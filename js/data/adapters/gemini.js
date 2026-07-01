// CA 프로젝트 — Gemini AI 어댑터 (Worker 프록시 경유)
//
// 사용:
//   import { askGemini } from './adapters/gemini.js';
//   const { text, error, fromCache } = await askGemini('프롬프트', { cacheKey: 'analysis:005930' });
//
// 캐싱: cacheKey 지정 시 LocalStorage 에 24h 저장. 재호출은 캐시 우선.
// 에러: 503 자동 재시도 1회 · 429 한도 안내 · 그 외 메시지 반환.

const WORKER_BASE = 'https://ca-finnhub-proxy.yhug76.workers.dev';
const GEMINI_ENDPOINT = `${WORKER_BASE}/gemini/chat`;
const CACHE_PREFIX = 'ca:gemini:';
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;   // 24h
const RETRY_DELAY_MS = 3000;                   // 503 재시도 대기 (레거시 상수 유지)
const MAX_RETRIES = 3;   // 최대 재시도 횟수 (총 4회 시도: 초기 + 3회)
const RETRY_DELAY_503 = 3000;
const RETRY_DELAY_LOCATION = 2000;
const RETRY_DELAY_DEFAULT = 1500;

/**
 * Gemini AI 호출.
 *
 * @param {string} prompt - 사용자 프롬프트
 * @param {object} [opts]
 * @param {string} [opts.cacheKey] - LocalStorage 캐시 키 (예: 'analysis:005930:v1'). 미지정 시 캐시 X.
 * @param {number} [opts.ttlMs=86400000] - 캐시 TTL (기본 24h)
 * @param {boolean} [opts.skipCache=false] - true 면 캐시 무시 강제 호출 (재계산)
 *
 * @returns {Promise<{text: string|null, error: string|null, fromCache: boolean, modelVersion?: string, timestamp?: number}>}
 */
export async function askGemini(prompt, opts = {}) {
  const {
    cacheKey,
    ttlMs = DEFAULT_TTL_MS,
    skipCache = false,
    onRetry = null,   // 신규 — 재시도 진행 콜백 (attempt, maxRetries)
  } = opts;

  // 입력 검증
  if (!prompt || typeof prompt !== 'string') {
    const rawError = '프롬프트가 비어있습니다';
    return { text: null, error: _toFriendlyError(null, rawError), rawError, fromCache: false };
  }

  // 1) 캐시 확인
  if (cacheKey && !skipCache) {
    const cached = _readCache(cacheKey, ttlMs);
    if (cached) {
      return {
        text: cached.text,
        error: null,
        fromCache: true,
        modelVersion: cached.modelVersion,
        timestamp: cached.timestamp,
      };
    }
  }

  // 2) Worker 호출 (재시도 최대 MAX_RETRIES = 3회, 총 4회 시도)
  let lastError = null;
  let lastStatus = null;   // 마지막 HTTP status (친화 메시지 변환용)
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // 재시도 안내 콜백 (attempt >= 1)
    if (attempt >= 1 && typeof onRetry === 'function') {
      try { onRetry(attempt, MAX_RETRIES); } catch (_) {}
    }

    try {
      const r = await fetch(GEMINI_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      lastStatus = r.status;

      let d;
      try { d = await r.json(); }
      catch (e) {
        lastError = `응답 파싱 실패 (HTTP ${r.status})`;
        if (attempt < MAX_RETRIES) {
          await _sleep(RETRY_DELAY_DEFAULT);
          continue;
        }
        break;
      }

      // 성공 (200)
      if (r.status === 200) {
        const text = d?.candidates?.[0]?.content?.parts?.[0]?.text;
        const modelVersion = d?.modelVersion;
        if (text) {
          if (cacheKey) _writeCache(cacheKey, text, modelVersion);
          return {
            text,
            error: null,
            fromCache: false,
            modelVersion,
            timestamp: Date.now(),
          };
        }
        // 200 인데 텍스트 없음 (필터 차단·안전 정책) — 재시도
        lastError = '응답 텍스트 누락 (필터 차단 가능성)';
        if (attempt < MAX_RETRIES) {
          await _sleep(RETRY_DELAY_DEFAULT);
          continue;
        }
        break;
      }

      // 429 (한도) — 재시도 X (한도 이슈 명확). 원본 보존 → 친화 변환은 최종 반환에서.
      if (r.status === 429) {
        lastError = d?.error?.message || 'Quota exceeded';
        break;
      }

      // 재시도 가능 에러 판별
      const isLocationError = r.status === 400
        && d?.error?.message?.match(/location is not supported/i);
      const isRetryable = r.status === 503
        || r.status === 502
        || (r.status >= 500 && r.status < 600)
        || isLocationError;

      if (isRetryable && attempt < MAX_RETRIES) {
        const delay = r.status === 503 ? RETRY_DELAY_503
          : isLocationError ? RETRY_DELAY_LOCATION
          : RETRY_DELAY_DEFAULT;
        await _sleep(delay);
        continue;
      }

      // 재시도 불가 그 외 에러
      lastError = d?.error?.message || `HTTP ${r.status}`;
      break;

    } catch (e) {
      lastError = e?.message || '네트워크 오류';
      lastStatus = null;   // 예외 (네트워크 등) — HTTP status 없음
      if (attempt < MAX_RETRIES) {
        await _sleep(1000);
        continue;
      }
    }
  }

  const rawError = lastError || '알 수 없는 오류';
  return {
    text: null,
    error: _toFriendlyError(lastStatus, rawError),
    rawError,   // 신규 — 디버깅용 원본 메시지 (UI 미표시)
    fromCache: false,
  };
}

// 내부 헬퍼
function _sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

/**
 * HTTP status·원본 메시지 → 사용자 친화 한국어 메시지 변환.
 *
 * @param {number|null} status - HTTP status (null 이면 네트워크 등 예외 케이스)
 * @param {string} rawMessage - 원본 에러 메시지
 * @returns {string} 한국어 친화 메시지
 */
function _toFriendlyError(status, rawMessage) {
  const msg = String(rawMessage || '').toLowerCase();

  // 400 + 지역 제한 (Cloudflare Worker 리전 이슈)
  if (status === 400 && msg.includes('location is not supported')) {
    return 'AI 서비스가 현재 지역에서 일시 제한되었습니다. 잠시 후 다시 시도해 주세요.';
  }
  // 400 그 외
  if (status === 400) {
    return '요청 형식 오류입니다. 잠시 후 다시 시도해 주세요.';
  }
  // 401·403 (인증)
  if (status === 401 || status === 403) {
    return 'AI 서비스 인증 실패. 관리자에게 문의해 주세요.';
  }
  // 404 (모델 없음)
  if (status === 404) {
    return 'AI 모델을 찾을 수 없습니다. 관리자에게 문의해 주세요.';
  }
  // 413 (요청 너무 김)
  if (status === 413) {
    return '요청 데이터가 너무 큽니다. 관리자에게 문의해 주세요.';
  }
  // 429 (한도)
  if (status === 429) {
    const retryMatch = rawMessage?.match(/retry in ([\d.]+)/i);
    const retrySec = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) : null;
    return retrySec
      ? `AI 호출 한도 초과 — 약 ${retrySec}초 후 다시 시도해 주세요.`
      : 'AI 호출 한도 초과. 잠시 후 다시 시도해 주세요.';
  }
  // 502 (게이트웨이)
  if (status === 502) {
    return 'AI 서버 통신 오류. 잠시 후 다시 시도해 주세요.';
  }
  // 503 (과부하)
  if (status === 503) {
    return 'AI 서비스 일시 과부하. 잠시 후 다시 시도해 주세요.';
  }
  // 5xx 그 외
  if (status && status >= 500 && status < 600) {
    return 'AI 서비스 일시 오류. 잠시 후 다시 시도해 주세요.';
  }

  // 원본 메시지 기반 매칭 (status 없거나 특수 케이스)
  if (msg.includes('필터 차단') || msg.includes('응답 텍스트 누락')) {
    return 'AI 가 응답을 생성하지 못했습니다. 잠시 후 다시 시도하거나 다른 종목으로 확인해 주세요.';
  }
  if (msg.includes('네트워크') || msg.includes('network') || msg.includes('fetch') || msg.includes('failed to fetch')) {
    return '네트워크 연결 오류. 인터넷 상태를 확인 후 다시 시도해 주세요.';
  }
  if (msg.includes('응답 파싱 실패')) {
    return 'AI 응답 처리 오류. 잠시 후 다시 시도해 주세요.';
  }
  if (msg.includes('프롬프트가 비어')) {
    return '분석에 필요한 데이터가 부족합니다.';
  }

  return 'AI 분석 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';
}

/**
 * Gemini 캐시 삭제. key 지정 시 단일, 미지정 시 전체 (CACHE_PREFIX 접두 모두).
 *
 * @param {string|null} [key=null]
 */
export function clearGeminiCache(key = null) {
  try {
    if (key) {
      localStorage.removeItem(CACHE_PREFIX + key);
      return;
    }
    const keys = Object.keys(localStorage).filter(k => k.startsWith(CACHE_PREFIX));
    keys.forEach(k => localStorage.removeItem(k));
  } catch (e) {
    // LocalStorage 비활성 — 무시
  }
}

/**
 * 캐시 메타 조회 (캐시 존재 여부·생성 시각 확인용).
 *
 * @param {string} key
 * @returns {{exists: boolean, timestamp?: number, ageMs?: number, modelVersion?: string}}
 */
export function getGeminiCacheMeta(key) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return { exists: false };
    const obj = JSON.parse(raw);
    return {
      exists: true,
      timestamp: obj.timestamp,
      ageMs: Date.now() - obj.timestamp,
      modelVersion: obj.modelVersion,
    };
  } catch (e) {
    return { exists: false };
  }
}

// === 내부 헬퍼 ===

function _readCache(key, ttlMs) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (Date.now() - obj.timestamp > ttlMs) return null;
    return obj;
  } catch (e) {
    return null;
  }
}

function _writeCache(key, text, modelVersion) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({
      text,
      modelVersion,
      timestamp: Date.now(),
    }));
  } catch (e) {
    // LocalStorage 가득 또는 비활성 — 무시
  }
}
