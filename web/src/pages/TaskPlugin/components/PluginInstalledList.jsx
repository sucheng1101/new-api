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
import { Button, Card, Empty, Switch, Tag, Tooltip, Typography } from '@douyinfe/semi-ui';
import { Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import CardTable from '../../../components/common/ui/CardTable';
import { copy, showSuccess } from '../../../helpers';
import PluginActionsMenu from './PluginActionsMenu';
import PluginIcon from './PluginIcon';
import { getPluginOwnershipPresentation } from './pluginViewModel';

const MAX_VISIBLE_MODELS = 3;

function localizedText(value) {
  if (typeof value === 'string') return value;
  return value?.zh ?? value?.en ?? '';
}

function ModelTags({ models = [] }) {
  const { t } = useTranslation();
  const visible = models.slice(0, MAX_VISIBLE_MODELS);
  const hidden = models.slice(MAX_VISIBLE_MODELS);
  if (!models.length) return <Typography.Text type='tertiary'>-</Typography.Text>;

  return (
    <div className='task-plugin-models'>
      {visible.map((model) => (
        <Tag key={model} className='task-plugin-model-tag'>
          {model}
        </Tag>
      ))}
      {hidden.length > 0 ? (
        <Tooltip content={hidden.join(', ')}>
          <Tag color='grey'>+{hidden.length}</Tag>
        </Tooltip>
      ) : null}
      <Typography.Text type='tertiary' size='small' className='sr-only'>
        {t('支持模型')}
      </Typography.Text>
    </div>
  );
}

function SourceTag({ record }) {
  const { t } = useTranslation();
  const presentation = getPluginOwnershipPresentation(record);
  return <Tag color={presentation.color}>{t(presentation.label)}</Tag>;
}

function RuntimeTag({ record }) {
  const { t } = useTranslation();
  const statusMap = {
    registered: { color: 'green', label: t('已注册') },
    compile_failed: { color: 'red', label: t('编译失败') },
    disabled: { color: 'grey', label: t('已停用') },
    disabled_fallback: { color: 'orange', label: t('已停用，使用内置') },
    not_registered: { color: 'grey', label: t('未注册') },
  };
  const status = statusMap[record?.runtime_status] ?? {
    color: 'grey',
    label: record?.runtime_status || t('未知'),
  };
  return (
    <Tooltip content={record?.runtime_error || status.label}>
      <Tag color={status.color}>{status.label}</Tag>
    </Tooltip>
  );
}

function PluginIdentity({ record }) {
  const { t } = useTranslation();
  const key = record?.meta?.key || '';
  return (
    <div className='task-plugin-identity'>
      <PluginIcon record={record} size={34} className='task-plugin-avatar' />
      <div className='task-plugin-identity-copy'>
        <Typography.Text
          strong
          className='task-plugin-identity-name'
          ellipsis={{ showTooltip: true }}
        >
          {record?.meta?.name || key || '-'}
        </Typography.Text>
        <div className='task-plugin-key-row'>
          <Typography.Text
            type='tertiary'
            size='small'
            code
            ellipsis={{ showTooltip: true }}
          >
            {key || '-'}
          </Typography.Text>
          {key ? (
            <Tooltip content={t('复制插件标识')}>
              <Button
                aria-label={t('复制插件标识')}
                icon={<Copy size={13} />}
                size='small'
                theme='borderless'
                type='tertiary'
                onClick={() => {
                  void copy(key);
                  showSuccess(t('已复制'));
                }}
              />
            </Tooltip>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function PluginInstalledList({
  records,
  loading,
  visibleColumns,
  view,
  onViewDetail,
  onUploadVersion,
  onDeleteVersion,
  onToggleEnabled,
}) {
  const { t } = useTranslation();
  const safeRecords = Array.isArray(records) ? records : [];

  const columns = useMemo(
    () => [
      {
        title: t('插件'),
        key: 'plugin',
        width: 252,
        render: (_, record) => <PluginIdentity record={record} />,
      },
      {
        title: t('模型'),
        key: 'models',
        width: 280,
        render: (_, record) => <ModelTags models={record?.meta?.models ?? []} />,
      },
      {
        title: t('版本'),
        key: 'version',
        width: 112,
        render: (_, record) => (
          <Typography.Text size='small' code>
            v{record?.meta?.version || '-'}
          </Typography.Text>
        ),
      },
      {
        title: t('来源'),
        key: 'source',
        width: 130,
        render: (_, record) => <SourceTag record={record} />,
      },
      {
        title: t('运行状态'),
        key: 'runtime',
        width: 130,
        render: (_, record) => <RuntimeTag record={record} />,
      },
      {
        title: t('启用'),
        key: 'enabled',
        width: 78,
        render: (_, record) => (
          <Switch
            checked={Boolean(record?.enabled)}
            size='small'
            aria-label={t('切换插件 {{key}}', { key: record?.meta?.key || '' })}
            onChange={(enabled) => void onToggleEnabled?.(record, enabled)}
          />
        ),
      },
      {
        title: t('操作'),
        key: 'actions',
        width: 70,
        fixed: 'right',
        align: 'center',
        render: (_, record) => (
          <PluginActionsMenu
            record={record}
            onDetails={onViewDetail}
            onUploadVersion={onUploadVersion}
            onDeleteVersion={onDeleteVersion}
          />
        ),
      },
    ],
    [onDeleteVersion, onToggleEnabled, onUploadVersion, onViewDetail, t],
  );

  const shownColumns = columns.filter(
    (column) => column.key === 'plugin' || column.key === 'actions' || visibleColumns?.[column.key] !== false,
  );

  if (!loading && safeRecords.length === 0) {
    return (
      <div className='task-plugin-empty-state'>
        <Empty title={t('未找到任务插件')} description={t('调整筛选条件或上传一个第三方插件。')} />
      </div>
    );
  }

  if (view === 'cards') {
    return (
      <div className='task-plugin-installed-grid'>
        {safeRecords.map((record) => (
          <Card
            key={`${record?.meta?.key || 'plugin'}@${record?.meta?.version || ''}`}
            className='task-plugin-installed-card'
          >
            <div className='task-plugin-installed-card-header'>
              <PluginIdentity record={record} />
              <PluginActionsMenu
                record={record}
                onDetails={onViewDetail}
                onUploadVersion={onUploadVersion}
                onDeleteVersion={onDeleteVersion}
              />
            </div>
            <div className='task-plugin-card-badges'>
              <SourceTag record={record} />
              <RuntimeTag record={record} />
              <Tag color='grey'>v{record?.meta?.version || '-'}</Tag>
            </div>
            <Typography.Text
              type='tertiary'
              size='small'
              className='task-plugin-card-description'
            >
              {localizedText(record?.meta?.description) || t('未提供插件描述')}
            </Typography.Text>
            <div className='task-plugin-card-models'>
              <Typography.Text type='tertiary' size='small'>
                {t('支持模型')}
              </Typography.Text>
              <ModelTags models={record?.meta?.models ?? []} />
            </div>
            <div className='task-plugin-card-footer'>
              <Typography.Text type='tertiary' size='small'>
                {t('启用')}
              </Typography.Text>
              <Switch
                checked={Boolean(record?.enabled)}
                size='small'
                onChange={(enabled) => void onToggleEnabled?.(record, enabled)}
              />
            </div>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className='task-plugin-table'>
      <CardTable
        columns={shownColumns}
        dataSource={safeRecords}
        loading={loading}
        rowKey={(record) => `${record?.meta?.key || 'plugin'}@${record?.meta?.version || ''}`}
        pagination={false}
        size='middle'
      />
    </div>
  );
}
