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

import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Button, Modal, Select } from '@douyinfe/semi-ui';
import { BarChart3, Coins, Filter, Hash, Settings2, Timer } from 'lucide-react';
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
import { CHART_CONFIG } from '../../constants/dashboard.constants';

const SummaryCard = ({
  icon: Icon,
  tone,
  label,
  value,
  description,
  loading,
}) => (
  <div className='dashboard-official-stat-card'>
    <div className='dashboard-official-stat-label'>
      <span
        className={`dashboard-official-icon-badge dashboard-official-icon-${tone}`}
      >
        <Icon size={14} />
      </span>
      <span>{label}</span>
    </div>
    {loading ? (
      <div className='dashboard-official-stat-loading'>
        <span />
        <span />
      </div>
    ) : (
      <>
        <div className='dashboard-official-stat-value' title={String(value)}>
          {value}
        </div>
        <div className='dashboard-official-stat-description'>{description}</div>
      </>
    )}
  </div>
);

const DashboardTabList = ({
  options,
  value,
  onChange,
  ariaLabel,
  compact = false,
}) => (
  <div
    className={`dashboard-official-tab-list${compact ? ' dashboard-official-tab-list-compact' : ''}`}
    role='tablist'
    aria-label={ariaLabel}
  >
    {options.map((option) => (
      <button
        key={option.value}
        type='button'
        role='tab'
        aria-selected={value === option.value}
        className={`dashboard-official-tab-button${value === option.value ? ' is-active' : ''}`}
        onClick={() => onChange(option.value)}
      >
        {option.icon ? <option.icon size={13} aria-hidden='true' /> : null}
        {option.label}
      </button>
    ))}
  </div>
);

const DashboardPreferences = ({
  visible,
  onClose,
  consumptionChartType,
  setConsumptionChartType,
  modelChartTab,
  setModelChartTab,
  t,
}) => (
  <Modal
    title={t('模型分析默认设置')}
    visible={visible}
    onCancel={onClose}
    onOk={onClose}
    okText={t('保存')}
    cancelText={t('取消')}
  >
    <div className='dashboard-official-preferences'>
      <label>
        <span>{t('默认消耗图表')}</span>
        <Select
          value={consumptionChartType}
          onChange={setConsumptionChartType}
          optionList={[
            { value: 'bar', label: t('柱状图') },
            { value: 'area', label: t('面积图') },
          ]}
        />
      </label>
      <label>
        <span>{t('默认模型调用图表')}</span>
        <Select
          value={modelChartTab}
          onChange={setModelChartTab}
          optionList={[
            { value: '2', label: t('调用趋势') },
            { value: '3', label: t('调用次数占比') },
            { value: '4', label: t('调用次数排行') },
          ]}
        />
      </label>
    </div>
  </Modal>
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
  const [userTopLimit, setUserTopLimit] = useState(10);
  const [userRangeDays, setUserRangeDays] = useState(1);
  const [userChartData, setUserChartData] = useState([]);
  const [modelChartTab, setModelChartTab] = useState('2');
  const [consumptionChartType, setConsumptionChartType] = useState('bar');
  const [preferencesVisible, setPreferencesVisible] = useState(false);

  const usersSectionVisible =
    dashboardData.isAdminUser &&
    (sidebarLoading || isModuleVisible('admin', 'dashboardUsers'));
  const pathnameSection = location.pathname.endsWith('/flow')
    ? 'flow'
    : location.pathname.endsWith('/users')
      ? 'users'
      : 'models';
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
    if (searchParams.get('section')) setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    loadSectionData();
    // Each route owns its first load; filter changes load after confirmation.
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
    <div className='dashboard-official-page'>
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
      <DashboardPreferences
        visible={preferencesVisible}
        onClose={() => setPreferencesVisible(false)}
        consumptionChartType={consumptionChartType}
        setConsumptionChartType={setConsumptionChartType}
        modelChartTab={modelChartTab}
        setModelChartTab={setModelChartTab}
        t={dashboardData.t}
      />

      <div className='dashboard-official-title-row'>
        <div className='flex items-center text-blue-500'>
          <BarChart3 size={16} className='mr-2' />
          <h2 className='!text-sm !font-medium'>{sectionTitle}</h2>
        </div>
      </div>

      <div className='dashboard-official-section-toolbar'>
        <div className='dashboard-official-section-tabs'>
          <DashboardTabList
            value={section}
            options={visibleSections.map((item) => ({
              value: item.key,
              label: item.label,
            }))}
            onChange={(key) =>
              navigate(
                key === 'models'
                  ? '/console/dashboard/models'
                  : `/console/dashboard/${key}`,
              )
            }
            ariaLabel={dashboardData.t('数据看板')}
          />
        </div>
        <div className='dashboard-official-section-actions'>
          {section === 'models' && (
            <Button
              size='small'
              theme='light'
              type='tertiary'
              icon={<Settings2 size={14} />}
              onClick={() => setPreferencesVisible(true)}
            >
              {dashboardData.t('偏好设置')}
            </Button>
          )}
          <Button
            size='small'
            theme='light'
            type='tertiary'
            icon={<Filter size={14} />}
            onClick={dashboardData.showSearchModal}
          >
            {dashboardData.t('筛选')}
          </Button>
        </div>
      </div>

      {section === 'models' && (
        <>
          <div className='dashboard-official-stat-strip'>
            <SummaryCard
              icon={Hash}
              tone='chart'
              label={dashboardData.t('调用次数')}
              value={renderNumber(dashboardData.times)}
              description={dashboardData.t('统计请求数')}
              loading={dashboardData.loading}
            />
            <SummaryCard
              icon={Coins}
              tone='success'
              label={dashboardData.t('额度消耗')}
              value={renderQuota(dashboardData.consumeQuota, 2)}
              description={dashboardData.t('统计配额')}
              loading={dashboardData.loading}
            />
            <SummaryCard
              icon={BarChart3}
              tone='info'
              label={dashboardData.t('Token 消耗')}
              value={renderNumber(dashboardData.consumeTokens)}
              description={dashboardData.t('统计 Token 数')}
              loading={dashboardData.loading}
            />
            <SummaryCard
              icon={Timer}
              tone='warning'
              label={dashboardData.t('平均 RPM')}
              value={dashboardData.performanceMetrics.avgRPM}
              description={dashboardData.t('每分钟请求数')}
              loading={dashboardData.loading}
            />
            <SummaryCard
              icon={Timer}
              tone='warning'
              label={dashboardData.t('平均 TPM')}
              value={dashboardData.performanceMetrics.avgTPM}
              description={dashboardData.t('每分钟 Token 数')}
              loading={dashboardData.loading}
            />
          </div>
          {dashboardData.isAdminUser && (
            <PerformanceHealthPanel enabled t={dashboardData.t} />
          )}
          <ChartsPanel
            mode='models'
            modelChartTab={modelChartTab}
            setModelChartTab={setModelChartTab}
            consumptionChartType={consumptionChartType}
            setConsumptionChartType={setConsumptionChartType}
            spec_line={dashboardCharts.spec_line}
            spec_area={dashboardCharts.spec_area}
            spec_model_line={dashboardCharts.spec_model_line}
            spec_pie={dashboardCharts.spec_pie}
            spec_rank_bar={dashboardCharts.spec_rank_bar}
            loading={dashboardData.loading}
            hasData={dashboardData.quotaData.length > 0}
            CHART_CONFIG={CHART_CONFIG}
            t={dashboardData.t}
          />
        </>
      )}

      {section === 'users' && dashboardData.isAdminUser && (
        <>
          <div className='dashboard-official-user-controls'>
            <DashboardTabList
              value={String(userRangeDays)}
              options={[1, 7, 14, 29].map((days) => ({
                value: String(days),
                label: dashboardData.t(`${days} 天`),
              }))}
              onChange={(value) => {
                const days = Number(value);
                setUserRangeDays(days);
                loadUserData(
                  userTopLimit,
                  dashboardData.dataExportDefaultTime,
                  days,
                );
              }}
              ariaLabel={dashboardData.t('时间范围')}
            />
            <DashboardTabList
              value={dashboardData.dataExportDefaultTime}
              options={dashboardData.timeOptions.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
              onChange={(value) => {
                dashboardData.handleInputChange(
                  value,
                  'data_export_default_time',
                );
                loadUserData(userTopLimit, value, userRangeDays);
              }}
              ariaLabel={dashboardData.t('时间粒度')}
            />
            <DashboardTabList
              value={String(userTopLimit)}
              options={[5, 10, 20, 50].map((limit) => ({
                value: String(limit),
                label: `Top ${limit}`,
              }))}
              onChange={(value) => {
                const limit = Number(value);
                setUserTopLimit(limit);
                loadUserData(
                  limit,
                  dashboardData.dataExportDefaultTime,
                  userRangeDays,
                );
              }}
              ariaLabel={dashboardData.t('Top 用户')}
            />
          </div>
          <ChartsPanel
            mode='users'
            spec_user_rank={dashboardCharts.spec_user_rank}
            spec_user_trend={dashboardCharts.spec_user_trend}
            loading={dashboardData.loading}
            hasData={userChartData.length > 0}
            CHART_CONFIG={CHART_CONFIG}
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
