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

export const TASK_LOG_COLUMN_KEYS = Object.freeze({
  SUBMIT_TIME: 'submit_time',
  FINISH_TIME: 'finish_time',
  DURATION: 'duration',
  CHANNEL: 'channel',
  USERNAME: 'username',
  PLATFORM: 'platform',
  TYPE: 'type',
  TASK_ID: 'task_id',
  TASK_STATUS: 'task_status',
  PROGRESS: 'progress',
  DETAILS: 'details',
  ARTIFACTS: 'artifacts',
});

const RETIRED_COLUMN_KEYS = {
  FAIL_REASON: 'fail_reason',
  RESULT_URL: 'result_url',
};

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

export const getDefaultTaskLogColumnVisibility = (isAdminUser) => ({
  [TASK_LOG_COLUMN_KEYS.SUBMIT_TIME]: true,
  [TASK_LOG_COLUMN_KEYS.FINISH_TIME]: true,
  [TASK_LOG_COLUMN_KEYS.DURATION]: true,
  [TASK_LOG_COLUMN_KEYS.CHANNEL]: isAdminUser,
  [TASK_LOG_COLUMN_KEYS.USERNAME]: isAdminUser,
  [TASK_LOG_COLUMN_KEYS.PLATFORM]: true,
  [TASK_LOG_COLUMN_KEYS.TYPE]: true,
  [TASK_LOG_COLUMN_KEYS.TASK_ID]: true,
  [TASK_LOG_COLUMN_KEYS.TASK_STATUS]: true,
  [TASK_LOG_COLUMN_KEYS.PROGRESS]: true,
  [TASK_LOG_COLUMN_KEYS.DETAILS]: true,
  [TASK_LOG_COLUMN_KEYS.ARTIFACTS]: true,
});

export const normalizeTaskLogColumnVisibility = (savedColumns, isAdminUser) => {
  const migrated =
    savedColumns &&
    typeof savedColumns === 'object' &&
    !Array.isArray(savedColumns)
      ? { ...savedColumns }
      : {};

  if (
    !hasOwn(migrated, TASK_LOG_COLUMN_KEYS.DETAILS) &&
    hasOwn(migrated, RETIRED_COLUMN_KEYS.FAIL_REASON)
  ) {
    migrated[TASK_LOG_COLUMN_KEYS.DETAILS] =
      migrated[RETIRED_COLUMN_KEYS.FAIL_REASON];
  }
  if (
    !hasOwn(migrated, TASK_LOG_COLUMN_KEYS.ARTIFACTS) &&
    hasOwn(migrated, RETIRED_COLUMN_KEYS.RESULT_URL)
  ) {
    migrated[TASK_LOG_COLUMN_KEYS.ARTIFACTS] =
      migrated[RETIRED_COLUMN_KEYS.RESULT_URL];
  }

  delete migrated[RETIRED_COLUMN_KEYS.FAIL_REASON];
  delete migrated[RETIRED_COLUMN_KEYS.RESULT_URL];

  const normalized = {
    ...getDefaultTaskLogColumnVisibility(isAdminUser),
    ...migrated,
  };
  if (!isAdminUser) {
    normalized[TASK_LOG_COLUMN_KEYS.CHANNEL] = false;
    normalized[TASK_LOG_COLUMN_KEYS.USERNAME] = false;
  }
  return normalized;
};
