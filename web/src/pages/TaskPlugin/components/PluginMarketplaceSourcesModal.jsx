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
import { Button, Input, Modal, Tooltip, Typography } from '@douyinfe/semi-ui';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { validateMarketplaceSources } from './pluginViewModel';

function sourceFieldError(t, field, issue) {
  if (!issue) return '';
  if (issue === 'required') {
    return field === 'name' ? t('请输入市场源名称') : t('请输入市场源地址');
  }
  if (issue === 'duplicate') {
    return field === 'name' ? t('市场源名称必须唯一') : t('市场源地址必须唯一');
  }
  return t('请输入有效的 HTTP(S) index.json 地址');
}

export default function PluginMarketplaceSourcesModal({
  visible,
  sources,
  loading,
  onCancel,
  onSave,
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState([]);

  useEffect(() => {
    if (visible) setDraft((sources ?? []).map((source) => ({ ...source })));
  }, [sources, visible]);

  const updateRow = (index, field, value) => {
    setDraft((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [field]: value } : row,
      ),
    );
  };
  const validation = validateMarketplaceSources(draft);

  return (
    <Modal
      title={t('市场源管理')}
      visible={visible}
      onCancel={onCancel}
      width={680}
      okText={t('保存')}
      cancelText={t('取消')}
      confirmLoading={loading}
      okButtonProps={{ disabled: loading || !validation.valid }}
      onOk={() => {
        if (validation.valid) onSave?.(validation.sources);
      }}
    >
      <Typography.Paragraph type='tertiary'>
        {t('每个市场源提供一个 index.json；市场页会分别加载每个已配置来源。')}
      </Typography.Paragraph>
      <div className='task-plugin-source-editor'>
        {draft.map((row, index) => {
          const errors = validation.errors[index];
          return (
            <div
              className='task-plugin-source-row'
              key={`${row.index_url}-${index}`}
            >
              <div className='task-plugin-source-row-heading'>
                <Typography.Text strong>
                  {t('市场源 {{index}}', { index: index + 1 })}
                </Typography.Text>
                <Tooltip content={t('移除')}>
                  <Button
                    aria-label={t('移除')}
                    icon={<Trash2 size={16} />}
                    theme='borderless'
                    type='danger'
                    size='small'
                    onClick={() =>
                      setDraft((current) =>
                        current.filter((_, rowIndex) => rowIndex !== index),
                      )
                    }
                  />
                </Tooltip>
              </div>
              <div className='task-plugin-source-field'>
                <Input
                  value={row.name}
                  placeholder={t('市场源名称')}
                  validateStatus={errors?.name ? 'error' : 'default'}
                  onChange={(value) => updateRow(index, 'name', value)}
                />
                {errors?.name ? (
                  <Typography.Text
                    type='danger'
                    size='small'
                    className='task-plugin-source-field-error'
                  >
                    {sourceFieldError(t, 'name', errors.name)}
                  </Typography.Text>
                ) : null}
              </div>
              <div className='task-plugin-source-field'>
                <Input
                  value={row.index_url}
                  placeholder='https://example.com/index.json'
                  validateStatus={errors?.index_url ? 'error' : 'default'}
                  onChange={(value) => updateRow(index, 'index_url', value)}
                />
                {errors?.index_url ? (
                  <Typography.Text
                    type='danger'
                    size='small'
                    className='task-plugin-source-field-error'
                  >
                    {sourceFieldError(t, 'index_url', errors.index_url)}
                  </Typography.Text>
                ) : null}
              </div>
            </div>
          );
        })}
        <Button
          icon={<Plus size={15} />}
          onClick={() =>
            setDraft((current) => [...current, { name: '', index_url: '' }])
          }
        >
          {t('添加市场源')}
        </Button>
      </div>
    </Modal>
  );
}
