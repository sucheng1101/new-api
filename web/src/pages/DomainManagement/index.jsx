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

import React, { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Card,
  Form,
  Modal,
  Switch,
  Table,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import { Copy, Globe2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { API } from '../../helpers';

const emptyConfig = { hosts: '', base_url: '' };

export default function DomainManagement() {
  const { t } = useTranslation();
  const [config, setConfig] = useState(emptyConfig);
  const [endpoints, setEndpoints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [modalVisible, setModalVisible] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await API.get('/api/admin/security/direct-api-config');
      if (!response.data?.success)
        throw new Error(response.data?.message || t('加载失败'));
      const data = response.data.data || {};
      setConfig({ hosts: data.hosts || '', base_url: data.base_url || '' });
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

  const copy = async (value) => {
    if (!value) return;
    await navigator.clipboard?.writeText(value);
    Toast.success(t('已复制'));
  };

  const saveConfig = async (values) => {
    try {
      const response = await API.patch(
        '/api/admin/security/direct-api-config',
        values,
      );
      if (!response.data?.success)
        throw new Error(response.data?.message || t('保存失败'));
      setConfig(values);
      Toast.success(t('域名配置已保存'));
    } catch (error) {
      Toast.error(
        error?.response?.data?.message || error.message || '保存失败',
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
        error?.response?.data?.message || error.message || '保存失败',
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

  const toggleEndpoint = async (record, enabled) => {
    try {
      await API.patch(`/api/admin/security/direct-api-endpoints/${record.id}`, {
        ...record,
        enabled,
      });
      await load();
    } catch (error) {
      Toast.error(error?.response?.data?.message || t('状态更新失败'));
    }
  };

  return (
    <div className='mx-auto w-full max-w-[1500px] px-3 pb-8 sm:px-6'>
      <div className='mb-5 flex items-center justify-between gap-3'>
        <div className='flex items-center gap-2'>
          <span className='flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-300'>
            <Globe2 size={17} />
          </span>
          <Typography.Title heading={3} style={{ margin: 0 }}>
            {t('域名管理')}
          </Typography.Title>
        </div>
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
        <Form
          initValues={config}
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
        className='mt-5 !rounded-2xl border-0 shadow-sm'
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
        <Table
          size='small'
          loading={loading}
          dataSource={endpoints}
          rowKey='id'
          className='w-full'
          scroll={{ x: '100%' }}
          columns={[
            { title: t('名称'), dataIndex: 'name', width: 160 },
            {
              title: t('地址'),
              dataIndex: 'endpoint',
              width: 360,
              render: (value) => (
                <Button
                  theme='borderless'
                  className='!px-0 max-w-full font-mono text-xs'
                  onClick={() => copy(value)}
                >
                  <span className='truncate'>{value}</span>
                  <Copy size={12} className='ml-1 shrink-0' />
                </Button>
              ),
            },
            {
              title: t('描述'),
              dataIndex: 'description',
              render: (value) =>
                value ? (
                  <span title={value} className='line-clamp-2'>
                    {value}
                  </span>
                ) : (
                  '-'
                ),
            },
            {
              title: t('状态'),
              dataIndex: 'enabled',
              width: 90,
              render: (value, record) => (
                <Switch
                  checked={value}
                  onChange={(checked) => toggleEndpoint(record, checked)}
                />
              ),
            },
            { title: t('排序'), dataIndex: 'sort_order', width: 70 },
            {
              title: t('操作'),
              width: 130,
              render: (_, record) => (
                <div className='flex gap-1'>
                  <Button
                    theme='borderless'
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
              ),
            },
          ]}
        />
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
}
