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
import React, { useEffect, useState } from 'react';
import {
  Banner,
  Button,
  Descriptions,
  Modal,
  Typography,
} from '@douyinfe/semi-ui';
import { TriangleAlert, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { API, showError, showSuccess } from '../../../helpers';
import { getTaskPluginUsageBlocker } from './pluginViewModel';

export default function PluginDeleteVersionModal({
  record,
  visible,
  onCancel,
  onDeleted,
}) {
  const { t } = useTranslation();
  const [deleting, setDeleting] = useState(false);
  const [blocker, setBlocker] = useState(null);
  const key = record?.meta?.key ?? '';
  const version = record?.meta?.version ?? '';
  const hasFactoryFallback = Boolean(record?.factory_meta);

  useEffect(() => {
    if (visible) setBlocker(null);
  }, [key, version, visible]);

  const removeVersion = async (force = false) => {
    if (!key || !version) return;
    setDeleting(true);
    try {
      const suffix = force ? '?force=true' : '';
      const response = await API.delete(
        `/api/plugin/task/${encodeURIComponent(key)}/versions/${encodeURIComponent(version)}${suffix}`,
        { skipErrorHandler: true },
      );
      if (!response?.data?.success) {
        setBlocker(getTaskPluginUsageBlocker(response?.data));
        return;
      }
      showSuccess(t('已删除版本'));
      await Promise.resolve(onDeleted?.(record));
    } catch (error) {
      setBlocker({
        message: String(error),
        channels: [],
        inFlightCount: 0,
      });
    } finally {
      setDeleting(false);
    }
  };

  const usageDetails = blocker ? (
    <div className='task-plugin-delete-blocker'>
      <Banner
        type='warning'
        closeIcon={null}
        icon={<TriangleAlert size={16} />}
        description={blocker.message || t('当前插件版本仍在使用中')}
      />
      {(blocker.channels.length > 0 || blocker.inFlightCount > 0) && (
        <Descriptions
          size='small'
          row
          data={[
            {
              key: t('绑定渠道'),
              value: blocker.channels.length
                ? blocker.channels
                    .map((channel) =>
                      channel.id === null
                        ? channel.name
                        : `#${channel.id} ${channel.name}`,
                    )
                    .join(', ')
                : '-',
            },
            { key: t('进行中任务'), value: blocker.inFlightCount },
          ]}
        />
      )}
    </div>
  ) : null;

  return (
    <Modal
      title={blocker ? t('插件仍在使用') : t('删除当前版本？')}
      visible={visible}
      onCancel={() => !deleting && onCancel?.()}
      width={560}
      footer={
        <div className='task-plugin-delete-actions'>
          <Button disabled={deleting} onClick={onCancel}>
            {blocker ? t('关闭') : t('取消')}
          </Button>
          {blocker ? (
            <Button
              theme='solid'
              type='danger'
              icon={<Trash2 size={16} />}
              loading={deleting}
              onClick={() => void removeVersion(true)}
            >
              {t('强制删除')}
            </Button>
          ) : (
            <Button
              theme='solid'
              type='danger'
              icon={<Trash2 size={16} />}
              loading={deleting}
              onClick={() => void removeVersion()}
            >
              {t('删除当前版本')}
            </Button>
          )}
        </div>
      }
    >
      <div className='task-plugin-delete-content'>
        {!blocker ? (
          <Typography.Paragraph type='tertiary'>
            {hasFactoryFallback
              ? t(
                  '删除此自定义版本后，系统会恢复同名出厂插件；渠道的插件绑定不会被修改。',
                )
              : t('此插件没有出厂回退版本，删除后该平台将不可用。')}
          </Typography.Paragraph>
        ) : null}
        <Descriptions
          size='small'
          row
          data={[
            { key: t('插件标识'), value: key || '-' },
            { key: t('版本'), value: version || '-' },
          ]}
        />
        {usageDetails}
      </div>
    </Modal>
  );
}
