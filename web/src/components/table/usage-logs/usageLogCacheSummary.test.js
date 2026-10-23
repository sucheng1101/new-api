import assert from 'node:assert/strict';
import test from 'node:test';
import { getCacheReadPercentage } from './usageLogCacheSummary.js';

test('calculates cache reads as a percentage of input tokens', () => {
  const percentage = getCacheReadPercentage(182400, 184896);

  assert.equal(Number(percentage.toFixed(1)), 98.7);
});

test('caps cache read percentage at 100 and omits invalid denominators', () => {
  assert.equal(getCacheReadPercentage(120, 100), 100);
  assert.equal(getCacheReadPercentage(120, 0), null);
  assert.equal(getCacheReadPercentage(0, 100), null);
});
