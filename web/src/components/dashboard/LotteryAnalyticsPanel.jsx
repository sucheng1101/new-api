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

import React from 'react';
import { Card, Empty, Table, Tag } from '@douyinfe/semi-ui';
import { BarChart3, Gift, Users, WalletCards } from 'lucide-react';
import { renderNumber, renderQuota } from '../../helpers';

const percent = (basisPoints) =>
  `${(Number(basisPoints || 0) / 100).toFixed(2)}%`;

export default function LotteryAnalyticsPanel({ stats, loading = false, t }) {
  if (!stats && !loading) return null;
  const prizes = Array.isArray(stats?.prizes) ? stats.prizes : [];
  const columns = [
    { title: t('奖品'), dataIndex: 'name' },
    {
      title: t('配置概率'),
      dataIndex: 'configured_probability_basis_points',
      render: (value) =>
        Number(value || 0) > 0 ? percent(value) : t('按权重'),
    },
    {
      title: t('实际中奖率'),
      dataIndex: 'actual_probability_basis_points',
      render: (value) => percent(value),
    },
    {
      title: t('中奖次数'),
      dataIndex: 'draw_count',
      render: (value) => renderNumber(value || 0),
    },
    {
      title: t('库存'),
      dataIndex: 'stock',
      render: (value, row) => (value === -1 ? t('不限') : value),
    },
    {
      title: t('状态'),
      render: (_, row) => (
        <Tag
          color={
            row.eligible
              ? 'green'
              : row.configured === false
                ? 'orange'
                : 'grey'
          }
        >
          {row.configured === false
            ? t('历史记录')
            : row.eligible
              ? t('参与奖池')
              : t('未参与')}
        </Tag>
      ),
    },
  ];

  return (
    <Card
      className='!rounded-2xl mb-4'
      title={
        <div className='flex items-center gap-2'>
          <BarChart3 size={17} />
          <span>{t('抽奖概率与结果')}</span>
          <Tag color='blue'>{t('管理员')}</Tag>
        </div>
      }
      loading={loading}
      bodyStyle={{ padding: 16 }}
    >
      {stats ? (
        <>
          <div className='grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4'>
            {[
              [
                <Gift size={16} />,
                t('抽奖次数'),
                renderNumber(stats.total_draws || 0),
              ],
              [
                <Users size={16} />,
                t('参与人数'),
                renderNumber(stats.participants || 0),
              ],
              [
                <WalletCards size={16} />,
                t('奖励额度'),
                renderQuota(stats.reward_quota || 0, 2),
              ],
            ].map(([icon, label, value]) => (
              <div key={label} className='border rounded-lg p-3'>
                <div className='flex items-center gap-2 text-xs text-gray-500'>
                  {icon}
                  {label}
                </div>
                <div className='text-lg font-semibold mt-1'>{value}</div>
              </div>
            ))}
          </div>
          {prizes.length > 0 ? (
            <Table
              columns={columns}
              dataSource={prizes}
              rowKey='id'
              pagination={false}
              scroll={{ x: 720 }}
            />
          ) : (
            <Empty description={t('暂无奖品配置')} />
          )}
        </>
      ) : (
        <Empty description={t('当前时间范围暂无抽奖数据')} />
      )}
    </Card>
  );
}
