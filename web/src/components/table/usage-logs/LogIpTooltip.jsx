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

import React, { useState } from 'react';
import { Tag, Tooltip } from '@douyinfe/semi-ui';
import { API } from '../../../helpers';

const completedLookups = new Map();
const activeLookups = new Map();

function lookupIPGeo(ip) {
  if (completedLookups.has(ip)) {
    return Promise.resolve(completedLookups.get(ip));
  }
  if (activeLookups.has(ip)) {
    return activeLookups.get(ip);
  }

  const request = API.get('/api/log/ip-geo', {
    params: { ip },
    skipErrorHandler: true,
  })
    .then((response) => {
      if (!response.data?.success || !response.data?.data) {
        throw new Error('IP geolocation lookup failed');
      }
      const result = response.data.data;
      if (result.status !== 'error') {
        completedLookups.set(ip, result);
      }
      return result;
    })
    .finally(() => activeLookups.delete(ip));

  activeLookups.set(ip, request);
  return request;
}

function GeoDetail({ label, value }) {
  if (!value) return null;
  return (
    <div className='flex gap-2'>
      <span className='shrink-0 text-gray-500'>{label}</span>
      <span className='break-all'>{value}</span>
    </div>
  );
}

export default function LogIpTooltip({ ip, t, onCopy }) {
  const [geo, setGeo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const loadGeo = (visible) => {
    if (!visible || (geo && geo.status !== 'error') || loading) return;
    setLoading(true);
    setFailed(false);
    setGeo(null);
    lookupIPGeo(ip)
      .then(setGeo)
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  };

  const location = geo
    ? [geo.country, geo.region, geo.city].filter(Boolean).join(' ')
    : '';
  const statusLabel =
    geo?.status === 'local'
      ? t('本机地址')
      : geo?.status === 'private'
        ? t('内网地址')
        : geo?.status === 'invalid'
          ? t('无效 IP')
          : '';

  return (
    <Tooltip
      content={
        <div className='flex min-w-48 flex-col gap-1 text-xs'>
          <div className='mb-1 font-medium'>{t('IP 归属地详情')}</div>
          {loading ? (
            <div>{t('加载中...')}</div>
          ) : failed || geo?.status === 'error' ? (
            <div>{t('暂无归属地')}</div>
          ) : statusLabel ? (
            <div>{statusLabel}</div>
          ) : geo ? (
            <>
              <GeoDetail label={t('归属地')} value={location} />
              <GeoDetail label={t('运营商')} value={geo.isp} />
              <GeoDetail label='ASN' value={geo.asn} />
              <GeoDetail label={t('时区')} value={geo.timezone} />
              {!location && !geo.isp && !geo.asn && !geo.timezone ? (
                <div>{t('暂无归属地')}</div>
              ) : null}
            </>
          ) : (
            <div>{t('暂无归属地')}</div>
          )}
        </div>
      }
      onVisibleChange={loadGeo}
    >
      <span>
        <Tag color='orange' shape='circle' onClick={onCopy}>
          {ip}
        </Tag>
      </span>
    </Tooltip>
  );
}
