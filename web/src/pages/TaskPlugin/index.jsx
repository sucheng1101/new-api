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
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Banner,
  Button,
  Card,
  Checkbox,
  Descriptions,
  Empty,
  Input,
  Modal,
  Select,
  Switch,
  Tabs,
  Tag,
  TextArea,
  Tooltip,
  Typography,
} from '@douyinfe/semi-ui';
import {
  Copy,
  FileCode2,
  LayoutGrid,
  Link2,
  List,
  Search,
  TriangleAlert,
  Upload,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { API, copy, showError, showSuccess } from '../../helpers';
import CardPro from '../../components/common/ui/CardPro';
import CardTable from '../../components/common/ui/CardTable';
import { createCardProPagination } from '../../helpers/utils';
import { useIsMobile } from '../../hooks/common/useIsMobile';
import './TaskPlugin.css';
import {
  findMarketplaceVersion,
  parseMarketplaceIndex,
  resolveMarketplaceSourceUrl,
  sha256Hex,
} from './marketplace';
import PluginActionsMenu from './components/PluginActionsMenu';
import PluginDeleteVersionModal from './components/PluginDeleteVersionModal';
import PluginDetailSheet from './components/PluginDetailSheet';
import PluginIcon from './components/PluginIcon';
import PluginMarketplacePanel from './components/PluginMarketplacePanel';
import PluginMarketplaceSourcesModal from './components/PluginMarketplaceSourcesModal';
import TaskPluginColumnSelectorModal from './components/TaskPluginColumnSelectorModal';
import {
  buildTaskPluginUploadPayload,
  getPluginOwnershipPresentation,
  marketplaceSourceKey,
  selectMarketplaceSourceKey,
} from './components/pluginViewModel';

const MAX_VISIBLE_MODELS = 3;

const TASK_PLUGIN_COLUMNS = [
  'plugin',
  'description',
  'models',
  'version',
  'source',
  'runtime',
  'enabled',
  'actions',
];

const DEFAULT_VISIBLE_PLUGIN_COLUMNS = TASK_PLUGIN_COLUMNS.reduce(
  (columns, key) => ({ ...columns, [key]: true }),
  {},
);

function readStoredPluginColumns() {
  if (typeof window === 'undefined') return DEFAULT_VISIBLE_PLUGIN_COLUMNS;
  try {
    const stored = JSON.parse(
      window.localStorage.getItem('task-plugin-table-columns') || 'null',
    );
    if (!stored || typeof stored !== 'object') {
      return DEFAULT_VISIBLE_PLUGIN_COLUMNS;
    }
    return TASK_PLUGIN_COLUMNS.reduce(
      (columns, key) => ({
        ...columns,
        [key]: stored[key] !== false,
      }),
      {},
    );
  } catch {
    return DEFAULT_VISIBLE_PLUGIN_COLUMNS;
  }
}

function readStoredPluginView() {
  if (typeof window === 'undefined') return 'table';
  return window.localStorage.getItem('task-plugin-view') === 'cards'
    ? 'cards'
    : 'table';
}

function localizedText(value) {
  if (typeof value === 'string') return value;
  return value?.zh ?? value?.en ?? '';
}

const MAX_PLUGIN_ICON_BYTES = 512 * 1024;

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

function sourceTag(record, t) {
  const presentation = getPluginOwnershipPresentation(record);
  return <Tag color={presentation.color}>{t(presentation.label)}</Tag>;
}

function runtimeTag(record, t) {
  const map = {
    registered: { color: 'green', text: t('已注册') },
    compile_failed: { color: 'red', text: t('编译失败') },
    disabled: { color: 'grey', text: t('已停用') },
    disabled_fallback: { color: 'orange', text: t('已停用，使用内置') },
    not_registered: { color: 'grey', text: t('未注册') },
  };
  const info = map[record.runtime_status] ?? {
    color: 'grey',
    text: record.runtime_status || t('未知'),
  };
  return (
    <Tooltip content={record.runtime_error || info.text} position='top'>
      <Tag color={info.color}>{info.text}</Tag>
    </Tooltip>
  );
}

function PluginAvatar({ record }) {
  return <PluginIcon record={record} className='task-plugin-avatar' />;
}

function MarketplaceInstallDialog({ target, visible, onCancel, onInstalled }) {
  const { t } = useTranslation();
  const [sourceText, setSourceText] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceHash, setSourceHash] = useState('');
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceError, setSourceError] = useState('');
  const [installing, setInstalling] = useState(false);
  const entry = target
    ? findMarketplaceVersion(target.plugin, target.plugin.latest)
    : null;

  useEffect(() => {
    let alive = true;
    setSourceText('');
    setSourceUrl('');
    setSourceHash('');
    setSourceError('');
    if (!visible || !target || !entry) return undefined;
    const url = resolveMarketplaceSourceUrl(
      target.source.index_url,
      entry.path,
    );
    if (!url) {
      setSourceError(t('插件源码地址无效，必须与市场索引保持同源。'));
      return undefined;
    }
    setSourceLoading(true);
    fetch(url)
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then(async (text) => {
        if (!alive) return;
        setSourceText(text);
        setSourceUrl(url);
        setSourceHash(await sha256Hex(text));
      })
      .catch((error) => alive && setSourceError(String(error)))
      .finally(() => alive && setSourceLoading(false));
    return () => {
      alive = false;
    };
  }, [entry, t, target, visible]);

  const digestMismatch = Boolean(
    entry?.sha256 &&
      sourceHash &&
      entry.sha256.toLowerCase() !== sourceHash.toLowerCase(),
  );

  const install = async () => {
    if (!sourceText || digestMismatch) return;
    setInstalling(true);
    try {
      const res = await API.post('/api/plugin/task', {
        source: sourceText,
        sourceSha256: entry?.sha256 || sourceHash,
        enabled: true,
        remark: `${target.source.name} v${target.plugin.latest}`,
      });
      if (!res?.data?.success)
        throw new Error(res?.data?.message || t('安装失败'));
      showSuccess(t('插件已安装并编译'));
      onInstalled();
    } catch (error) {
      showError(t('安装失败') + ': ' + String(error));
    } finally {
      setInstalling(false);
    }
  };

  return (
    <Modal
      title={
        target
          ? `${target.plugin.name} v${target.plugin.latest}`
          : t('安装插件')
      }
      visible={visible}
      onCancel={onCancel}
      width={760}
      okText={installing ? t('安装中...') : t('安装并启用')}
      cancelText={t('取消')}
      confirmLoading={installing}
      okButtonProps={{
        disabled:
          sourceLoading ||
          !sourceText ||
          Boolean(sourceError) ||
          digestMismatch,
      }}
      onOk={() => void install()}
    >
      {target && (
        <div className='task-plugin-install-dialog'>
          <Descriptions
            size='small'
            row
            data={[
              { key: t('插件标识'), value: target.plugin.key },
              { key: t('来源'), value: target.source.name },
              { key: t('源码地址'), value: sourceUrl || '-' },
              {
                key: t('SHA-256'),
                value: entry?.sha256 || sourceHash || t('未提供'),
              },
            ]}
          />
          {sourceLoading && (
            <Banner
              type='info'
              closeIcon={null}
              description={t('正在读取插件源码...')}
            />
          )}
          {sourceError && (
            <Banner type='error' closeIcon={null} description={sourceError} />
          )}
          {digestMismatch && (
            <Banner
              type='error'
              closeIcon={null}
              description={t('源码 SHA-256 与市场索引不一致，已停止安装。')}
            />
          )}
          {!entry?.sha256 && !sourceError && (
            <Banner
              type='warning'
              closeIcon={null}
              description={t(
                '该市场源未提供完整性校验值，请确认源码后再安装。',
              )}
            />
          )}
          <Typography.Title heading={6}>{t('源码预览')}</Typography.Title>
          <pre className='task-plugin-code-block task-plugin-marketplace-source-preview'>
            {sourceText || t('源码将在这里显示')}
          </pre>
        </div>
      )}
    </Modal>
  );
}

function ModelTags({ models = [] }) {
  const visible = models.slice(0, MAX_VISIBLE_MODELS);
  const hidden = models.slice(MAX_VISIBLE_MODELS);
  if (!models.length)
    return <Typography.Text type='tertiary'>-</Typography.Text>;

  return (
    <div className='task-plugin-models'>
      {visible.map((model) => (
        <Tag key={model} title={model} className='task-plugin-model-tag'>
          {model}
        </Tag>
      ))}
      {hidden.length > 0 && (
        <Tooltip content={hidden.join(', ')} position='top'>
          <Tag color='grey'>+{hidden.length}</Tag>
        </Tooltip>
      )}
    </div>
  );
}

export default function TaskPlugin() {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(false);
  const [plugins, setPlugins] = useState([]);
  const [runtime, setRuntime] = useState(null);
  const [masterEnabled, setMasterEnabled] = useState(true);
  const [masterChanging, setMasterChanging] = useState(false);
  const [activeTab, setActiveTab] = useState('installed');
  const [installedView, setInstalledView] = useState(readStoredPluginView);
  const [pluginSearchDraft, setPluginSearchDraft] = useState('');
  const [pluginSearch, setPluginSearch] = useState('');
  const [pluginSourceFilter, setPluginSourceFilter] = useState('all');
  const [pluginStatusFilter, setPluginStatusFilter] = useState('all');
  const [pluginPage, setPluginPage] = useState(1);
  const [pluginPageSize, setPluginPageSize] = useState(10);
  const [showColumnSelector, setShowColumnSelector] = useState(false);
  const [visiblePluginColumns, setVisiblePluginColumns] = useState(
    readStoredPluginColumns,
  );
  const [detail, setDetail] = useState(null);
  const [detailRecord, setDetailRecord] = useState(null);
  const [uploadVisible, setUploadVisible] = useState(false);
  const [uploadSource, setUploadSource] = useState('');
  const [uploadRemark, setUploadRemark] = useState('');
  const [uploadForce, setUploadForce] = useState(false);
  const [uploadIcon, setUploadIcon] = useState('');
  const [uploadIconName, setUploadIconName] = useState('');
  const [uploadIconError, setUploadIconError] = useState('');
  const [uploadUrl, setUploadUrl] = useState('');
  const [uploadUrlLoading, setUploadUrlLoading] = useState(false);
  const [uploadUrlError, setUploadUrlError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadTargetKey, setUploadTargetKey] = useState('');
  const [sources, setSources] = useState([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [marketplaceSourceStates, setMarketplaceSourceStates] = useState({});
  const [selectedMarketplaceSourceKey, setSelectedMarketplaceSourceKey] =
    useState('');
  const [sourcesVisible, setSourcesVisible] = useState(false);
  const [marketplaceInstallTarget, setMarketplaceInstallTarget] =
    useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  useEffect(() => {
    window.localStorage.setItem('task-plugin-view', installedView);
  }, [installedView]);

  useEffect(() => {
    window.localStorage.setItem(
      'task-plugin-table-columns',
      JSON.stringify(visiblePluginColumns),
    );
  }, [visiblePluginColumns]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [listRes, runtimeRes, optionsRes] = await Promise.all([
        API.get('/api/plugin/task'),
        API.get('/api/plugin/task/runtime/status'),
        API.get('/api/option/'),
      ]);
      if (listRes?.data?.success) {
        setPlugins(listRes.data.data ?? []);
      } else {
        showError(listRes?.data?.message ?? t('加载任务插件失败'));
      }
      if (runtimeRes?.data?.success) {
        setRuntime(runtimeRes.data.data ?? null);
      }
      if (optionsRes?.data?.success) {
        const found = (optionsRes.data.data ?? []).find(
          (item) => item.key === 'TaskPluginEnabled',
        );
        setMasterEnabled(found ? found.value === 'true' : true);
      }
    } catch (error) {
      showError(t('加载任务插件失败') + ': ' + String(error));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadSources = useCallback(async () => {
    setSourcesLoading(true);
    try {
      const res = await API.get('/api/plugin/task/marketplace/sources');
      if (res?.data?.success) {
        const nextSources = Array.isArray(res.data.data) ? res.data.data : [];
        setSources(nextSources);
        setSelectedMarketplaceSourceKey((current) =>
          selectMarketplaceSourceKey(nextSources, current),
        );
        const validSourceKeys = new Set(
          nextSources.map((source) => marketplaceSourceKey(source)),
        );
        setMarketplaceSourceStates((current) =>
          Object.entries(current).reduce((next, [key, state]) => {
            if (validSourceKeys.has(key)) next[key] = state;
            return next;
          }, {}),
        );
        return nextSources;
      } else {
        showError(res?.data?.message ?? t('加载市场源失败'));
      }
    } catch (error) {
      showError(t('加载市场源失败') + ': ' + String(error));
    } finally {
      setSourcesLoading(false);
    }
    return [];
  }, [t]);

  const loadMarketplaceIndex = useCallback(async (source) => {
    const sourceKey = marketplaceSourceKey(source);
    if (!sourceKey) return;

    setMarketplaceSourceStates((current) => ({
      ...current,
      [sourceKey]: { status: 'loading' },
    }));
    try {
      const response = await fetch(source.index_url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const index = parseMarketplaceIndex(await response.json());
      setMarketplaceSourceStates((current) => ({
        ...current,
        [sourceKey]: { status: 'ready', index },
      }));
    } catch (error) {
      setMarketplaceSourceStates((current) => ({
        ...current,
        [sourceKey]: {
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        },
      }));
    }
  }, []);

  useEffect(() => {
    if (activeTab !== 'marketplace') return;
    void loadSources();
  }, [activeTab, loadSources]);

  const selectedMarketplaceSource = sources.find(
    (source) => marketplaceSourceKey(source) === selectedMarketplaceSourceKey,
  );

  useEffect(() => {
    if (activeTab !== 'marketplace' || !selectedMarketplaceSource) return;
    const sourceKey = marketplaceSourceKey(selectedMarketplaceSource);
    if (marketplaceSourceStates[sourceKey]) return;
    void loadMarketplaceIndex(selectedMarketplaceSource);
  }, [
    activeTab,
    loadMarketplaceIndex,
    marketplaceSourceStates,
    selectedMarketplaceSource,
  ]);

  const handleTabChange = (key) => {
    setActiveTab(key);
  };

  const toggleMaster = async (enabled) => {
    const previous = masterEnabled;
    setMasterEnabled(enabled);
    setMasterChanging(true);
    try {
      const res = await API.put('/api/option/', {
        key: 'TaskPluginEnabled',
        value: String(enabled),
      });
      if (res?.data?.success) {
        showSuccess(
          enabled ? t('任务插件系统已启用') : t('任务插件系统已停用'),
        );
        await load();
      } else {
        setMasterEnabled(previous);
        showError(res?.data?.message ?? t('操作失败'));
      }
    } catch (error) {
      setMasterEnabled(previous);
      showError(t('操作失败') + ': ' + String(error));
    } finally {
      setMasterChanging(false);
    }
  };

  const requestMasterToggle = (enabled) => {
    if (enabled) {
      void toggleMaster(true);
      return;
    }
    Modal.confirm({
      title: t('停用任务插件系统？'),
      content: t('停用后，内置和上传的任务插件都会停止提供服务。'),
      okText: t('停用'),
      cancelText: t('取消'),
      okType: 'danger',
      onOk: () => toggleMaster(false),
    });
  };

  const toggleStatus = async (record, enabled) => {
    try {
      const res = await API.post(`/api/plugin/task/${record.meta.key}/status`, {
        enabled,
      });
      if (res?.data?.success) {
        showSuccess(enabled ? t('已启用') : t('已停用'));
      } else {
        showError(res?.data?.message ?? t('操作失败'));
      }
    } catch (error) {
      showError(t('操作失败') + ': ' + String(error));
    } finally {
      await load();
    }
  };

  const showDetail = async (record) => {
    try {
      const res = await API.get(`/api/plugin/task/${record.meta.key}`);
      if (res?.data?.success) {
        setDetail(res.data.data ?? null);
        setDetailRecord(record);
      } else {
        showError(res?.data?.message ?? t('加载失败'));
      }
    } catch (error) {
      showError(t('加载失败') + ': ' + String(error));
    }
  };

  const upload = async () => {
    if (!uploadSource.trim()) {
      showError(t('插件源码不能为空'));
      return;
    }
    setUploading(true);
    try {
      const res = await API.post(
        '/api/plugin/task',
        buildTaskPluginUploadPayload({
          source: uploadSource,
          remark: uploadRemark,
          force: uploadForce,
          expectedKey: uploadTargetKey,
          icon: uploadIcon,
        }),
      );
      if (res?.data?.success) {
        showSuccess(t('插件已上传并编译'));
        setUploadVisible(false);
        setUploadTargetKey('');
        setUploadSource('');
        setUploadRemark('');
        setUploadForce(false);
        setUploadIcon('');
        setUploadIconName('');
        setUploadIconError('');
        setUploadUrl('');
        setUploadUrlError('');
        await load();
      } else {
        showError(res?.data?.message ?? t('上传失败'));
      }
    } catch (error) {
      showError(t('上传失败') + ': ' + String(error));
    } finally {
      setUploading(false);
    }
  };

  const openUpload = (record) => {
    setUploadTargetKey(record?.meta?.key || '');
    setUploadSource('');
    setUploadRemark('');
    setUploadForce(false);
    setUploadIcon('');
    setUploadIconName('');
    setUploadIconError('');
    setUploadUrl('');
    setUploadUrlError('');
    setUploadVisible(true);
  };

  const importPluginSource = async () => {
    const value = uploadUrl.trim();
    if (!value) {
      setUploadUrlError(t('请输入插件源码 URL'));
      return;
    }
    try {
      const parsed = new URL(value);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error(t('插件源码 URL 必须使用 HTTP(S)'));
      }
    } catch (error) {
      setUploadUrlError(error instanceof Error ? error.message : String(error));
      return;
    }
    setUploadUrlLoading(true);
    setUploadUrlError('');
    try {
      const response = await fetch(value);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const source = await response.text();
      if (new TextEncoder().encode(source).length > 1024 * 1024) {
        throw new Error(t('插件源码不能超过 1 MiB'));
      }
      setUploadSource(source);
    } catch (error) {
      setUploadUrlError(t('导入插件源码失败') + ': ' + String(error));
    } finally {
      setUploadUrlLoading(false);
    }
  };

  const handleIconFile = async (file) => {
    if (!file) return;
    const isImage =
      ['image/svg+xml', 'image/png'].includes(file.type) ||
      /\.(svg|png)$/i.test(file.name);
    if (!isImage) {
      setUploadIcon('');
      setUploadIconName('');
      setUploadIconError(t('插件图标必须是 SVG 或 PNG 文件'));
      return;
    }
    if (file.size > MAX_PLUGIN_ICON_BYTES) {
      setUploadIcon('');
      setUploadIconName('');
      setUploadIconError(t('插件图标不能超过 512 KiB'));
      return;
    }
    try {
      setUploadIcon(await readFileAsDataUrl(file));
      setUploadIconName(file.name);
      setUploadIconError('');
    } catch (error) {
      setUploadIcon('');
      setUploadIconName('');
      setUploadIconError(t('读取插件图标失败') + ': ' + String(error));
    }
  };

  const saveSources = async (nextSources = sources) => {
    setSourcesLoading(true);
    try {
      const res = await API.put(
        '/api/plugin/task/marketplace/sources',
        nextSources,
      );
      if (res?.data?.success) {
        showSuccess(t('市场源已保存'));
        const savedSources = Array.isArray(res.data.data)
          ? res.data.data
          : nextSources;
        setSources(savedSources);
        setSelectedMarketplaceSourceKey((current) =>
          selectMarketplaceSourceKey(savedSources, current),
        );
        const validSourceKeys = new Set(
          savedSources.map((source) => marketplaceSourceKey(source)),
        );
        setMarketplaceSourceStates((current) =>
          Object.entries(current).reduce((next, [key, state]) => {
            if (validSourceKeys.has(key)) next[key] = state;
            return next;
          }, {}),
        );
        setSourcesVisible(false);
      } else {
        showError(res?.data?.message ?? t('保存失败'));
      }
    } catch (error) {
      showError(t('保存失败') + ': ' + String(error));
    } finally {
      setSourcesLoading(false);
    }
  };

  const handleMarketplaceInstalled = async () => {
    setMarketplaceInstallTarget(null);
    await load();
  };

  const filteredPlugins = useMemo(() => {
    const query = pluginSearch.trim().toLowerCase();

    return plugins.filter((record) => {
      const meta = record.meta ?? {};
      const ownership = getPluginOwnershipPresentation(record).ownership;
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

      const matchesQuery = !query || searchable.includes(query);
      const matchesSource =
        pluginSourceFilter === 'all' || ownership === pluginSourceFilter;
      const matchesStatus =
        pluginStatusFilter === 'all' ||
        (pluginStatusFilter === 'enabled' && record.enabled) ||
        (pluginStatusFilter === 'disabled' && !record.enabled) ||
        (pluginStatusFilter === 'error' &&
          record.runtime_status === 'compile_failed');

      return matchesQuery && matchesSource && matchesStatus;
    });
  }, [pluginSearch, pluginSourceFilter, pluginStatusFilter, plugins]);

  const pagedPlugins = useMemo(() => {
    const start = (pluginPage - 1) * pluginPageSize;
    return filteredPlugins.slice(start, start + pluginPageSize);
  }, [filteredPlugins, pluginPage, pluginPageSize]);

  useEffect(() => {
    const pageCount = Math.max(
      1,
      Math.ceil(filteredPlugins.length / pluginPageSize),
    );
    if (pluginPage > pageCount) setPluginPage(pageCount);
  }, [filteredPlugins.length, pluginPage, pluginPageSize]);

  const applyPluginSearch = () => {
    setPluginSearch(pluginSearchDraft.trim());
    setPluginPage(1);
  };

  const resetPluginFilters = () => {
    setPluginSearchDraft('');
    setPluginSearch('');
    setPluginSourceFilter('all');
    setPluginStatusFilter('all');
    setPluginPage(1);
  };

  const updateVisiblePluginColumn = (key, visible) => {
    if (key === '__all__') {
      setVisiblePluginColumns(
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
    setVisiblePluginColumns((current) => ({ ...current, [key]: visible }));
  };

  const resetVisiblePluginColumns = () => {
    setVisiblePluginColumns(DEFAULT_VISIBLE_PLUGIN_COLUMNS);
  };

  const columns = [
    {
      title: t('插件'),
      width: 238,
      key: 'plugin',
      render: (_, record) => (
        <div className='task-plugin-identity'>
          <PluginAvatar record={record} />
          <div className='task-plugin-identity-copy'>
            <Typography.Text strong ellipsis={{ showTooltip: true }}>
              {record.meta?.name ?? record.meta?.key}
            </Typography.Text>
            <div className='task-plugin-key-row'>
              <Typography.Text
                type='tertiary'
                size='small'
                code
                ellipsis={{ showTooltip: true }}
              >
                {record.meta?.key}
              </Typography.Text>
              <Tooltip content={t('复制插件标识')} position='top'>
                <Button
                  aria-label={t('复制插件标识')}
                  icon={<Copy size={13} />}
                  size='small'
                  theme='borderless'
                  type='tertiary'
                  onClick={() => {
                    void copy(record.meta?.key || '');
                    showSuccess(t('已复制'));
                  }}
                />
              </Tooltip>
            </div>
          </div>
        </div>
      ),
    },
    {
      title: t('描述'),
      width: 220,
      key: 'description',
      render: (_, record) => (
        <Typography.Text
          type='tertiary'
          size='small'
          ellipsis={{ showTooltip: true }}
        >
          {localizedText(record.meta?.description) || '-'}
        </Typography.Text>
      ),
    },
    {
      title: t('模型'),
      width: 260,
      key: 'models',
      render: (_, record) => <ModelTags models={record.meta?.models ?? []} />,
    },
    {
      title: t('版本'),
      width: 112,
      key: 'version',
      render: (_, record) => (
        <div className='task-plugin-version'>
          <Typography.Text size='small' code>
            v{record.meta?.version ?? '-'}
          </Typography.Text>
        </div>
      ),
    },
    {
      title: t('来源'),
      width: 128,
      key: 'source',
      render: (_, record) => sourceTag(record, t),
    },
    {
      title: t('运行状态'),
      width: 124,
      key: 'runtime',
      render: (_, record) => runtimeTag(record, t),
    },
    {
      title: t('启用'),
      width: 72,
      key: 'enabled',
      render: (_, record) => (
        <Switch
          checked={record.enabled}
          size='small'
          aria-label={t('切换插件 {{key}}', { key: record.meta?.key })}
          onChange={(checked) => void toggleStatus(record, checked)}
        />
      ),
    },
    {
      title: t('操作'),
      width: 72,
      key: 'actions',
      fixed: 'right',
      align: 'center',
      render: (_, record) => (
        <PluginActionsMenu
          record={record}
          onDetails={(plugin) => void showDetail(plugin)}
          onUploadVersion={openUpload}
          onDeleteVersion={setDeleteTarget}
        />
      ),
    },
  ];

  const renderPluginCard = (record) => (
    <Card
      key={`${record.meta?.key ?? '?'}@${record.meta?.version ?? '?'}`}
      className='task-plugin-installed-card'
    >
      <div className='task-plugin-installed-card-header'>
        <PluginAvatar record={record} />
        <div className='task-plugin-identity-copy'>
          <Typography.Text strong ellipsis={{ showTooltip: true }}>
            {record.meta?.name ?? record.meta?.key}
          </Typography.Text>
          <Typography.Text
            type='tertiary'
            size='small'
            ellipsis={{ showTooltip: true }}
          >
            {record.meta?.key}
          </Typography.Text>
        </div>
        <PluginActionsMenu
          record={record}
          onDetails={(plugin) => void showDetail(plugin)}
          onUploadVersion={openUpload}
          onDeleteVersion={setDeleteTarget}
        />
      </div>
      <div className='task-plugin-card-badges'>
        {sourceTag(record, t)}
        {runtimeTag(record, t)}
        <Tag color='grey'>v{record.meta?.version ?? '-'}</Tag>
      </div>
      <Typography.Text
        type='tertiary'
        size='small'
        ellipsis={{ showTooltip: true }}
      >
        {localizedText(record.meta?.description) || t('未提供插件描述')}
      </Typography.Text>
      <div className='task-plugin-card-models'>
        <Typography.Text type='tertiary' size='small'>
          {t('模型')}
        </Typography.Text>
        <ModelTags models={record.meta?.models ?? []} />
      </div>
      <div className='task-plugin-card-footer'>
        <Typography.Text type='tertiary' size='small'>
          {t('启用')}
        </Typography.Text>
        <Switch
          checked={record.enabled}
          size='small'
          onChange={(checked) => void toggleStatus(record, checked)}
        />
      </div>
    </Card>
  );

  const marketplaceSourceOptions = sources.map((source) => ({
    value: marketplaceSourceKey(source),
    label: source.name || marketplaceSourceKey(source),
  }));

  return (
    <div className='mt-[64px] px-2 task-plugin-page'>
      <CardPro
        type='type3'
        className='task-plugin-card-pro'
        tabsArea={
          <Tabs
            activeKey={activeTab}
            onChange={handleTabChange}
            type='card'
            collapsible
            className='mb-2 task-plugin-tabs'
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
                    {plugins.length}
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
                    {sources.length}
                  </Tag>
                </span>
              }
            />
          </Tabs>
        }
        actionsArea={
          <div className='task-plugin-management-row'>
            <div className='task-plugin-management-heading'>
              <Typography.Text strong>
                {activeTab === 'installed' ? t('任务插件') : t('插件市场')}
              </Typography.Text>
              {activeTab === 'installed' &&
              runtime?.current_generation !== undefined ? (
                <Tag color='grey' size='small'>
                  {t('运行时')} v{runtime.current_generation}
                </Tag>
              ) : null}
            </div>
            {activeTab === 'installed' ? (
              <div className='task-plugin-master-switch'>
                <Typography.Text strong>{t('系统启用')}</Typography.Text>
                <Tooltip
                  content={t('控制全部内置和上传插件是否提供服务')}
                  position='bottom'
                >
                  <Switch
                    checked={masterEnabled}
                    loading={masterChanging}
                    aria-label={t('系统启用')}
                    onChange={requestMasterToggle}
                  />
                </Tooltip>
              </div>
            ) : null}
          </div>
        }
        searchArea={
          <div className='task-plugin-filter-row'>
            <div className='task-plugin-filter-tools'>
              {activeTab === 'installed' ? (
                <Button
                  size='small'
                  theme='light'
                  type='primary'
                  onClick={() => openUpload()}
                >
                  {t('上传插件')}
                </Button>
              ) : (
                <Button
                  size='small'
                  theme='light'
                  type='primary'
                  onClick={() => setSourcesVisible(true)}
                >
                  {t('管理市场源')}
                </Button>
              )}
              <Button
                size='small'
                theme='light'
                type='tertiary'
                loading={activeTab === 'installed' ? loading : sourcesLoading}
                onClick={() =>
                  void (activeTab === 'installed' ? load() : loadSources())
                }
              >
                {t('刷新')}
              </Button>
              {activeTab === 'installed' ? (
                <>
                  <Button
                    size='small'
                    theme='light'
                    type='tertiary'
                    onClick={() => setShowColumnSelector(true)}
                  >
                    {t('列设置')}
                  </Button>
                  <div
                    className='task-plugin-view-toggle'
                    role='group'
                    aria-label={t('视图切换')}
                  >
                    <Tooltip content={t('表格视图')} position='top'>
                      <Button
                        size='small'
                        theme={
                          installedView === 'table' ? 'light' : 'borderless'
                        }
                        type={
                          installedView === 'table' ? 'primary' : 'tertiary'
                        }
                        aria-label={t('表格视图')}
                        icon={<List size={15} />}
                        onClick={() => setInstalledView('table')}
                      />
                    </Tooltip>
                    <Tooltip content={t('卡片视图')} position='top'>
                      <Button
                        size='small'
                        theme={
                          installedView === 'cards' ? 'light' : 'borderless'
                        }
                        type={
                          installedView === 'cards' ? 'primary' : 'tertiary'
                        }
                        aria-label={t('卡片视图')}
                        icon={<LayoutGrid size={15} />}
                        onClick={() => setInstalledView('cards')}
                      />
                    </Tooltip>
                  </div>
                </>
              ) : null}
            </div>
            {activeTab === 'installed' ? (
              <div className='task-plugin-filter-controls'>
                <Input
                  size='small'
                  value={pluginSearchDraft}
                  prefix={<Search size={15} />}
                  placeholder={t('插件名称、Key、描述或模型')}
                  showClear
                  onChange={setPluginSearchDraft}
                  onEnterPress={applyPluginSearch}
                />
                <Select
                  size='small'
                  value={pluginSourceFilter}
                  optionList={[
                    { label: t('全部来源'), value: 'all' },
                    { label: t('出厂插件'), value: 'factory' },
                    { label: t('第三方插件'), value: 'third_party' },
                    {
                      label: t('覆盖出厂版本'),
                      value: 'override_over_factory',
                    },
                  ]}
                  onChange={(value) => {
                    setPluginSourceFilter(
                      typeof value === 'string' ? value : 'all',
                    );
                    setPluginPage(1);
                  }}
                />
                <Select
                  size='small'
                  value={pluginStatusFilter}
                  optionList={[
                    { label: t('全部状态'), value: 'all' },
                    { label: t('已启用'), value: 'enabled' },
                    { label: t('已停用'), value: 'disabled' },
                    { label: t('编译异常'), value: 'error' },
                  ]}
                  onChange={(value) => {
                    setPluginStatusFilter(
                      typeof value === 'string' ? value : 'all',
                    );
                    setPluginPage(1);
                  }}
                />
                <Button
                  size='small'
                  type='tertiary'
                  onClick={applyPluginSearch}
                >
                  {t('查询')}
                </Button>
                <Button
                  size='small'
                  type='tertiary'
                  onClick={resetPluginFilters}
                >
                  {t('重置')}
                </Button>
              </div>
            ) : sources.length > 1 ? (
              <div className='task-plugin-filter-controls'>
                <Select
                  aria-label={t('选择市场源')}
                  size='small'
                  value={marketplaceSourceKey(selectedMarketplaceSource)}
                  optionList={marketplaceSourceOptions}
                  placeholder={t('选择市场源')}
                  className='task-plugin-marketplace-source-select'
                  onChange={(value) => {
                    if (typeof value === 'string') {
                      setSelectedMarketplaceSourceKey(value);
                    }
                  }}
                />
              </div>
            ) : null}
          </div>
        }
        paginationArea={
          activeTab === 'installed'
            ? createCardProPagination({
                currentPage: pluginPage,
                pageSize: pluginPageSize,
                total: filteredPlugins.length,
                onPageChange: setPluginPage,
                onPageSizeChange: (size) => {
                  setPluginPageSize(size);
                  setPluginPage(1);
                },
                isMobile,
                pageSizeOpts: [10, 20, 50],
                t,
              })
            : null
        }
        t={t}
      >
        {activeTab === 'installed' &&
          runtime?.plugin_errors &&
          Object.keys(runtime.plugin_errors).length > 0 && (
            <div className='task-plugin-errors'>
              {Object.entries(runtime.plugin_errors).map(([key, message]) => (
                <Banner
                  key={key}
                  type='error'
                  closeIcon={null}
                  description={`${key}: ${message}`}
                />
              ))}
            </div>
          )}

        <div className='task-plugin-panel'>
          {activeTab === 'installed' ? (
            installedView === 'table' ? (
              <CardTable
                className='task-plugin-table'
                columns={columns.filter(
                  (column) => visiblePluginColumns[column.key] !== false,
                )}
                dataSource={pagedPlugins}
                rowKey={(record) =>
                  `${record.meta?.key ?? '?'}@${record.meta?.version ?? '?'}`
                }
                loading={loading}
                hidePagination
                scroll={{ x: 'max-content' }}
                size='small'
                empty={
                  <Empty
                    title={
                      filteredPlugins.length
                        ? t('当前页暂无插件')
                        : t('搜索无结果')
                    }
                  />
                }
              />
            ) : (
              <div className='task-plugin-installed-grid'>
                {loading ? (
                  <Empty title={t('正在加载插件...')} />
                ) : pagedPlugins.length ? (
                  pagedPlugins.map(renderPluginCard)
                ) : (
                  <Empty
                    title={
                      filteredPlugins.length
                        ? t('当前页暂无插件')
                        : t('搜索无结果')
                    }
                  />
                )}
              </div>
            )
          ) : (
            <PluginMarketplacePanel
              sources={sources}
              sourceStates={marketplaceSourceStates}
              sourcesLoading={sourcesLoading}
              selectedSourceKey={selectedMarketplaceSourceKey}
              installed={plugins}
              onInstall={setMarketplaceInstallTarget}
              onRetrySource={(source) => void loadMarketplaceIndex(source)}
            />
          )}
        </div>
      </CardPro>

      <TaskPluginColumnSelectorModal
        visible={showColumnSelector}
        columns={columns}
        visibleColumns={visiblePluginColumns}
        onChange={updateVisiblePluginColumn}
        onReset={resetVisiblePluginColumns}
        onCancel={() => setShowColumnSelector(false)}
        t={t}
      />
      <PluginMarketplaceSourcesModal
        visible={sourcesVisible}
        sources={sources}
        loading={sourcesLoading}
        onCancel={() => setSourcesVisible(false)}
        onSave={(nextSources) => void saveSources(nextSources)}
      />
      <MarketplaceInstallDialog
        visible={Boolean(marketplaceInstallTarget)}
        target={marketplaceInstallTarget}
        onCancel={() => setMarketplaceInstallTarget(null)}
        onInstalled={handleMarketplaceInstalled}
      />

      <PluginDetailSheet
        detail={detail}
        listRecord={detailRecord}
        visible={Boolean(detail)}
        onCancel={() => {
          setDetail(null);
          setDetailRecord(null);
        }}
        onPluginChanged={() => load()}
      />

      <PluginDeleteVersionModal
        record={deleteTarget}
        visible={Boolean(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
        onDeleted={async () => {
          setDeleteTarget(null);
          await load();
        }}
      />

      <Modal
        title={
          uploadTargetKey
            ? t('上传新版本：{{key}}', { key: uploadTargetKey })
            : t('上传插件')
        }
        visible={uploadVisible}
        onCancel={() => {
          setUploadVisible(false);
          setUploadTargetKey('');
          setUploadUrlError('');
        }}
        footer={null}
        width={720}
      >
        <div className='task-plugin-upload-form'>
          <Banner
            type='warning'
            closeIcon={null}
            icon={<TriangleAlert size={16} />}
            description={t(
              '第三方插件由管理员信任并执行，可能读取渠道配置并影响上游请求。请先审阅源码，确认后再上传和启用。',
            )}
          />
          {uploadTargetKey ? (
            <Typography.Paragraph type='tertiary'>
              {t(
                '上传源码中的插件标识应保持为 {{key}}，系统会将其作为新版本接入现有插件。',
                {
                  key: uploadTargetKey,
                },
              )}
            </Typography.Paragraph>
          ) : null}
          <div className='task-plugin-upload-field'>
            <Typography.Text strong>{t('从文件上传')}</Typography.Text>
            <div className='task-plugin-file-picker'>
              <FileCode2 size={18} aria-hidden='true' />
              <Typography.Text type='tertiary' size='small'>
                {t('选择单文件 JavaScript 插件，源码会展示在下方供检查')}
              </Typography.Text>
              <input
                className='task-plugin-native-file-input'
                type='file'
                accept='.js,text/javascript'
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    if (file.size > 1024 * 1024) {
                      showError(t('插件源码不能超过 1 MiB'));
                    } else {
                      void file.text().then(setUploadSource);
                    }
                  }
                  event.target.value = '';
                }}
              />
            </div>
          </div>
          <div className='task-plugin-upload-field'>
            <Typography.Text strong>{t('URL 导入')}</Typography.Text>
            <div className='task-plugin-url-import'>
              <Input
                value={uploadUrl}
                onChange={(value) => {
                  setUploadUrl(value);
                  setUploadUrlError('');
                }}
                placeholder={t('https://example.com/plugin.js')}
                suffix={
                  <Button
                    theme='borderless'
                    type='primary'
                    size='small'
                    icon={<Link2 size={15} />}
                    loading={uploadUrlLoading}
                    onClick={() => void importPluginSource()}
                  >
                    {t('导入')}
                  </Button>
                }
              />
            </div>
            {uploadUrlError ? (
              <Typography.Text type='danger' size='small'>
                {uploadUrlError}
              </Typography.Text>
            ) : null}
          </div>
          <div className='task-plugin-upload-field'>
            <Typography.Text strong>{t('插件源码')}</Typography.Text>
            <TextArea
              value={uploadSource}
              onChange={setUploadSource}
              autosize={{ minRows: 12, maxRows: 22 }}
              placeholder={t('粘贴单文件插件源码（export const meta = ...）')}
            />
          </div>
          <div className='task-plugin-upload-field'>
            <Typography.Text strong>{t('插件图标')}</Typography.Text>
            <div className='task-plugin-icon-upload-row'>
              {uploadIcon ? (
                <PluginIcon
                  record={{ meta: { key: 'upload', icon: uploadIcon } }}
                  size={40}
                />
              ) : null}
              <input
                className='task-plugin-native-file-input'
                type='file'
                accept='.svg,.png,image/svg+xml,image/png'
                onChange={(event) => {
                  void handleIconFile(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
              {uploadIcon ? (
                <Button
                  theme='borderless'
                  type='tertiary'
                  onClick={() => {
                    setUploadIcon('');
                    setUploadIconName('');
                    setUploadIconError('');
                  }}
                >
                  {t('移除')}
                </Button>
              ) : null}
            </div>
            <Typography.Text
              type={uploadIconError ? 'danger' : 'tertiary'}
              size='small'
            >
              {uploadIconError ||
                uploadIconName ||
                t('可选，支持 SVG/PNG，最大 512 KiB')}
            </Typography.Text>
          </div>
          <div className='task-plugin-upload-field'>
            <Typography.Text strong>{t('备注')}</Typography.Text>
            <Input
              value={uploadRemark}
              onChange={setUploadRemark}
              placeholder={t('备注（可选）')}
            />
          </div>
          <Checkbox
            checked={uploadForce}
            onChange={(event) => setUploadForce(event.target.checked)}
          >
            {t('跳过路由冲突预检')}
          </Checkbox>
          <div className='task-plugin-upload-actions'>
            <Button
              theme='solid'
              type='primary'
              icon={<Upload size={16} />}
              loading={uploading}
              onClick={() => void upload()}
            >
              {t('上传并编译')}
            </Button>
            <Typography.Text type='tertiary' size='small'>
              {t('上传前会校验声明、导出和路由冲突。')}
            </Typography.Text>
          </div>
        </div>
      </Modal>
    </div>
  );
}
