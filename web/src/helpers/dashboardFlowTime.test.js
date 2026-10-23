import assert from 'node:assert/strict';
import test from 'node:test';
import { getLast24HoursRange } from './dashboardFlowTime.js';

test('defaults flow analytics to the rolling 24 hours', () => {
  const now = Date.UTC(2026, 9, 23, 8, 30, 0);
  const range = getLast24HoursRange(now);

  assert.equal(Date.parse(range.end_timestamp), now);
  assert.equal(Date.parse(range.start_timestamp), now - 24 * 60 * 60 * 1000);
});
