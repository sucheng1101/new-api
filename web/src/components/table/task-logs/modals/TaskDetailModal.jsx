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
import { Button, Modal, Tag, Typography } from '@douyinfe/semi-ui';
import { Film } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getTaskArtifactAction, getTaskLogDetails } from '../taskLogDetails';

const { Text, Title } = Typography;

const formatTimestamp = (timestamp) => {
  if (!timestamp) return '-';
  const date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) return '-';
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds(),
  )}`;
};

const formatDuration = (seconds) => {
  if (seconds === null || seconds === undefined) return '-';
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  return `${Math.floor(seconds / 60)}m ${(seconds % 60)
    .toFixed(0)
    .padStart(2, '0')}s`;
};

const formatQuota = (value, t) => {
  if (value === null || value === undefined) return '-';
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '-';
  return `${amount.toLocaleString()} ${t('额度')}`;
};

const formatUsageFact = (key, value, t) => {
  switch (key) {
    case 'seconds':
    case 'duration':
    case 'duration_seconds':
      return { label: t('视频时长'), value: `${value} ${t('秒')}` };
    case 'resolution':
    case 'size':
      return { label: t('分辨率'), value: String(value) };
    case 'input_images':
      return { label: t('参考图片数'), value: `${value} ${t('张')}` };
    case 'input_video_seconds':
      return { label: t('输入视频时长'), value: `${value} ${t('秒')}` };
    default:
      return { label: key, value: String(value) };
  }
};

const componentLabel = (component, t) => {
  if (component.kind === 'base') return t('公共基础价格');
  if (component.kind === 'plugin_addon') {
    return component.pluginKey
      ? t('插件附加价格（{{plugin}}）', { plugin: component.pluginKey })
      : t('插件附加价格');
  }
  return component.kind;
};

const componentValue = (component, t) => {
  const parts = [];
  if (component.estimatedTier) {
    parts.push(`${t('预估档位')} ${component.estimatedTier}`);
  }
  if (component.actualTier) {
    parts.push(`${t('实际档位')} ${component.actualTier}`);
  }
  if (component.estimatedQuotaBeforeGroup !== null) {
    parts.push(
      `${t('预估')} ${formatQuota(component.estimatedQuotaBeforeGroup, t)}`,
    );
  }
  if (component.actualQuotaBeforeGroup !== null) {
    parts.push(
      `${t('实际')} ${formatQuota(component.actualQuotaBeforeGroup, t)}`,
    );
  }
  return parts.join(' · ');
};

const DetailRow = ({ label, value, mono = false }) => {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '132px minmax(0, 1fr)',
        gap: 12,
        padding: '7px 0',
        borderBottom: '1px solid var(--semi-color-border)',
      }}
    >
      <Text type='tertiary'>{label}</Text>
      <Text
        ellipsis={{ showTooltip: true }}
        style={{
          fontFamily: mono ? 'var(--semi-font-family-code)' : undefined,
        }}
      >
        {value}
      </Text>
    </div>
  );
};

const DetailSection = ({ title, children }) => {
  const rows = React.Children.toArray(children).filter(Boolean);
  if (!rows.length) return null;
  return (
    <section style={{ marginBottom: 20 }}>
      <Title heading={6} style={{ margin: '0 0 8px' }}>
        {title}
      </Title>
      <div>{rows}</div>
    </section>
  );
};

const TaskDetailModal = ({
  visible,
  onCancel,
  task,
  isAdminUser,
  isRootUser,
  onOpenArtifact,
}) => {
  const { t } = useTranslation();
  const details = useMemo(
    () => getTaskLogDetails(task, { isAdminUser, isRootUser }),
    [task, isAdminUser, isRootUser],
  );
  const { basic, billing, admin, root } = details;
  const timings = basic.timings;
  const plugin = admin?.plugin;
  const runtime = root?.runtime;
  const artifactAction = getTaskArtifactAction(task);
  const canOpenArtifact =
    artifactAction === 'plugin' || artifactAction === 'legacy-video';

  return (
    <Modal
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {t('任务详情')}
          {basic.status ? <Tag color='blue'>{basic.status}</Tag> : null}
        </span>
      }
      visible={visible}
      onCancel={onCancel}
      footer={null}
      width={760}
      bodyStyle={{ maxHeight: '70vh', overflow: 'auto' }}
    >
      {canOpenArtifact ? (
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            marginBottom: 16,
          }}
        >
          <Button
            type='primary'
            theme='solid'
            size='small'
            icon={<Film size={15} />}
            onClick={() => onOpenArtifact?.(task)}
          >
            {t(artifactAction === 'legacy-video' ? '查看视频' : '查看制品')}
          </Button>
        </div>
      ) : null}
      <DetailSection title={t('基本信息')}>
        <DetailRow label={t('任务ID')} value={basic.taskId} mono />
        <DetailRow label={t('平台')} value={basic.platform} mono />
        <DetailRow label={t('操作')} value={basic.action} mono />
        <DetailRow label={t('状态')} value={basic.status} mono />
        <DetailRow label={t('进度')} value={basic.progress || '-'} mono />
        <DetailRow
          label={t('提交时间')}
          value={formatTimestamp(basic.submitTime)}
          mono
        />
        <DetailRow
          label={t('开始时间')}
          value={formatTimestamp(basic.startTime)}
          mono
        />
        <DetailRow
          label={t('完成时间')}
          value={formatTimestamp(basic.finishTime)}
          mono
        />
        <DetailRow
          label={timings?.isFinished ? t('总耗时') : t('已等待')}
          value={formatDuration(timings?.totalSeconds)}
          mono
        />
        <DetailRow
          label={t('排队耗时')}
          value={formatDuration(timings?.queueSeconds)}
          mono
        />
        <DetailRow
          label={t('执行耗时')}
          value={formatDuration(timings?.executionSeconds)}
          mono
        />
        <DetailRow label={t('原始模型')} value={basic.originModel} mono />
        <DetailRow label={t('实际模型')} value={basic.actualModel} mono />
        <DetailRow label={t('失败原因')} value={basic.failReason} />
      </DetailSection>

      {billing ? (
        <DetailSection title={t('计费明细')}>
          <DetailRow
            label={t('计费方式')}
            value={
              billing.mode === 'tiered_expr'
                ? t('规格表达式计费')
                : billing.mode
            }
          />
          <DetailRow
            label={t('结算状态')}
            value={billing.settled ? t('已完成') : t('预扣中')}
          />
          <DetailRow
            label={t('分组倍率')}
            value={billing.groupRatio === null ? '' : `${billing.groupRatio}x`}
          />
          <DetailRow
            label={t('基础与附加预估总额')}
            value={formatQuota(billing.estimatedQuota, t)}
          />
          <DetailRow
            label={t('最终扣除额度')}
            value={formatQuota(billing.actualQuota, t)}
          />
          {billing.usageFacts.map(([key, value]) => {
            const fact = formatUsageFact(key, value, t);
            return (
              <DetailRow key={key} label={fact.label} value={fact.value} />
            );
          })}
          {billing.components.map((component, index) => (
            <DetailRow
              key={`${component.kind}-${component.pluginKey || index}`}
              label={componentLabel(component, t)}
              value={componentValue(component, t)}
            />
          ))}
        </DetailSection>
      ) : null}

      {admin ? (
        <DetailSection title={t('仅管理员可见')}>
          <DetailRow label={t('用户')} value={admin.user} />
          <DetailRow
            label={t('渠道')}
            value={admin.channel === null ? '' : `#${admin.channel}`}
            mono
          />
          <DetailRow label={t('分组')} value={admin.group} mono />
          <DetailRow
            label={t('额度')}
            value={admin.quota === null ? '' : String(admin.quota)}
            mono
          />
          <DetailRow label={t('请求ID')} value={admin.requestId} mono />
          <DetailRow label={t('请求路径')} value={admin.requestPath} mono />
          <DetailRow
            label={t('任务插件')}
            value={plugin?.name || plugin?.key}
          />
          <DetailRow label={t('插件键')} value={plugin?.key} mono />
          <DetailRow label={t('版本')} value={plugin?.version} mono />
          <DetailRow label={t('插件作者')} value={plugin?.author?.name} />
        </DetailSection>
      ) : null}

      {root ? (
        <DetailSection title={t('Root诊断')}>
          <DetailRow
            label={t('API版本')}
            value={
              runtime?.apiVersion === null
                ? ''
                : String(runtime?.apiVersion ?? '')
            }
            mono
          />
          <DetailRow
            label={t('插件运行代次')}
            value={
              runtime?.generation === null
                ? ''
                : String(runtime?.generation ?? '')
            }
            mono
          />
          <DetailRow label={t('上游任务ID')} value={root.upstreamTaskId} mono />
          <DetailRow label={t('节点名称')} value={root.nodeName} mono />
        </DetailSection>
      ) : null}
    </Modal>
  );
};

export default TaskDetailModal;
