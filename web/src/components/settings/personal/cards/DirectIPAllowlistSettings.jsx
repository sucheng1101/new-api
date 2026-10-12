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
import { Button, Card, Input, Typography } from '@douyinfe/semi-ui';
import { IconDelete, IconRefresh } from '@douyinfe/semi-icons';
import { API, showError, showSuccess } from '../../../../helpers';

const DirectIPAllowlistSettings = ({ t }) => {
  const [items, setItems] = useState([]);
  const [maxItems, setMaxItems] = useState(5);
  const [currentIP, setCurrentIP] = useState({ ipv4: '', ipv6: '' });
  const [baseURL, setBaseURL] = useState('');
  const [ip, setIP] = useState('');
  const [remark, setRemark] = useState('');
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [listRes, ipRes] = await Promise.all([
        API.get('/api/user/direct-ip-whitelist'),
        API.get('/api/user/direct-ip-whitelist/current-ip'),
      ]);
      if (!listRes.data.success) throw new Error(listRes.data.message);
      setItems(listRes.data.data?.items || []);
      setMaxItems(listRes.data.data?.max || 5);
      setBaseURL(listRes.data.data?.base_url || '');
      if (ipRes.data.success) setCurrentIP(ipRes.data.data || {});
    } catch (error) {
      showError(error.message || t('直连白名单加载失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const add = async (value = ip) => {
    const normalized = String(value || '').trim();
    if (!normalized) {
      showError(t('请输入 IPv4 地址'));
      return;
    }
    try {
      const res = await API.post('/api/user/direct-ip-whitelist', {
        ip: normalized,
        remark: remark.trim(),
      });
      if (!res.data.success) throw new Error(res.data.message);
      showSuccess(t('IPv4 白名单已添加'));
      setIP('');
      setRemark('');
      await load();
    } catch (error) {
      showError(error.message || t('添加失败'));
    }
  };

  const remove = async (id) => {
    try {
      const res = await API.delete(`/api/user/direct-ip-whitelist/${id}`);
      if (!res.data.success) throw new Error(res.data.message);
      showSuccess(t('已删除'));
      await load();
    } catch (error) {
      showError(error.message || t('删除失败'));
    }
  };

  return (
    <Card className='mt-4 md:mt-6' title={t('直连白名单')}>
      <Typography.Text type='secondary' className='block mb-4'>
        {t('将发起 API 请求的机器公网 IPv4 加入白名单后，即可使用直连入口。')}
        {baseURL ? ` ${t('直连入口')}: ${baseURL}` : ''}
      </Typography.Text>

      <div className='rounded-lg border border-gray-200 p-4 mb-4'>
        <div className='flex flex-wrap items-center gap-3 mb-4'>
          <Typography.Text strong>{t('当前浏览器 IPv4')}:</Typography.Text>
          <Typography.Text code>{currentIP.ipv4 || t('未检测到')}</Typography.Text>
          <Button
            theme='solid'
            type='primary'
            disabled={!currentIP.ipv4 || items.length >= maxItems}
            onClick={() => add(currentIP.ipv4)}
          >
            {t('添加此 IPv4')}
          </Button>
          <Button icon={<IconRefresh />} loading={loading} onClick={load}>
            {t('刷新')}
          </Button>
        </div>
        {currentIP.ipv6 && (
          <Typography.Text type='warning' className='block mb-3'>
            {t('直连入口暂不支持 IPv6，无需添加。')}
          </Typography.Text>
        )}
        <div className='flex flex-col md:flex-row gap-3'>
          <Input
            className='flex-1'
            value={ip}
            onChange={setIP}
            placeholder={t('IPv4 地址，例如 1.2.3.4')}
            onEnterPress={() => add()}
          />
          <Input
            className='flex-1'
            value={remark}
            onChange={setRemark}
            placeholder={t('备注（可选）')}
            onEnterPress={() => add()}
          />
          <Button disabled={items.length >= maxItems} onClick={() => add()}>
            {t('添加')}
          </Button>
        </div>
      </div>

      <div className='rounded-lg border border-gray-200 p-4'>
        <div className='flex items-center justify-between mb-3'>
          <Typography.Title heading={5} style={{ margin: 0 }}>
            {t('我的白名单')} ({items.length} / {maxItems})
          </Typography.Title>
        </div>
        <div className='overflow-x-auto'>
          <table className='w-full text-left text-sm'>
            <thead>
              <tr className='border-b border-gray-200 text-gray-500'>
                <th className='py-2'>{t('IP')}</th>
                <th className='py-2'>{t('备注')}</th>
                <th className='py-2'>{t('添加时间')}</th>
                <th className='py-2'>{t('最近访问')}</th>
                <th className='py-2 text-right'>{t('操作')}</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={5} className='py-4 text-gray-500'>
                    {t('还没有添加 IP')}
                  </td>
                </tr>
              ) : (
                items.map((entry) => (
                  <tr key={entry.id} className='border-b border-gray-100'>
                    <td className='py-2 font-mono'>{entry.ip}</td>
                    <td className='py-2'>{entry.remark || '-'}</td>
                    <td className='py-2'>{formatTimestamp(entry.created_at)}</td>
                    <td className='py-2'>
                      {entry.last_access_at ? formatTimestamp(entry.last_access_at) : t('尚未访问')}
                    </td>
                    <td className='py-2 text-right'>
                      <Button
                        type='danger'
                        theme='borderless'
                        icon={<IconDelete />}
                        onClick={() => remove(entry.id)}
                      >
                        {t('删除')}
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className='rounded-lg border border-gray-200 p-4 mt-4 text-sm text-gray-600'>
        <Typography.Title heading={5}>{t('使用说明')}</Typography.Title>
        <ul className='list-disc pl-5 space-y-1'>
          <li>{t('Base URL 改为直连入口，API Key 不变。')}</li>
          <li>{t('添加后约 2 秒生效；删除立即失效。每个账号最多 5 个 IP。')}</li>
          <li>{t('直连入口目前只支持 IPv4；IPv6 地址不会生效。')}</li>
          <li>{t('连续 180 天没有通过直连访问的 IP 会被自动移除。')}</li>
          <li>{t('宽带重新拨号后公网 IP 可能变化，请重新添加新的 IPv4。')}</li>
        </ul>
      </div>
    </Card>
  );
};

const formatTimestamp = (value) => {
  if (!value) return '-';
  const date = new Date(Number(value) * 1000);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString();
};

export default DirectIPAllowlistSettings;
