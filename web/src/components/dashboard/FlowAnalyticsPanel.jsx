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
import {
  Checkbox,
  Empty,
  Input,
  Select,
  Table,
  Tabs,
  TabPane,
  Tag,
} from '@douyinfe/semi-ui';
import {
  Activity,
  GitBranch,
  Layers3,
  RefreshCw,
  Search,
  Server,
  Users,
} from 'lucide-react';
import { VChart } from '@visactor/react-vchart';
import { renderNumber, renderQuota } from '../../helpers';
import { CHART_CONFIG } from '../../constants/dashboard.constants';

const DIMENSIONS = [
  { key: 'model', label: '模型', icon: Layers3 },
  { key: 'group', label: '分组', icon: GitBranch },
  { key: 'channel', label: '渠道', icon: Server },
  { key: 'node', label: '节点', icon: Activity },
  { key: 'token', label: '令牌', icon: Users },
];

const getDimensionName = (row, dimension, t) => {
  const fallback = t('未命名');
  if (dimension === 'model') return row.model_name || fallback;
  if (dimension === 'group') return row.group || fallback;
  if (dimension === 'channel')
    return (
      row.channel_name || (row.channel_id ? `#${row.channel_id}` : fallback)
    );
  if (dimension === 'node') return row.node_name || fallback;
  return row.token_name || (row.token_id ? `#${row.token_id}` : fallback);
};

const toMetricValue = (row, metric) => {
  if (metric === 'tokens') return Number(row.token_used || 0);
  if (metric === 'count') return Number(row.count || 0);
  return Number(row.quota || 0);
};

const aggregateRows = (rows, dimension, metric, topN, showOther, t) => {
  const grouped = new Map();
  rows.forEach((row) => {
    const name = getDimensionName(row, dimension, t);
    const current = grouped.get(name) || {
      name,
      quota: 0,
      tokens: 0,
      count: 0,
    };
    current.quota += Number(row.quota || 0);
    current.tokens += Number(row.token_used || 0);
    current.count += Number(row.count || 0);
    grouped.set(name, current);
  });
  const total = rows.reduce((sum, row) => sum + toMetricValue(row, metric), 0);
  const sorted = Array.from(grouped.values()).sort(
    (left, right) => toMetricValue(right, metric) - toMetricValue(left, metric),
  );
  const visible = topN === 0 ? sorted : sorted.slice(0, topN);
  if (showOther && topN > 0 && sorted.length > topN) {
    const other = sorted.slice(topN).reduce(
      (result, row) => ({
        name: t('其他'),
        quota: result.quota + row.quota,
        tokens: result.tokens + row.tokens,
        count: result.count + row.count,
      }),
      { name: t('其他'), quota: 0, tokens: 0, count: 0 },
    );
    visible.push(other);
  }
  return visible.map((row, index) => ({
    ...row,
    key: `${dimension}-${row.name}-${index}`,
    value: toMetricValue(row, metric),
    share: total > 0 ? (toMetricValue(row, metric) / total) * 100 : 0,
  }));
};

export default function FlowAnalyticsPanel({
  flowData = [],
  loading = false,
  isAdminUser,
  onRefresh,
  t,
}) {
  const [dimension, setDimension] = useState('model');
  const [metric, setMetric] = useState('quota');
  const [topN, setTopN] = useState(10);
  const [showOther, setShowOther] = useState(true);
  const [nodeFilter, setNodeFilter] = useState('');
  const activeDimension =
    DIMENSIONS.find((item) => item.key === dimension) || DIMENSIONS[0];
  const nodeOptions = useMemo(() => {
    const names = new Set(flowData.map((row) => row.node_name).filter(Boolean));
    return Array.from(names)
      .sort()
      .map((name) => ({ value: name, label: name }));
  }, [flowData]);
  const filteredData = useMemo(
    () =>
      nodeFilter
        ? flowData.filter((row) => (row.node_name || '') === nodeFilter)
        : flowData,
    [flowData, nodeFilter],
  );
  const rows = useMemo(
    () => aggregateRows(filteredData, dimension, metric, topN, showOther, t),
    [dimension, filteredData, metric, showOther, t, topN],
  );
  const sankeySpec = useMemo(() => {
    const stages = isAdminUser
      ? [
          ['user', 'username'],
          ['node', 'node_name'],
          ['token', 'token_name'],
          ['group', 'group'],
          ['model', 'model_name'],
          ['channel', 'channel_name'],
        ]
      : [
          ['token', 'token_name'],
          ['group', 'group'],
          ['model', 'model_name'],
          ['channel', 'channel_name'],
        ];
    const nodes = new Map();
    const links = new Map();
    const readLabel = (row, key) => {
      const value = row[key];
      if (value !== undefined && value !== null && String(value).trim()) {
        return String(value);
      }
      return t('未知');
    };

    filteredData.forEach((row) => {
      const path = stages.map(([kind, key]) => ({
        kind,
        label: readLabel(row, key),
      }));
      path.forEach(({ kind, label }) => {
        const id = `${kind}:${label}`;
        if (!nodes.has(id)) nodes.set(id, { key: id, name: label });
      });
      const value = Math.max(0, toMetricValue(row, metric));
      for (let index = 0; index < path.length - 1; index += 1) {
        const source = `${path[index].kind}:${path[index].label}`;
        const target = `${path[index + 1].kind}:${path[index + 1].label}`;
        const key = `${source}->${target}`;
        links.set(key, {
          source,
          target,
          value: (links.get(key)?.value || 0) + value,
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
  }, [filteredData, isAdminUser, metric, t]);
  const totals = useMemo(
    () =>
      filteredData.reduce(
        (result, row) => ({
          quota: result.quota + Number(row.quota || 0),
          tokens: result.tokens + Number(row.token_used || 0),
          count: result.count + Number(row.count || 0),
        }),
        { quota: 0, tokens: 0, count: 0 },
      ),
    [filteredData],
  );
  const columns = [
    {
      title: t(activeDimension.label),
      dataIndex: 'name',
      render: (value) => <span className='font-medium'>{value}</span>,
    },
    {
      title: t('额度'),
      dataIndex: 'quota',
      render: (value) => renderQuota(value, 2),
    },
    {
      title: t('Token'),
      dataIndex: 'tokens',
      render: (value) => renderNumber(value),
    },
    {
      title: t('调用次数'),
      dataIndex: 'count',
      render: (value) => renderNumber(value),
    },
    {
      title: t('占比'),
      dataIndex: 'share',
      render: (value) => (
        <Tag color={value >= 50 ? 'blue' : 'grey'}>{value.toFixed(1)}%</Tag>
      ),
    },
  ];

  return (
    <section className='dashboard-new-chart-card dashboard-flow-card mb-4'>
      <header className='dashboard-new-chart-header'>
        <div className='dashboard-new-chart-title'>
          <span className='dashboard-new-chart-icon'>
            <GitBranch size={15} />
          </span>
          <span>{t('调用流向分析')}</span>
          {isAdminUser && <Tag color='blue'>{t('全站')}</Tag>}
        </div>
        <button
          type='button'
          aria-label={t('刷新调用流向')}
          className='dashboard-flow-refresh'
          onClick={onRefresh}
          disabled={loading}
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </header>
      <div className='dashboard-new-chart-body p-3 sm:p-5'>
        <div className='grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4'>
          {[
            [t('额度'), renderQuota(totals.quota, 2)],
            [t('Token'), renderNumber(totals.tokens)],
            [t('调用次数'), renderNumber(totals.count)],
          ].map(([label, value]) => (
            <div key={label} className='dashboard-flow-summary'>
              <div className='text-xs text-semi-color-text-2'>{label}</div>
              <div className='text-lg font-semibold mt-1'>{value}</div>
            </div>
          ))}
        </div>
        <div className='flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3 mb-3'>
          <Tabs type='button' activeKey={dimension} onChange={setDimension}>
            {DIMENSIONS.map((item) => (
              <TabPane key={item.key} itemKey={item.key} tab={t(item.label)} />
            ))}
          </Tabs>
          <Tabs type='button' activeKey={metric} onChange={setMetric}>
            <TabPane itemKey='quota' tab={t('按额度')} />
            <TabPane itemKey='tokens' tab={t('按Token')} />
            <TabPane itemKey='count' tab={t('按调用次数')} />
          </Tabs>
        </div>
        <div className='flex flex-wrap items-center gap-2 mb-4'>
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
          <Select
            value={topN}
            onChange={setTopN}
            optionList={[5, 10, 15, 20, 0].map((value) => ({
              value,
              label: value === 0 ? t('全部') : `Top ${value}`,
            }))}
            style={{ width: 110 }}
          />
          <Checkbox
            checked={showOther}
            onChange={(event) => setShowOther(event.target.checked)}
          >
            {t('聚合其他')}
          </Checkbox>
          <Input
            prefix={<Search size={14} />}
            value={dimension === 'node' ? nodeFilter : ''}
            onChange={(value) => dimension === 'node' && setNodeFilter(value)}
            placeholder={t('筛选节点')}
            style={{ width: 180 }}
            showClear
          />
        </div>
        {rows.length > 0 ? (
          <>
            <div className='flow-sankey-chart'>
              <VChart spec={sankeySpec} option={CHART_CONFIG} />
            </div>
            <div className='space-y-2 mb-4'>
              {rows.slice(0, 8).map((row) => (
                <div
                  key={`bar-${row.key}`}
                  className='flex items-center gap-2 text-xs'
                >
                  <span className='w-28 truncate' title={row.name}>
                    {row.name}
                  </span>
                  <div className='flex-1 h-2 bg-gray-100 rounded overflow-hidden'>
                    <div
                      className='h-full bg-blue-500 rounded'
                      style={{
                        width: `${Math.min(100, Math.max(0, row.share))}%`,
                      }}
                    />
                  </div>
                  <span className='w-14 text-right text-gray-500'>
                    {row.share.toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
            <Table
              columns={columns}
              dataSource={rows}
              rowKey='key'
              pagination={false}
              scroll={{ x: 620 }}
            />
          </>
        ) : (
          <Empty description={t('当前时间范围暂无调用流向数据')} />
        )}
      </div>
    </section>
  );
}
