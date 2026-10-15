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

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  Card,
  Divider,
  Empty,
  Form,
  Input,
  Modal,
  Switch,
  Tag,
  Toast,
} from '@douyinfe/semi-ui';
import { Check, Copy, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { API } from '../../helpers';
import {
  buildApiEndpoint,
  getServerAddress,
  normalizeServerAddress,
} from '../../helpers/token';

const emptyConfig = { hosts: '', base_url: '', resolved_base_url: '' };

const AddressRow = ({ label, url, copyKey, copiedKey, onCopy, copyLabel }) => (
  <div className='flex min-w-0 items-center gap-2 rounded-lg bg-semi-color-fill-0 px-3 py-2'>
    <Tag color='blue' className='shrink-0'>
      {label}
    </Tag>
    <span
      className='min-w-0 flex-1 truncate font-mono text-sm'
      title={url || ''}
    >
      {url || '-'}
    </span>
    <Button
      theme='borderless'
      size='small'
      disabled={!url}
      aria-label={copyLabel}
      icon={
        copiedKey === copyKey ? (
          <Check size={14} className='text-green-500' />
        ) : (
          <Copy size={14} />
        )
      }
      onClick={() => onCopy(copyKey, url)}
    />
  </div>
);

const EditableDescription = ({ value, onSave, placeholder }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');

  useEffect(() => {
    setDraft(value || '');
  }, [value]);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next !== (value || '')) onSave(next);
  };

  if (editing) {
    return (
      <Input
        size='small'
        autofocus
        value={draft}
        placeholder={placeholder}
        className='max-w-[420px]'
        onChange={setDraft}
        onBlur={commit}
        onEnterPress={commit}
      />
    );
  }

  return (
    <button
      type='button'
      className='flex w-fit max-w-full items-center gap-1 text-left text-xs text-semi-color-text-2 hover:text-semi-color-primary'
      onClick={() => setEditing(true)}
    >
      <span className='truncate'>{value || placeholder}</span>
      <Pencil size={12} className='shrink-0' />
    </button>
  );
};

const DomainManagementPanel = () => {
  const { t } = useTranslation();
  const [config, setConfig] = useState(emptyConfig);
  const [endpoints, setEndpoints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [copiedKey, setCopiedKey] = useState('');
  const copyTimer = useRef(null);

  useEffect(() => () => clearTimeout(copyTimer.current), []);

  const copy = async (key, value) => {
    if (!value) return;
    try {
      await navigator.clipboard?.writeText(value);
    } catch {
      // Clipboard access can be denied; still surface copy intent feedback.
    }
    setCopiedKey(key);
    Toast.success(t('已复制'));
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopiedKey(''), 1500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await API.get('/api/admin/security/direct-api-config');
      if (!response.data?.success)
        throw new Error(response.data?.message || t('加载失败'));
      const data = response.data.data || {};
      setConfig({
        hosts: data.hosts || '',
        base_url: data.base_url || '',
        resolved_base_url: data.resolved_base_url || '',
      });
      setEndpoints(data.endpoints || []);
    } catch (error) {
      Toast.error(
        error?.response?.data?.message || error.message || t('加载失败'),
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const gatewayAddress = normalizeServerAddress(
    config.resolved_base_url || getServerAddress(),
  );
  const openAIEndpoint = buildApiEndpoint(gatewayAddress, '/v1');
  const enabledEndpoints = endpoints.filter(
    (item) => item.enabled && item.endpoint,
  );

  const saveConfig = async (values) => {
    try {
      const response = await API.patch(
        '/api/admin/security/direct-api-config',
        values,
      );
      if (!response.data?.success)
        throw new Error(response.data?.message || t('保存失败'));
      Toast.success(t('域名配置已保存'));
      await load();
    } catch (error) {
      Toast.error(
        error?.response?.data?.message || error.message || t('保存失败'),
      );
    }
  };

  const saveEndpoint = async (values) => {
    try {
      const payload = {
        ...values,
        enabled: values.enabled !== false,
        sort_order: Number(values.sort_order || 0),
      };
      const response = editing
        ? await API.patch(
            `/api/admin/security/direct-api-endpoints/${editing.id}`,
            payload,
          )
        : await API.post('/api/admin/security/direct-api-endpoints', payload);
      if (!response.data?.success)
        throw new Error(response.data?.message || t('保存失败'));
      setModalVisible(false);
      setEditing(null);
      await load();
      Toast.success(t('端点已保存'));
    } catch (error) {
      Toast.error(
        error?.response?.data?.message || error.message || t('保存失败'),
      );
    }
  };

  const patchEndpoint = async (record, payload) => {
    try {
      const response = await API.patch(
        `/api/admin/security/direct-api-endpoints/${record.id}`,
        payload,
      );
      if (!response.data?.success)
        throw new Error(response.data?.message || t('保存失败'));
      await load();
    } catch (error) {
      Toast.error(
        error?.response?.data?.message || error.message || t('状态更新失败'),
      );
    }
  };

  const removeEndpoint = (record) =>
    Modal.confirm({
      title: t('确认删除'),
      content: `${t('确定删除')} ${record.name}？`,
      onOk: async () => {
        try {
          await API.delete(
            `/api/admin/security/direct-api-endpoints/${record.id}`,
          );
          await load();
        } catch (error) {
          Toast.error(error?.response?.data?.message || t('删除失败'));
        }
      },
    });

  return (
    <div className='flex flex-col gap-5'>
      <div className='flex justify-end'>
        <Button
          theme='light'
          icon={<RefreshCw size={15} />}
          loading={loading}
          onClick={load}
        >
          {t('刷新')}
        </Button>
      </div>

      <Card
        className='!rounded-2xl border-0 shadow-sm'
        title={t('直连域名配置')}
      >
        <div className='flex flex-col gap-2'>
          <AddressRow
            label={t('网关地址')}
            url={gatewayAddress}
            copyKey='gateway'
            copiedKey={copiedKey}
            onCopy={copy}
            copyLabel={t('复制地址')}
          />
          <AddressRow
            label={t('OpenAI兼容地址')}
            url={openAIEndpoint}
            copyKey='openai'
            copiedKey={copiedKey}
            onCopy={copy}
            copyLabel={t('复制地址')}
          />
          {enabledEndpoints.map((item) => (
            <AddressRow
              key={item.id || item.endpoint}
              label={item.name || t('自定义端点')}
              url={item.endpoint}
              copyKey={`endpoint-${item.id || item.endpoint}`}
              copiedKey={copiedKey}
              onCopy={copy}
              copyLabel={t('复制地址')}
            />
          ))}
        </div>
        <Divider margin='16px' />
        <Form
          initValues={{ hosts: config.hosts, base_url: config.base_url }}
          key={`${config.hosts}|${config.base_url}`}
          onSubmit={saveConfig}
          layout='vertical'
        >
          <div className='grid gap-4 md:grid-cols-2'>
            <Form.Input
              field='hosts'
              label={t('直连域名')}
              placeholder={t('直连域名示例')}
            />
            <Form.Input
              field='base_url'
              label={t('API 地址')}
              placeholder='https://api.example.com'
            />
          </div>
          <div className='flex justify-end'>
            <Button type='primary' htmlType='submit'>
              {t('保存配置')}
            </Button>
          </div>
        </Form>
      </Card>

      <Card
        className='!rounded-2xl border-0 shadow-sm'
        title={
          <div className='flex items-center justify-between gap-3'>
            <span>{t('OpenAI 兼容端点')}</span>
            <Button
              type='primary'
              size='small'
              icon={<Plus size={14} />}
              onClick={() => {
                setEditing(null);
                setModalVisible(true);
              }}
            >
              {t('新增端点')}
            </Button>
          </div>
        }
      >
        {endpoints.length === 0 ? (
          <Empty
            title={t('暂无自定义端点')}
            description={t('新增端点后即可在此管理启停与排序')}
            style={{ padding: '24px 0' }}
          >
            <Button
              type='primary'
              icon={<Plus size={14} />}
              onClick={() => {
                setEditing(null);
                setModalVisible(true);
              }}
            >
              {t('新增端点')}
            </Button>
          </Empty>
        ) : (
          <div className='flex w-full flex-col gap-2'>
            {endpoints.map((record) => (
              <div
                key={record.id}
                className='flex w-full flex-col gap-2 rounded-xl border border-solid border-semi-color-border px-3 py-2.5 sm:flex-row sm:items-center'
              >
                <div className='flex min-w-0 flex-1 flex-col gap-1.5'>
                  <div className='flex min-w-0 items-center gap-2'>
                    <span className='shrink-0 truncate font-medium'>
                      {record.name}
                    </span>
                    <span
                      className='min-w-0 flex-1 truncate font-mono text-xs text-semi-color-text-2'
                      title={record.endpoint}
                    >
                      {record.endpoint}
                    </span>
                    <Button
                      theme='borderless'
                      size='small'
                      disabled={!record.endpoint}
                      aria-label={t('复制地址')}
                      icon={
                        copiedKey === `endpoint-${record.id}` ? (
                          <Check size={14} className='text-green-500' />
                        ) : (
                          <Copy size={14} />
                        )
                      }
                      onClick={() =>
                        copy(`endpoint-${record.id}`, record.endpoint)
                      }
                    />
                  </div>
                  <EditableDescription
                    value={record.description}
                    placeholder={t('展示给用户的说明，可编辑')}
                    onSave={(description) =>
                      patchEndpoint(record, { description })
                    }
                  />
                </div>
                <div className='flex shrink-0 items-center gap-3'>
                  <span className='text-xs text-semi-color-text-2'>
                    {t('排序')} {record.sort_order ?? 0}
                  </span>
                  <Switch
                    checked={record.enabled}
                    onChange={(checked) =>
                      patchEndpoint(record, { enabled: checked })
                    }
                  />
                  <Button
                    theme='borderless'
                    icon={<Pencil size={14} />}
                    onClick={() => {
                      setEditing(record);
                      setModalVisible(true);
                    }}
                  >
                    {t('编辑')}
                  </Button>
                  <Button
                    type='danger'
                    theme='borderless'
                    icon={<Trash2 size={14} />}
                    onClick={() => removeEndpoint(record)}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal
        title={editing ? t('编辑端点') : t('新增端点')}
        visible={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          setEditing(null);
        }}
        footer={null}
      >
        <Form
          key={editing?.id || 'new'}
          initValues={editing || { enabled: true, sort_order: 0 }}
          onSubmit={saveEndpoint}
          layout='vertical'
        >
          <Form.Input
            field='name'
            label={t('名称')}
            rules={[{ required: true, message: t('请输入名称') }]}
          />
          <Form.Input
            field='endpoint'
            label={t('Endpoint URL')}
            placeholder='https://api.example.com/v1'
            rules={[{ required: true, message: t('请输入 Endpoint URL') }]}
          />
          <Form.Input
            field='description'
            label={t('描述')}
            placeholder={t('展示给用户的说明，可编辑')}
          />
          <Form.Input field='sort_order' label={t('排序')} />
          <Form.Switch field='enabled' label={t('启用')} />
          <div className='flex justify-end gap-2'>
            <Button onClick={() => setModalVisible(false)}>{t('取消')}</Button>
            <Button htmlType='submit' type='primary'>
              {t('保存')}
            </Button>
          </div>
        </Form>
      </Modal>
    </div>
  );
};

export default DomainManagementPanel;
