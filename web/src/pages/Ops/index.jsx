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

import React, { useEffect, useMemo } from 'react';
import { initVChartSemiTheme } from '@visactor/vchart-semi-theme';

import { toOpsParams, useOpsData } from '../../hooks/ops/useOpsData';
import { useDashboardAnalytics } from '../../hooks/dashboard/useDashboardAnalytics';
import FlowAnalyticsPanel from '../../components/dashboard/FlowAnalyticsPanel';
import LotteryAnalyticsPanel from '../../components/dashboard/LotteryAnalyticsPanel';
import OpsAlerts from './components/OpsAlerts';
import OpsDetailModal from './components/OpsDetailModal';
import OpsHeader from './components/OpsHeader';
import OpsOverviewPanel from './components/OpsOverviewPanel';
import OpsRankingsPanel from './components/OpsRankingsPanel';
import OpsSystemStatus from './components/OpsSystemStatus';
import OpsTrendPanel from './components/OpsTrendPanel';
import SystemEventLogPanel from './components/SystemEventLogPanel';

const Ops = ({ pageTitle = '运维监控', variant = 'ops' }) => {
  const isAnalytics = variant === 'analytics';
  const data = useOpsData({
    includeOverview: !isAnalytics,
    includeSystem: !isAnalytics,
    includeRankings: !isAnalytics,
    includeLogs: !isAnalytics,
  });
  const analyticsInputs = useMemo(() => {
    const params = toOpsParams(data.filters);
    return {
      start_timestamp: new Date(params.start_timestamp * 1000).toISOString(),
      end_timestamp: new Date(params.end_timestamp * 1000).toISOString(),
      username: '',
    };
  }, [data.filters]);
  const analytics = useDashboardAnalytics({
    inputs: analyticsInputs,
    isAdminUser: true,
  });

  useEffect(() => {
    initVChartSemiTheme({ isWatchingThemeSwitch: true });
  }, []);

  useEffect(() => {
    if (!isAnalytics) return;
    analytics.loadAnalytics();
  }, [analytics.loadAnalytics, isAnalytics]);

  const refresh = () =>
    data.refresh(isAnalytics ? analytics.loadAnalytics : undefined);

  if (isAnalytics) {
    return (
      <div className='mt-[60px] px-2'>
        <OpsHeader
          {...data}
          refresh={refresh}
          pageTitle={pageTitle}
          showDimensionFilters={false}
        />
        <FlowAnalyticsPanel
          flowData={analytics.flowData}
          loading={analytics.flowLoading}
          isAdminUser
          onRefresh={analytics.loadFlowData}
          t={data.t}
        />
        <LotteryAnalyticsPanel
          stats={analytics.lotteryStats}
          loading={analytics.lotteryLoading}
          t={data.t}
        />
      </div>
    );
  }

  return (
    <div className='mt-[60px] px-2'>
      <OpsHeader {...data} refresh={refresh} pageTitle={pageTitle} />
      <OpsOverviewPanel {...data} />
      <OpsSystemStatus {...data} />
      <div className='grid grid-cols-1 gap-3 xl:grid-cols-12'>
        <div className='xl:col-span-5'>
          <OpsTrendPanel overview={data.overview} t={data.t} />
        </div>
        <div className='xl:col-span-4'>
          <OpsRankingsPanel {...data} />
        </div>
        <div className='xl:col-span-3'>
          <OpsAlerts
            alerts={data.overview?.recent_alerts || []}
            openEventDetail={data.openEventDetail}
            t={data.t}
          />
        </div>
      </div>
      <SystemEventLogPanel {...data} />
      <OpsDetailModal {...data} />
    </div>
  );
};

export default Ops;
