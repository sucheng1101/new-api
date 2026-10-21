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

import React, { useEffect, useMemo, useState } from 'react';
import { Empty, Spin } from '@douyinfe/semi-ui';
import PropTypes from 'prop-types';
import { API } from '../../../helpers';
import { getServerAddress } from '../../../helpers/token';
import { handleSpeedTest } from '../../../helpers/dashboard';
import EndpointPill from '../../security/EndpointPill';

const normalizeRecordUrl = (record) => {
  const value = String(record?.endpoint || '').trim();
  if (!value) return '';
  if (record?.kind === 'host' && !/^[a-z][a-z\d+.-]*:\/\//i.test(value)) {
    return `https://${value}`;
  }
  return value;
};

const TokenEndpointBar = ({ copyText, t }) => {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const serverAddress = useMemo(() => getServerAddress(), []);

  useEffect(() => {
    let mounted = true;
    API.get('/api/user/direct-ip-whitelist')
      .then((response) => {
        if (mounted && response.data?.success) {
          const data = response.data.data || {};
          setRecords(Array.isArray(data.records) ? data.records : []);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const visibleRecords = records
    .filter((record) => record?.enabled !== false && normalizeRecordUrl(record))
    .map((record) => ({
      ...record,
      // The configured base URL can describe an older deployment entry point.
      // User-facing API connection strings must follow the page currently
      // served in this browser.
      displayUrl:
        record.kind === 'base_url' && serverAddress
          ? serverAddress
          : normalizeRecordUrl(record),
    }));
  const hasBaseURL = visibleRecords.some(
    (record) => record.kind === 'base_url',
  );
  const displayRecords =
    serverAddress && !hasBaseURL
      ? [
          {
            id: 'runtime-origin',
            kind: 'base_url',
            name: t('当前访问入口'),
            description: t('当前浏览器访问地址'),
            displayUrl: serverAddress,
            enabled: true,
          },
          ...visibleRecords,
        ]
      : visibleRecords;

  return (
    <div className='flex w-full flex-col gap-2 rounded-xl border border-solid p-3'>
      <div className='flex items-center justify-between gap-2'>
        <div className='shrink-0 text-sm font-medium'>{t('API地址')}</div>
        {loading && <Spin size='small' />}
      </div>
      <div className='grid min-w-0 grid-cols-1 gap-2 xl:grid-cols-2'>
        {displayRecords.map((record) => (
          <EndpointPill
            key={record.id || record.displayUrl}
            label={record.name || t('API端点')}
            kind={record.kind}
            url={record.displayUrl}
            description={record.description || t('点击可复制此端点')}
            enabled={record.enabled !== false}
            onCopy={copyText}
            onTest={handleSpeedTest}
            copyLabel={t('复制地址')}
            testLabel={t('快速测试')}
          />
        ))}
        {!loading && !displayRecords.length && (
          <Empty title={t('暂无可用 API 地址')} className='col-span-full' />
        )}
      </div>
    </div>
  );
};

TokenEndpointBar.propTypes = {
  copyText: PropTypes.func.isRequired,
  t: PropTypes.func.isRequired,
};

export default TokenEndpointBar;
