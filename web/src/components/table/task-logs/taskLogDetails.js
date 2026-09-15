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

const isRecord = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const asRecord = (value) => (isRecord(value) ? value : {});

const stringValue = (value) =>
  typeof value === 'string' && value.trim() ? value.trim() : '';

const numberValue = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const taskIsSuccessful = (task) => task?.status === 'SUCCESS';

export const getTaskTimings = (task, now = Date.now() / 1000) => {
  const submitTime = numberValue(task?.submit_time);
  const startTime = numberValue(task?.start_time);
  const finishTime = numberValue(task?.finish_time);
  const endTime = finishTime ?? (submitTime !== null ? now : null);
  const totalSeconds =
    submitTime !== null && endTime !== null
      ? Math.max(0, endTime - submitTime)
      : null;
  const queueSeconds =
    submitTime !== null && startTime !== null
      ? Math.max(0, startTime - submitTime)
      : null;
  const executionSeconds =
    startTime !== null && finishTime !== null
      ? Math.max(0, finishTime - startTime)
      : null;
  return {
    totalSeconds,
    queueSeconds,
    executionSeconds,
    isFinished: finishTime !== null,
  };
};

export const getTaskArtifactAction = (task) => {
  if (!taskIsSuccessful(task)) return 'none';
  if (task?.artifact_available) return 'plugin';
  if (task?.legacy_video_available) return 'legacy-video';
  if (
    task?.platform === 'suno' &&
    Array.isArray(task?.data) &&
    task.data.some((item) => isRecord(item) && stringValue(item.audio_url))
  ) {
    return 'legacy-audio';
  }
  return 'none';
};

export const getTaskLogActions = (task) => ({
  details: 'details',
  artifact: getTaskArtifactAction(task),
});

export const getTaskLogDetails = (
  task,
  { isAdminUser = false, isRootUser = false } = {},
) => {
  const safeTask = asRecord(task);
  const properties = asRecord(safeTask.properties);
  const basic = {
    taskId: stringValue(safeTask.task_id),
    platform: stringValue(safeTask.platform),
    action: stringValue(safeTask.action),
    status: stringValue(safeTask.status),
    progress: stringValue(safeTask.progress),
    submitTime: numberValue(safeTask.submit_time),
    startTime: numberValue(safeTask.start_time),
    finishTime: numberValue(safeTask.finish_time),
    timings: getTaskTimings(safeTask),
    originModel: stringValue(properties.origin_model_name),
    actualModel: stringValue(properties.upstream_model_name),
    failReason: stringValue(safeTask.fail_reason),
  };

  let admin = null;
  if (isAdminUser) {
    const adminInfo = asRecord(safeTask.admin_info);
    const pluginValue = asRecord(adminInfo.task_plugin);
    const authorValue = asRecord(pluginValue.author);
    const plugin = stringValue(pluginValue.key)
      ? {
          key: stringValue(pluginValue.key),
          name: stringValue(pluginValue.name),
          version: stringValue(pluginValue.version),
          author: {
            name: stringValue(authorValue.name),
            url: stringValue(authorValue.url),
          },
        }
      : null;
    admin = {
      user:
        stringValue(adminInfo.username) ||
        String(numberValue(adminInfo.user_id) ?? ''),
      channel: numberValue(adminInfo.channel_id),
      group: stringValue(adminInfo.group),
      quota: numberValue(adminInfo.quota),
      requestId: stringValue(adminInfo.request_id),
      requestPath: stringValue(adminInfo.request_path),
      plugin,
    };
  }

  let root = null;
  if (isRootUser) {
    const rootInfo = asRecord(safeTask.root_info);
    const runtimeValue = asRecord(rootInfo.task_plugin);
    const runtime =
      stringValue(runtimeValue.key) ||
      stringValue(runtimeValue.version) ||
      numberValue(runtimeValue.api_version) !== null ||
      numberValue(runtimeValue.generation) !== null
        ? {
            key: stringValue(runtimeValue.key),
            version: stringValue(runtimeValue.version),
            apiVersion: numberValue(runtimeValue.api_version),
            generation: numberValue(runtimeValue.generation),
          }
        : null;
    root = {
      runtime,
      upstreamTaskId: stringValue(rootInfo.upstream_task_id),
      nodeName: stringValue(rootInfo.node_name),
    };
  }

  return { basic, admin, root };
};
