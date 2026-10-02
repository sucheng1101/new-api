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
import { Empty, Input, Select, Tag } from '@douyinfe/semi-ui';
import {
  Activity,
  ChevronRight,
  Eye,
  EyeOff,
  GitBranch,
  Hash,
  Info,
  RefreshCw,
  Search,
  Server,
  WalletCards,
} from 'lucide-react';
import { VChart } from '@visactor/react-vchart';
import { renderNumber, renderQuota } from '../../helpers';
import { CHART_CONFIG } from '../../constants/dashboard.constants';

const FLOW_STAGES = [
  ['user', 'username'],
  ['node', 'node_name'],
  ['token', 'token_name'],
  ['group', 'group'],
  ['model', 'model_name'],
  ['channel', 'channel_name'],
];

const STAGE_LABELS = {
  user: '用户',
  node: '节点',
  token: '令牌',
  group: '分组',
  model: '模型',
  channel: '渠道',
};

const FlowToggleGroup = ({ options, value, onChange, ariaLabel }) => (
  <div
    className='dashboard-official-flow-toggle-list'
    role='tablist'
    aria-label={ariaLabel}
  >
    {options.map((option) => (
      <button
        key={option.value}
        type='button'
        role='tab'
        aria-selected={value === option.value}
        className={`dashboard-official-flow-toggle${value === option.value ? ' is-active' : ''}`}
        onClick={() => onChange(option.value)}
      >
        {option.icon ? <option.icon size={13} aria-hidden='true' /> : null}
        {option.label}
      </button>
    ))}
  </div>
);

const metricValue = (row, metric) => {
  if (metric === 'tokens') return Number(row.token_used || 0);
  if (metric === 'requests') return Number(row.count || 0);
  return Number(row.quota || 0);
};

const labelFor = (row, key, kind, t, sensitiveVisible) => {
  if (!sensitiveVisible && ['user', 'token', 'channel'].includes(kind)) {
    return t('已隐藏');
  }
  const value = row[key];
  if (value !== undefined && value !== null && String(value).trim()) {
    return String(value);
  }
  if (kind === 'channel' && row.channel_id) return `#${row.channel_id}`;
  if (kind === 'token' && row.token_id) return `#${row.token_id}`;
  return t('未知');
};

const buildSankeySpec = (rows, stages, metric, t, sensitiveVisible) => {
  const nodes = new Map();
  const links = new Map();
  rows.forEach((row) => {
    const path = stages.map(([kind, key]) => ({
      kind,
      label: labelFor(row, key, kind, t, sensitiveVisible),
    }));
    path.forEach(({ kind, label }) => {
      const id = `${kind}:${label}`;
      if (!nodes.has(id)) nodes.set(id, { key: id, name: label });
    });
    const value = Math.max(0, metricValue(row, metric));
    for (let index = 0; index < path.length - 1; index += 1) {
      const source = `${path[index].kind}:${path[index].label}`;
      const target = `${path[index + 1].kind}:${path[index + 1].label}`;
      const key = `${source}->${target}`;
      const current = links.get(key);
      links.set(key, {
        source,
        target,
        value: (current?.value || 0) + value,
      });
    }
  });
  return {
    type: 'sankey',
    data: [
      {
        id: 'flow',
        values: [
          {
            nodes: Array.from(nodes.values()),
            links: Array.from(links.values()),
          },
        ],
      },
    ],
    categoryField: 'name',
    sourceField: 'source',
    targetField: 'target',
    valueField: 'value',
    nodeKey: 'key',
    direction: 'horizontal',
    nodeAlign: 'justify',
    nodeGap: 14,
    nodeWidth: 16,
    minLinkHeight: 2,
    minNodeHeight: 8,
    legends: { visible: false },
    label: {
      visible: true,
      position: 'outside',
      limit: 180,
      style: { fill: '#64748b', fontSize: 11 },
    },
    tooltip: {
      mark: {
        content: [
          {
            key: t('数值'),
            value: (datum) =>
              metric === 'quota'
                ? renderQuota(datum?.value || 0, 2)
                : renderNumber(datum?.value || 0),
          },
        ],
      },
    },
    background: { fill: 'transparent' },
    animation: false,
  };
};

export default function FlowAnalyticsPanel({
  flowData = [],
  loading = false,
  isAdminUser,
  onRefresh,
  t,
}) {
  const [metric, setMetric] = useState('quota');
  const [topN, setTopN] = useState(50);
  const [overflowMode, setOverflowMode] = useState('aggregate');
  const [nodeFilter, setNodeFilter] = useState('');
  const [sensitiveVisible, setSensitiveVisible] = useState(true);
  const [visibleStageKeys, setVisibleStageKeys] = useState(
    FLOW_STAGES.map(([kind]) => kind),
  );

  const stages = useMemo(
    () =>
      FLOW_STAGES.filter(
        ([kind]) => isAdminUser || !['user', 'node'].includes(kind),
      ).filter(([kind]) => visibleStageKeys.includes(kind)),
    [isAdminUser, visibleStageKeys],
  );
  const availableStages = useMemo(
    () =>
      FLOW_STAGES.filter(
        ([kind]) => isAdminUser || !['user', 'node'].includes(kind),
      ),
    [isAdminUser],
  );
  const nodeOptions = useMemo(
    () =>
      Array.from(new Set(flowData.map((row) => row.node_name).filter(Boolean)))
        .sort()
        .map((name) => ({ value: name, label: name })),
    [flowData],
  );
  const filteredData = useMemo(() => {
    const matchingRows = flowData
      .filter((row) => !nodeFilter || row.node_name === nodeFilter)
      .sort((a, b) => metricValue(b, metric) - metricValue(a, metric));
    const visibleRows = matchingRows.slice(0, topN || undefined);
    if (
      overflowMode === 'aggregate' &&
      topN > 0 &&
      matchingRows.length > topN
    ) {
      const other = matchingRows.slice(topN).reduce(
        (result, row) => ({
          ...result,
          quota: result.quota + Number(row.quota || 0),
          token_used: result.token_used + Number(row.token_used || 0),
          count: result.count + Number(row.count || 0),
        }),
        {
          username: t('其他'),
          node_name: t('其他'),
          token_name: t('其他'),
          group: t('其他'),
          model_name: t('其他'),
          channel_name: t('其他'),
          quota: 0,
          token_used: 0,
          count: 0,
        },
      );
      visibleRows.push(other);
    }
    return visibleRows;
  }, [flowData, metric, nodeFilter, overflowMode, t, topN]);
  const sankeySpec = useMemo(
    () => buildSankeySpec(filteredData, stages, metric, t, sensitiveVisible),
    [filteredData, metric, stages, t, sensitiveVisible],
  );

  const toggleStage = (kind) => {
    setVisibleStageKeys((current) => {
      if (current.includes(kind)) {
        if (current.length <= 2) return current;
        return current.filter((item) => item !== kind);
      }
      return [...current, kind];
    });
  };

  const metricOptions = [
    ['quota', '按额度', WalletCards],
    ['tokens', '按 Token', Hash],
    ['requests', '按请求', Activity],
  ];

  return (
    <div className='dashboard-official-flow-layout'>
      <div className='dashboard-official-flow-controls'>
        <div className='dashboard-official-flow-control-group'>
          <div className='dashboard-official-flow-control-label'>
            <span>{t('流向宽度指标')}</span>
            <button
              type='button'
              className='dashboard-official-help-button'
              title={t('选择计算流向宽度的指标')}
              aria-label={t('流向宽度指标')}
            >
              <Info size={13} />
            </button>
          </div>
          <FlowToggleGroup
            value={metric}
            onChange={setMetric}
            ariaLabel={t('流向宽度指标')}
            options={metricOptions.map(([value, label, icon]) => ({
              value,
              label: t(label),
              icon,
            }))}
          />
        </div>
        <div className='dashboard-official-flow-control-group'>
          <span>{t('显示数量')}</span>
          <FlowToggleGroup
            value={String(topN)}
            onChange={(value) => setTopN(Number(value))}
            ariaLabel={t('显示数量')}
            options={[10, 20, 50, 100].map((value) => ({
              value: String(value),
              label: `Top ${value}`,
            }))}
          />
        </div>
        <div className='dashboard-official-flow-control-group'>
          <span>{t('溢出项目')}</span>
          <FlowToggleGroup
            value={overflowMode}
            onChange={setOverflowMode}
            ariaLabel={t('溢出项目')}
            options={[
              { value: 'aggregate', label: t('聚合其他') },
              { value: 'hide', label: t('隐藏') },
            ]}
          />
        </div>
        {isAdminUser && nodeOptions.length > 0 && (
          <Select
            value={nodeFilter}
            onChange={setNodeFilter}
            placeholder={t('全部节点')}
            optionList={[{ value: '', label: t('全部节点') }, ...nodeOptions]}
            style={{ minWidth: 150 }}
            prefix={<Server size={14} />}
          />
        )}
        <Input
          prefix={<Search size={14} />}
          value={nodeFilter}
          onChange={setNodeFilter}
          placeholder={t('筛选节点')}
          style={{ width: 170 }}
          showClear
        />
      </div>

      <section className='dashboard-official-panel dashboard-official-flow-panel'>
        <header className='dashboard-official-panel-header dashboard-official-flow-header'>
          <div className='dashboard-official-panel-heading'>
            <span className='dashboard-official-icon-badge dashboard-official-icon-chart'>
              <GitBranch size={15} />
            </span>
            <span className='dashboard-official-panel-title'>{t('分流')}</span>
            {isAdminUser && <Tag color='blue'>{t('全站')}</Tag>}
          </div>
          <div className='dashboard-official-flow-header-actions'>
            <div className='dashboard-official-flow-stage-toggles'>
              <button
                type='button'
                className='dashboard-official-icon-button dashboard-official-flow-info'
                title={t('点击阶段按钮显示或隐藏对应列')}
                aria-label={t('显示或隐藏流向列')}
              >
                <Info size={14} />
              </button>
              {availableStages.map(([kind]) => (
                <React.Fragment key={kind}>
                  {kind !== availableStages[0][0] && (
                    <ChevronRight
                      className='dashboard-official-flow-chevron'
                      size={13}
                    />
                  )}
                  <button
                    type='button'
                    className={`dashboard-official-stage-toggle ${visibleStageKeys.includes(kind) ? 'is-active' : ''}`}
                    onClick={() => toggleStage(kind)}
                    aria-pressed={visibleStageKeys.includes(kind)}
                  >
                    {!visibleStageKeys.includes(kind) && <EyeOff size={11} />}
                    {t(STAGE_LABELS[kind])}
                  </button>
                </React.Fragment>
              ))}
            </div>
            <button
              type='button'
              className='dashboard-official-icon-button'
              onClick={() => setSensitiveVisible((value) => !value)}
              aria-label={
                sensitiveVisible ? t('隐藏敏感数据') : t('显示敏感数据')
              }
            >
              {sensitiveVisible ? <Eye size={15} /> : <EyeOff size={15} />}
            </button>
            <button
              type='button'
              aria-label={t('刷新调用流向')}
              className='dashboard-official-icon-button'
              onClick={onRefresh}
              disabled={loading}
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </header>
        <div className='dashboard-official-flow-chart'>
          {loading ? (
            <div className='dashboard-official-chart-skeleton' aria-busy='true'>
              <div className='dashboard-official-skeleton-line' />
              <div className='dashboard-official-skeleton-grid' />
            </div>
          ) : filteredData.length > 0 && stages.length >= 2 ? (
            <VChart spec={sankeySpec} option={CHART_CONFIG} />
          ) : (
            <Empty description={t('当前时间范围暂无调用流向数据')} />
          )}
        </div>
        {overflowMode === 'hide' && flowData.length > filteredData.length && (
          <div className='dashboard-official-flow-overflow-note'>
            {t('已隐藏超出显示数量的项目')}
          </div>
        )}
      </section>
    </div>
  );
}
