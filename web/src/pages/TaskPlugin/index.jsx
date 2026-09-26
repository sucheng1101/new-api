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
import {
  Button,
  Input,
  Modal,
  Select,
  Switch,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from '@douyinfe/semi-ui';
import { LayoutGrid, List, RefreshCw, Settings2, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import CardPro from '../../components/common/ui/CardPro';
import { createCardProPagination } from '../../helpers/utils';
import { useIsMobile } from '../../hooks/common/useIsMobile';
import './TaskPlugin.css';
import MarketplaceInstallDialog from './components/MarketplaceInstallDialog';
import PluginDeleteVersionModal from './components/PluginDeleteVersionModal';
import PluginDetailSheet from './components/PluginDetailSheet';
import PluginInstalledList from './components/PluginInstalledList';
import PluginMarketplacePanel from './components/PluginMarketplacePanel';
import PluginMarketplaceSourcesModal from './components/PluginMarketplaceSourcesModal';
import PluginUploadDialog from './components/PluginUploadDialog';
import TaskPluginColumnSelectorModal from './components/TaskPluginColumnSelectorModal';
import { marketplaceSourceKey } from './components/pluginViewModel';
import useTaskPluginPageState, {
  TASK_PLUGIN_COLUMN_LABELS,
  TASK_PLUGIN_COLUMNS,
} from './hooks/useTaskPluginPageState';

function PluginTabs({ activeTab, installedCount, sourceCount, onChange, t }) {
  return (
    <Tabs
      activeKey={activeTab}
      type='card'
      collapsible
      className='task-plugin-tabs'
      onChange={onChange}
    >
      <Tabs.TabPane
        itemKey='installed'
        tab={
          <span className='task-plugin-tab-label'>
            {t('已安装插件')}
            <Tag
              shape='circle'
              color={activeTab === 'installed' ? 'red' : 'grey'}
            >
              {installedCount}
            </Tag>
          </span>
        }
      />
      <Tabs.TabPane
        itemKey='marketplace'
        tab={
          <span className='task-plugin-tab-label'>
            {t('市场源')}
            <Tag
              shape='circle'
              color={activeTab === 'marketplace' ? 'red' : 'grey'}
            >
              {sourceCount}
            </Tag>
          </span>
        }
      />
    </Tabs>
  );
}

function InstalledCommands({ state, onOpenColumnSelector, t }) {
  return (
    <div className='task-plugin-command-row'>
      <div className='task-plugin-command-actions'>
        <Button
          size='small'
          theme='light'
          type='primary'
          icon={<Upload size={15} />}
          onClick={() => state.setUploadTarget({})}
        >
          {t('上传插件')}
        </Button>
        <Tooltip content={t('刷新已安装插件和运行时状态')}>
          <Button
            aria-label={t('刷新')}
            size='small'
            theme='light'
            type='tertiary'
            icon={<RefreshCw size={15} />}
            loading={state.loading}
            onClick={() => void state.refreshPlugins()}
          />
        </Tooltip>
        <Tooltip content={t('列设置')}>
          <Button
            aria-label={t('列设置')}
            size='small'
            theme='light'
            type='tertiary'
            icon={<Settings2 size={15} />}
            onClick={onOpenColumnSelector}
          />
        </Tooltip>
        <div
          className='task-plugin-view-toggle'
          role='group'
          aria-label={t('视图切换')}
        >
          <Tooltip content={t('表格视图')}>
            <Button
              aria-label={t('表格视图')}
              size='small'
              theme={state.installedView === 'table' ? 'light' : 'borderless'}
              type={state.installedView === 'table' ? 'primary' : 'tertiary'}
              icon={<List size={15} />}
              onClick={() => state.setInstalledView('table')}
            />
          </Tooltip>
          <Tooltip content={t('卡片视图')}>
            <Button
              aria-label={t('卡片视图')}
              size='small'
              theme={state.installedView === 'cards' ? 'light' : 'borderless'}
              type={state.installedView === 'cards' ? 'primary' : 'tertiary'}
              icon={<LayoutGrid size={15} />}
              onClick={() => state.setInstalledView('cards')}
            />
          </Tooltip>
        </div>
      </div>
      <div className='task-plugin-command-filters'>
        <Input
          size='small'
          value={state.search}
          showClear
          placeholder={t('搜索名称、Key 或模型')}
          onChange={(value) => {
            state.setSearch(value);
            state.setPage(1);
          }}
        />
        <Select
          size='small'
          value={state.sourceFilter}
          optionList={[
            { value: 'all', label: t('全部来源') },
            { value: 'factory', label: t('出厂插件') },
            { value: 'third_party', label: t('第三方插件') },
            { value: 'override_over_factory', label: t('覆盖出厂版本') },
          ]}
          onChange={(value) => {
            state.setSourceFilter(value || 'all');
            state.setPage(1);
          }}
        />
        <Select
          size='small'
          value={state.statusFilter}
          optionList={[
            { value: 'all', label: t('全部状态') },
            { value: 'enabled', label: t('已启用') },
            { value: 'disabled', label: t('已停用') },
            { value: 'error', label: t('编译异常') },
          ]}
          onChange={(value) => {
            state.setStatusFilter(value || 'all');
            state.setPage(1);
          }}
        />
      </div>
    </div>
  );
}

function MarketplaceCommands({ state, t }) {
  const selectedSource = state.selectedMarketplaceSource;
  const selectedState = selectedSource
    ? state.sourceStates[marketplaceSourceKey(selectedSource)]
    : null;

  return (
    <div className='task-plugin-command-row'>
      <div className='task-plugin-command-actions'>
        <Button
          size='small'
          theme='light'
          type='primary'
          icon={<Settings2 size={15} />}
          onClick={() => state.setSourcesVisible(true)}
        >
          {t('管理市场源')}
        </Button>
        <Tooltip content={t('刷新当前市场源索引')}>
          <Button
            aria-label={t('刷新当前市场源索引')}
            size='small'
            theme='light'
            type='tertiary'
            icon={<RefreshCw size={15} />}
            loading={selectedState?.status === 'loading'}
            disabled={!selectedSource}
            onClick={() => void state.refreshMarketplaceSource(selectedSource)}
          />
        </Tooltip>
      </div>
      <div className='task-plugin-command-filters'>
        <Select
          size='small'
          className='task-plugin-marketplace-source-select'
          value={state.selectedSourceKey}
          placeholder={t('选择市场源')}
          optionList={state.sources.map((source) => ({
            value: marketplaceSourceKey(source),
            label: source.name || marketplaceSourceKey(source),
          }))}
          loading={state.sourcesLoading}
          onChange={(value) => state.setSelectedSourceKey(value || '')}
        />
      </div>
    </div>
  );
}

export default function TaskPlugin() {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const state = useTaskPluginPageState(t);
  const [columnSelectorVisible, setColumnSelectorVisible] =
    React.useState(false);

  const requestMasterToggle = (enabled) => {
    if (enabled) {
      void state.toggleMaster(true);
      return;
    }
    Modal.confirm({
      title: t('停用任务插件系统？'),
      content: t('停用后，内置和上传的任务插件都会停止提供服务。'),
      okText: t('停用'),
      cancelText: t('取消'),
      okType: 'danger',
      onOk: () => state.toggleMaster(false),
    });
  };

  return (
    <div className='mt-[60px] px-2 task-plugin-page'>
      <CardPro
        type='type3'
        className='task-plugin-card-pro'
        tabsArea={
          <PluginTabs
            activeTab={state.activeTab}
            installedCount={state.plugins.length}
            sourceCount={state.sources.length}
            onChange={state.setActiveTab}
            t={t}
          />
        }
        actionsArea={
          <div className='task-plugin-page-heading'>
            <div className='task-plugin-page-heading-copy'>
              <Typography.Text strong>
                {state.activeTab === 'installed'
                  ? t('任务插件')
                  : t('插件市场')}
              </Typography.Text>
              <Typography.Text type='tertiary' size='small'>
                {state.activeTab === 'installed'
                  ? t('管理已安装任务插件、版本与运行状态')
                  : t('从已配置市场源安装或更新任务插件')}
              </Typography.Text>
            </div>
            {state.activeTab === 'installed' ? (
              <div className='task-plugin-master-switch'>
                {state.runtime?.current_generation !== undefined ? (
                  <Tag color='grey' size='small'>
                    {t('运行时')} v{state.runtime.current_generation}
                  </Tag>
                ) : null}
                <Typography.Text strong>{t('系统启用')}</Typography.Text>
                <Tooltip content={t('控制全部内置和上传插件是否提供服务')}>
                  <Switch
                    checked={state.masterEnabled}
                    loading={state.masterChanging}
                    aria-label={t('系统启用')}
                    onChange={requestMasterToggle}
                  />
                </Tooltip>
              </div>
            ) : null}
          </div>
        }
        searchArea={
          state.activeTab === 'installed' ? (
            <InstalledCommands
              state={state}
              onOpenColumnSelector={() => setColumnSelectorVisible(true)}
              t={t}
            />
          ) : (
            <MarketplaceCommands state={state} t={t} />
          )
        }
        paginationArea={
          state.activeTab === 'installed'
            ? createCardProPagination({
                currentPage: state.page,
                pageSize: state.pageSize,
                total: state.filteredPluginCount,
                onPageChange: state.setPage,
                onPageSizeChange: (nextPageSize) => {
                  state.setPageSize(nextPageSize);
                  state.setPage(1);
                },
                isMobile,
                t,
              })
            : null
        }
        t={t}
      >
        <div className='task-plugin-panel'>
          {state.activeTab === 'installed' ? (
            <PluginInstalledList
              records={state.pagedPlugins}
              loading={state.loading}
              visibleColumns={state.visibleColumns}
              view={state.installedView}
              onViewDetail={(record) => void state.openDetail(record)}
              onUploadVersion={state.setUploadTarget}
              onDeleteVersion={state.setDeleteTarget}
              onToggleEnabled={state.togglePlugin}
            />
          ) : (
            <PluginMarketplacePanel
              sources={state.sources}
              sourceStates={state.sourceStates}
              sourcesLoading={state.sourcesLoading}
              selectedSourceKey={state.selectedSourceKey}
              installed={state.plugins}
              onInstall={state.setMarketplaceInstallTarget}
              onRetrySource={state.refreshMarketplaceSource}
            />
          )}
        </div>
      </CardPro>

      <TaskPluginColumnSelectorModal
        visible={columnSelectorVisible}
        columns={TASK_PLUGIN_COLUMNS.map((key) => ({
          key,
          title: t(TASK_PLUGIN_COLUMN_LABELS[key] || key),
        }))}
        visibleColumns={state.visibleColumns}
        onCancel={() => setColumnSelectorVisible(false)}
        onChange={state.updateVisibleColumn}
        onReset={state.resetVisibleColumns}
        t={t}
      />
      <PluginUploadDialog
        visible={Boolean(state.uploadTarget)}
        target={state.uploadTarget}
        submitting={state.uploading}
        onCancel={() => state.setUploadTarget(null)}
        onSubmit={async (payload) => {
          await state.uploadPlugin(payload);
          state.setUploadTarget(null);
        }}
      />
      <PluginMarketplaceSourcesModal
        visible={state.sourcesVisible}
        sources={state.sources}
        loading={state.sourcesLoading}
        onCancel={() => state.setSourcesVisible(false)}
        onSave={state.saveSources}
      />
      <MarketplaceInstallDialog
        target={state.marketplaceInstallTarget}
        visible={Boolean(state.marketplaceInstallTarget)}
        onCancel={() => state.setMarketplaceInstallTarget(null)}
        onInstalled={async () => {
          state.setMarketplaceInstallTarget(null);
          await state.refreshPlugins();
        }}
      />
      <PluginDetailSheet
        detail={state.detail}
        listRecord={state.detailRecord}
        visible={Boolean(state.detail)}
        onCancel={state.closeDetail}
        onPluginChanged={state.refreshPlugins}
      />
      <PluginDeleteVersionModal
        record={state.deleteTarget}
        visible={Boolean(state.deleteTarget)}
        onCancel={() => state.setDeleteTarget(null)}
        onDeleted={async () => {
          state.setDeleteTarget(null);
          await state.refreshPlugins();
        }}
      />
    </div>
  );
}
