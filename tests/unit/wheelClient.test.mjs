// Prize wheel client (src/services/wheel.ts) — the spin id is sent ONLY with a signed-in order (orderSubmit).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WHEEL_ENABLED, WHEEL_SPIN_ID_RE } from '../../src/services/wheel.ts';

test('wheel is OFF in a normal build (no VITE_WHEEL_MODE)', () => {
  assert.equal(WHEEL_ENABLED, false);
  assert.ok(WHEEL_SPIN_ID_RE.test('test-campaign_aliceUid000000000000000000A1_1'));
  assert.ok(!WHEEL_SPIN_ID_RE.test('../orders/x_1'));
});
