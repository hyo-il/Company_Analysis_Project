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

// Gemini 1.5 Flash — 무료 tier 가장 빠르고 저렴
const GEMINI_MODEL = 'gemini-1.5-flash-latest';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
// 보안: 입력 길이 제한 (악용·비용 폭주 방지)
const MAX_PROMPT_CHARS = 8000;     // 약 2000~3000 토큰
const MAX_RESPONSE_TOKENS = 800;   // 응답 상한 (1~2 문단 분량)

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

async function handleGemini(request, env, origin, allowedOrigins) {
  if (!env.GEMINI_API_KEY) {
    return cors('Gemini API key not configured', 500, origin, allowedOrigins);
  }

  // 요청 본문 파싱
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return cors('Invalid JSON body', 400, origin, allowedOrigins);
  }

  // 입력 검증
  const prompt = (body?.prompt || '').toString();
  if (!prompt.trim()) {
    return cors('Missing "prompt" field', 400, origin, allowedOrigins);
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    return cors(`Prompt too long (max ${MAX_PROMPT_CHARS} chars)`, 413, origin, allowedOrigins);
  }

  // Gemini API 호출
  const geminiUrl = `${GEMINI_ENDPOINT}?key=${env.GEMINI_API_KEY}`;
  const geminiBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      maxOutputTokens: MAX_RESPONSE_TOKENS,
      temperature: 0.7,
    },
  };

  let resp;
  try {
    resp = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(geminiBody),
    });
  } catch (e) {
    return cors('Gemini upstream fetch failed', 502, origin, allowedOrigins);
  }

  const respText = await resp.text();
  // Gemini 응답 형식 그대로 전달 (클라이언트가 candidates[0].content.parts[0].text 추출)
  return new Response(respText, {
    status: resp.status,
    headers: {
      'content-type': resp.headers.get('content-type') || 'application/json',
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
