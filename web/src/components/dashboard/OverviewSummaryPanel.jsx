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
import { Button, Card, Skeleton, Tag } from '@douyinfe/semi-ui';
import { Activity, ArrowRight, Flame, ShieldCheck, Wallet } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { API, renderNumber, renderQuota } from '../../helpers';

const BUCKET_COUNT = 12;

const MiniBars = ({ values }) => {
  const max = Math.max(...values, 1);
  return (
    <div className='flex h-8 items-end gap-1' aria-hidden>
      {values.map((value, index) => (
        <span
          key={index}
          className='min-w-1 flex-1 rounded-sm bg-semi-color-primary opacity-50'
          style={{ height: `${Math.max(8, (value / max) * 100)}%` }}
        />
      ))}
    </div>
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
      const start = end - 86400;
      try {
        const response = await API.get(
          `/api/data/self/?start_timestamp=${start}&end_timestamp=${end}&default_time=hour`,
        );
        if (active && response.data?.success) {
          setRows(response.data.data || []);
        }
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
    const start = end - 86400;
    const usageBuckets = Array.from({ length: BUCKET_COUNT }, () => 0);
    const requestBuckets = Array.from({ length: BUCKET_COUNT }, () => 0);
    let usage = 0;
    let requests = 0;
    rows.forEach((row) => {
      const quota = Number(row.quota || 0);
      const count = Number(row.count || 0);
      const timestamp = Number(row.created_at || start);
      const ratio = Math.max(
        0,
        Math.min(0.9999, (timestamp - start) / (end - start)),
      );
      const index = Math.floor(ratio * BUCKET_COUNT);
      usage += quota;
      requests += count;
      usageBuckets[index] += quota;
      requestBuckets[index] += count;
    });
    return { usage, requests, usageBuckets, requestBuckets };
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
      values: summary.usageBuckets,
    },
    {
      title: t('请求次数'),
      value: renderNumber(requestCount),
      description: t('账户累计请求总量'),
      icon: ShieldCheck,
      values: summary.requestBuckets,
    },
    {
      title: t('最近 24 小时消耗'),
      value: renderQuota(summary.usage),
      description: t('按小时聚合的额度消耗'),
      icon: Flame,
      values: summary.usageBuckets,
    },
  ];

  return (
    <Card
      className='!mb-4 !rounded-2xl overflow-hidden'
      bodyStyle={{ padding: 0 }}
    >
      <div className='grid xl:grid-cols-[minmax(0,1fr)_310px]'>
        <div className='p-4 sm:p-5'>
          <div className='mb-4'>
            <h2 className='text-base font-semibold'>{t('用量概览')}</h2>
            <p className='mt-1 text-sm text-semi-color-text-2'>
              {t('查看余额、消耗和请求量')}
            </p>
          </div>
          <div className='grid grid-cols-1 gap-3 sm:grid-cols-3'>
            {cards.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.title}
                  className='rounded-xl border border-semi-color-border bg-semi-color-bg-0 p-3'
                >
                  <div className='flex items-center gap-2 text-xs font-medium text-semi-color-text-2'>
                    <Icon size={15} />
                    {item.title}
                  </div>
                  <Skeleton
                    loading={loading}
                    active
                    placeholder={
                      <Skeleton.Title style={{ width: 96, height: 28 }} />
                    }
                  >
                    <div className='mt-2 text-xl font-semibold'>
                      {item.value}
                    </div>
                    <div className='mt-1 text-xs text-semi-color-text-2'>
                      {item.description}
                    </div>
                    <div className='mt-3'>
                      <MiniBars values={item.values} />
                    </div>
                  </Skeleton>
                </div>
              );
            })}
          </div>
        </div>

        <div className='flex flex-col justify-between gap-4 border-t border-semi-color-border bg-gradient-to-br from-blue-50 to-emerald-50 p-4 dark:from-blue-950/30 dark:to-emerald-950/20 sm:p-5 xl:border-l xl:border-t-0'>
          <div>
            <div className='flex items-center justify-between gap-2'>
              <span className='text-xs font-medium text-semi-color-text-2'>
                {t('剩余额度')}
              </span>
              <Tag color={health}>
                {health === 'red'
                  ? t('余额已用尽')
                  : health === 'orange'
                    ? t('余额偏低')
                    : t('状态健康')}
              </Tag>
            </div>
            <div className='mt-3 text-2xl font-semibold'>
              {renderQuota(remainQuota)}
            </div>
            <div className='mt-4 grid grid-cols-2 gap-2'>
              <div className='rounded-lg bg-semi-color-bg-0 p-3'>
                <div className='flex items-center gap-1 text-[11px] text-semi-color-text-2'>
                  <Flame size={12} /> {t('最近 24 小时')}
                </div>
                <div className='mt-1 text-sm font-semibold'>
                  {renderQuota(summary.usage)}
                </div>
              </div>
              <div className='rounded-lg bg-semi-color-bg-0 p-3'>
                <div className='flex items-center gap-1 text-[11px] text-semi-color-text-2'>
                  <ShieldCheck size={12} /> {t('预计可用')}
                </div>
                <div className='mt-1 text-sm font-semibold'>{runway}</div>
              </div>
            </div>
          </div>
          <Button
            block
            type='primary'
            icon={<Wallet size={15} />}
            onClick={() => navigate('/console/topup')}
          >
            <span className='flex flex-1 items-center justify-between'>
              {t('钱包管理')} <ArrowRight size={15} />
            </span>
          </Button>
        </div>
      </div>
    </Card>
  );
};

export default OverviewSummaryPanel;
