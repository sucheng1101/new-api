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

import React, { useMemo, useState } from 'react';
import { Tabs, TabPane } from '@douyinfe/semi-ui';
import { Activity, PieChart, Users, WalletCards } from 'lucide-react';
import { VChart } from '@visactor/react-vchart';

const chartSpec = (spec) => {
  if (!spec) return null;
  return {
    ...spec,
    title: { ...(spec.title || {}), visible: false },
    background: 'transparent',
  };
};

const ChartFrame = ({ icon: Icon, title, total, actions, children }) => (
  <section className='dashboard-new-chart-card'>
    <header className='dashboard-new-chart-header'>
      <div className='dashboard-new-chart-title'>
        <span className='dashboard-new-chart-icon'>
          <Icon size={15} />
        </span>
        <span>{title}</span>
        {total ? (
          <span className='dashboard-new-chart-total'>{total}</span>
        ) : null}
      </div>
      {actions ? (
        <div className='dashboard-new-chart-actions'>{actions}</div>
      ) : null}
    </header>
    <div className='dashboard-new-chart-body'>{children}</div>
  </section>
);

const ChartCanvas = ({ spec, option }) => {
  const prepared = useMemo(() => chartSpec(spec), [spec]);
  if (!prepared) return null;
  return <VChart spec={prepared} option={option} />;
};

const ChartLoading = () => (
  <div className='dashboard-chart-placeholder' aria-busy='true'>
    <div className='dashboard-chart-placeholder-bar' />
    <div className='dashboard-chart-placeholder-bars'>
      {[32, 54, 42, 78, 62, 88, 48, 70, 40, 64, 52, 82].map((height, index) => (
        <span key={index} style={{ height: `${height}%` }} />
      ))}
    </div>
  </div>
);

const ChartEmpty = ({ label }) => (
  <div className='dashboard-chart-empty'>
    <span className='dashboard-chart-empty-icon'>
      <Activity size={18} />
    </span>
    <span>{label}</span>
  </div>
);

const ChartContent = ({ spec, option, loading, hasData, t }) => {
  if (loading) return <ChartLoading />;
  if (!hasData) return <ChartEmpty label={t('暂无数据')} />;
  return <ChartCanvas spec={spec} option={option} />;
};

const ChartsPanel = ({
  mode = 'all',
  activeChartTab,
  setActiveChartTab,
  spec_line,
  spec_area,
  spec_model_line,
  spec_pie,
  spec_rank_bar,
  spec_user_rank,
  spec_user_trend,
  isAdminUser,
  loading = false,
  hasData = true,
  CHART_CONFIG,
  t,
}) => {
  const showModelCharts = mode !== 'users';
  const showUserCharts = mode !== 'models' && isAdminUser;
  const [consumptionChartType, setConsumptionChartType] = useState('bar');
  const modelTab = ['3', '4'].includes(activeChartTab) ? activeChartTab : '2';

  if (showModelCharts) {
    return (
      <div className='dashboard-chart-stack'>
        <ChartFrame
          icon={WalletCards}
          title={t('消耗分布')}
          total={spec_line?.title?.subtext}
          actions={
            <Tabs
              type='button'
              activeKey={consumptionChartType}
              onChange={setConsumptionChartType}
            >
              <TabPane itemKey='bar' tab={t('柱状图')} />
              <TabPane itemKey='area' tab={t('面积图')} />
            </Tabs>
          }
        >
          <div className='dashboard-new-chart-canvas dashboard-new-chart-canvas-tall'>
            <ChartContent
              spec={consumptionChartType === 'area' ? spec_area : spec_line}
              option={CHART_CONFIG}
              loading={loading}
              hasData={hasData}
              t={t}
            />
          </div>
        </ChartFrame>

        <ChartFrame
          icon={PieChart}
          title={t('模型调用分析')}
          total={
            modelTab === '3'
              ? spec_pie?.title?.subtext
              : modelTab === '4'
                ? spec_rank_bar?.title?.subtext
                : spec_model_line?.title?.subtext
          }
          actions={
            <Tabs
              type='button'
              activeKey={modelTab}
              onChange={setActiveChartTab}
            >
              <TabPane itemKey='2' tab={t('调用趋势')} />
              <TabPane itemKey='3' tab={t('调用次数占比')} />
              <TabPane itemKey='4' tab={t('调用次数排行')} />
            </Tabs>
          }
        >
          <div className='dashboard-new-chart-canvas dashboard-new-chart-canvas-tall'>
            <ChartContent
              spec={
                modelTab === '3'
                  ? spec_pie
                  : modelTab === '4'
                    ? spec_rank_bar
                    : spec_model_line
              }
              option={CHART_CONFIG}
              loading={loading}
              hasData={hasData}
              t={t}
            />
          </div>
        </ChartFrame>
      </div>
    );
  }

  if (showUserCharts) {
    return (
      <div className='dashboard-chart-stack'>
        <ChartFrame
          icon={Users}
          title={t('用户消耗排行')}
          total={spec_user_rank?.title?.subtext}
        >
          <div className='dashboard-new-chart-canvas dashboard-new-chart-canvas-tall'>
            <ChartContent
              spec={spec_user_rank}
              option={CHART_CONFIG}
              loading={loading}
              hasData={hasData}
              t={t}
            />
          </div>
        </ChartFrame>
        <ChartFrame
          icon={Activity}
          title={t('用户消耗趋势')}
          total={spec_user_trend?.title?.subtext}
        >
          <div className='dashboard-new-chart-canvas dashboard-new-chart-canvas-tall'>
            <ChartContent
              spec={spec_user_trend}
              option={CHART_CONFIG}
              loading={loading}
              hasData={hasData}
              t={t}
            />
          </div>
        </ChartFrame>
      </div>
    );
  }

  return null;
};

export default ChartsPanel;
