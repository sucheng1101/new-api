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

import { describe, expect, it } from 'bun:test';
import {
  TASK_LOG_COLUMN_KEYS,
  normalizeTaskLogColumnVisibility,
} from './taskLogColumnVisibility';

describe('task log column visibility', () => {
  it('migrates old details and result columns without retaining retired keys', () => {
    const visibility = normalizeTaskLogColumnVisibility(
      {
        fail_reason: false,
        result_url: true,
        progress: false,
      },
      true,
    );

    expect(visibility[TASK_LOG_COLUMN_KEYS.DETAILS]).toBe(false);
    expect(visibility[TASK_LOG_COLUMN_KEYS.ARTIFACTS]).toBe(true);
    expect(visibility[TASK_LOG_COLUMN_KEYS.PROGRESS]).toBe(false);
    expect(visibility).not.toHaveProperty('fail_reason');
    expect(visibility).not.toHaveProperty('result_url');
    expect(Object.values(TASK_LOG_COLUMN_KEYS)).not.toContain('fail_reason');
    expect(Object.values(TASK_LOG_COLUMN_KEYS)).not.toContain('result_url');
  });

  it('does not restore administrator-only columns for a normal user', () => {
    const visibility = normalizeTaskLogColumnVisibility(
      { channel: true, username: true },
      false,
    );

    expect(visibility[TASK_LOG_COLUMN_KEYS.CHANNEL]).toBe(false);
    expect(visibility[TASK_LOG_COLUMN_KEYS.USERNAME]).toBe(false);
    expect(visibility[TASK_LOG_COLUMN_KEYS.DETAILS]).toBe(true);
    expect(visibility[TASK_LOG_COLUMN_KEYS.ARTIFACTS]).toBe(true);
  });
});
