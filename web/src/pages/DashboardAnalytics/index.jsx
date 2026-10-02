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

import React, { useCallback, useContext, useEffect, useMemo } from 'react';
import { Button, TabPane, Tabs, Typography } from '@douyinfe/semi-ui';
import { BarChart3, Coins, Hash, RefreshCw, Search, Timer } from 'lucide-react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';

import { UserContext } from '../../context/User';
import { StatusContext } from '../../context/Status';
import { renderNumber, renderQuota } from '../../helpers';
import ChartsPanel from '../../components/dashboard/ChartsPanel';
import FlowAnalyticsPanel from '../../components/dashboard/FlowAnalyticsPanel';
import PerformanceHealthPanel from '../../components/dashboard/PerformanceHealthPanel';
import SearchModal from '../../components/dashboard/modals/SearchModal';
import { useDashboardData } from '../../hooks/dashboard/useDashboardData';
import { useDashboardCharts } from '../../hooks/dashboard/useDashboardCharts';
import { useDashboardAnalytics } from '../../hooks/dashboard/useDashboardAnalytics';
import { useSidebar } from '../../hooks/common/useSidebar';
import {
  CARD_PROPS,
  CHART_CONFIG,
  FLEX_CENTER_GAP2,
} from '../../constants/dashboard.constants';

const SummaryCard = ({ icon, label, value, description, loading }) => (
  <div className='min-w-0 px-3 py-3 sm:px-5 sm:py-4'>
    <div className='flex items-center gap-2 text-xs font-medium text-semi-color-text-2'>
      <span className='flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-600 dark:bg-blue-950/40'>
        {icon}
      </span>
      <span className='truncate'>{label}</span>
    </div>
    <div
      className='mt-2 truncate text-xl font-semibold'
      title={loading ? '' : String(value)}
    >
      {loading ? '—' : value}
    </div>
    <div className='mt-1 hidden text-xs text-semi-color-text-2 md:block'>
      {description}
    </div>
  </div>
);

const DashboardAnalytics = () => {
  const [userState, userDispatch] = useContext(UserContext);
  const [statusState] = useContext(StatusContext);
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { isModuleVisible, loading: sidebarLoading } = useSidebar();
  const dashboardData = useDashboardData(userState, userDispatch, statusState);
  const dashboardCharts = useDashboardCharts(
    dashboardData.dataExportDefaultTime,
    dashboardData.setTrendData,
    dashboardData.setConsumeQuota,
    dashboardData.setTimes,
    dashboardData.setConsumeTokens,
    dashboardData.setPieData,
    dashboardData.setLineData,
    dashboardData.setModelColors,
    dashboardData.t,
  );
  const analytics = useDashboardAnalytics({
    inputs: dashboardData.inputs,
    isAdminUser: dashboardData.isAdminUser,
  });
  const [userTopLimit, setUserTopLimit] = React.useState(10);
  const [userRangeDays, setUserRangeDays] = React.useState(1);
  const [userChartData, setUserChartData] = React.useState([]);
  const usersSectionVisible =
    dashboardData.isAdminUser &&
    (sidebarLoading || isModuleVisible('admin', 'dashboardUsers'));
  const pathnameSection = location.pathname.endsWith('/flow')
    ? 'flow'
    : location.pathname.endsWith('/users')
      ? 'users'
      : location.pathname.endsWith('/models')
        ? 'models'
        : null;
  const requestedSection = searchParams.get('section') || pathnameSection;
  const section =
    requestedSection === 'flow' ||
    (requestedSection === 'users' && usersSectionVisible)
      ? requestedSection
      : 'models';

  const loadModelData = useCallback(async () => {
    const data = await dashboardData.loadQuotaData();
    dashboardCharts.updateChartData(data || []);
  }, [dashboardCharts.updateChartData, dashboardData.loadQuotaData]);

  const loadUserData = useCallback(
    async (
      limit = userTopLimit,
      granularity = dashboardData.dataExportDefaultTime,
      rangeDays = userRangeDays,
    ) => {
      const end = Math.floor(Date.now() / 1000);
      const start = end - Number(rangeDays || 1) * 86400;
      const data = await dashboardData.loadUserQuotaData({
        start_timestamp: new Date(start * 1000).toISOString(),
        end_timestamp: new Date(end * 1000).toISOString(),
      });
      const rows = data || [];
      setUserChartData(rows);
      dashboardCharts.updateUserChartData(rows, limit, granularity);
      return rows;
    },
    [
      dashboardCharts.updateUserChartData,
      dashboardData.dataExportDefaultTime,
      dashboardData.loadUserQuotaData,
      userRangeDays,
      userTopLimit,
    ],
  );

  const loadSectionData = useCallback(async () => {
    if (section === 'flow') {
      await analytics.loadFlowData();
      return;
    }
    if (section === 'users') {
      await loadUserData();
      return;
    }
    await loadModelData();
  }, [analytics.loadFlowData, loadModelData, loadUserData, section]);

  useEffect(() => {
    if (searchParams.get('section') && pathnameSection) {
      setSearchParams({}, { replace: true });
    }
  }, [pathnameSection, searchParams, setSearchParams]);

  useEffect(() => {
    if (section === 'users') {
      dashboardData.setActiveChartTab('5');
    } else if (!['2', '3', '4'].includes(dashboardData.activeChartTab)) {
      dashboardData.setActiveChartTab('2');
    }
    loadSectionData();
    // Each route owns its first load; filter changes load only after confirmation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);

  const handleApplyFilters = async () => {
    dashboardData.handleCloseModal();
    await loadSectionData();
  };

  const visibleSections = useMemo(
    () => [
      { key: 'models', label: dashboardData.t('模型调用分析') },
      { key: 'flow', label: dashboardData.t('分流') },
      ...(usersSectionVisible
        ? [{ key: 'users', label: dashboardData.t('用户统计') }]
        : []),
    ],
    [dashboardData.t, usersSectionVisible],
  );

  const loading =
    section === 'flow' ? analytics.flowLoading : dashboardData.loading;
  const sectionTitle =
    visibleSections.find((item) => item.key === section)?.label ||
    dashboardData.t('数据看板');
  return (
    <div className='dashboard-analytics-page mx-auto w-full max-w-[1800px] px-2 pb-8 sm:px-4'>
      <SearchModal
        searchModalVisible={dashboardData.searchModalVisible}
        handleSearchConfirm={handleApplyFilters}
        handleCloseModal={dashboardData.handleCloseModal}
        isMobile={dashboardData.isMobile}
        isAdminUser={dashboardData.isAdminUser && section !== 'users'}
        inputs={dashboardData.inputs}
        dataExportDefaultTime={dashboardData.dataExportDefaultTime}
        timeOptions={dashboardData.timeOptions}
        handleInputChange={dashboardData.handleInputChange}
        t={dashboardData.t}
      />

      <div className='dashboard-page-heading mb-3 flex flex-wrap items-center justify-between gap-3'>
        <div>
          <Typography.Title heading={4} style={{ margin: 0 }}>
            {sectionTitle}
          </Typography.Title>
        </div>
      </div>

      <div className='dashboard-analytics-toolbar mb-4 flex flex-wrap items-center justify-between gap-3'>
        <div className='overflow-x-auto'>
          <Tabs
            type='button'
            activeKey={section}
            onChange={(key) =>
              navigate(
                key === 'models'
                  ? '/console/dashboard/models'
                  : `/console/dashboard/${key}`,
              )
            }
          >
            {visibleSections.map((item) => (
              <TabPane key={item.key} itemKey={item.key} tab={item.label} />
            ))}
          </Tabs>
        </div>
        <div className='flex shrink-0 flex-wrap items-center gap-2'>
          <Button
            size='small'
            theme='light'
            type='tertiary'
            icon={<Search size={14} />}
            onClick={dashboardData.showSearchModal}
          >
            {dashboardData.t('筛选')}
          </Button>
          <Button
            size='small'
            theme='light'
            type='primary'
            icon={
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            }
            onClick={loadSectionData}
            loading={loading}
          >
            {dashboardData.t('刷新')}
          </Button>
        </div>
      </div>

      {section === 'models' && (
        <>
          <div className='dashboard-stat-strip mb-4 overflow-hidden rounded-lg border border-semi-color-border'>
            <div className='grid grid-cols-2 divide-x divide-y divide-semi-color-border sm:grid-cols-3 lg:grid-cols-5 lg:divide-y-0'>
              <SummaryCard
                icon={<Hash size={16} />}
                label={dashboardData.t('调用次数')}
                value={renderNumber(dashboardData.times)}
                description={dashboardData.t('统计请求数')}
                loading={dashboardData.loading}
              />
              <SummaryCard
                icon={<Coins size={16} />}
                label={dashboardData.t('额度消耗')}
                value={renderQuota(dashboardData.consumeQuota, 2)}
                description={dashboardData.t('统计配额')}
                loading={dashboardData.loading}
              />
              <SummaryCard
                icon={<BarChart3 size={16} />}
                label={dashboardData.t('Token 消耗')}
                value={renderNumber(dashboardData.consumeTokens)}
                description={dashboardData.t('统计 Token 数')}
                loading={dashboardData.loading}
              />
              <SummaryCard
                icon={<Timer size={16} />}
                label={dashboardData.t('平均 RPM')}
                value={dashboardData.performanceMetrics.avgRPM}
                description={dashboardData.t('每分钟请求数')}
                loading={dashboardData.loading}
              />
              <SummaryCard
                icon={<Timer size={16} />}
                label={dashboardData.t('平均 TPM')}
                value={dashboardData.performanceMetrics.avgTPM}
                description={dashboardData.t('每分钟 Token 数')}
                loading={dashboardData.loading}
              />
            </div>
          </div>
          {dashboardData.isAdminUser && (
            <div className='mb-4'>
              <PerformanceHealthPanel enabled t={dashboardData.t} />
            </div>
          )}
          <ChartsPanel
            mode='models'
            activeChartTab={dashboardData.activeChartTab}
            setActiveChartTab={dashboardData.setActiveChartTab}
            spec_line={dashboardCharts.spec_line}
            spec_area={dashboardCharts.spec_area}
            spec_model_line={dashboardCharts.spec_model_line}
            spec_pie={dashboardCharts.spec_pie}
            spec_rank_bar={dashboardCharts.spec_rank_bar}
            spec_user_rank={dashboardCharts.spec_user_rank}
            userRankMetric={dashboardCharts.userRankMetric}
            setUserRankMetric={dashboardCharts.setUserRankMetric}
            spec_user_trend={dashboardCharts.spec_user_trend}
            isAdminUser={dashboardData.isAdminUser}
            loading={dashboardData.loading}
            hasData={dashboardData.quotaData.length > 0}
            CARD_PROPS={CARD_PROPS}
            CHART_CONFIG={CHART_CONFIG}
            FLEX_CENTER_GAP2={FLEX_CENTER_GAP2}
            hasApiInfoPanel={false}
            t={dashboardData.t}
          />
        </>
      )}

      {section === 'users' && dashboardData.isAdminUser && (
        <>
          <div className='dashboard-user-controls mb-3 flex flex-wrap items-center gap-2'>
            <span className='text-xs font-medium text-semi-color-text-2'>
              {dashboardData.t('时间范围')}
            </span>
            <Tabs
              type='button'
              activeKey={String(userRangeDays)}
              onChange={(value) => {
                const days = Number(value);
                setUserRangeDays(days);
                loadUserData(
                  userTopLimit,
                  dashboardData.dataExportDefaultTime,
                  days,
                );
              }}
            >
              {[1, 7, 14, 29].map((days) => (
                <TabPane
                  key={days}
                  itemKey={String(days)}
                  tab={dashboardData.t(`${days} 天`)}
                />
              ))}
            </Tabs>
            <span className='text-xs font-medium text-semi-color-text-2'>
              {dashboardData.t('Top Users')}
            </span>
            <Tabs
              type='button'
              activeKey={String(userTopLimit)}
              onChange={(value) => {
                const limit = Number(value);
                setUserTopLimit(limit);
                loadUserData(
                  limit,
                  dashboardData.dataExportDefaultTime,
                  userRangeDays,
                );
              }}
            >
              {[5, 10, 20, 50].map((limit) => (
                <TabPane
                  key={limit}
                  itemKey={String(limit)}
                  tab={dashboardData.t(`Top ${limit}`)}
                />
              ))}
            </Tabs>
            <span className='text-xs font-medium text-semi-color-text-2'>
              {dashboardData.t('Time granularity')}
            </span>
            <Tabs
              type='button'
              activeKey={dashboardData.dataExportDefaultTime}
              onChange={(value) => {
                dashboardData.handleInputChange(
                  value,
                  'data_export_default_time',
                );
                loadUserData(userTopLimit, value, userRangeDays);
              }}
            >
              {dashboardData.timeOptions.map((option) => (
                <TabPane
                  key={option.value}
                  itemKey={option.value}
                  tab={option.label}
                />
              ))}
            </Tabs>
          </div>
          <ChartsPanel
            mode='users'
            activeChartTab={dashboardData.activeChartTab}
            setActiveChartTab={dashboardData.setActiveChartTab}
            spec_line={dashboardCharts.spec_line}
            spec_area={dashboardCharts.spec_area}
            spec_model_line={dashboardCharts.spec_model_line}
            spec_pie={dashboardCharts.spec_pie}
            spec_rank_bar={dashboardCharts.spec_rank_bar}
            spec_user_rank={dashboardCharts.spec_user_rank}
            userRankMetric={dashboardCharts.userRankMetric}
            setUserRankMetric={dashboardCharts.setUserRankMetric}
            spec_user_trend={dashboardCharts.spec_user_trend}
            isAdminUser
            loading={dashboardData.loading}
            hasData={userChartData.length > 0}
            CARD_PROPS={CARD_PROPS}
            CHART_CONFIG={CHART_CONFIG}
            FLEX_CENTER_GAP2={FLEX_CENTER_GAP2}
            hasApiInfoPanel={false}
            t={dashboardData.t}
          />
        </>
      )}

      {section === 'flow' && (
        <FlowAnalyticsPanel
          flowData={analytics.flowData}
          loading={analytics.flowLoading}
          isAdminUser={dashboardData.isAdminUser}
          onRefresh={analytics.loadFlowData}
          t={dashboardData.t}
        />
      )}
    </div>
  );
};

export default DashboardAnalytics;
