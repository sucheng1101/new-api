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

import React, { useContext, useEffect, useState } from 'react';
import { Button } from '@douyinfe/semi-ui';
import { BarChart3, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { getRelativeTime } from '../../helpers';
import { UserContext } from '../../context/User';
import { StatusContext } from '../../context/Status';
import ApiInfoPanel from './ApiInfoPanel';
import AnnouncementsPanel from './AnnouncementsPanel';
import FaqPanel from './FaqPanel';
import UptimePanel from './UptimePanel';
import OverviewSetupGuide from './OverviewSetupGuide';
import OverviewSummaryPanel from './OverviewSummaryPanel';
import PerformanceHealthPanel from './PerformanceHealthPanel';
import { useDashboardData } from '../../hooks/dashboard/useDashboardData';
import {
  CARD_PROPS,
  FLEX_CENTER_GAP2,
  ILLUSTRATION_SIZE,
  ANNOUNCEMENT_LEGEND_DATA,
  UPTIME_STATUS_MAP,
} from '../../constants/dashboard.constants';
import {
  handleCopyUrl,
  handleSpeedTest,
  getUptimeStatusColor,
  getUptimeStatusText,
  renderMonitorList,
} from '../../helpers/dashboard';

const Dashboard = () => {
  const [userState, userDispatch] = useContext(UserContext);
  const [statusState] = useContext(StatusContext);
  const [refreshKey, setRefreshKey] = useState(0);
  const navigate = useNavigate();
  const dashboardData = useDashboardData(userState, userDispatch, statusState);

  const apiInfoData = statusState?.status?.api_info || [];
  const announcementData = (statusState?.status?.announcements || []).map(
    (item) => {
      const pubDate = item?.publishDate ? new Date(item.publishDate) : null;
      const absoluteTime =
        pubDate && !isNaN(pubDate.getTime())
          ? `${pubDate.getFullYear()}-${String(pubDate.getMonth() + 1).padStart(2, '0')}-${String(pubDate.getDate()).padStart(2, '0')} ${String(pubDate.getHours()).padStart(2, '0')}:${String(pubDate.getMinutes()).padStart(2, '0')}`
          : item?.publishDate || '';
      return {
        ...item,
        time: absoluteTime,
        relative: getRelativeTime(item.publishDate),
      };
    },
  );
  const faqData = statusState?.status?.faq || [];
  const uptimeLegendData = Object.entries(UPTIME_STATUS_MAP).map(
    ([status, info]) => ({
      status: Number(status),
      color: info.color,
      label: dashboardData.t(info.label),
    }),
  );

  useEffect(() => {
    dashboardData.loadUptimeData();
  }, []);

  const handleRefresh = async () => {
    await Promise.all([
      dashboardData.getUserData(),
      dashboardData.loadUptimeData(),
    ]);
    setRefreshKey((value) => value + 1);
  };

  const showLeftContentPanels =
    dashboardData.apiInfoEnabled ||
    dashboardData.announcementsEnabled ||
    dashboardData.faqEnabled;
  const showPerformancePanel = dashboardData.isAdminUser;
  const showContentPanels =
    showPerformancePanel ||
    showLeftContentPanels ||
    dashboardData.uptimeEnabled;

  return (
    <div className='h-full'>
      <div className='mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
        <div>
          <h1 className='text-2xl font-semibold'>{dashboardData.t('概览')}</h1>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          <Button
            theme='light'
            type='tertiary'
            icon={<BarChart3 size={16} />}
            onClick={() => navigate('/console/dashboard')}
          >
            {dashboardData.t('数据看板')}
          </Button>
          <Button
            theme='light'
            type='primary'
            icon={<RefreshCw size={16} />}
            loading={dashboardData.uptimeLoading}
            onClick={handleRefresh}
          >
            {dashboardData.t('刷新')}
          </Button>
        </div>
      </div>

      <OverviewSetupGuide
        user={userState?.user}
        apiInfo={apiInfoData}
        isAdminUser={dashboardData.isAdminUser}
        t={dashboardData.t}
      />

      <OverviewSummaryPanel
        user={userState?.user}
        refreshKey={refreshKey}
        t={dashboardData.t}
      />

      {showContentPanels && (
        <div
          className={`grid grid-cols-1 gap-4 ${
            (showLeftContentPanels || showPerformancePanel) &&
            dashboardData.uptimeEnabled
              ? 'xl:grid-cols-[minmax(0,1fr)_360px]'
              : ''
          }`}
        >
          {(showLeftContentPanels || showPerformancePanel) && (
            <div className='grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2'>
              {showPerformancePanel && (
                <div className='lg:col-span-2'>
                  <PerformanceHealthPanel enabled t={dashboardData.t} />
                </div>
              )}
              {dashboardData.apiInfoEnabled && (
                <ApiInfoPanel
                  apiInfoData={apiInfoData}
                  handleCopyUrl={(url) => handleCopyUrl(url, dashboardData.t)}
                  handleSpeedTest={handleSpeedTest}
                  CARD_PROPS={CARD_PROPS}
                  FLEX_CENTER_GAP2={FLEX_CENTER_GAP2}
                  ILLUSTRATION_SIZE={ILLUSTRATION_SIZE}
                  t={dashboardData.t}
                />
              )}
              {dashboardData.announcementsEnabled && (
                <AnnouncementsPanel
                  announcementData={announcementData}
                  announcementLegendData={ANNOUNCEMENT_LEGEND_DATA.map(
                    (item) => ({
                      ...item,
                      label: dashboardData.t(item.label),
                    }),
                  )}
                  CARD_PROPS={CARD_PROPS}
                  ILLUSTRATION_SIZE={ILLUSTRATION_SIZE}
                  t={dashboardData.t}
                />
              )}
              {dashboardData.faqEnabled && (
                <FaqPanel
                  faqData={faqData}
                  CARD_PROPS={CARD_PROPS}
                  FLEX_CENTER_GAP2={FLEX_CENTER_GAP2}
                  ILLUSTRATION_SIZE={ILLUSTRATION_SIZE}
                  t={dashboardData.t}
                />
              )}
            </div>
          )}

          {dashboardData.uptimeEnabled && (
            <UptimePanel
              uptimeData={dashboardData.uptimeData}
              uptimeLoading={dashboardData.uptimeLoading}
              activeUptimeTab={dashboardData.activeUptimeTab}
              setActiveUptimeTab={dashboardData.setActiveUptimeTab}
              loadUptimeData={dashboardData.loadUptimeData}
              uptimeLegendData={uptimeLegendData}
              renderMonitorList={(monitors) =>
                renderMonitorList(
                  monitors,
                  (status) => getUptimeStatusColor(status, UPTIME_STATUS_MAP),
                  (status) =>
                    getUptimeStatusText(
                      status,
                      UPTIME_STATUS_MAP,
                      dashboardData.t,
                    ),
                  dashboardData.t,
                )
              }
              CARD_PROPS={CARD_PROPS}
              ILLUSTRATION_SIZE={ILLUSTRATION_SIZE}
              t={dashboardData.t}
            />
          )}
        </div>
      )}
    </div>
  );
};

export default Dashboard;
