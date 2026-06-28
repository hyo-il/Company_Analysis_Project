// CA Finnhub 프록시 Worker
// 환경변수(Cloudflare 대시보드에서 등록): FINNHUB_KEY (Secret), ALLOWED_ORIGINS (Text)
// 허용 경로만 프록시 + Origin 검증 + 클라이언트가 보낸 token은 폐기(서버 키만 사용)
// (DART 분기는 정적 JSON 전환으로 제거됨 — 2026-05-31. DART_KEY Secret 도 더 이상 불필요)

const ALLOWED_PATHS = new Set([
  '/api/v1/calendar/earnings',
  '/api/v1/stock/dividend',
  '/api/v1/quote',
  '/api/v1/stock/profile2',
  '/api/v1/stock/metric',
  '/api/v1/stock/financials-reported',
  '/api/v1/company-news',
  '/api/v1/search',
]);

// 주 모델 — 무료 tier 가능 확인 (gemini-2.5-flash-lite, 2026-06 기준)
const GEMINI_MODEL_PRIMARY = 'gemini-2.5-flash-lite';
// 폴백 모델 — 별칭 (Google 자동 매핑, 주 모델 일시 장애 시)
const GEMINI_MODEL_FALLBACK = 'gemini-flash-lite-latest';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
// 보안: 입력 길이 제한 (악용·비용 폭주 방지)
const MAX_PROMPT_CHARS = 8000;       // 약 2000~3000 토큰
const MAX_RESPONSE_TOKENS = 1500;    // 800 → 1500 (잘림 방지)

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const allowedOrigins = (env.ALLOWED_ORIGINS || '')
      .split(',').map(s => s.trim()).filter(Boolean);

    if (request.method === 'OPTIONS') return cors(null, 204, origin, allowedOrigins);
    if (!allowedOrigins.includes(origin)) return cors('Forbidden origin', 403, origin, allowedOrigins);

    // === Gemini 분기 (POST /gemini/chat) ===
    if (url.pathname === '/gemini/chat') {
      if (request.method !== 'POST') {
        return cors('Method not allowed (use POST)', 405, origin, allowedOrigins);
      }
      return handleGemini(request, env, origin, allowedOrigins);
    }

    // === Finnhub 분기 (기존, GET only) ===
    if (request.method !== 'GET') return cors('Method not allowed', 405, origin, allowedOrigins);
    if (!url.pathname.startsWith('/finnhub')) return cors('Not found', 404, origin, allowedOrigins);

    const finnhubPath = url.pathname.slice('/finnhub'.length);
    if (!ALLOWED_PATHS.has(finnhubPath)) return cors('Path not allowed', 403, origin, allowedOrigins);
    if (!env.FINNHUB_KEY) return cors('Server key not configured', 500, origin, allowedOrigins);

    const target = new URL('https://finnhub.io' + finnhubPath);
    url.searchParams.forEach((v, k) => {
      if (k.toLowerCase() === 'token') return;
      target.searchParams.set(k, v);
    });
    target.searchParams.set('token', env.FINNHUB_KEY);

    let resp;
    try {
      resp = await fetch(target.toString(), { method: 'GET' });
    } catch (e) {
      return cors('Upstream fetch failed', 502, origin, allowedOrigins);
    }
    const body = await resp.text();
    return new Response(body, {
      status: resp.status,
      headers: {
        'content-type': resp.headers.get('content-type') || 'application/json',
        'cache-control': 'public, max-age=300',
        'Access-Control-Allow-Origin': origin,
        'Vary': 'Origin',
      },
    });
  },
};

async function callGemini(prompt, model, apiKey) {
  const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      maxOutputTokens: MAX_RESPONSE_TOKENS,
      temperature: 0.3,   // 0.7 → 0.3 (일관성·정확성 ↑)
      topP: 0.8,
      topK: 40,
    },
  };
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await resp.text();
    return { status: resp.status, text, contentType: resp.headers.get('content-type') };
  } catch (e) {
    return { status: 502, text: JSON.stringify({ error: { message: 'Upstream fetch failed' } }), contentType: 'application/json' };
  }
}

async function handleGemini(request, env, origin, allowedOrigins) {
  if (!env.GEMINI_API_KEY) {
    return cors('Gemini API key not configured', 500, origin, allowedOrigins);
  }

  let body;
  try { body = await request.json(); }
  catch (e) { return cors('Invalid JSON body', 400, origin, allowedOrigins); }

  const prompt = (body?.prompt || '').toString();
  if (!prompt.trim()) return cors('Missing "prompt" field', 400, origin, allowedOrigins);
  if (prompt.length > MAX_PROMPT_CHARS) {
    return cors(`Prompt too long (max ${MAX_PROMPT_CHARS} chars)`, 413, origin, allowedOrigins);
  }

  // 주 모델 호출 → 일시 장애 (429/503) 시 폴백 자동 시도
  let resp = await callGemini(prompt, GEMINI_MODEL_PRIMARY, env.GEMINI_API_KEY);
  if (resp.status === 429 || resp.status === 503) {
    const fallback = await callGemini(prompt, GEMINI_MODEL_FALLBACK, env.GEMINI_API_KEY);
    // 폴백이 더 나쁘지 않으면 폴백 사용
    if (fallback.status === 200 || (fallback.status >= 200 && fallback.status < resp.status)) {
      resp = fallback;
    }
  }

  return new Response(resp.text, {
    status: resp.status,
    headers: {
      'content-type': resp.contentType || 'application/json',
      'cache-control': 'no-store',   // AI 응답은 항상 fresh
      'Access-Control-Allow-Origin': origin,
      'Vary': 'Origin',
    },
  });
}

function cors(body, status, origin, allowedOrigins) {
  const allow = allowedOrigins.includes(origin) ? origin : '';
  return new Response(body, {
    status,
    headers: {
      'Access-Control-Allow-Origin': allow,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    },
  });
}
