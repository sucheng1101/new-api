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
import { Button, Tag, Typography } from '@douyinfe/semi-ui';
import { IconCopy } from '@douyinfe/semi-icons';
import PropTypes from 'prop-types';
import {
  buildApiEndpoint,
  getServerAddress,
  normalizeServerAddress,
} from '../../../helpers/token';
import { API } from '../../../helpers';

const EndpointItem = ({ label, url, onCopy, copyLabel }) => (
  <div className='flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center'>
    <Tag color='blue' className='w-fit shrink-0'>
      {label}
    </Tag>
    <Typography.Text
      className='min-w-0 flex-1 font-mono text-sm'
      ellipsis={{ showTooltip: true }}
      selectable
    >
      {url}
    </Typography.Text>
    <Button
      type='tertiary'
      size='small'
      icon={<IconCopy />}
      aria-label={`${copyLabel}: ${label}`}
      onClick={() => onCopy(url)}
    >
      {copyLabel}
    </Button>
  </div>
);

EndpointItem.propTypes = {
  label: PropTypes.string.isRequired,
  url: PropTypes.string.isRequired,
  onCopy: PropTypes.func.isRequired,
  copyLabel: PropTypes.string.isRequired,
};

const TokenEndpointBar = ({ copyText, t }) => {
  const [customEndpoints, setCustomEndpoints] = useState([]);
  const [configuredBaseUrl, setConfiguredBaseUrl] = useState('');
  useEffect(() => {
    let mounted = true;
    API.get('/api/user/direct-ip-whitelist')
      .then((response) => {
        if (mounted && response.data?.success) {
          const data = response.data.data || {};
          setConfiguredBaseUrl(normalizeServerAddress(data.base_url || ''));
          setCustomEndpoints(data.endpoints || []);
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);
  const serverAddress =
    configuredBaseUrl || normalizeServerAddress(getServerAddress());
  const openAIEndpoint = buildApiEndpoint(serverAddress, '/v1');

  return (
    <div className='flex w-full flex-col gap-2 rounded-xl border border-solid p-3 sm:flex-row sm:items-center'>
      <div className='shrink-0 text-sm font-medium'>{t('API地址')}</div>
      <div className='flex min-w-0 flex-1 flex-col gap-2 lg:flex-row'>
        <EndpointItem
          label={t('网关地址')}
          url={serverAddress}
          onCopy={copyText}
          copyLabel={t('复制地址')}
        />
        <EndpointItem
          label={t('OpenAI兼容地址')}
          url={openAIEndpoint}
          onCopy={copyText}
          copyLabel={t('复制地址')}
        />
        {customEndpoints
          .filter((item) => item.enabled && item.endpoint)
          .map((item) => (
            <EndpointItem
              key={item.id || item.endpoint}
              label={item.name || t('自定义端点')}
              url={item.endpoint}
              onCopy={copyText}
              copyLabel={t('复制地址')}
            />
          ))}
      </div>
    </div>
  );
};

TokenEndpointBar.propTypes = {
  copyText: PropTypes.func.isRequired,
  t: PropTypes.func.isRequired,
};

export default TokenEndpointBar;
