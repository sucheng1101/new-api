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
import { Card, Empty, Tag } from '@douyinfe/semi-ui';
import { Activity, Gauge, Timer, Zap } from 'lucide-react';

import { renderNumber } from '../../helpers';
import { useModelPerformanceSummary } from '../../hooks/model-pricing/useModelPerformanceSummary';

const PerformanceHealthPanel = ({ enabled, t }) => {
  const models = useModelPerformanceSummary({ hours: 24, enabled });
  const summary = useMemo(() => {
    const values = Array.from(models.values());
    if (!values.length) return null;
    const totals = values.reduce(
      (result, item) => ({
        latency: result.latency + Number(item.avg_latency_ms || 0),
        success: result.success + Number(item.success_rate || 0),
        tps: result.tps + Number(item.avg_tps || 0),
      }),
      { latency: 0, success: 0, tps: 0 },
    );
    return {
      count: values.length,
      latency: totals.latency / values.length,
      success: totals.success / values.length,
      tps: totals.tps / values.length,
      models: values
        .slice()
        .sort(
          (a, b) => Number(b.success_rate || 0) - Number(a.success_rate || 0),
        )
        .slice(0, 3),
    };
  }, [models]);

  if (!enabled) return null;

  return (
    <Card
      className='!rounded-2xl'
      title={
        <div className='flex items-center gap-2'>
          <Activity size={16} />
          {t('模型性能健康')}
        </div>
      }
      headerExtraContent={<Tag color='blue'>{t('最近 24 小时')}</Tag>}
    >
      {summary ? (
        <div className='grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-[repeat(3,minmax(0,1fr))_minmax(260px,1.2fr)]'>
          {[
            [Gauge, t('平均成功率'), `${summary.success.toFixed(2)}%`],
            [
              Timer,
              t('平均延迟'),
              `${renderNumber(Math.round(summary.latency))} ms`,
            ],
            [Zap, t('平均吞吐'), `${summary.tps.toFixed(2)} TPS`],
          ].map(([Icon, label, value]) => (
            <div
              key={label}
              className='rounded-xl border border-semi-color-border p-3'
            >
              <div className='flex items-center gap-2 text-xs text-semi-color-text-2'>
                <Icon size={14} /> {label}
              </div>
              <div className='mt-2 text-xl font-semibold'>{value}</div>
            </div>
          ))}
          <div className='rounded-xl border border-semi-color-border p-3'>
            <div className='text-xs text-semi-color-text-2'>
              {t('已统计模型')} · {summary.count}
            </div>
            <div className='mt-2 flex flex-wrap gap-2'>
              {summary.models.map((item) => (
                <Tag key={item.model_name} color='green' shape='circle'>
                  {item.model_name}
                </Tag>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <Empty description={t('最近 24 小时暂无模型性能数据')} />
      )}
    </Card>
  );
};

export default PerformanceHealthPanel;
