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

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Tooltip } from '@douyinfe/semi-ui';
import { CalendarDays, Flame, Hash, Trophy, TrendingUp } from 'lucide-react';

import { renderNumber, renderQuota } from '../../helpers';

const DAY_MS = 24 * 60 * 60 * 1000;
const VIEW_MODES = ['daily', 'weekly', 'cumulative'];
const LEVEL_CLASSES = [
  'bg-semi-color-fill-0',
  'bg-blue-100 dark:bg-blue-950/60',
  'bg-blue-300 dark:bg-blue-800',
  'bg-blue-500 dark:bg-blue-600',
  'bg-blue-700 dark:bg-blue-400',
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
  <div className='flex min-w-0 items-center justify-center gap-2 px-2 py-2 sm:px-3'>
    <div
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${tone}`}
    >
      <Icon size={14} />
    </div>
    <div className='min-w-0 text-left'>
      <div className='truncate text-base font-semibold leading-5 text-semi-color-text-0 sm:text-lg'>
        {value}
      </div>
      <div className='text-[11px] leading-4 text-semi-color-text-2'>
        {label}
      </div>
      {detail ? (
        <div className='text-[9px] leading-3 text-semi-color-text-2'>
          {detail}
        </div>
      ) : null}
    </div>
  </div>
);

const UsageHeatmap = ({ data = [], loading, t }) => {
  const [viewMode, setViewMode] = useState('daily');
  const heatmapScrollRef = useRef(null);
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
    const weekTotals = new Map();
    activeEntries.forEach(([date, item]) => {
      const dateValue = new Date(`${date}T00:00:00`);
      const weekStart = new Date(dateValue);
      weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
      const weekKey = toDateKey(weekStart);
      weekTotals.set(weekKey, (weekTotals.get(weekKey) || 0) + item.count);
    });
    let cumulative = 0;
    const levelByDate = new Map();
    activeEntries.forEach(([date, item]) => {
      const dateValue = new Date(`${date}T00:00:00`);
      const weekStart = new Date(dateValue);
      weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
      const weekKey = toDateKey(weekStart);
      cumulative += item.count;
      levelByDate.set(
        date,
        viewMode === 'weekly'
          ? weekTotals.get(weekKey)
          : viewMode === 'cumulative'
            ? cumulative
            : item.count,
      );
    });
    const rawValues = activeEntries.map(([, item]) => item.count);
    const values = activeEntries
      .map(([date]) => levelByDate.get(date) || 0)
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
          levelCount: levelByDate.get(key) || 0,
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
    const requestTotal = rawValues.reduce((sum, value) => sum + value, 0);

    return {
      cells: nextCells,
      monthLabels: nextMonthLabels,
      thresholds: nextThresholds,
      totalRequests: requestTotal,
      activeDays: rawValues.length,
      peakCount: peak.count,
      peakDate: peak.date ? new Date(`${peak.date}T00:00:00`) : null,
      averageDaily: rawValues.length
        ? Math.round(requestTotal / rawValues.length)
        : 0,
      currentStreak: streaks.current,
      longestStreak: streaks.longest,
    };
  }, [data, viewMode]);

  useEffect(() => {
    if (!loading && heatmapScrollRef.current) {
      heatmapScrollRef.current.scrollLeft =
        heatmapScrollRef.current.scrollWidth;
    }
  }, [data, loading]);

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
            <div className='text-sm font-semibold'>
              {t('\u8c03\u7528\u6b21\u6570')}
            </div>
            <div className='text-xs text-semi-color-text-2'>
              {t('\u8c03\u7528\u6b21\u6570\u5206\u5e03')}
            </div>
          </div>
        </div>
        <div className='flex items-center gap-3'>
          <div className='text-xs text-semi-color-text-2'>
            {t('\u8c03\u7528\u6b21\u6570')}: {renderNumber(totalRequests)} -{' '}
            {renderNumber(activeDays)} {t('\u5929')}
          </div>
          <div className='flex items-center rounded-full bg-semi-color-fill-0 p-0.5'>
            {VIEW_MODES.map((mode) => (
              <button
                key={mode}
                type='button'
                aria-pressed={viewMode === mode}
                className={`rounded-full px-2.5 py-1 text-[11px] transition-colors ${
                  viewMode === mode
                    ? 'bg-semi-color-bg-2 font-medium text-semi-color-text-0 shadow-sm'
                    : 'text-semi-color-text-2 hover:text-semi-color-text-0'
                }`}
                onClick={() => setViewMode(mode)}
              >
                {t(
                  mode === 'daily'
                    ? '\u6bcf\u65e5'
                    : mode === 'weekly'
                      ? '\u6bcf\u5468'
                      : '\u7d2f\u8ba1',
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div
        ref={heatmapScrollRef}
        className='w-full overflow-x-auto pb-1 sm:overflow-visible'
      >
        <div className='relative min-w-[640px] sm:w-full sm:min-w-0'>
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
                          : LEVEL_CLASSES[getLevel(cell.levelCount, thresholds)]
                      }`}
                    />
                  </Tooltip>
                );
              })}
            </div>
          )}
          <div className='mt-2 flex h-4 items-start justify-between gap-2'>
            {monthLabels.map((item) => (
              <span
                key={`${item.label}-${item.column}`}
                className='whitespace-nowrap text-[10px] text-semi-color-text-2'
              >
                {item.label}
              </span>
            ))}
          </div>
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
            className={`${index > 0 ? 'border-t sm:border-l sm:border-t-0' : ''} ${index === 2 ? 'lg:border-l' : ''} ${index === 4 ? 'col-span-2 sm:col-span-1' : ''} border-semi-color-border`}
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
