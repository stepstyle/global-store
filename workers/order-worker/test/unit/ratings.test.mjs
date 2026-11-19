// node --test test/unit/ratings.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateRatings } from '../../src/ratings.js';

test('published reviews only; missing status counts as published; average to one decimal', () => {
  assert.deepEqual(aggregateRatings([{ rating: 5, status: 'published' }, { rating: 4 }, { rating: 1, status: 'hidden' }]), { avg: 4.5, count: 2 });
  assert.deepEqual(aggregateRatings([{ rating: 5 }, { rating: 4 }, { rating: 4 }]), { avg: 4.3, count: 3 });
});

test('missing / invalid ratings are ignored, never counted as a 1; values clamped to 1..5', () => {
  assert.deepEqual(aggregateRatings([{ rating: null }, { rating: undefined }, { rating: 'abc' }, { rating: 5 }]), { avg: 5, count: 1 });
  assert.deepEqual(aggregateRatings([{ rating: 9 }, { rating: -3 }]), { avg: 3, count: 2 });
  assert.deepEqual(aggregateRatings([]), { avg: 0, count: 0 });
});
