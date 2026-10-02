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

import React, { useMemo } from 'react';
import {
  Activity,
  AreaChart,
  BarChart3,
  PieChart,
  Users,
  WalletCards,
} from 'lucide-react';
import { VChart } from '@visactor/react-vchart';

const prepareSpec = (spec) => {
  if (!spec) return null;
  return {
    ...spec,
    title: { ...(spec.title || {}), visible: false },
    background: 'transparent',
  };
};

const OfficialIconBadge = ({ children, tone = 'info' }) => (
  <span
    className={`dashboard-official-icon-badge dashboard-official-icon-${tone}`}
  >
    {children}
  </span>
);

const ChartSkeleton = () => (
  <div className='dashboard-official-chart-skeleton' aria-busy='true'>
    <div className='dashboard-official-skeleton-line' />
    <div className='dashboard-official-skeleton-grid'>
      {[38, 62, 48, 76, 54, 86, 44, 69, 52, 78, 46, 64].map((height, index) => (
        <span key={index} style={{ height: `${height}%` }} />
      ))}
    </div>
  </div>
);

const ChartEmpty = ({ label }) => (
  <div className='dashboard-official-chart-empty'>
    <span className='dashboard-official-empty-icon'>
      <Activity size={16} />
    </span>
    <span>{label}</span>
  </div>
);

const ChartCanvas = ({ spec, option, loading, hasData, t }) => {
  const prepared = useMemo(() => prepareSpec(spec), [spec]);
  if (loading) return <ChartSkeleton />;
  if (!hasData || !prepared) return <ChartEmpty label={t('暂无数据')} />;
  return <VChart spec={prepared} option={option} />;
};

const SegmentTabs = ({ activeKey, onChange, options, ariaLabel }) => (
  <div
    className='dashboard-official-segmented'
    aria-label={ariaLabel}
    role='tablist'
  >
    {options.map((option) => (
      <button
        key={option.value}
        type='button'
        role='tab'
        aria-selected={activeKey === option.value}
        className={`dashboard-official-segment-button${activeKey === option.value ? ' is-active' : ''}`}
        onClick={() => onChange(option.value)}
      >
        {option.icon ? <option.icon size={13} aria-hidden='true' /> : null}
        {option.label}
      </button>
    ))}
  </div>
);

const ChartPanel = ({
  icon: Icon,
  tone,
  title,
  total,
  actions,
  children,
  className = '',
}) => (
  <section className={`dashboard-official-panel ${className}`}>
    <div className='dashboard-official-panel-header'>
      <div className='dashboard-official-panel-heading'>
        <OfficialIconBadge tone={tone}>
          <Icon size={15} />
        </OfficialIconBadge>
        <span className='dashboard-official-panel-title'>{title}</span>
        {total ? (
          <span className='dashboard-official-panel-total'>{total}</span>
        ) : null}
      </div>
      {actions ? (
        <div className='dashboard-official-panel-actions'>{actions}</div>
      ) : null}
    </div>
    <div className='dashboard-official-panel-body'>{children}</div>
  </section>
);

const ChartBody = ({ children }) => (
  <div className='dashboard-official-chart-body'>{children}</div>
);

const ChartsPanel = ({
  mode = 'models',
  modelChartTab = '2',
  setModelChartTab,
  consumptionChartType = 'bar',
  setConsumptionChartType,
  spec_line,
  spec_area,
  spec_model_line,
  spec_pie,
  spec_rank_bar,
  spec_user_rank,
  spec_user_trend,
  loading = false,
  hasData = true,
  CHART_CONFIG,
  t,
}) => {
  if (mode === 'users') {
    return (
      <div className='dashboard-official-chart-stack'>
        <ChartPanel icon={Users} tone='info' title={t('用户消耗排行')}>
          <ChartBody>
            <ChartCanvas
              spec={spec_user_rank}
              option={CHART_CONFIG}
              loading={loading}
              hasData={hasData}
              t={t}
            />
          </ChartBody>
        </ChartPanel>
        <ChartPanel icon={Users} tone='info' title={t('用户消耗趋势')}>
          <ChartBody>
            <ChartCanvas
              spec={spec_user_trend}
              option={CHART_CONFIG}
              loading={loading}
              hasData={hasData}
              t={t}
            />
          </ChartBody>
        </ChartPanel>
      </div>
    );
  }

  const modelSpec =
    modelChartTab === '3'
      ? spec_pie
      : modelChartTab === '4'
        ? spec_rank_bar
        : spec_model_line;

  return (
    <div className='dashboard-official-chart-stack'>
      <ChartPanel
        icon={WalletCards}
        tone='success'
        title={t('消耗分布')}
        total={spec_line?.title?.subtext}
        actions={
          <SegmentTabs
            activeKey={consumptionChartType}
            onChange={setConsumptionChartType}
            ariaLabel={t('消耗分布图表')}
            options={[
              { value: 'bar', icon: BarChart3, label: t('柱状图') },
              { value: 'area', icon: AreaChart, label: t('面积图') },
            ]}
          />
        }
      >
        <ChartBody>
          <ChartCanvas
            spec={consumptionChartType === 'area' ? spec_area : spec_line}
            option={CHART_CONFIG}
            loading={loading}
            hasData={hasData}
            t={t}
          />
        </ChartBody>
      </ChartPanel>

      <ChartPanel
        icon={PieChart}
        tone='chart'
        title={t('模型调用分析')}
        total={modelSpec?.title?.subtext}
        actions={
          <SegmentTabs
            activeKey={modelChartTab}
            onChange={setModelChartTab}
            ariaLabel={t('模型调用分析图表')}
            options={[
              { value: '2', label: t('调用趋势') },
              { value: '3', label: t('调用次数占比') },
              { value: '4', label: t('调用次数排行') },
            ]}
          />
        }
      >
        <ChartBody>
          <ChartCanvas
            spec={modelSpec}
            option={CHART_CONFIG}
            loading={loading}
            hasData={hasData}
            t={t}
          />
        </ChartBody>
      </ChartPanel>
    </div>
  );
};

export default ChartsPanel;
