/**
 * 最小 LLM 代理：浏览器 -> 本服务 -> DeepSeek(或任意 OpenAI 兼容) API
 * 目的：API Key 只放服务端，前端拿不到；同时可做限流、日志、内容审核。
 *
 * 运行：
 *   DEEPSEEK_API_KEY=sk-xxx node ai-proxy/server.mjs
 *   # 可选：DEEPSEEK_BASE_URL=https://api.deepseek.com/anthropic 等
 */
import http from 'node:http';

const PORT = Number(process.env.PORT || 8790);
const API_KEY = process.env.DEEPSEEK_API_KEY || '';
const BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

const SYSTEM_PROMPT = `你是保利威（POLYV）的吉祥物「小威」：蓝白猫耳少女，戴 O 播放器发饰和耳麦。
性格亲切、聪明、简短。回答控制在 80 字内，适当带一点可爱语气，但不要卖萌过度。
你正在企业的 H5 直播间里陪观众看直播，可以回答直播内容、报名、回放、产品相关问题。
不确定的信息不要编造，直接说「这个我帮您转给助教」。`;

function cors(res) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'content-type');
  res.setHeader('access-control-allow-methods', 'POST, OPTIONS');
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  try { return JSON.parse(body || '{}'); } catch { return {}; }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return; }
  if (req.method !== 'POST' || req.url !== '/chat') {
    cors(res); res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":"not found"}'); return;
  }
  if (!API_KEY) {
    cors(res); res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: '缺少 DEEPSEEK_API_KEY' })); return;
  }

  const { messages = [] } = await readJson(req);
  const payload = {
    model: MODEL,
    stream: true,
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages].slice(-20),
  };

  try {
    const upstream = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify(payload),
    });
    if (!upstream.ok || !upstream.body) {
      cors(res); res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'upstream ' + upstream.status })); return;
    }
    cors(res);
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    const reader = upstream.body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  } catch (e) {
    cors(res); res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: String(e) }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`LLM proxy on http://127.0.0.1:${PORT}  model=${MODEL}`);
});
