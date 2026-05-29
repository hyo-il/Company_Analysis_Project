// CA Finnhub 프록시 Worker
// 환경변수(Cloudflare 대시보드에서 등록): FINNHUB_KEY (Secret), ALLOWED_ORIGINS (Text)
// 허용 경로만 프록시 + Origin 검증 + 클라이언트가 보낸 token은 폐기(서버 키만 사용)

const ALLOWED_PATHS = new Set([
  '/api/v1/calendar/earnings',
  '/api/v1/stock/dividend',
  '/api/v1/quote',
  '/api/v1/stock/profile2',
  '/api/v1/stock/metric',
  '/api/v1/stock/financials-reported',
  '/api/v1/company-news',
]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const allowedOrigins = (env.ALLOWED_ORIGINS || '')
      .split(',').map(s => s.trim()).filter(Boolean);

    if (request.method === 'OPTIONS') return cors(null, 204, origin, allowedOrigins);
    if (request.method !== 'GET')   return cors('Method not allowed', 405, origin, allowedOrigins);
    if (!allowedOrigins.includes(origin)) return cors('Forbidden origin', 403, origin, allowedOrigins);
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

function cors(body, status, origin, allowedOrigins) {
  const allow = allowedOrigins.includes(origin) ? origin : '';
  return new Response(body, {
    status,
    headers: {
      'Access-Control-Allow-Origin': allow,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    },
  });
}
