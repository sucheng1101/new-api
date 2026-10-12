/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

import { beforeEach, describe, expect, test } from 'bun:test';
import { formatRmb, quotaToRmb, rmbToQuota } from './promotionLotteryQuota';

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  clear: () => storage.clear(),
};

describe('promotion and lottery RMB conversion', () => {
  beforeEach(() => localStorage.clear());

  test('uses the runtime quota unit without applying currency exchange rates', () => {
    localStorage.setItem('quota_per_unit', '500000');
    expect(quotaToRmb(1250000)).toBe(2.5);
    expect(rmbToQuota(2.5)).toBe(1250000);
  });

  test('falls back to the internal default unit', () => {
    expect(quotaToRmb(500000)).toBe(1);
    expect(rmbToQuota(1)).toBe(500000);
  });

  test('formats administrator-facing values with the RMB symbol', () => {
    expect(formatRmb(2)).toBe('￥2.000000');
  });

  test('keeps one quota unit visible for small balances', () => {
    expect(formatRmb(quotaToRmb(1))).toBe('￥0.000002');
  });

  test('rejects invalid or unsafe values instead of converting them to zero', () => {
    expect(rmbToQuota('')).toBeNull();
    expect(rmbToQuota(-1)).toBeNull();
    expect(rmbToQuota(Number.NaN)).toBeNull();
    expect(rmbToQuota(Number.POSITIVE_INFINITY)).toBeNull();
    expect(rmbToQuota(Number.MAX_SAFE_INTEGER)).toBeNull();
    expect(quotaToRmb(Number.MAX_SAFE_INTEGER + 1)).toBeNull();
  });
});
