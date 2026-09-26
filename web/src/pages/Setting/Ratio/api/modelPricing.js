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
import { API } from '../../../../helpers';

function responseMessage(response, fallback) {
  return response?.data?.message || fallback;
}

export async function getModelPricing(modelNames = []) {
  const query = modelNames
    .filter(Boolean)
    .map((modelName) => `model=${encodeURIComponent(modelName)}`)
    .join('&');
  const endpoint = query
    ? `/api/option/model_pricing?${query}`
    : '/api/option/model_pricing';
  const response = await API.get(endpoint, {
    skipErrorHandler: true,
  });
  if (!response?.data?.success) {
    throw new Error(responseMessage(response, '加载模型定价失败'));
  }
  return response.data.data;
}

export async function getTaskPluginModelNames() {
  const response = await API.get('/api/task_plugin_options', {
    skipErrorHandler: true,
  });
  if (!response?.data?.success) {
    throw new Error(responseMessage(response, '加载任务插件失败'));
  }
  return Array.from(
    new Set(
      (response.data.data ?? []).flatMap((plugin) =>
        Array.isArray(plugin.models) ? plugin.models : [],
      ),
    ),
  );
}

export async function previewModelPricing(pricing) {
  const response = await API.post(
    '/api/option/model_pricing/preview',
    pricing,
    {
      skipErrorHandler: true,
    },
  );
  if (!response?.data?.success) {
    throw new Error(responseMessage(response, '预览模型定价失败'));
  }
  return response.data.data;
}

export async function saveModelPricing(changes) {
  try {
    const response = await API.patch(
      '/api/option/model_pricing',
      { changes },
      { skipErrorHandler: true },
    );
    if (!response?.data?.success) {
      throw new Error(responseMessage(response, '保存模型定价失败'));
    }
    return { conflict: false, data: response.data.data };
  } catch (error) {
    if (error?.response?.status === 409) {
      return {
        conflict: true,
        message: error.response.data?.message || '模型定价已更新',
      };
    }
    throw error;
  }
}
