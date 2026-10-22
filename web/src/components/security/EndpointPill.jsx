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

import React from 'react';
import { Button, Tag, Tooltip } from '@douyinfe/semi-ui';
import { Check, Copy, Eye, EyeOff, Pencil, Trash2, Zap } from 'lucide-react';
import PropTypes from 'prop-types';

const KIND_LABELS = {
  host: '直连入口域名',
  base_url: '默认 API 地址',
  endpoint: '附加 API 地址',
};
const KIND_COLORS = { host: 'blue', base_url: 'cyan', endpoint: 'green' };

const getTestUrl = (kind, url) => {
  if (
    kind === 'host' &&
    url &&
    !/^[a-z][a-z\d+.-]*:\/\//i.test(String(url).trim())
  ) {
    return `https://${String(url).trim()}`;
  }
  return url;
};

const EndpointPill = ({
  label,
  kind = 'endpoint',
  url,
  description,
  enabled = true,
  copied = false,
  onCopy,
  onTest,
  onEdit,
  onDelete,
  onToggle,
  compact = false,
  copyLabel = '复制地址',
  testLabel = '快速测试',
}) => {
  const normalizedKind = KIND_LABELS[kind] ? kind : 'endpoint';
  return (
    <div
      className={`group flex min-w-0 items-center gap-2 rounded-xl border px-3 py-2 transition-colors ${
        enabled
          ? 'border-semi-color-border bg-semi-color-bg-2 hover:border-blue-300 hover:bg-blue-50/40 dark:hover:bg-blue-950/20'
          : 'border-semi-color-border bg-semi-color-fill-0 opacity-65'
      }`}
    >
      <div className='flex min-w-0 items-center gap-1.5'>
        <Tag color={KIND_COLORS[normalizedKind]} size='small'>
          {label || KIND_LABELS[normalizedKind]}
        </Tag>
        {!compact && (
          <span className='hidden shrink-0 text-[11px] text-semi-color-text-2 sm:inline'>
            {enabled ? '显示' : '隐藏'}
          </span>
        )}
      </div>
      <Tooltip content={description || '点击可复制此端点'} position='top'>
        <button
          type='button'
          className='min-w-0 flex-1 truncate text-left font-mono text-xs text-semi-color-primary hover:underline sm:text-sm'
          onClick={() => onCopy?.(url)}
          title={url}
        >
          {url || '-'}
        </button>
      </Tooltip>
      <div className='flex shrink-0 items-center gap-0.5'>
        <Button
          theme='borderless'
          size='small'
          icon={copied ? <Check size={14} /> : <Copy size={14} />}
          aria-label={`${copyLabel}: ${url}`}
          onClick={() => onCopy?.(url)}
        />
        {onTest && (
          <Tooltip content={testLabel} position='top'>
            <Button
              theme='borderless'
              size='small'
              icon={<Zap size={14} />}
              aria-label={`${testLabel}: ${url}`}
              onClick={() => onTest(getTestUrl(normalizedKind, url))}
            />
          </Tooltip>
        )}
        {onEdit && (
          <Button
            theme='borderless'
            size='small'
            icon={<Pencil size={14} />}
            aria-label='编辑'
            onClick={onEdit}
          />
        )}
        {onToggle && (
          <Button
            theme='borderless'
            size='small'
            icon={enabled ? <Eye size={14} /> : <EyeOff size={14} />}
            aria-label={enabled ? '隐藏' : '显示'}
            onClick={onToggle}
          />
        )}
        {onDelete && (
          <Button
            theme='borderless'
            type='danger'
            size='small'
            icon={<Trash2 size={14} />}
            aria-label='删除'
            onClick={onDelete}
          />
        )}
      </div>
    </div>
  );
};

EndpointPill.propTypes = {
  label: PropTypes.string,
  kind: PropTypes.string,
  url: PropTypes.string.isRequired,
  description: PropTypes.string,
  enabled: PropTypes.bool,
  copied: PropTypes.bool,
  onCopy: PropTypes.func,
  onTest: PropTypes.func,
  onEdit: PropTypes.func,
  onDelete: PropTypes.func,
  onToggle: PropTypes.func,
  compact: PropTypes.bool,
  copyLabel: PropTypes.string,
  testLabel: PropTypes.string,
};

export default EndpointPill;
