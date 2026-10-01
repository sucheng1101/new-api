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
import { Button, Card, TabPane, Tabs, Tag } from '@douyinfe/semi-ui';
import {
  BarChart3,
  Coins,
  Hash,
  RefreshCw,
  Search,
  Timer,
  Users,
  Workflow,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

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
import {
  CARD_PROPS,
  CHART_CONFIG,
  FLEX_CENTER_GAP2,
} from '../../constants/dashboard.constants';

const SECTION_CONFIG = {
  models: {
    title: '模型调用分析',
    description: '查看模型消耗、调用趋势和请求分布',
    icon: BarChart3,
  },
  flow: {
    title: '调用流向',
    description: '按模型、分组、渠道、节点和令牌追踪调用流向',
    icon: Workflow,
  },
  users: {
    title: '用户分析',
    description: '查看用户消耗排行和历史趋势',
    icon: Users,
  },
};

const SummaryCard = ({ icon, label, value, loading }) => (
  <Card className='!rounded-2xl' bodyStyle={{ padding: 16 }} loading={loading}>
    <div className='flex items-center gap-3'>
      <div className='flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/40'>
        {icon}
      </div>
      <div className='min-w-0'>
        <div className='text-xs text-semi-color-text-2'>{label}</div>
        <div className='mt-1 truncate text-xl font-semibold'>{value}</div>
      </div>
    </div>
  </Card>
);

const DashboardAnalytics = ({ section }) => {
  const [userState, userDispatch] = useContext(UserContext);
  const [statusState] = useContext(StatusContext);
  const navigate = useNavigate();
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
  const config = SECTION_CONFIG[section] || SECTION_CONFIG.models;
  const Icon = config.icon;

  const loadModelData = useCallback(async () => {
    const data = await dashboardData.loadQuotaData();
    if (data && data.length > 0) {
      dashboardCharts.updateChartData(data);
    }
  }, [dashboardCharts.updateChartData, dashboardData.loadQuotaData]);

  const loadUserData = useCallback(async () => {
    const data = await dashboardData.loadUserQuotaData();
    dashboardCharts.updateUserChartData(data || []);
  }, [dashboardCharts.updateUserChartData, dashboardData.loadUserQuotaData]);

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
    if (section === 'users') {
      dashboardData.setActiveChartTab('5');
    } else if (!['1', '2', '3'].includes(dashboardData.activeChartTab)) {
      dashboardData.setActiveChartTab('1');
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
      { key: 'flow', label: dashboardData.t('调用流向') },
      ...(dashboardData.isAdminUser
        ? [{ key: 'users', label: dashboardData.t('用户分析') }]
        : []),
    ],
    [dashboardData.isAdminUser, dashboardData.t],
  );

  const loading =
    section === 'flow' ? analytics.flowLoading : dashboardData.loading;

  return (
    <div className='mt-[60px] px-2'>
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

      <div className='mb-4 flex flex-col gap-3 rounded-2xl border border-semi-color-border bg-semi-color-bg-1 p-4 sm:flex-row sm:items-center sm:justify-between'>
        <div className='flex min-w-0 items-center gap-3'>
          <div className='flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600 dark:bg-violet-950/40'>
            <Icon size={21} />
          </div>
          <div className='min-w-0'>
            <div className='flex flex-wrap items-center gap-2'>
              <h1 className='text-xl font-semibold'>
                {dashboardData.t(config.title)}
              </h1>
              <Tag color={dashboardData.isAdminUser ? 'blue' : 'green'}>
                {dashboardData.isAdminUser
                  ? dashboardData.t('全站数据')
                  : dashboardData.t('我的数据')}
              </Tag>
            </div>
            <p className='mt-1 text-sm text-semi-color-text-2'>
              {dashboardData.t(config.description)}
            </p>
          </div>
        </div>
        <div className='flex shrink-0 flex-wrap items-center gap-2'>
          <Button
            theme='light'
            type='tertiary'
            icon={<Search size={16} />}
            onClick={dashboardData.showSearchModal}
          >
            {dashboardData.t('筛选')}
          </Button>
          <Button
            theme='light'
            type='primary'
            icon={
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            }
            onClick={loadSectionData}
            loading={loading}
          >
            {dashboardData.t('刷新')}
          </Button>
        </div>
      </div>

      <div className='mb-4 overflow-x-auto'>
        <Tabs
          type='button'
          activeKey={section}
          onChange={(key) => navigate(`/console/dashboard/${key}`)}
        >
          {visibleSections.map((item) => (
            <TabPane key={item.key} itemKey={item.key} tab={item.label} />
          ))}
        </Tabs>
      </div>

      {section === 'models' && (
        <>
          <div className='mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5'>
            <SummaryCard
              icon={<Hash size={18} />}
              label={dashboardData.t('调用次数')}
              value={renderNumber(dashboardData.times)}
              loading={dashboardData.loading}
            />
            <SummaryCard
              icon={<Coins size={18} />}
              label={dashboardData.t('额度消耗')}
              value={renderQuota(dashboardData.consumeQuota, 2)}
              loading={dashboardData.loading}
            />
            <SummaryCard
              icon={<BarChart3 size={18} />}
              label={dashboardData.t('Token 消耗')}
              value={renderNumber(dashboardData.consumeTokens)}
              loading={dashboardData.loading}
            />
            <SummaryCard
              icon={<Timer size={18} />}
              label={dashboardData.t('平均 RPM')}
              value={dashboardData.performanceMetrics.avgRPM}
              loading={dashboardData.loading}
            />
            <SummaryCard
              icon={<Timer size={18} />}
              label={dashboardData.t('平均 TPM')}
              value={dashboardData.performanceMetrics.avgTPM}
              loading={dashboardData.loading}
            />
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
            spec_model_line={dashboardCharts.spec_model_line}
            spec_pie={dashboardCharts.spec_pie}
            spec_user_rank={dashboardCharts.spec_user_rank}
            userRankMetric={dashboardCharts.userRankMetric}
            setUserRankMetric={dashboardCharts.setUserRankMetric}
            spec_user_trend={dashboardCharts.spec_user_trend}
            isAdminUser={dashboardData.isAdminUser}
            CARD_PROPS={CARD_PROPS}
            CHART_CONFIG={CHART_CONFIG}
            FLEX_CENTER_GAP2={FLEX_CENTER_GAP2}
            hasApiInfoPanel={false}
            t={dashboardData.t}
          />
        </>
      )}

      {section === 'users' && dashboardData.isAdminUser && (
        <ChartsPanel
          mode='users'
          activeChartTab={dashboardData.activeChartTab}
          setActiveChartTab={dashboardData.setActiveChartTab}
          spec_line={dashboardCharts.spec_line}
          spec_model_line={dashboardCharts.spec_model_line}
          spec_pie={dashboardCharts.spec_pie}
          spec_user_rank={dashboardCharts.spec_user_rank}
          userRankMetric={dashboardCharts.userRankMetric}
          setUserRankMetric={dashboardCharts.setUserRankMetric}
          spec_user_trend={dashboardCharts.spec_user_trend}
          isAdminUser
          CARD_PROPS={CARD_PROPS}
          CHART_CONFIG={CHART_CONFIG}
          FLEX_CENTER_GAP2={FLEX_CENTER_GAP2}
          hasApiInfoPanel={false}
          t={dashboardData.t}
        />
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
