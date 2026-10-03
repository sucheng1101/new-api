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
import { Tooltip } from '@douyinfe/semi-ui';
import { CalendarDays, Flame, Hash, Trophy, TrendingUp } from 'lucide-react';

import { renderNumber, renderQuota } from '../../helpers';

const DAY_MS = 24 * 60 * 60 * 1000;
const LEVEL_CLASSES = [
  'bg-semi-color-fill-0',
  'bg-emerald-100 dark:bg-emerald-950/60',
  'bg-emerald-300 dark:bg-emerald-800',
  'bg-emerald-500 dark:bg-emerald-600',
  'bg-emerald-700 dark:bg-emerald-400',
];

const toDateKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatDate = (date) =>
  new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);

const getLevel = (count, thresholds) => {
  if (!count) return 0;
  // Keep every active day visibly different from an unused day. With a
  // single active value all percentile thresholds collapse to the same
  // number, so the lowest non-zero level would otherwise be too faint.
  let level = 4;
  if (count <= thresholds[0]) level = 1;
  else if (count <= thresholds[1]) level = 2;
  else if (count <= thresholds[2]) level = 3;
  return Math.max(2, level);
};

const getStreaks = (dates, today) => {
  if (dates.length === 0) return { current: 0, longest: 0 };

  let longest = 0;
  let run = 0;
  let previous = null;
  dates.forEach((date) => {
    const distance = previous
      ? Math.round((date.getTime() - previous.getTime()) / DAY_MS)
      : 0;
    run = distance === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = date;
  });

  const activeKeys = new Set(dates.map(toDateKey));
  const cursor = new Date(today);
  if (!activeKeys.has(toDateKey(cursor))) cursor.setDate(cursor.getDate() - 1);

  let current = 0;
  while (activeKeys.has(toDateKey(cursor))) {
    current += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return { current, longest };
};

const SummaryMetric = ({ icon: Icon, value, label, detail, tone }) => (
  <div className='min-w-0 px-2 py-2 text-center sm:px-3'>
    <div
      className={`mx-auto flex h-6 w-6 items-center justify-center rounded-md ${tone}`}
    >
      <Icon size={13} />
    </div>
    <div className='mt-1 truncate text-sm font-semibold text-semi-color-text-0 sm:text-base'>
      {value}
    </div>
    <div className='mt-0.5 truncate text-[10px] text-semi-color-text-2'>
      {label}
    </div>
    {detail ? (
      <div className='mt-0.5 truncate text-[9px] text-semi-color-text-2'>
        {detail}
      </div>
    ) : null}
  </div>
);

const UsageHeatmap = ({ data = [], loading, t }) => {
  const {
    cells,
    monthLabels,
    thresholds,
    totalRequests,
    activeDays,
    peakCount,
    peakDate,
    averageDaily,
    currentStreak,
    longestStreak,
  } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const gridStart = new Date(today.getTime() - 364 * DAY_MS);
    gridStart.setDate(gridStart.getDate() - gridStart.getDay());
    const gridEnd = new Date(today);
    gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()));

    const byDate = new Map(
      data.map((item) => [
        item.date,
        {
          count: Number(item.count || 0),
          quota: Number(item.quota || 0),
          tokenUsed: Number(item.tokenUsed || 0),
        },
      ]),
    );
    const activeEntries = Array.from(byDate.entries())
      .filter(([, item]) => item.count > 0)
      .sort(([left], [right]) => left.localeCompare(right));
    const values = activeEntries
      .map(([, item]) => item.count)
      .sort((a, b) => a - b);
    const percentile = (ratio) =>
      values.length
        ? values[Math.min(values.length - 1, Math.floor(values.length * ratio))]
        : 1;
    const nextThresholds = [
      percentile(0.25),
      percentile(0.5),
      percentile(0.75),
    ];

    const nextCells = [];
    const nextMonthLabels = [];
    const cursor = new Date(gridStart);
    let column = 0;
    while (cursor <= gridEnd) {
      for (let row = 0; row < 7; row += 1) {
        const date = new Date(cursor.getTime() + row * DAY_MS);
        const key = toDateKey(date);
        const value = byDate.get(key) || {
          count: 0,
          quota: 0,
          tokenUsed: 0,
        };
        nextCells.push({
          key,
          date,
          value,
          column,
          row,
          future: date > today,
        });
      }
      if (cursor.getDate() <= 7 || column === 0) {
        nextMonthLabels.push({
          label: new Intl.DateTimeFormat(undefined, {
            month: 'short',
          }).format(cursor),
          column,
        });
      }
      cursor.setDate(cursor.getDate() + 7);
      column += 1;
    }

    const peak = activeEntries.reduce(
      (result, [date, item]) =>
        item.count > result.count ? { date, count: item.count } : result,
      { date: '', count: 0 },
    );
    const activeDates = activeEntries.map(
      ([date]) => new Date(`${date}T00:00:00`),
    );
    const streaks = getStreaks(activeDates, today);
    const requestTotal = values.reduce((sum, value) => sum + value, 0);

    return {
      cells: nextCells,
      monthLabels: nextMonthLabels,
      thresholds: nextThresholds,
      totalRequests: requestTotal,
      activeDays: values.length,
      peakCount: peak.count,
      peakDate: peak.date ? new Date(`${peak.date}T00:00:00`) : null,
      averageDaily: values.length
        ? Math.round(requestTotal / values.length)
        : 0,
      currentStreak: streaks.current,
      longestStreak: streaks.longest,
    };
  }, [data]);

  const summaryMetrics = [
    {
      icon: Hash,
      value: loading ? '—' : renderNumber(totalRequests),
      label: t('累计调用次数'),
      tone: 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300',
    },
    {
      icon: TrendingUp,
      value: loading ? '—' : renderNumber(peakCount),
      label: t('峰值调用次数'),
      detail: peakDate ? formatDate(peakDate) : t('暂无数据'),
      tone: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300',
    },
    {
      icon: CalendarDays,
      value: loading ? '—' : renderNumber(averageDaily),
      label: t('平均每日调用'),
      tone: 'bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-300',
    },
    {
      icon: Flame,
      value: loading ? '—' : `${renderNumber(currentStreak)} ${t('天')}`,
      label: t('当前连续天数'),
      tone: 'bg-orange-50 text-orange-600 dark:bg-orange-950/40 dark:text-orange-300',
    },
    {
      icon: Trophy,
      value: loading ? '—' : `${renderNumber(longestStreak)} ${t('天')}`,
      label: t('最长连续天数'),
      tone: 'bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300',
    },
  ];

  return (
    <div className='flex h-full w-full min-w-0 flex-col'>
      <div className='mb-3 flex flex-wrap items-center justify-between gap-2'>
        <div className='flex items-center gap-2'>
          <span className='flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300'>
            <CalendarDays size={15} />
          </span>
          <div>
            <div className='text-sm font-semibold'>{t('调用次数')}</div>
            <div className='text-xs text-semi-color-text-2'>
              {t('调用次数分布')}
            </div>
          </div>
        </div>
        <div className='text-xs text-semi-color-text-2'>
          {t('调用次数')}：{renderNumber(totalRequests)} ·{' '}
          {renderNumber(activeDays)} {t('天')}
        </div>
      </div>

      <div className='overflow-x-auto pb-1'>
        <div className='relative min-w-[680px]'>
          <div
            className='mb-1 grid h-4'
            style={{
              gridTemplateColumns: `repeat(${Math.max(1, Math.ceil(cells.length / 7))}, minmax(0, 1fr))`,
            }}
          >
            {monthLabels.map((item) => (
              <span
                key={`${item.label}-${item.column}`}
                className='text-[10px] text-semi-color-text-2'
                style={{ gridColumnStart: item.column + 1 }}
              >
                {item.label}
              </span>
            ))}
          </div>
          {loading ? (
            <div className='grid h-[76px] grid-flow-col grid-rows-7 gap-1'>
              {Array.from({ length: 53 * 7 }).map((_, index) => (
                <span
                  key={index}
                  className='animate-pulse rounded-[3px] bg-semi-color-fill-0'
                />
              ))}
            </div>
          ) : (
            <div
              className='grid h-[76px] grid-flow-col grid-rows-7 gap-1'
              style={{
                gridTemplateColumns: `repeat(${Math.max(1, Math.ceil(cells.length / 7))}, minmax(0, 1fr))`,
              }}
            >
              {cells.map((cell) => {
                const tooltip = `${formatDate(cell.date)} · ${t('调用次数')}：${renderNumber(cell.value.count)} · ${t('额度')}：${renderQuota(cell.value.quota)} · Token：${renderNumber(cell.value.tokenUsed)}`;
                return (
                  <Tooltip key={cell.key} content={tooltip} position='top'>
                    <span
                      aria-label={tooltip}
                      className={`block h-full min-h-[9px] rounded-[3px] ${
                        cell.future
                          ? 'bg-transparent'
                          : LEVEL_CLASSES[
                              getLevel(cell.value.count, thresholds)
                            ]
                      }`}
                    />
                  </Tooltip>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className='mt-3 flex items-center justify-between gap-2 text-[11px] text-semi-color-text-2'>
        <span>{t('按调用次数')}</span>
        <div className='flex items-center gap-1'>
          <span>{t('少')}</span>
          {LEVEL_CLASSES.map((className, index) => (
            <span
              key={index}
              className={`h-3 w-3 rounded-[3px] ${className}`}
            />
          ))}
          <span>{t('多')}</span>
        </div>
      </div>

      <div className='mt-3 grid grid-cols-2 overflow-hidden rounded-lg bg-semi-color-fill-0 sm:grid-cols-3 lg:grid-cols-5'>
        {summaryMetrics.map((metric, index) => (
          <div
            key={metric.label}
            className={`${index > 0 ? 'border-t sm:border-l sm:border-t-0' : ''} ${index === 2 ? 'lg:border-l' : ''} border-semi-color-border`}
          >
            <SummaryMetric {...metric} />
          </div>
        ))}
      </div>
    </div>
  );
};

export const aggregateUsageByDate = (rows = []) => {
  const map = new Map();
  rows.forEach((row) => {
    const timestamp = Number(row.created_at || 0);
    if (!timestamp) return;
    const date = new Date(timestamp * 1000);
    const key = toDateKey(date);
    const current = map.get(key) || {
      date: key,
      count: 0,
      quota: 0,
      tokenUsed: 0,
    };
    current.count += Number(row.count || 0);
    current.quota += Number(row.quota || 0);
    current.tokenUsed += Number(row.token_used || row.tokenUsed || 0);
    map.set(key, current);
  });
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
};

export default UsageHeatmap;
