// Notify sink tests — pure Node, in-memory KV. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sink, { sinkConfig, summarize } from '../src/index.js';

class MemoryKV {
  constructor() {
    this.m = new Map();
  }
  async get(k) {
    return this.m.has(k) ? this.m.get(k) : null;
  }
  async put(k, v) {
    this.m.set(k, v);
  }
  async delete(k) {
    this.m.delete(k);
  }
  async list({ prefix = '', limit = 1000 } = {}) {
    return { keys: [...this.m.keys()].filter((k) => k.startsWith(prefix)).sort().slice(0, limit).map((name) => ({ name })) };
  }
}

const TG = 'tg-token-aaaaaaaaaaaaaaaaaaaaaaaa';
const SG = 'sg-key-bbbbbbbbbbbbbbbbbbbbbbbbbbb';
const RD = 'read-token-cccccccccccccccccccccc';
const mkEnv = (o = {}) => ({ SINK_ENVIRONMENT: 'staging', SINK_TELEGRAM_TOKEN: TG, SINK_SENDGRID_KEY: SG, SINK_READ_TOKEN: RD, SINK_KV: new MemoryKV(), ...o });

const call = (env, path, { method = 'GET', body, headers = {} } = {}) =>
  sink.fetch(new Request(`https://sink.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);

// Message shaped like order-worker notify.buildMessage(), with fake personal data
const MESSAGE = [
  '🛒 New Order', '', 'Order ID: ORD-ABCD1234-MZ0Q1X2Y', 'Customer: Test Buyer', 'Phone: +962791234567',
  'City: عمّان', 'Street: شارع 1', 'Payment: cliq (ref 1234567890)', 'Shipping: standard', '', 'Items:', '1) دفتر x2 - JOD 2.50', '',
  'Total (customer saw): JOD 0.50', 'Total (server check): JOD 8.20', '⚠️ PRICE MISMATCH — verify the amount before confirming',
  '⚠️ Warnings: PRICE_MISMATCH, STOCK_SHORTFALL(item 2)', '', 'Note: اتصل قبل الوصول',
].join('\n');
const PII = ['Test Buyer', '+962791234567', 'شارع', '1234567890', 'اتصل', 'buyer@example.com', 'admin@example.invalid', 'staging-chat'];

test('refuses to run when misconfigured (wrong env, short / duplicate tokens, no KV)', async () => {
  for (const o of [
    { SINK_ENVIRONMENT: 'production' },
    { SINK_ENVIRONMENT: undefined },
    { SINK_READ_TOKEN: 'short' },
    { SINK_SENDGRID_KEY: TG },
    { SINK_KV: undefined },
  ]) {
    const env = mkEnv(o);
    assert.equal(sinkConfig(env).ok, false, JSON.stringify(Object.keys(o)));
    const r = await call(env, '/');
    assert.equal(r.status, 500);
  }
});

test('Telegram stand-in: wrong token -> 401 and nothing recorded', async () => {
  const env = mkEnv();
  const r = await call(env, '/telegram/botWRONGTOKENxxxxxxxxxxxxxxxxx/sendMessage', { method: 'POST', body: { chat_id: 'x', text: MESSAGE } });
  assert.equal(r.status, 401);
  assert.equal(env.SINK_KV.m.size, 0);
});

test('SendGrid stand-in: wrong / missing bearer -> 401 and nothing recorded', async () => {
  const env = mkEnv();
  for (const headers of [{}, { authorization: 'Bearer nope' }, { authorization: SG }]) {
    const r = await call(env, '/sendgrid/v3/mail/send', { method: 'POST', body: { content: [{ value: MESSAGE }] }, headers });
    assert.equal(r.status, 401);
  }
  assert.equal(env.SINK_KV.m.size, 0);
});

test('records only a summary: no personal data, no tokens, no headers, no recipients', async () => {
  const env = mkEnv();
  const t = await call(env, `/telegram/bot${TG}/sendMessage`, { method: 'POST', body: { chat_id: 'staging-chat', text: MESSAGE } });
  assert.equal(t.status, 200);
  const e = await call(env, '/sendgrid/v3/mail/send', {
    method: 'POST',
    headers: { authorization: `Bearer ${SG}` },
    body: { personalizations: [{ to: [{ email: 'admin@example.invalid' }] }], from: { email: 'buyer@example.com' }, content: [{ type: 'text/plain', value: MESSAGE }] },
  });
  assert.equal(e.status, 202);

  const stored = [...env.SINK_KV.m.values()].join('\n');
  for (const s of [...PII, TG, SG, RD, 'authorization', 'Bearer']) assert.equal(stored.includes(s), false, `stored ${s}`);

  const r = await call(env, '/calls', { headers: { 'x-sink-auth': RD } });
  const { calls } = await r.json();
  assert.equal(calls.length, 2);
  for (const c of calls) {
    assert.deepEqual(Object.keys(c).sort(), ['at', 'channel', 'customerTotal', 'length', 'ok', 'orderId', 'priceMismatch', 'serverTotal', 'sha256', 'warningCodes']);
    assert.equal(c.orderId, 'ORD-ABCD1234-MZ0Q1X2Y');
    assert.equal(c.priceMismatch, true);
    assert.equal(c.serverTotal, 8.2);
    assert.equal(c.customerTotal, 0.5);
    assert.deepEqual(c.warningCodes, ['PRICE_MISMATCH', 'STOCK_SHORTFALL']);
  }
});

test('/calls and /control require x-sink-auth', async () => {
  const env = mkEnv();
  assert.equal((await call(env, '/calls')).status, 401);
  assert.equal((await call(env, '/calls', { headers: { 'x-sink-auth': TG } })).status, 401);
  assert.equal((await call(env, '/control', { method: 'POST', body: { failNext: { telegram: 1 } } })).status, 401);
  assert.equal((await call(env, '/calls', { method: 'DELETE' })).status, 401);
});

test('failure injection: failNext makes the next N sends fail, then recover', async () => {
  const env = mkEnv();
  await call(env, '/control', { method: 'POST', headers: { 'x-sink-auth': RD }, body: { failNext: { telegram: 2 } } });
  const statuses = [];
  for (let i = 0; i < 3; i++) statuses.push((await call(env, `/telegram/bot${TG}/sendMessage`, { method: 'POST', body: { text: MESSAGE } })).status);
  assert.deepEqual(statuses, [500, 500, 200]);
  const { calls } = await (await call(env, '/calls', { headers: { 'x-sink-auth': RD } })).json();
  assert.deepEqual(calls.map((c) => c.ok), [false, false, true]);
});

test('failNext is clamped to 0..10', async () => {
  const env = mkEnv();
  const r = await call(env, '/control', { method: 'POST', headers: { 'x-sink-auth': RD }, body: { failNext: { telegram: 9999, email: -5 } } });
  assert.deepEqual((await r.json()).failNext, { telegram: 10, email: 0 });
});

test('DELETE /calls clears records; oversized body -> 413; unknown path -> 404', async () => {
  const env = mkEnv();
  await call(env, `/telegram/bot${TG}/sendMessage`, { method: 'POST', body: { text: MESSAGE } });
  const d = await call(env, '/calls', { method: 'DELETE', headers: { 'x-sink-auth': RD } });
  assert.equal((await d.json()).deleted, 1);
  const big = await call(env, `/telegram/bot${TG}/sendMessage`, { method: 'POST', body: { text: 'x'.repeat(70 * 1024) } });
  assert.equal(big.status, 413);
  assert.equal((await call(env, '/anything')).status, 404);
});

test('the sink never makes outbound requests', async () => {
  const original = globalThis.fetch;
  let outbound = 0;
  globalThis.fetch = async () => {
    outbound += 1;
    throw new Error('no outbound allowed');
  };
  try {
    const env = mkEnv();
    await call(env, `/telegram/bot${TG}/sendMessage`, { method: 'POST', body: { text: MESSAGE } });
    await call(env, '/sendgrid/v3/mail/send', { method: 'POST', headers: { authorization: `Bearer ${SG}` }, body: { content: [{ value: MESSAGE }] } });
    await call(env, '/calls', { headers: { 'x-sink-auth': RD } });
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(outbound, 0);
});

test('summarize() of a message without order id / totals', async () => {
  const s = await summarize('telegram', 'hello');
  assert.equal(s.orderId, null);
  assert.equal(s.serverTotal, null);
  assert.deepEqual(s.warningCodes, []);
});
