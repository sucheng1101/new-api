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
import { Button, ButtonGroup, Tabs, TabPane } from '@douyinfe/semi-ui';
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
  userRankMetric,
  setUserRankMetric,
  spec_user_trend,
  isAdminUser,
  CHART_CONFIG,
  t,
}) => {
  const showModelCharts = mode !== 'users';
  const showUserCharts = mode !== 'models' && isAdminUser;
  const [consumptionChartType, setConsumptionChartType] = useState('bar');
  const modelTab = ['3', '4'].includes(activeChartTab) ? activeChartTab : '2';
  const userTab = activeChartTab === '6' ? '6' : '5';

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
            <ChartCanvas
              spec={consumptionChartType === 'area' ? spec_area : spec_line}
              option={CHART_CONFIG}
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
            <ChartCanvas
              spec={
                modelTab === '3'
                  ? spec_pie
                  : modelTab === '4'
                    ? spec_rank_bar
                    : spec_model_line
              }
              option={CHART_CONFIG}
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
          actions={
            <ButtonGroup>
              {[
                ['quota', t('额度消耗')],
                ['tokens', t('Token 消耗')],
                ['count', t('调用次数')],
              ].map(([value, label]) => (
                <Button
                  key={value}
                  size='small'
                  type={userRankMetric === value ? 'primary' : 'tertiary'}
                  theme={userRankMetric === value ? 'solid' : 'light'}
                  onClick={() => setUserRankMetric(value)}
                >
                  {label}
                </Button>
              ))}
            </ButtonGroup>
          }
        >
          <div className='dashboard-new-chart-canvas dashboard-new-chart-canvas-tall'>
            <ChartCanvas spec={spec_user_rank} option={CHART_CONFIG} />
          </div>
        </ChartFrame>
        <ChartFrame
          icon={Activity}
          title={t('用户消耗趋势')}
          total={spec_user_trend?.title?.subtext}
          actions={
            <Tabs
              type='button'
              activeKey={userTab}
              onChange={setActiveChartTab}
            >
              <TabPane itemKey='5' tab={t('排行')} />
              <TabPane itemKey='6' tab={t('趋势')} />
            </Tabs>
          }
        >
          <div className='dashboard-new-chart-canvas dashboard-new-chart-canvas-tall'>
            <ChartCanvas spec={spec_user_trend} option={CHART_CONFIG} />
          </div>
        </ChartFrame>
      </div>
    );
  }

  return null;
};

export default ChartsPanel;
