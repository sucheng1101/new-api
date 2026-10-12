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

import { describe, expect, test } from 'bun:test';
import { buildApiEndpoint, normalizeServerAddress } from './token';

describe('token endpoint helpers', () => {
  test('normalizes configured server addresses', () => {
    expect(normalizeServerAddress(' https://api.example.com/// ')).toBe(
      'https://api.example.com',
    );
  });

  test('builds the OpenAI endpoint without duplicate suffixes', () => {
    expect(buildApiEndpoint('https://api.example.com/')).toBe(
      'https://api.example.com/v1',
    );
    expect(buildApiEndpoint('https://api.example.com/v1/')).toBe(
      'https://api.example.com/v1',
    );
  });

  test('keeps custom paths and handles an empty base address', () => {
    expect(buildApiEndpoint('https://api.example.com/base', '/v1beta')).toBe(
      'https://api.example.com/base/v1beta',
    );
    expect(buildApiEndpoint('', '/v1')).toBe('/v1');
  });
});
