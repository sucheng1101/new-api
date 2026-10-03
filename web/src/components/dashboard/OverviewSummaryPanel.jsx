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

import React, { useEffect, useMemo, useState } from 'react';
import { Button, Card, Tag } from '@douyinfe/semi-ui';
import { Activity, ArrowRight, Flame, ShieldCheck, Wallet } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { API, renderNumber, renderQuota } from '../../helpers';
import UsageHeatmap, { aggregateUsageByDate } from './UsageHeatmap';

const DAY_SECONDS = 24 * 60 * 60;
const MAX_RANGE_SECONDS = 30 * DAY_SECONDS;
const YEAR_SECONDS = 365 * DAY_SECONDS;

const loadYearRows = async (start, end) => {
  const requests = [];
  let cursor = start;
  while (cursor < end) {
    const segmentEnd = Math.min(end, cursor + MAX_RANGE_SECONDS - 1);
    requests.push(
      API.get(
        `/api/data/self/?start_timestamp=${cursor}&end_timestamp=${segmentEnd}&default_time=hour`,
      ),
    );
    cursor = segmentEnd + 1;
  }

  const results = await Promise.allSettled(requests);
  return results.flatMap((result) =>
    result.status === 'fulfilled' && result.value.data?.success
      ? result.value.data.data || []
      : [],
  );
};

const OverviewSummaryPanel = ({ user, refreshKey, t }) => {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      const end = Math.floor(Date.now() / 1000);
      const start = end - YEAR_SECONDS;
      try {
        const nextRows = await loadYearRows(start, end);
        if (active) setRows(nextRows);
      } catch (error) {
        console.error(error);
        if (active) setRows([]);
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [refreshKey]);

  const summary = useMemo(() => {
    const end = Math.floor(Date.now() / 1000);
    const start = end - DAY_SECONDS;
    let usage = 0;

    rows.forEach((row) => {
      const timestamp = Number(row.created_at || start);
      if (timestamp < start || timestamp > end) return;
      const quota = Number(row.quota || 0);
      usage += quota;
    });
    return { usage };
  }, [rows]);

  const remainQuota = Number(user?.quota || 0);
  const usedQuota = Number(user?.used_quota || 0);
  const requestCount = Number(user?.request_count || 0);
  const runwayDays = summary.usage > 0 ? remainQuota / summary.usage : null;
  const health =
    remainQuota <= 0
      ? 'red'
      : runwayDays !== null && runwayDays < 3
        ? 'orange'
        : 'green';
  const runway =
    remainQuota <= 0
      ? t('余额已用尽')
      : runwayDays === null
        ? t('近期暂无消耗')
        : runwayDays < 1
          ? t('不足 1 天')
          : `~${renderNumber(Math.min(999, Math.floor(runwayDays)))} ${t('天')}`;
  const cards = [
    {
      title: t('历史消耗'),
      value: renderQuota(usedQuota),
      description: t('账户累计使用额度'),
      icon: Activity,
    },
    {
      title: t('请求次数'),
      value: renderNumber(requestCount),
      description: t('账户累计请求总量'),
      icon: ShieldCheck,
    },
    {
      title: t('最近 24 小时消耗'),
      value: renderQuota(summary.usage),
      description: t('按小时聚合的额度消耗'),
      icon: Flame,
    },
  ];
  const heatmapData = useMemo(() => aggregateUsageByDate(rows), [rows]);

  return (
    <Card
      className='!mb-4 !rounded-2xl overflow-hidden'
      bodyStyle={{ padding: 0 }}
    >
      <div className='grid items-stretch xl:grid-cols-[minmax(0,1fr)_360px]'>
        <div className='flex min-w-0 p-3 sm:p-4'>
          <UsageHeatmap data={heatmapData} loading={loading} t={t} />
        </div>

        <div className='flex flex-col justify-between gap-3 border-t border-semi-color-border bg-gradient-to-br from-blue-50 to-emerald-50 p-3 dark:from-blue-950/30 dark:to-emerald-950/20 sm:p-4 xl:border-l xl:border-t-0'>
          <div>
            <div className='flex items-center justify-between gap-2'>
              <span className='text-xs font-medium text-semi-color-text-2'>
                {t('剩余额度')}
              </span>
              <Tag color={health} size='small'>
                {health === 'red'
                  ? t('余额已用尽')
                  : health === 'orange'
                    ? t('余额偏低')
                    : t('状态健康')}
              </Tag>
            </div>
            <div className='mt-2 text-xl font-semibold'>
              {renderQuota(remainQuota)}
            </div>
            <div className='mt-3 grid grid-cols-3 gap-2'>
              {cards.map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.title}
                    className='min-w-0 rounded-lg bg-semi-color-bg-0 px-2 py-2'
                  >
                    <div className='flex items-center gap-1 text-[10px] text-semi-color-text-2'>
                      <Icon size={11} className='shrink-0' />
                      <span className='truncate'>{item.title}</span>
                    </div>
                    <div className='mt-1 truncate text-sm font-semibold'>
                      {item.value}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className='mt-2 rounded-lg bg-semi-color-bg-0 px-2.5 py-2'>
              <div className='flex items-center gap-1 text-[10px] text-semi-color-text-2'>
                <ShieldCheck size={11} /> {t('预计可用')}
              </div>
              <div className='mt-1 truncate text-xs font-semibold'>
                {runway}
              </div>
            </div>
          </div>
          <Button
            block
            size='small'
            type='primary'
            icon={<Wallet size={14} />}
            onClick={() => navigate('/console/topup')}
          >
            <span className='flex flex-1 items-center justify-between'>
              {t('钱包管理')} <ArrowRight size={14} />
            </span>
          </Button>
        </div>
      </div>
    </Card>
  );
};

export default OverviewSummaryPanel;
