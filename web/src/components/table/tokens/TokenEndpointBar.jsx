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

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Button, Spin, Tooltip } from '@douyinfe/semi-ui';
import { Copy, Eye, EyeOff, RefreshCw, Zap } from 'lucide-react';
import PropTypes from 'prop-types';
import { API } from '../../../helpers';
import { getServerAddress } from '../../../helpers/token';
import { handleSpeedTest } from '../../../helpers/dashboard';

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
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [showAddresses, setShowAddresses] = useState(true);
  const [useCurrentOrigin, setUseCurrentOrigin] = useState(false);
  const [tokenBaseURLVisible, setTokenBaseURLVisible] = useState(true);
  const currentOrigin = useMemo(() => getServerAddress(), []);
  const requestRef = useRef(null);
  const hasLoadedRef = useRef(false);
  const mountedRef = useRef(true);

  const loadRecords = useCallback(() => {
    if (requestRef.current) return requestRef.current;

    const initialLoad = !hasLoadedRef.current;
    setLoadError('');
    if (initialLoad) setLoading(true);
    else setRefreshing(true);

    const request = (async () => {
      try {
        const response = await API.get('/api/user/direct-ip-whitelist');
        if (!response.data?.success) {
          throw new Error(response.data?.message || t('加载域名配置失败'));
        }
        const data = response.data.data || {};
        if (!mountedRef.current) return;
        setRecords(Array.isArray(data.records) ? data.records : []);
        setUseCurrentOrigin(data.token_use_current_origin === true);
        setTokenBaseURLVisible(data.token_base_url_visible !== false);
      } catch (error) {
        if (!mountedRef.current) return;
        setLoadError(
          error?.response?.data?.message ||
            error?.message ||
            t('加载域名配置失败'),
        );
      } finally {
        hasLoadedRef.current = true;
        requestRef.current = null;
        if (mountedRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    })();
    requestRef.current = request;
    return request;
  }, [t]);

  useEffect(() => {
    mountedRef.current = true;
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') loadRecords();
    };

    loadRecords();
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      mountedRef.current = false;
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [loadRecords]);

  const displayRecords = useMemo(() => {
    const visibleRecords = records
      .filter(
        (record) =>
          record?.enabled !== false &&
          record?.show_in_token_management !== false &&
          normalizeRecordUrl(record),
      )
      .map((record) => ({ ...record, displayUrl: normalizeRecordUrl(record) }));
    if (!useCurrentOrigin || !currentOrigin || !tokenBaseURLVisible)
      return visibleRecords;

    const baseURLIndex = visibleRecords.findIndex(
      (record) => record.kind === 'base_url',
    );
    if (baseURLIndex >= 0) {
      visibleRecords[baseURLIndex] = {
        ...visibleRecords[baseURLIndex],
        displayUrl: currentOrigin,
      };
      return visibleRecords;
    }

    return [
      {
        id: 'runtime-origin',
        kind: 'base_url',
        name: t('当前访问入口'),
        description: t('当前浏览器访问地址'),
        displayUrl: currentOrigin,
        enabled: true,
      },
      ...visibleRecords,
    ];
  }, [currentOrigin, records, t, tokenBaseURLVisible, useCurrentOrigin]);

  return (
    <div className='flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1 text-sm'>
      {displayRecords.map((record) => (
        <span
          key={record.id || record.displayUrl}
          className='inline-flex min-w-0 items-center gap-0.5'
        >
          <Tooltip
            content={record.description || t('点击测试此地址')}
            position='top'
          >
            <a
              href={record.displayUrl}
              target='_blank'
              rel='noreferrer'
              className='max-w-[min(42vw,280px)] truncate font-mono text-xs text-semi-color-primary hover:underline sm:text-sm'
              aria-label={record.name || record.displayUrl}
              title={showAddresses ? record.displayUrl : t('令牌地址已隐藏')}
            >
              {showAddresses ? record.displayUrl : '••••••••'}
            </a>
          </Tooltip>
          <Tooltip content={t('复制地址')} position='top'>
            <Button
              theme='borderless'
              size='small'
              icon={<Copy size={13} />}
              aria-label={`${t('复制地址')}: ${record.displayUrl}`}
              onClick={() => copyText(record.displayUrl)}
            />
          </Tooltip>
          <Tooltip content={t('快速测试')} position='top'>
            <Button
              theme='borderless'
              size='small'
              icon={<Zap size={13} />}
              aria-label={`${t('快速测试')}: ${record.displayUrl}`}
              onClick={() => handleSpeedTest(record.displayUrl)}
            />
          </Tooltip>
        </span>
      ))}
      {loading && <Spin size='small' />}
      {!loading && !loadError && displayRecords.length === 0 && (
        <span className='text-xs text-semi-color-text-2'>
          {t('暂无可用 API 地址')}
        </span>
      )}
      {loadError && (
        <span className='text-xs text-semi-color-danger' role='alert'>
          {loadError}
        </span>
      )}
      <Tooltip content={t('刷新域名配置')} position='top'>
        <Button
          theme='borderless'
          size='small'
          loading={refreshing || loading}
          disabled={loading || refreshing}
          icon={<RefreshCw size={14} />}
          aria-label={t('刷新域名配置')}
          onClick={loadRecords}
        />
      </Tooltip>
      {displayRecords.length > 0 && (
        <Tooltip
          content={t(showAddresses ? '隐藏令牌地址' : '显示令牌地址')}
          position='top'
        >
          <Button
            theme='borderless'
            size='small'
            icon={showAddresses ? <Eye size={14} /> : <EyeOff size={14} />}
            aria-label={t(showAddresses ? '隐藏令牌地址' : '显示令牌地址')}
            onClick={() => setShowAddresses((visible) => !visible)}
          />
        </Tooltip>
      )}
    </div>
  );
};

TokenEndpointBar.propTypes = {
  copyText: PropTypes.func.isRequired,
  t: PropTypes.func.isRequired,
};

export default TokenEndpointBar;
