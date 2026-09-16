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
import { readFileSync } from 'node:fs';
import {
  getTaskArtifactAction,
  getTaskLogActions,
  getTaskLogDetails,
  getTaskTimings,
} from './taskLogDetails';

const task = {
  task_id: 'task-123',
  platform: 'prompt-hubs',
  action: 'text_to_video',
  status: 'SUCCESS',
  progress: '100%',
  submit_time: 1710000000,
  start_time: 1710000001,
  finish_time: 1710000006,
  properties: {
    origin_model_name: 'MiniMax-H3',
    upstream_model_name: 'minimax_h3',
  },
  user_id: 12,
  username: 'skye',
  channel_id: 52,
  group: 'default',
  quota: 800000,
  admin_info: {
    user_id: 12,
    username: 'skye',
    channel_id: 52,
    group: 'default',
    quota: 800000,
    request_id: 'gateway-123',
    request_path: '/v1/videos',
    task_plugin: {
      key: 'prompt-hubs',
      name: 'Prompt Hubs Video',
      version: '1.0.0',
      author: { name: 'Skye', url: 'https://example.com/skye' },
    },
  },
  root_info: {
    task_plugin: { api_version: 1, generation: 42 },
    upstream_task_id: 'provider-123',
    node_name: 'node-a',
  },
  billing: {
    mode: 'tiered_expr',
    group_ratio: 1.2,
    estimated_quota: 600000,
    actual_quota: 720000,
    settled: true,
    usage_facts: {
      seconds: 5,
      resolution: '2K',
      input_images: 2,
      input_video_seconds: 3,
    },
    components: [
      {
        kind: 'base',
        estimated_quota_before_group: 400000,
        actual_quota_before_group: 450000,
        estimated_tier: '2K',
        actual_tier: '2K',
      },
      {
        kind: 'plugin_addon',
        plugin_key: 'hailuo',
        estimated_quota_before_group: 100000,
        actual_quota_before_group: 150000,
        estimated_tier: 'reference_media',
        actual_tier: 'reference_media',
      },
    ],
  },
};

describe('taskLogDetails', () => {
  it('splits completed task time into queue, execution, and total duration', () => {
    expect(getTaskTimings(task)).toEqual({
      totalSeconds: 6,
      queueSeconds: 1,
      executionSeconds: 5,
      isFinished: true,
    });
  });

  it('uses current time as waiting time without inventing a finish time', () => {
    expect(
      getTaskTimings(
        { submit_time: 100, start_time: 105, status: 'IN_PROGRESS' },
        112,
      ),
    ).toEqual({
      totalSeconds: 12,
      queueSeconds: 5,
      executionSeconds: null,
      isFinished: false,
    });
  });

  it('keeps plugin artifacts independent from task details', () => {
    expect(getTaskLogActions({ ...task, artifact_available: true })).toEqual({
      details: 'details',
      artifact: 'plugin',
    });
    expect(getTaskLogActions({ ...task, artifact_available: false })).toEqual({
      details: 'details',
      artifact: 'none',
    });

    expect(getTaskArtifactAction({ ...task, artifact_available: true })).toBe(
      'plugin',
    );
    expect(getTaskArtifactAction({ ...task, artifact_available: false })).toBe(
      'none',
    );
    expect(
      getTaskArtifactAction({
        ...task,
        artifact_available: false,
        legacy_video_available: true,
      }),
    ).toBe('legacy-video');
  });

  it('keeps an available video reachable from the task detail modal', () => {
    const source = readFileSync(
      new URL('./modals/TaskDetailModal.jsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('getTaskArtifactAction(task)');
    expect(source).toContain('onOpenArtifact?.(task)');
  });

  it('projects privileged sections only for the supplied role', () => {
    const userDetails = getTaskLogDetails(task, {
      isAdminUser: false,
      isRootUser: false,
    });
    expect(userDetails.basic.originModel).toBe('MiniMax-H3');
    expect(userDetails.admin).toBeNull();
    expect(userDetails.root).toBeNull();
    expect(userDetails.billing).toMatchObject({
      mode: 'tiered_expr',
      groupRatio: 1.2,
      estimatedQuota: 600000,
      actualQuota: 720000,
      settled: true,
    });
    expect(userDetails.billing.usageFacts).toContainEqual(['seconds', 5]);
    expect(userDetails.billing.components).toEqual([
      {
        kind: 'base',
        pluginKey: '',
        estimatedQuotaBeforeGroup: 400000,
        actualQuotaBeforeGroup: 450000,
        estimatedTier: '2K',
        actualTier: '2K',
      },
      {
        kind: 'plugin_addon',
        pluginKey: 'hailuo',
        estimatedQuotaBeforeGroup: 100000,
        actualQuotaBeforeGroup: 150000,
        estimatedTier: 'reference_media',
        actualTier: 'reference_media',
      },
    ]);

    const rootDetails = getTaskLogDetails(task, {
      isAdminUser: true,
      isRootUser: true,
    });
    expect(rootDetails.admin.plugin.key).toBe('prompt-hubs');
    expect(rootDetails.root.upstreamTaskId).toBe('provider-123');
    expect(rootDetails.root.runtime.generation).toBe(42);
  });

  it('reads administrator fields only from the server-projected admin info', () => {
    const adminTask = {
      ...task,
      user_id: 999,
      username: 'raw-user-must-not-win',
      channel_id: 998,
      group: 'raw-group-must-not-win',
      quota: 997,
      admin_info: {
        ...task.admin_info,
        user_id: 12,
        username: 'skye',
        channel_id: 52,
        group: 'default',
        quota: 800000,
      },
    };

    const userDetails = getTaskLogDetails(adminTask, {
      isAdminUser: false,
      isRootUser: false,
    });
    expect(userDetails.admin).toBeNull();

    const adminDetails = getTaskLogDetails(adminTask, {
      isAdminUser: true,
      isRootUser: false,
    });
    expect(adminDetails.admin).toMatchObject({
      user: 'skye',
      channel: 52,
      group: 'default',
      quota: 800000,
      requestId: 'gateway-123',
      requestPath: '/v1/videos',
    });
  });
});
