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
const RETRY_DELAY_MS = 3000;                   // 503 재시도 대기

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
  const { cacheKey, ttlMs = DEFAULT_TTL_MS, skipCache = false } = opts;

  // 입력 검증
  if (!prompt || typeof prompt !== 'string') {
    return { text: null, error: '프롬프트가 비어있습니다', fromCache: false };
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

  // 2) Worker 호출 (503 시 1회 자동 재시도)
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(GEMINI_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });

      let d;
      try {
        d = await r.json();
      } catch (e) {
        lastError = `응답 파싱 실패 (HTTP ${r.status})`;
        break;
      }

      // 성공
      if (r.status === 200) {
        const text = d?.candidates?.[0]?.content?.parts?.[0]?.text;
        const modelVersion = d?.modelVersion;
        if (!text) {
          lastError = '응답 텍스트 누락 (필터 차단 가능성)';
          break;
        }
        // 캐시 저장
        if (cacheKey) _writeCache(cacheKey, text, modelVersion);
        return {
          text,
          error: null,
          fromCache: false,
          modelVersion,
          timestamp: Date.now(),
        };
      }

      // 일시 과부하 — 1회 재시도
      if (r.status === 503 && attempt === 0) {
        await new Promise(res => setTimeout(res, RETRY_DELAY_MS));
        continue;
      }

      // 호출 한도 초과 — 친화 메시지
      if (r.status === 429) {
        const retryMatch = d?.error?.message?.match(/retry in ([\d.]+)/i);
        const retrySec = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) : null;
        lastError = retrySec
          ? `AI 호출 한도 초과 (약 ${retrySec}초 후 재시도 가능)`
          : 'AI 호출 한도 초과 (잠시 후 재시도)';
        break;
      }

      // 그 외 에러
      lastError = d?.error?.message || `HTTP ${r.status}`;
      break;

    } catch (e) {
      lastError = e?.message || '네트워크 오류';
      if (attempt === 0) {
        await new Promise(res => setTimeout(res, 1000));
        continue;
      }
    }
  }

  return { text: null, error: lastError || '알 수 없는 오류', fromCache: false };
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
