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

import { useCallback, useEffect, useMemo, useState } from 'react';

import { API, showError, showSuccess } from '../../../helpers';
import { parseMarketplaceIndex } from '../marketplace';
import {
  buildTaskPluginUploadPayload,
  getPluginOwnershipPresentation,
  marketplaceSourceKey,
  selectMarketplaceSourceKey,
} from '../components/pluginViewModel';

export const TASK_PLUGIN_COLUMNS = [
  'plugin',
  'models',
  'version',
  'source',
  'runtime',
  'enabled',
  'actions',
];

export const TASK_PLUGIN_COLUMN_LABELS = {
  plugin: '插件',
  models: '模型',
  version: '版本',
  source: '来源',
  runtime: '运行状态',
  enabled: '启用',
  actions: '操作',
};

const DEFAULT_VISIBLE_COLUMNS = TASK_PLUGIN_COLUMNS.reduce(
  (columns, key) => ({ ...columns, [key]: true }),
  {},
);

function readStoredColumns() {
  if (typeof window === 'undefined') return DEFAULT_VISIBLE_COLUMNS;
  try {
    const saved = JSON.parse(
      window.localStorage.getItem('task-plugin-table-columns') || 'null',
    );
    if (!saved || typeof saved !== 'object') return DEFAULT_VISIBLE_COLUMNS;
    return TASK_PLUGIN_COLUMNS.reduce(
      (columns, key) => ({ ...columns, [key]: saved[key] !== false }),
      {},
    );
  } catch {
    return DEFAULT_VISIBLE_COLUMNS;
  }
}

function readStoredView() {
  if (typeof window === 'undefined') return 'table';
  return window.localStorage.getItem('task-plugin-view') === 'cards'
    ? 'cards'
    : 'table';
}

function localizedText(value) {
  if (typeof value === 'string') return value;
  return value?.zh ?? value?.en ?? '';
}

export default function useTaskPluginPageState(t) {
  const [loading, setLoading] = useState(false);
  const [plugins, setPlugins] = useState([]);
  const [runtime, setRuntime] = useState(null);
  const [masterEnabled, setMasterEnabled] = useState(true);
  const [masterChanging, setMasterChanging] = useState(false);
  const [activeTab, setActiveTab] = useState('installed');
  const [installedView, setInstalledView] = useState(readStoredView);
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [visibleColumns, setVisibleColumns] = useState(readStoredColumns);
  const [detail, setDetail] = useState(null);
  const [detailRecord, setDetailRecord] = useState(null);
  const [uploadTarget, setUploadTarget] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [sources, setSources] = useState([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [sourceStates, setSourceStates] = useState({});
  const [selectedSourceKey, setSelectedSourceKey] = useState('');
  const [sourcesVisible, setSourcesVisible] = useState(false);
  const [marketplaceInstallTarget, setMarketplaceInstallTarget] = useState(null);

  useEffect(() => {
    window.localStorage.setItem('task-plugin-view', installedView);
  }, [installedView]);

  useEffect(() => {
    window.localStorage.setItem(
      'task-plugin-table-columns',
      JSON.stringify(visibleColumns),
    );
  }, [visibleColumns]);

  const refreshPlugins = useCallback(async () => {
    setLoading(true);
    try {
      const [listRes, runtimeRes, optionsRes] = await Promise.all([
        API.get('/api/plugin/task'),
        API.get('/api/plugin/task/runtime/status'),
        API.get('/api/option/'),
      ]);
      if (!listRes?.data?.success) {
        throw new Error(listRes?.data?.message || t('加载任务插件失败'));
      }
      setPlugins(Array.isArray(listRes.data.data) ? listRes.data.data : []);
      if (runtimeRes?.data?.success) setRuntime(runtimeRes.data.data ?? null);
      if (optionsRes?.data?.success) {
        const enabled = (optionsRes.data.data ?? []).find(
          (item) => item.key === 'TaskPluginEnabled',
        );
        setMasterEnabled(enabled ? enabled.value === 'true' : true);
      }
    } catch (error) {
      showError(`${t('加载任务插件失败')}: ${String(error)}`);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refreshPlugins();
  }, [refreshPlugins]);

  const refreshSources = useCallback(async () => {
    setSourcesLoading(true);
    try {
      const response = await API.get('/api/plugin/task/marketplace/sources');
      if (!response?.data?.success) {
        throw new Error(response?.data?.message || t('加载市场源失败'));
      }
      const nextSources = Array.isArray(response.data.data)
        ? response.data.data
        : [];
      const validKeys = new Set(nextSources.map(marketplaceSourceKey));
      setSources(nextSources);
      setSelectedSourceKey((current) =>
        selectMarketplaceSourceKey(nextSources, current),
      );
      setSourceStates((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([key]) => validKeys.has(key)),
        ),
      );
      return nextSources;
    } catch (error) {
      showError(`${t('加载市场源失败')}: ${String(error)}`);
      return [];
    } finally {
      setSourcesLoading(false);
    }
  }, [t]);

  const refreshMarketplaceSource = useCallback(async (source) => {
    const key = marketplaceSourceKey(source);
    if (!key) return;
    setSourceStates((current) => ({ ...current, [key]: { status: 'loading' } }));
    try {
      const response = await fetch(source.index_url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const index = parseMarketplaceIndex(await response.json());
      setSourceStates((current) => ({
        ...current,
        [key]: { status: 'ready', index },
      }));
    } catch (error) {
      setSourceStates((current) => ({
        ...current,
        [key]: {
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        },
      }));
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'marketplace') void refreshSources();
  }, [activeTab, refreshSources]);

  const selectedMarketplaceSource = useMemo(
    () =>
      sources.find(
        (source) => marketplaceSourceKey(source) === selectedSourceKey,
      ) ?? sources[0],
    [selectedSourceKey, sources],
  );

  useEffect(() => {
    if (activeTab !== 'marketplace' || !selectedMarketplaceSource) return;
    const key = marketplaceSourceKey(selectedMarketplaceSource);
    if (sourceStates[key]) return;
    void refreshMarketplaceSource(selectedMarketplaceSource);
  }, [
    activeTab,
    refreshMarketplaceSource,
    selectedMarketplaceSource,
    sourceStates,
  ]);

  const saveSources = useCallback(
    async (nextSources) => {
      setSourcesLoading(true);
      try {
        const response = await API.put(
          '/api/plugin/task/marketplace/sources',
          nextSources,
        );
        if (!response?.data?.success) {
          throw new Error(response?.data?.message || t('保存失败'));
        }
        const saved = Array.isArray(response.data.data)
          ? response.data.data
          : nextSources;
        const validKeys = new Set(saved.map(marketplaceSourceKey));
        setSources(saved);
        setSelectedSourceKey((current) =>
          selectMarketplaceSourceKey(saved, current),
        );
        setSourceStates((current) =>
          Object.fromEntries(
            Object.entries(current).filter(([key]) => validKeys.has(key)),
          ),
        );
        setSourcesVisible(false);
        showSuccess(t('市场源已保存'));
      } catch (error) {
        showError(`${t('保存失败')}: ${String(error)}`);
      } finally {
        setSourcesLoading(false);
      }
    },
    [t],
  );

  const toggleMaster = useCallback(
    async (enabled) => {
      const previous = masterEnabled;
      setMasterEnabled(enabled);
      setMasterChanging(true);
      try {
        const response = await API.put('/api/option/', {
          key: 'TaskPluginEnabled',
          value: String(enabled),
        });
        if (!response?.data?.success) {
          throw new Error(response?.data?.message || t('操作失败'));
        }
        showSuccess(enabled ? t('任务插件系统已启用') : t('任务插件系统已停用'));
        await refreshPlugins();
      } catch (error) {
        setMasterEnabled(previous);
        showError(`${t('操作失败')}: ${String(error)}`);
      } finally {
        setMasterChanging(false);
      }
    },
    [masterEnabled, refreshPlugins, t],
  );

  const togglePlugin = useCallback(
    async (record, enabled) => {
      const key = record?.meta?.key;
      if (!key) return;
      try {
        const response = await API.post(
          `/api/plugin/task/${encodeURIComponent(key)}/status`,
          { enabled },
        );
        if (!response?.data?.success) {
          throw new Error(response?.data?.message || t('操作失败'));
        }
        showSuccess(enabled ? t('已启用') : t('已停用'));
      } catch (error) {
        showError(`${t('操作失败')}: ${String(error)}`);
      } finally {
        await refreshPlugins();
      }
    },
    [refreshPlugins, t],
  );

  const openDetail = useCallback(
    async (record) => {
      const key = record?.meta?.key;
      if (!key) return;
      try {
        const response = await API.get(`/api/plugin/task/${encodeURIComponent(key)}`);
        if (!response?.data?.success) {
          throw new Error(response?.data?.message || t('加载失败'));
        }
        setDetail(response.data.data ?? null);
        setDetailRecord(record);
      } catch (error) {
        showError(`${t('加载失败')}: ${String(error)}`);
      }
    },
    [t],
  );

  const uploadPlugin = useCallback(
    async ({ source, remark, force, expectedKey, icon }) => {
      setUploading(true);
      try {
        const response = await API.post(
          '/api/plugin/task',
          buildTaskPluginUploadPayload({
            source,
            remark,
            force,
            expectedKey,
            icon,
          }),
        );
        if (!response?.data?.success) {
          throw new Error(response?.data?.message || t('上传失败'));
        }
        showSuccess(t('插件已上传并编译'));
        await refreshPlugins();
      } finally {
        setUploading(false);
      }
    },
    [refreshPlugins, t],
  );

  const filteredPlugins = useMemo(() => {
    const query = search.trim().toLowerCase();
    return plugins.filter((record) => {
      const meta = record?.meta ?? {};
      const searchable = [
        meta.name,
        meta.key,
        localizedText(meta.description),
        record.remark,
        ...(Array.isArray(meta.models) ? meta.models : []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      const ownership = getPluginOwnershipPresentation(record).ownership;
      const sourceMatches =
        sourceFilter === 'all' || ownership === sourceFilter;
      const statusMatches =
        statusFilter === 'all' ||
        (statusFilter === 'enabled' && record.enabled) ||
        (statusFilter === 'disabled' && !record.enabled) ||
        (statusFilter === 'error' &&
          record.runtime_status === 'compile_failed');
      return (
        (!query || searchable.includes(query)) && sourceMatches && statusMatches
      );
    });
  }, [plugins, search, sourceFilter, statusFilter]);

  const pageCount = Math.max(1, Math.ceil(filteredPlugins.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pagedPlugins = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredPlugins.slice(start, start + pageSize);
  }, [filteredPlugins, pageSize, safePage]);

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  const updateVisibleColumn = useCallback((key, visible) => {
    if (key === '__all__') {
      setVisibleColumns(
        TASK_PLUGIN_COLUMNS.reduce(
          (columns, columnKey) => ({
            ...columns,
            [columnKey]:
              columnKey === 'plugin' || columnKey === 'actions'
                ? true
                : visible,
          }),
          {},
        ),
      );
      return;
    }
    if (key === 'plugin' || key === 'actions') return;
    setVisibleColumns((current) => ({ ...current, [key]: visible }));
  }, []);

  return {
    activeTab,
    setActiveTab,
    loading,
    plugins,
    runtime,
    masterEnabled,
    masterChanging,
    toggleMaster,
    refreshPlugins,
    installedView,
    setInstalledView,
    search,
    setSearch,
    sourceFilter,
    setSourceFilter,
    statusFilter,
    setStatusFilter,
    page: safePage,
    setPage,
    pageSize,
    setPageSize,
    filteredPluginCount: filteredPlugins.length,
    pagedPlugins,
    visibleColumns,
    updateVisibleColumn,
    resetVisibleColumns: () => setVisibleColumns(DEFAULT_VISIBLE_COLUMNS),
    detail,
    detailRecord,
    openDetail,
    closeDetail: () => {
      setDetail(null);
      setDetailRecord(null);
    },
    uploadTarget,
    setUploadTarget,
    uploading,
    uploadPlugin,
    deleteTarget,
    setDeleteTarget,
    togglePlugin,
    sources,
    sourcesLoading,
    sourceStates,
    selectedSourceKey,
    setSelectedSourceKey,
    selectedMarketplaceSource,
    refreshSources,
    refreshMarketplaceSource,
    sourcesVisible,
    setSourcesVisible,
    saveSources,
    marketplaceInstallTarget,
    setMarketplaceInstallTarget,
  };
}
