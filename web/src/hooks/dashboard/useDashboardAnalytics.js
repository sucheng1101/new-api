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

import { useCallback, useState } from 'react';
import { API, showError } from '../../helpers';

const toTimestamp = (value) => {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : 0;
};

const responseData = (response) => {
  if (!response?.data?.success) {
    throw new Error(response?.data?.message || '数据加载失败');
  }
  return response.data.data;
};

export const useDashboardAnalytics = ({ inputs, isAdminUser }) => {
  const [flowData, setFlowData] = useState([]);
  const [flowLoading, setFlowLoading] = useState(false);
  const [lotteryStats, setLotteryStats] = useState(null);
  const [lotteryLoading, setLotteryLoading] = useState(false);

  const getRangeParams = useCallback(() => {
    const startTimestamp = toTimestamp(inputs?.start_timestamp);
    const endTimestamp = toTimestamp(inputs?.end_timestamp);
    if (!startTimestamp || !endTimestamp || endTimestamp < startTimestamp) {
      return null;
    }
    return `start_timestamp=${startTimestamp}&end_timestamp=${endTimestamp}`;
  }, [inputs?.end_timestamp, inputs?.start_timestamp]);

  const loadFlowData = useCallback(async () => {
    const range = getRangeParams();
    if (!range) {
      setFlowData([]);
      return [];
    }
    setFlowLoading(true);
    try {
      const username = isAdminUser
        ? `&username=${encodeURIComponent(inputs?.username || '')}`
        : '';
      const endpoint = isAdminUser
        ? `/api/data/flow?${range}${username}`
        : `/api/data/flow/self?${range}`;
      const data = responseData(await API.get(endpoint));
      const rows = Array.isArray(data) ? data : [];
      setFlowData(rows);
      return rows;
    } catch (error) {
      showError(error);
      setFlowData([]);
      return [];
    } finally {
      setFlowLoading(false);
    }
  }, [getRangeParams, inputs?.username, isAdminUser]);

  const loadLotteryStats = useCallback(async () => {
    if (!isAdminUser) {
      setLotteryStats(null);
      return null;
    }
    const range = getRangeParams();
    if (!range) {
      setLotteryStats(null);
      return null;
    }
    setLotteryLoading(true);
    try {
      const data = responseData(
        await API.get(`/api/admin/lottery/stats?${range}`),
      );
      setLotteryStats(data || null);
      return data || null;
    } catch (error) {
      showError(error);
      setLotteryStats(null);
      return null;
    } finally {
      setLotteryLoading(false);
    }
  }, [getRangeParams, isAdminUser]);

  const loadAnalytics = useCallback(async () => {
    await Promise.all([loadFlowData(), loadLotteryStats()]);
  }, [loadFlowData, loadLotteryStats]);

  return {
    flowData,
    flowLoading,
    lotteryStats,
    lotteryLoading,
    loadFlowData,
    loadLotteryStats,
    loadAnalytics,
  };
};
