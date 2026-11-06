// LIVE Telegram test (manual, needs approval): a REAL **test** bot drives the LOCAL order Worker. No webhook is set,
// changed or deleted on any bot; nothing is deployed; production is never contacted.
//
//   Worker (wrangler dev, 127.0.0.1) ──sendMessage/edit/answer──> bridge 127.0.0.1:8790 ──> api.telegram.org (TEST bot)
//   Telegram (TEST bot) <──getUpdates (long polling)── bridge ──POST /telegram/webhook + secret──> Worker
//
// Refuses to start unless:
//   - the token file holds a bot token whose bot USERNAME contains "test" and that you confirm by name (--confirm),
//   - the bot has NO webhook (getWebhookInfo url empty — getUpdates would fail otherwise; we never remove a webhook),
//   - the bot id is not --forbid-bot-id (put your REAL store bot's numeric id there: the part of its token before ':'),
//   - the chat id is a numeric group id; every outgoing message is forced to that chat.
//
//   node test/local-e2e/telegram-bridge.mjs --check --token-file <path> [--forbid-bot-id <id>]
//   E2E_TG_LOCAL_SECRET=<same as the Worker run> node test/local-e2e/telegram-bridge.mjs --run \
//        --token-file <path> --chat-id -100… --confirm <test_bot_username> --forbid-bot-id <real store bot id>
//
// The token file is read, never printed; keep it under workers/order-worker/.secrets/ (git-ignored).
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const BRIDGE_PORT = 8790;
export const WORKER_URL = 'http://127.0.0.1:8787';
const API = 'https://api.telegram.org';
const METHODS = new Set(['sendMessage', 'editMessageText', 'editMessageReplyMarkup', 'answerCallbackQuery']);

export class BridgeRefused extends Error {
  constructor(problems) {
    super(`TELEGRAM BRIDGE REFUSED:\n - ${problems.join('\n - ')}`);
    this.problems = problems;
  }
}

/** pure checks (unit-tested): token shape, bot identity, webhook, chat id, confirmation */
export function assertBridgeAllowed({ token, me, webhookInfo, chatId, confirm, forbidBotId, mode = 'run' }) {
  const p = [];
  const m = /^(\d{5,20}):[A-Za-z0-9_-]{30,}$/.exec(String(token || ''));
  if (!m) p.push('token file does not hold a Telegram bot token');
  const botId = m ? m[1] : '';
  if (me && String(me.id) !== botId) p.push('getMe id does not match the token');
  const username = String(me?.username || '');
  if (!/test/i.test(username)) p.push(`bot username must contain "test" (got "${username || '?'}") — use a separate TEST bot, never the store bot`);
  if (forbidBotId && String(forbidBotId) === botId) p.push('this is the forbidden (real store) bot');
  if (webhookInfo?.url) p.push('the bot has a webhook set — refusing (this bridge never changes or removes webhooks)');
  if (mode === 'run') {
    if (!/^-\d{5,20}$/.test(String(chatId || ''))) p.push('--chat-id must be the numeric id of the TEST group (negative)');
    if (!forbidBotId) p.push('--forbid-bot-id <real store bot id> is required (protects the real bot)');
    if (confirm !== username) p.push(`--confirm must equal the test bot username "${username}"`);
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(String(process.env.E2E_TG_LOCAL_SECRET || ''))) p.push('E2E_TG_LOCAL_SECRET (32+ chars, same value as the local Worker run) is required');
  }
  if (p.length) throw new BridgeRefused(p);
  return { botId, username };
}

/** outgoing call from the local Worker -> Telegram: method allow-list, chat forced to the test group */
export function rewriteOutgoing(method, body, chatId) {
  if (!METHODS.has(method)) throw new BridgeRefused([`method ${method} not allowed`]);
  const b = { ...(body || {}) };
  if (method !== 'answerCallbackQuery') b.chat_id = Number(chatId);
  return b;
}

const tg = async (token, method, payload = {}, timeoutMs = 15_000) => {
  const r = await fetch(`${API}/bot${token}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: r.status, data: await r.json().catch(() => null) };
};

async function main(argv) {
  const arg = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  const mode = argv.includes('--run') ? 'run' : 'check';
  const token = readFileSync(arg('token-file') || '', 'utf8').trim();
  const me = (await tg(token, 'getMe')).data?.result;
  const webhookInfo = (await tg(token, 'getWebhookInfo')).data?.result;
  const chatId = arg('chat-id');
  const { username } = assertBridgeAllowed({ token, me, webhookInfo, chatId, confirm: arg('confirm'), forbidBotId: arg('forbid-bot-id'), mode });
  console.log(`test bot @${username}: OK (no webhook)`);
  if (mode === 'check') return;

  const secret = process.env.E2E_TG_LOCAL_SECRET;
  const server = http.createServer(async (req, res) => {
    const m = /^\/telegram\/bot([^/]+)\/([A-Za-z]+)$/.exec(req.url || '');
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (!m || req.method !== 'POST' || m[1] !== secret) return send(404, { ok: false });
    let raw = '';
    for await (const c of req) raw += c;
    try {
      const out = await tg(token, m[2], rewriteOutgoing(m[2], JSON.parse(raw || '{}'), chatId));
      console.log(`→ ${m[2]} ${out.status}`);
      send(out.status, out.data ?? { ok: false });
    } catch (e) {
      send(400, { ok: false, description: String(e.message).slice(0, 200) });
    }
  });
  await new Promise((r) => server.listen(BRIDGE_PORT, '127.0.0.1', r));
  console.log(`bridge on 127.0.0.1:${BRIDGE_PORT} — press the buttons in the TEST group; Ctrl+C to stop`);
  let offset = 0;
  for (;;) {
    const u = await tg(token, 'getUpdates', { offset, timeout: 25, allowed_updates: ['callback_query'] }, 35_000).catch(() => null);
    for (const up of u?.data?.result || []) {
      offset = up.update_id + 1;
      const r = await fetch(`${WORKER_URL}/telegram/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': secret }, body: JSON.stringify(up) }).catch(() => null);
      console.log(`← callback ${String(up.callback_query?.data || '').slice(0, 40)} -> Worker ${r?.status ?? 'unreachable'}`);
    }
    if (!u) await new Promise((r) => setTimeout(r, 2000));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e) => { console.error(e instanceof BridgeRefused ? e.message : `bridge error: ${e.message}`); process.exit(2); });
}
