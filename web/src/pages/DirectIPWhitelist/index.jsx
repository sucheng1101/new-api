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
  Button,
  Card,
  Input,
  Table,
  Tag,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import { Copy, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { API } from '../../helpers';

const formatTime = (value) => {
  if (!value) return '-';
  const date = new Date(Number(value) * 1000);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString();
};

export default function DirectIPWhitelist() {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [currentIP, setCurrentIP] = useState({});
  const [ip, setIP] = useState('');
  const [remark, setRemark] = useState('');
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [list, current] = await Promise.all([
        API.get('/api/user/direct-ip-whitelist'),
        API.get('/api/user/direct-ip-whitelist/current-ip'),
      ]);
      if (!list.data?.success)
        throw new Error(list.data?.message || '加载失败');
      setItems(list.data.data?.items || []);
      setCurrentIP(current.data?.data || {});
    } catch (error) {
      Toast.error(error?.response?.data?.message || error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const copy = async (value) => {
    if (!value) return;
    await navigator.clipboard?.writeText(value);
    Toast.success(t('已复制'));
  };

  const add = async () => {
    try {
      const response = await API.post('/api/user/direct-ip-whitelist', {
        ip: ip.trim(),
        remark: remark.trim(),
      });
      if (!response.data?.success)
        throw new Error(response.data?.message || '添加失败');
      setIP('');
      setRemark('');
      Toast.success(t('添加成功'));
      await load();
    } catch (error) {
      Toast.error(error?.response?.data?.message || error.message);
    }
  };

  const remove = async (id) => {
    try {
      await API.delete(`/api/user/direct-ip-whitelist/${id}`);
      Toast.success(t('已删除'));
      await load();
    } catch (error) {
      Toast.error(error?.response?.data?.message || error.message);
    }
  };

  return (
    <div className='mx-auto w-full max-w-[1200px] px-3 pb-8 sm:px-6'>
      <div className='mb-5 flex items-center justify-between'>
        <div className='flex items-center gap-2'>
          <ShieldCheck className='text-blue-600' size={22} />
          <Typography.Title heading={3} style={{ margin: 0 }}>
            {t('直连白名单')}
          </Typography.Title>
        </div>
        <Button icon={<RefreshCw size={15} />} loading={loading} onClick={load}>
          {t('刷新')}
        </Button>
      </div>

      <Card
        className='!rounded-2xl border-0 shadow-sm'
        title={t('直连访问说明')}
      >
        <Typography.Text type='secondary'>
          {t('只有域名管理中开启直连校验的域名会检查本页 IPv4 白名单。')}
        </Typography.Text>
        <div className='mt-4 flex flex-wrap items-center gap-3'>
          <Tag color='blue'>
            {t('当前 IPv4')}: {currentIP.ipv4 || '-'}
          </Tag>
          <Button
            type='primary'
            disabled={!currentIP.ipv4 || items.length >= 5}
            onClick={() => setIP(currentIP.ipv4)}
          >
            {t('填入当前 IPv4')}
          </Button>
        </div>
      </Card>

      <Card
        className='mt-5 !rounded-2xl border-0 shadow-sm'
        title={`${t('我的白名单')} (${items.length}/5)`}
      >
        <div className='mb-4 flex flex-col gap-3 md:flex-row'>
          <Input
            className='flex-1'
            value={ip}
            onChange={setIP}
            placeholder='IPv4'
          />
          <Input
            className='flex-1'
            value={remark}
            onChange={setRemark}
            placeholder={t('备注')}
          />
          <Button
            type='primary'
            disabled={!ip.trim() || items.length >= 5}
            onClick={add}
          >
            {t('添加')}
          </Button>
        </div>
        <Table
          size='small'
          loading={loading}
          dataSource={items}
          rowKey='id'
          pagination={false}
          columns={[
            {
              title: 'IP',
              dataIndex: 'ip',
              render: (value) => (
                <Button
                  theme='borderless'
                  className='!px-0 font-mono'
                  onClick={() => copy(value)}
                >
                  {value} <Copy size={13} />
                </Button>
              ),
            },
            {
              title: t('备注'),
              dataIndex: 'remark',
              render: (value) => value || '-',
            },
            {
              title: t('状态'),
              dataIndex: 'enabled',
              render: (value) => (
                <Tag color={value ? 'green' : 'grey'}>
                  {value ? t('启用') : t('停用')}
                </Tag>
              ),
            },
            {
              title: t('最近访问'),
              dataIndex: 'last_access_at',
              render: formatTime,
            },
            {
              title: t('操作'),
              render: (_, record) => (
                <Button
                  type='danger'
                  theme='borderless'
                  icon={<Trash2 size={15} />}
                  onClick={() => remove(record.id)}
                />
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
