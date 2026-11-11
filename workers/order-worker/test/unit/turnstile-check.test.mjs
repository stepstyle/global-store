// Server-side Turnstile result check (src/index.js turnstileResultOk) — pure, local.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { turnstileResultOk } from '../../src/index.js';

const prod = { isProd: true, allowedOrigins: ['https://dairsharaf.com', 'https://www.dairsharaf.com'] };
const staging = { isProd: false, allowedOrigins: ['http://127.0.0.1:3000'] };

test('Turnstile: only success === true counts; in production the token must be issued for the store\'s own hostname', () => {
  assert.equal(turnstileResultOk({ success: true, hostname: 'dairsharaf.com' }, prod), true);
  assert.equal(turnstileResultOk({ success: true, hostname: 'www.dairsharaf.com' }, prod), true);
  for (const bad of [
    { success: true, hostname: 'evil.example' },
    { success: true, hostname: 'dairsharaf.com.evil.example' },
    { success: true },
    { success: false, hostname: 'dairsharaf.com' },
    { success: 'true', hostname: 'dairsharaf.com' },
    {},
    null,
  ]) assert.equal(turnstileResultOk(bad, prod), false, JSON.stringify(bad));
  // staging / local use Cloudflare's TEST keys (placeholder hostname): success is enough there
  assert.equal(turnstileResultOk({ success: true, hostname: 'example.com' }, staging), true);
  assert.equal(turnstileResultOk({ success: false }, staging), false);
});
