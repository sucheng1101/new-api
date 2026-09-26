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
import { Banner, Button, Empty, Tag, Typography } from '@douyinfe/semi-ui';
import { Download, RefreshCw, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  deriveMarketplaceInstallState,
  findMarketplaceVersion,
} from '../marketplace';
import PluginIcon from './PluginIcon';
import { marketplaceSourceKey } from './pluginViewModel';

function localizedText(value) {
  if (typeof value === 'string') return value;
  return value?.zh ?? value?.en ?? '';
}

function installStateLabel(state, t) {
  if (state.status === 'up_to_date') return t('已是最新版本');
  if (state.status === 'upgradable') {
    return t('可升级至 {{version}}', { version: state.latestVersion });
  }
  if (state.status === 'diverged') return t('本地版本与市场源不一致');
  return t('未安装');
}

function MarketplacePluginCard({ plugin, installed, source, onInstall }) {
  const { t } = useTranslation();
  const state = deriveMarketplaceInstallState(plugin, installed);
  const description = localizedText(plugin.description);
  const latest = findMarketplaceVersion(plugin, plugin.latest);
  const canInstall = state.status !== 'up_to_date';
  const matchingInstalled = (installed ?? []).find(
    (item) => item.meta?.key === plugin.key,
  );

  return (
    <div className='task-plugin-marketplace-card'>
      <div className='task-plugin-marketplace-card-header'>
        <PluginIcon
          record={{
            meta: {
              key: plugin.key,
              name: plugin.name,
              icon: plugin.icon,
              channelTypes: plugin.channelTypes,
            },
          }}
          size={36}
          className='task-plugin-marketplace-icon'
        />
        <div className='task-plugin-marketplace-card-title'>
          <Typography.Text strong ellipsis={{ showTooltip: true }}>
            {plugin.name}
          </Typography.Text>
          <Typography.Text
            type='tertiary'
            size='small'
            ellipsis={{ showTooltip: true }}
          >
            {plugin.key}
          </Typography.Text>
        </div>
        <Tag color={state.status === 'up_to_date' ? 'green' : 'blue'}>
          {installStateLabel(state, t)}
        </Tag>
      </div>
      {description ? (
        <Typography.Text
          type='tertiary'
          size='small'
          className='task-plugin-marketplace-description'
        >
          {description}
        </Typography.Text>
      ) : null}
      <div className='task-plugin-marketplace-facts'>
        <span>
          {t('版本')} <code>{plugin.latest}</code>
        </span>
        <span>
          {t('模型')} {plugin.models?.length ?? 0}
        </span>
        <span>
          {t('渠道')} {plugin.channelTypes?.join(', ') || '-'}
        </span>
      </div>
      {matchingInstalled?.meta?.version &&
      matchingInstalled.meta.version !== plugin.latest ? (
        <Typography.Text type='tertiary' size='small'>
          {t('已安装')} <code>{matchingInstalled.meta.version}</code>
        </Typography.Text>
      ) : null}
      <div className='task-plugin-marketplace-card-footer'>
        <Typography.Text type='tertiary' size='small'>
          {latest?.sha256 ? t('已提供完整性校验') : t('未提供完整性校验')}
        </Typography.Text>
        <Button
          size='small'
          theme={canInstall ? 'solid' : 'borderless'}
          type={canInstall ? 'primary' : 'tertiary'}
          icon={<Download size={15} />}
          disabled={!canInstall}
          onClick={() => onInstall?.({ source, plugin, state })}
        >
          {state.status === 'upgradable' ? t('升级') : t('安装')}
        </Button>
      </div>
    </div>
  );
}

function MarketplaceSourceSection({
  source,
  sourceState,
  installed,
  onInstall,
  onRetry,
}) {
  const { t } = useTranslation();
  const index = sourceState?.index;
  const error = sourceState?.error;

  return (
    <section className='task-plugin-marketplace-source'>
      <div className='task-plugin-marketplace-heading'>
        <div>
          <Typography.Title heading={6} style={{ margin: 0 }}>
            {index?.name || source.name}
          </Typography.Title>
          <Typography.Text type='tertiary' size='small'>
            {source.index_url}
          </Typography.Text>
        </div>
        <div className='task-plugin-marketplace-source-badges'>
          {index ? <Tag color='blue'>v{index.indexVersion}</Tag> : null}
          <Button
            aria-label={t('刷新 {{name}}', { name: source.name })}
            size='small'
            theme='borderless'
            icon={<RefreshCw size={15} />}
            loading={sourceState?.status === 'loading'}
            onClick={() => onRetry?.(source)}
          />
        </div>
      </div>
      {sourceState?.status === 'loading' ? (
        <Banner
          type='info'
          closeIcon={null}
          description={t('正在加载此市场源...')}
        />
      ) : null}
      {error ? (
        <Banner
          type='warning'
          closeIcon={null}
          description={
            <div className='task-plugin-marketplace-source-error'>
              <span>
                {t('此市场源加载失败')}: {error}
              </span>
              <Button size='small' onClick={() => onRetry?.(source)}>
                {t('重试')}
              </Button>
            </div>
          }
          icon={<TriangleAlert size={16} />}
        />
      ) : null}
      {index?.plugins?.length ? (
        <div className='task-plugin-marketplace-grid'>
          {index.plugins.map((plugin) => (
            <MarketplacePluginCard
              key={plugin.key}
              plugin={plugin}
              source={source}
              installed={installed}
              onInstall={onInstall}
            />
          ))}
        </div>
      ) : null}
      {index && !index.plugins?.length ? (
        <Empty title={t('该市场源暂无可安装插件')} />
      ) : null}
    </section>
  );
}

export default function PluginMarketplacePanel({
  sources,
  sourceStates,
  sourcesLoading,
  selectedSourceKey,
  installed,
  onInstall,
  onRetrySource,
}) {
  const { t } = useTranslation();
  const safeSources = Array.isArray(sources) ? sources : [];
  const selectedSource =
    safeSources.find(
      (source) => marketplaceSourceKey(source) === selectedSourceKey,
    ) ?? safeSources[0];
  const selectedSourceState = selectedSource
    ? sourceStates?.[marketplaceSourceKey(selectedSource)]
    : undefined;
  const isLoading = selectedSourceState?.status === 'loading';

  return (
    <div className='task-plugin-marketplace'>
      {!safeSources.length && !sourcesLoading ? (
        <Empty
          title={t('暂无市场源')}
          description={t(
            '请使用当前页面上方的“管理市场源”添加一个插件市场索引地址',
          )}
        />
      ) : null}
      {selectedSource ? (
        <MarketplaceSourceSection
          key={marketplaceSourceKey(selectedSource)}
          source={selectedSource}
          sourceState={selectedSourceState}
          installed={installed}
          onInstall={onInstall}
          onRetry={onRetrySource}
        />
      ) : null}
    </div>
  );
}
