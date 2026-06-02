// OpenDART 호출 어댑터. crtfc_key는 클라이언트 측에서 보내지 않는다(Worker가 서버 키로 자동 첨부).
import { getDartProxyBase } from '../config.js';
import { showToast } from '../../components/toast.js';

const FETCH_TIMEOUT_MS = 10000;
const FAILURE_THRESHOLD = 5;   // 누적 실패 임계값
const RESET_AFTER_MS = 60_000; // 마지막 실패 후 1분 지나면 카운터 초기화

// 회로 차단기 상태(모듈 전역 — 세션 단위)
let failureCount = 0;
let lastFailureAt = 0;
let circuitOpen = false;
let notified = false;

function maybeResetCircuit() {
  if (lastFailureAt && Date.now() - lastFailureAt > RESET_AFTER_MS) {
    failureCount = 0;
    circuitOpen = false;
    notified = false;
  }
}

function recordFailure(path, reason) {
  failureCount += 1;
  lastFailureAt = Date.now();
  console.warn('[dart] fetch failed', path, reason, `(누적 ${failureCount}회)`);
  if (failureCount >= FAILURE_THRESHOLD && !circuitOpen) {
    circuitOpen = true;
    if (!notified) {
      try {
        showToast(
          `OpenDART 호출이 ${FAILURE_THRESHOLD}회 연속 실패해 한국 종목 재무 조회를 일시 중단했습니다. 페이지를 새로고침하거나 잠시 후 다시 시도해 주세요.`,
          { type: 'warn', timeoutMs: 6000 }
        );
      } catch {}
      notified = true;
    }
  }
}

function recordSuccess() {
  if (failureCount > 0) {
    failureCount = 0;
    circuitOpen = false;
    notified = false;
  }
}

async function fetchJson(path, params) {
  maybeResetCircuit();
  if (circuitOpen) return null;

  const base = getDartProxyBase();
  if (!base) return null;
  const url = new URL(base + path);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (k.toLowerCase() === 'crtfc_key') return;
    if (v != null && v !== '') url.searchParams.set(k, v);
  });

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), { signal: ctl.signal });
    if (!res.ok) {
      recordFailure(path, `HTTP ${res.status}`);
      return null;
    }
    const json = await res.json();
    if (json?.status && json.status !== '000' && json.status !== '013') {
      recordFailure(path, `API ${json.status} ${json.message || ''}`.trim());
      return null;
    }
    recordSuccess();
    return json;
  } catch (e) {
    const reason = e.name === 'AbortError' ? 'timeout' : (e.message || 'unknown');
    recordFailure(path, reason);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// 회사 개황
export async function dartCompany(corpCode) {
  return fetchJson('/api/company.json', { corp_code: corpCode });
}

// 단일회사 주요계정.
// reprt_code: 11011=사업보고서(연간), 11014=3분기, 11012=반기, 11013=1분기
export async function dartFnlttSinglAcnt(corpCode, year, reportCode) {
  return fetchJson('/api/fnlttSinglAcnt.json', {
    corp_code: corpCode,
    bsns_year: year,
    reprt_code: reportCode,
  });
}
