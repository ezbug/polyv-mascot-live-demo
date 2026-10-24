/**
 * Polyv AI 答疑助手 + DeepSeek 混合代理（生产版参考实现）
 *
 * 路由：
 *   1) 知识库问题 → 保利威 AI 答疑助手（RAG），回答「超纲」时自动回退 DeepSeek
 *   2) 闲聊/人格化 → DeepSeek（服务端读取 DEEPSEEK_API_KEY）
 *
 * 安全：
 *   - Polyv appSecret / DeepSeek Key 都不下发前端
 *   - Origin 白名单、限流、token 缓存、上游超时
 *
 * 启动：
 *   POLYV_APP_ID=xxx POLYV_APP_SECRET=xxx \
 *   DEEPSEEK_CREDENTIALS_FILE=/path/.credentials.yaml \
 *   node server.mjs
 *   # 或直接 DEEPSEEK_API_KEY=sk-xxx
 */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';

const PORT = Number(process.env.PORT || 8789);
const APP_ID = process.env.POLYV_APP_ID || '';
const APP_SECRET = process.env.POLYV_APP_SECRET || '';
const AI_ID = process.env.POLYV_AI_ID || '';

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://127.0.0.1:8788,http://localhost:8788')
  .split(',').map(s => s.trim()).filter(Boolean);
const ALLOW_NO_ORIGIN = process.env.ALLOW_NO_ORIGIN === '1';

const TOKEN_TTL_MS = Number(process.env.TOKEN_TTL_MS || 10 * 60 * 1000);
const RATE_LIMIT = Number(process.env.RATE_LIMIT || 30);
const RATE_WINDOW_MS = 60 * 1000;
const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 30000);

const TOKEN_API = 'https://api.polyv.net/live/v3/common/token/get-ai-token';
const AI_API = 'https://api.polyv.net/ai/v1/chat/question';

/* ---------------- DeepSeek 配置 ---------------- */
const DS_BASE = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
const DS_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const DS_KEY = loadDeepSeekKey();
const DS_SYSTEM = `你是保利威（POLYV）的吉祥物「小威」：蓝白猫耳少女，戴 O 播放器发饰和耳麦。
性格亲切、聪明、简短，回答控制在 80 字内，可以有一点可爱语气，但不要卖萌过度。
你在企业 H5 直播间里陪观众看直播：闲聊、暖场、回答问题都可以。
涉及具体业务/数据/价格时不要编造，提示用户问助教或看回放。`;

function loadDeepSeekKey() {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY;
  const file = process.env.DEEPSEEK_CREDENTIALS_FILE;
  if (!file) return '';
  try {
    const txt = fs.readFileSync(file, 'utf8');
    const m = txt.match(/^\s*DEEPSEEK_API_KEY:\s*(\S+)/m);
    return m ? m[1] : '';
  } catch (e) { return ''; }
}

if (!APP_ID || !APP_SECRET || !AI_ID) {
  console.error('[fatal] 缺少 POLYV_APP_ID / POLYV_APP_SECRET / POLYV_AI_ID');
  process.exit(1);
}
if (!DS_KEY) console.warn('[warn] 未配置 DeepSeek Key，闲聊将回退到保利威/本地');

/* ---------------- 签名 ---------------- */
function sign(params) {
  const keys = Object.keys(params).filter(k => params[k] !== '' && params[k] != null).sort();
  const raw = APP_SECRET + keys.map(k => k + params[k]).join('') + APP_SECRET;
  return crypto.createHash('md5').update(raw, 'utf8').digest('hex').toUpperCase();
}

/* ---------------- token 缓存 ---------------- */
const tokenCache = new Map();
async function getToken(viewerId) {
  const now = Date.now();
  const hit = tokenCache.get(viewerId);
  if (hit && hit.exp > now) return hit.token;
  const params = { appId: APP_ID, timestamp: String(now), viewerId };
  params.sign = sign(params);
  const res = await fetch(TOKEN_API, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  const json = await res.json().catch(() => ({}));
  if (json.code !== 200 || !json.data) throw new Error('token 获取失败: ' + (json.message || json.code));
  tokenCache.set(viewerId, { token: json.data, exp: now + TOKEN_TTL_MS });
  return json.data;
}

/* ---------------- 限流 ---------------- */
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  let rec = hits.get(ip);
  if (!rec || rec.reset < now) { rec = { count: 0, reset: now + RATE_WINDOW_MS }; hits.set(ip, rec); }
  rec.count += 1;
  return rec.count > RATE_LIMIT;
}
setInterval(() => { const now = Date.now(); for (const [ip, r] of hits) if (r.reset < now) hits.delete(ip); }, 60 * 1000).unref();

/* ---------------- 白名单 / CORS ---------------- */
function originAllowed(req) {
  const origin = req.headers.origin || '';
  if (!origin) return ALLOW_NO_ORIGIN;
  return ALLOWED_ORIGINS.includes(origin);
}
function setCors(res, origin) {
  if (origin) { res.setHeader('access-control-allow-origin', origin); res.setHeader('vary', 'Origin'); }
  res.setHeader('access-control-allow-methods', 'GET, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
  res.setHeader('access-control-max-age', '600');
}
function json(res, status, body, origin) {
  setCors(res, origin);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

/* ---------------- SSE 输出 ---------------- */
function startSse(res, origin) {
  setCors(res, origin);
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
}
const emit = (res, obj) => res.write('data: ' + JSON.stringify(obj) + '\n\n');
const emitMeta = (res, source) => emit(res, { source });
const emitContent = (res, content) => emit(res, { content });
const emitDone = (res) => { emit(res, { done: true }); res.end(); };

/* ---------------- 路由判断 ---------------- */
function isChitchat(q) {
  if (q.length > 24) return false;
  if (/保利威|直播|报名|回放|产品|价格|吉祥物|课程|知识库|发票|合同/.test(q)) return false;
  return /^(你好|您好|hi|hello|嗨|在吗|在不在|早上好|晚上好|早安|晚安|谢谢|感谢|再见|拜拜|讲个笑话|说个笑话|随便聊聊|聊聊|你能做什么|你是谁|你叫什么)/i.test(q);
}
const POLYV_MISS = /超纲|未能|没有找到|暂无法|无法回答|没有相关/;

/* ---------------- 保利威知识库（流式） ---------------- */
async function streamPolyv(question, viewerId, res, origin) {
  const token = await getToken(viewerId);
  const qs = new URLSearchParams({ question, aiId: AI_ID, token });
  const upstream = await fetch(AI_API + '?' + qs, {
    headers: { accept: 'text/event-stream' },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!upstream.ok || !upstream.body) throw new Error('polyv upstream ' + upstream.status);

  const reader = upstream.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let started = false;
  let got = '';
  const start = () => {
    if (started) return;
    started = true;
    startSse(res, origin);
    emitMeta(res, 'polyv');
  };
  const finish = async () => {
    if (!started) {
      // 整段都是「超纲/未找到」→ 交给 DeepSeek
      if (POLYV_MISS.test(got)) return false;
      start();
      if (got) emitContent(res, got);
    }
    emitDone(res);
    return true;
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop();
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const raw = t.slice(5).trim();
        if (!raw || raw === '[DONE]') continue;
        let data; try { data = JSON.parse(raw); } catch (e) { continue; }
        if (data.error) throw new Error(data.message || 'polyv error');
        if (data.content) {
          got += data.content;
          if (!started) {
            if (POLYV_MISS.test(got.slice(0, 80))) {
              try { await reader.cancel(); } catch (e) {}
              return false;
            }
            if (got.length >= 16) {
              start();
              emitContent(res, got);
            }
          } else {
            emitContent(res, data.content);
          }
        }
      }
    }
    return await finish();
  } catch (e) {
    try { await reader.cancel(); } catch (e2) {}
    if (started) {
      emitDone(res);
      return true;
    }
    return false;
  }
}

/* ---------------- DeepSeek（流式） ---------------- */
async function streamDeepSeek(question, res, origin) {
  const upstream = await fetch(`${DS_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + DS_KEY },
    body: JSON.stringify({
      model: DS_MODEL,
      stream: true,
      max_tokens: 300,
      messages: [
        { role: 'system', content: DS_SYSTEM },
        { role: 'user', content: question },
      ],
    }),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!upstream.ok || !upstream.body) throw new Error('deepseek upstream ' + upstream.status);

  startSse(res, origin);
  emitMeta(res, 'deepseek');
  const reader = upstream.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop();
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const raw = t.slice(5).trim();
      if (!raw || raw === '[DONE]') continue;
      let data; try { data = JSON.parse(raw); } catch (e) { continue; }
      const content = data.choices?.[0]?.delta?.content;
      if (content) emitContent(res, content);
    }
  }
  emitDone(res);
}

/* ---------------- 服务 ---------------- */
const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';

  if (req.method === 'OPTIONS') {
    if (!originAllowed(req)) return json(res, 403, { error: 'origin not allowed' }, origin);
    setCors(res, origin); res.writeHead(204); res.end(); return;
  }

  if (url.pathname === '/healthz') {
    return json(res, 200, { ok: true, uptime: Math.round(process.uptime()), aiId: AI_ID, deepseek: !!DS_KEY }, origin);
  }
  if (url.pathname !== '/api/ai') return json(res, 404, { error: 'not found' }, origin);

  if (!originAllowed(req)) return json(res, 403, { error: 'origin not allowed: ' + (origin || '(none)') }, origin);
  if (rateLimited(ip)) return json(res, 429, { error: 'too many requests' }, origin);

  const question = (url.searchParams.get('question') || '').trim();
  if (!question) return json(res, 400, { error: 'question required' }, origin);
  if (question.length > 500) return json(res, 400, { error: 'question too long' }, origin);

  const viewerId = (url.searchParams.get('viewerId') || 'anon-' + crypto.createHash('md5').update(ip).digest('hex').slice(0, 12)).slice(0, 64);
  const chitchat = isChitchat(question);
  console.log(`[ai] route=${chitchat ? 'deepseek' : 'polyv-first'} q=${question.slice(0, 24)}`);

  try {
    if (chitchat && DS_KEY) {
      await streamDeepSeek(question, res, origin);
      return;
    }
    const ok = await streamPolyv(question, viewerId, res, origin);
    if (!ok && DS_KEY) {
      console.log('[ai] polyv miss -> deepseek');
      await streamDeepSeek(question, res, origin);
      return;
    }
    if (!ok) {
      startSse(res, origin);
      emitContent(res, '这个问题我暂时答不上来，可以换个问法，或者问助教～');
      emitDone(res);
    }
  } catch (e) {
    console.error('[ai] error', e && e.message ? e.message : e);
    if (!res.headersSent) return json(res, 500, { error: String(e && e.message ? e.message : e) }, origin);
    try { emitDone(res); } catch (e2) { res.end(); }
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[polyv-ai-proxy] http://127.0.0.1:${PORT}  aiId=${AI_ID}  deepseek=${DS_KEY ? 'on' : 'off'}`);
  console.log(`[polyv-ai-proxy] allowed origins: ${ALLOWED_ORIGINS.join(', ')}${ALLOW_NO_ORIGIN ? ' (+no-origin)' : ''}`);
});
