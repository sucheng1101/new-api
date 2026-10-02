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
    <div className='dashboard-performance-strip'>
      <div className='dashboard-performance-title'>
        <span className='dashboard-performance-icon'>
          <Activity size={14} />
        </span>
        <span>{t('模型性能健康')}</span>
      </div>
      {summary ? (
        <>
          <span className='dashboard-performance-divider' />
          <div className='dashboard-performance-metrics'>
            <InlineMetric
              icon={Gauge}
              label={t('平均成功率')}
              value={`${summary.success.toFixed(2)}%`}
            />
            <InlineMetric
              icon={Timer}
              label={t('平均延迟')}
              value={`${renderNumber(Math.round(summary.latency))} ms`}
            />
            <InlineMetric
              icon={Zap}
              label={t('平均吞吐')}
              value={`${summary.tps.toFixed(2)} TPS`}
            />
          </div>
          <span className='dashboard-performance-divider hidden lg:block' />
          <div className='dashboard-performance-models'>
            {summary.models.map((item) => (
              <span
                key={item.model_name}
                className='dashboard-performance-badge'
              >
                {item.model_name}
              </span>
            ))}
          </div>
        </>
      ) : (
        <span className='dashboard-performance-empty'>{t('暂无性能数据')}</span>
      )}
    </div>
  );
};

const InlineMetric = ({ icon: Icon, label, value }) => (
  <div className='dashboard-performance-metric'>
    <Icon size={13} />
    <span>{label}</span>
    <strong>{value}</strong>
  </div>
);

export default PerformanceHealthPanel;
