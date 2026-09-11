/*
 * 任务插件管理页 —— 独立左侧导航页。
 *
 * 页面内容结构自官方 v1.0.0-rc.37 web/src/features/task-plugins/ 移植：
 *   顶部（标题 + 系统启用开关 TaskPluginEnabled + 上传/刷新）
 *   页签：已安装（插件表格） / 市场源（P2：仅源管理，安装流另行走发布门）
 *   详情侧栏：概览 / 计费参数（usageSchema + 示例） / 插件源码 / 版本历史
 * 壳适配本 Fork 的 jsx + Semi UI 结构（官方为 shadcn/ui TSX）。
 *
 * 后端 API（RootAuth，controller/task_plugin.go）：
 *   GET/POST/PUT /api/plugin/task、GET /api/plugin/task/runtime/status、
 *   GET /api/plugin/task/:key[?version=]、GET /:key/versions、POST /:key/activate、
 *   POST /:key/status、POST /:key/dryrun、DELETE /:key/versions/:version、
 *   GET/PUT /api/plugin/task/marketplace/sources
 */
import React, { useEffect, useState } from 'react';
import {
  Banner,
  Button,
  Checkbox,
  Descriptions,
  Modal,
  Popconfirm,
  Select,
  SideSheet,
  Switch,
  Table,
  Tabs,
  Tag,
  TextArea,
  Typography,
} from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';
import { API, showError, showSuccess } from '../../helpers';

const UNIT_LABELS = {
  second: '秒',
  count: '次',
  token: 'token',
  credit: 'credit',
};

function layerOf(record) {
  if (!record.source) return 'factory';
  return record.source === 'override_over_factory' ? 'override_over_factory' : 'override';
}

function runtimeTag(record, t) {
  const status = record.runtime_status;
  const map = {
    registered: { color: 'green', text: t('已注册') },
    compile_failed: { color: 'red', text: t('编译失败') },
    disabled_fallback: { color: 'orange', text: t('已停用·内置兜底') },
    not_registered: { color: 'grey', text: t('未注册') },
  };
  const info = map[status] ?? { color: 'grey', text: status };
  return (
    <Tag color={info.color} title={record.runtime_error ?? undefined}>
      {info.text}
    </Tag>
  );
}

function renderSchemaTable(schema, t) {
  if (!schema || Object.keys(schema).length === 0) {
    return <Typography.Text type='tertiary'>{t('未声明 usageSchema')}</Typography.Text>;
  }
  return (
    <Table
      columns={[
        { title: t('字段'), dataIndex: 'field', width: 140 },
        {
          title: t('类型'),
          width: 140,
          render: (text, record) => (
            <Tag>
              {record.def.type}
              {record.def.unit ? ` (${UNIT_LABELS[record.def.unit] ?? record.def.unit})` : ''}
            </Tag>
          ),
        },
        {
          title: t('枚举/约束'),
          render: (text, record) =>
            record.def.enum?.length ? (
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {record.def.enum.map((value) => (
                  <Tag key={value}>{value}</Tag>
                ))}
              </div>
            ) : (
              <span>-</span>
            ),
        },
        {
          title: t('说明'),
          render: (text, record) => {
            const desc = record.def.description;
            if (!desc) return '-';
            return typeof desc === 'string' ? desc : (desc.zh ?? desc.en ?? '-');
          },
        },
      ]}
      dataSource={Object.entries(schema).map(([field, def]) => ({ key: field, field, def }))}
      pagination={false}
      size='small'
    />
  );
}

export default function TaskPlugin() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [plugins, setPlugins] = useState([]);
  const [runtime, setRuntime] = useState(null);
  const [masterEnabled, setMasterEnabled] = useState(true);
  const [detail, setDetail] = useState(null);
  const [detailTab, setDetailTab] = useState('overview');
  const [versions, setVersions] = useState(null);
  const [uploadVisible, setUploadVisible] = useState(false);
  const [uploadSource, setUploadSource] = useState('');
  const [uploadRemark, setUploadRemark] = useState('');
  const [uploadForce, setUploadForce] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dryRun, setDryRun] = useState(null);
  const [dryRunHook, setDryRunHook] = useState('extractUsage');
  const [dryRunArgs, setDryRunArgs] = useState('[]');
  const [dryRunOutput, setDryRunOutput] = useState('');
  const [sources, setSources] = useState([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);

  const load = async () => {
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
  };

  useEffect(() => {
    load();
  }, []);

  const toggleMaster = async (enabled) => {
    const previous = masterEnabled;
    setMasterEnabled(enabled);
    try {
      const res = await API.put('/api/option/', {
        key: 'TaskPluginEnabled',
        value: String(enabled),
      });
      if (res?.data?.success) {
        showSuccess(enabled ? t('任务插件系统已启用') : t('任务插件系统已停用'));
        load();
      } else {
        setMasterEnabled(previous);
        showError(res?.data?.message ?? t('操作失败'));
      }
    } catch (error) {
      setMasterEnabled(previous);
      showError(t('操作失败') + ': ' + String(error));
    }
  };

  const activate = async (key, version) => {
    try {
      const res = await API.post(`/api/plugin/task/${key}/activate`, { version });
      if (res?.data?.success) {
        showSuccess(t('已激活') + ` ${key}@${version}`);
        load();
        return true;
      }
      showError(res?.data?.message ?? t('操作失败'));
      return false;
    } catch (error) {
      showError(t('操作失败') + ': ' + String(error));
      return false;
    }
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
      load();
    }
  };

  const deleteVersion = async (record) => {
    if ((record.in_flight_count ?? 0) > 0) {
      showError(t('插件仍有在途任务，暂不能删除'));
      return;
    }
    try {
      const res = await API.delete(
        `/api/plugin/task/${record.meta.key}/versions/${record.meta.version}`,
      );
      if (res?.data?.success) {
        showSuccess(t('已删除版本'));
        load();
      } else {
        showError(res?.data?.message ?? t('操作失败'));
      }
    } catch (error) {
      showError(t('操作失败') + ': ' + String(error));
    }
  };

  const showDetail = async (record) => {
    setDetailTab('overview');
    try {
      const res = await API.get(`/api/plugin/task/${record.meta.key}`);
      if (res?.data?.success) {
        setDetail(res.data.data ?? null);
      } else {
        showError(res?.data?.message ?? t('加载失败'));
      }
    } catch (error) {
      showError(t('加载失败') + ': ' + String(error));
    }
  };

  const showVersions = async (record) => {
    try {
      const res = await API.get(`/api/plugin/task/${record.meta.key}/versions`);
      if (res?.data?.success) {
        setVersions({ key: record.meta.key, list: res.data.data ?? [] });
      } else {
        showError(res?.data?.message ?? t('加载失败'));
      }
    } catch (error) {
      showError(t('加载失败') + ': ' + String(error));
    }
  };

  const runDryRun = async (record) => {
    setDryRun(record);
    setDryRunOutput('');
    try {
      let args;
      try {
        args = JSON.parse(dryRunArgs || '[]');
      } catch {
        showError(t('dry run 参数必须是 JSON 数组'));
        return;
      }
      const res = await API.post(`/api/plugin/task/${record.meta.key}/dryrun`, {
        hook: dryRunHook,
        args,
      });
      if (res?.data?.success) {
        setDryRunOutput(JSON.stringify(res.data.data, null, 2));
      } else {
        setDryRunOutput('ERROR: ' + (res?.data?.message ?? t('执行失败')));
      }
    } catch (error) {
      setDryRunOutput('ERROR: ' + String(error));
    }
  };

  const upload = async () => {
    if (!uploadSource.trim()) {
      showError(t('插件源码不能为空'));
      return;
    }
    setUploading(true);
    try {
      const res = await API.post('/api/plugin/task', {
        source: uploadSource,
        remark: uploadRemark,
        force: uploadForce,
      });
      if (res?.data?.success) {
        showSuccess(t('插件已上传并编译'));
        setUploadVisible(false);
        setUploadSource('');
        setUploadRemark('');
        load();
      } else {
        showError(res?.data?.message ?? t('上传失败'));
      }
    } catch (error) {
      showError(t('上传失败') + ': ' + String(error));
    } finally {
      setUploading(false);
    }
  };

  const loadSources = async () => {
    setSourcesLoading(true);
    try {
      const res = await API.get('/api/plugin/task/marketplace/sources');
      if (res?.data?.success) {
        setSources(res.data.data ?? []);
      } else {
        showError(res?.data?.message ?? t('加载市场源失败'));
      }
    } catch (error) {
      showError(t('加载市场源失败') + ': ' + String(error));
    } finally {
      setSourcesLoading(false);
    }
  };

  const saveSources = async () => {
    setSourcesLoading(true);
    try {
      const res = await API.put('/api/plugin/task/marketplace/sources', sources);
      if (res?.data?.success) {
        showSuccess(t('市场源已保存'));
      } else {
        showError(res?.data?.message ?? t('保存失败'));
      }
    } catch (error) {
      showError(t('保存失败') + ': ' + String(error));
    } finally {
      setSourcesLoading(false);
    }
  };

  const columns = [
    {
      title: t('插件'),
      render: (text, record) => (
        <div>
          <Typography.Text strong>
            {record.meta?.name ?? record.meta?.key}
          </Typography.Text>
          <div>
            <Typography.Text
              type='tertiary'
              size='small'
              copyable={{ content: record.meta?.key }}
            >
              {record.meta?.key}
            </Typography.Text>
          </div>
          {record.meta?.description && (
            <Typography.Text
              type='tertiary'
              size='small'
              ellipsis={{ showTooltip: true }}
              style={{ maxWidth: 260, display: 'block' }}
            >
              {typeof record.meta.description === 'string'
                ? record.meta.description
                : (record.meta.description.zh ?? record.meta.description.en ?? '')}
            </Typography.Text>
          )}
        </div>
      ),
    },
    {
      title: t('激活版本'),
      width: 120,
      render: (text, record) => {
        const stale =
          record.factory_meta && record.factory_meta.version !== record.meta?.version;
        return (
          <div>
            <Typography.Text>{record.meta?.version ?? '-'}</Typography.Text>
            {stale ? (
              <div>
                <Typography.Text type='warning' size='small'>
                  {t('内置已有')} {record.factory_meta.version}
                </Typography.Text>
              </div>
            ) : null}
          </div>
        );
      },
    },
    {
      title: t('来源'),
      width: 120,
      render: (text, record) => {
        const layer = layerOf(record);
        return (
          <Tag color={layer === 'factory' ? 'blue' : 'purple'}>
            {layer === 'factory'
              ? t('内置')
              : layer === 'override'
                ? t('上传版本')
                : t('上传覆盖内置')}
          </Tag>
        );
      },
    },
    {
      title: t('渠道类型'),
      width: 110,
      render: (text, record) => {
        const types = record.meta?.channelTypes ?? [];
        return types.length ? (
          <Tag>{types.length === 1 ? types[0] : `${types[0]} +${types.length - 1}`}</Tag>
        ) : (
          <Tag>{t('通用')}</Tag>
        );
      },
    },
    {
      title: t('模型'),
      render: (text, record) => {
        const models = record.meta?.models ?? [];
        const shown = models.slice(0, 3);
        return (
          <>
            {shown.map((model) => (
              <Tag key={model} style={{ margin: 2 }}>
                {model}
              </Tag>
            ))}
            {models.length > 3 ? (
              <Tag color='grey' style={{ margin: 2 }}>
                +{models.length - 3}
              </Tag>
            ) : null}
          </>
        );
      },
    },
    {
      title: t('启用'),
      width: 90,
      render: (text, record) => (
        <Switch
          checked={record.enabled}
          size='small'
          onChange={(checked) => toggleStatus(record, checked)}
        />
      ),
    },
    {
      title: t('运行状态'),
      width: 130,
      render: (text, record) => runtimeTag(record, t),
    },
    { title: t('绑定渠道'), dataIndex: 'channel_count', width: 90 },
    { title: t('在途任务'), dataIndex: 'in_flight_count', width: 90 },
    {
      title: t('操作'),
      width: 300,
      render: (text, record) => (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Button size='small' onClick={() => showDetail(record)}>
            {t('详情')}
          </Button>
          {!record.active && (
            <Button
              size='small'
              type='primary'
              onClick={() => activate(record.meta.key, record.meta.version)}
            >
              {t('激活')}
            </Button>
          )}
          <Button size='small' onClick={() => runDryRun(record)}>
            {t('Dry Run')}
          </Button>
          <Button size='small' onClick={() => showVersions(record)}>
            {t('版本')}
          </Button>
          <Popconfirm
            title={t('确认删除该版本？')}
            onConfirm={() => deleteVersion(record)}
          >
            <Button size='small' type='danger'>
              {t('删除')}
            </Button>
          </Popconfirm>
        </div>
      ),
    },
  ];

  const detailMeta = detail?.meta ?? {};

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Typography.Title heading={4} style={{ margin: 0 }}>
            {t('任务插件')}
          </Typography.Title>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Typography.Text type='tertiary'>{t('系统启用')}</Typography.Text>
            <Switch checked={masterEnabled} onChange={toggleMaster} />
          </div>
          {runtime && (
            <Tag color='lightBlue'>
              {t('运行时')} generation {runtime.current_generation}
            </Tag>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button theme='solid' type='primary' onClick={() => setUploadVisible(true)}>
            {t('上传插件版本')}
          </Button>
          <Button onClick={load} loading={loading}>
            {t('刷新')}
          </Button>
        </div>
      </div>

      {runtime?.plugin_errors && Object.keys(runtime.plugin_errors).length > 0 && (
        <div style={{ marginBottom: 12 }}>
          {Object.entries(runtime.plugin_errors).map(([key, message]) => (
            <Banner
              key={key}
              type='alert'
              closeIcon={null}
              description={`${key}: ${message}`}
              style={{ marginBottom: 6 }}
            />
          ))}
        </div>
      )}

      <Banner
        type='info'
        closeIcon={null}
        description={t(
          '任务插件承载视频等异步任务的协议解析与用量事实提取；插件只做数据变换，网络、凭据、预扣与结算仍由宿主掌管。定价请在 系统设置 → 分组与模型定价设置 → 任务计费 中配置。',
        )}
        style={{ marginBottom: 12 }}
      />

      <Tabs type='line' defaultActiveKey='installed'>
        <Tabs.TabPane tab={t('已安装插件')} itemKey='installed'>
          <Table
            columns={columns}
            dataSource={plugins}
            rowKey={(record) => (record.meta?.key ?? '?') + '@' + (record.meta?.version ?? '?')}
            loading={loading}
            pagination={false}
            size='small'
          />
        </Tabs.TabPane>
        <Tabs.TabPane tab={t('市场源')} itemKey='marketplace'>
          <Banner
            type='warning'
            closeIcon={null}
            description={t(
              '市场安装流属于 P2 发布门：外部来源插件必须显式上传并预检，不会自动激活。此处仅管理索引源。',
            )}
            style={{ marginBottom: 12 }}
          />
          <Button
            onClick={() => setSources([...sources, { name: '', index_url: '' }])}
            style={{ marginBottom: 8 }}
          >
            {t('添加市场源')}
          </Button>
          <Table
            columns={[
              {
                title: t('名称'),
                render: (text, record, index) => (
                  <TextArea
                    value={record.name}
                    onChange={(value) =>
                      setSources((prev) =>
                        prev.map((item, i) => (i === index ? { ...item, name: value } : item)),
                      )
                    }
                    autosize
                  />
                ),
              },
              {
                title: t('索引地址 (index_url)'),
                render: (text, record, index) => (
                  <TextArea
                    value={record.index_url}
                    onChange={(value) =>
                      setSources((prev) =>
                        prev.map((item, i) => (i === index ? { ...item, index_url: value } : item)),
                      )
                    }
                    autosize
                  />
                ),
              },
              {
                title: t('操作'),
                width: 90,
                render: (text, record, index) => (
                  <Button
                    size='small'
                    type='danger'
                    onClick={() => setSources((prev) => prev.filter((_, i) => i !== index))}
                  >
                    {t('移除')}
                  </Button>
                ),
              },
            ]}
            dataSource={sources}
            rowKey={(record, index) => String(index)}
            loading={sourcesLoading}
            pagination={false}
            size='small'
          />
          <Button
            theme='solid'
            type='primary'
            loading={sourcesLoading}
            onClick={saveSources}
            style={{ marginTop: 8 }}
          >
            {t('保存市场源')}
          </Button>
        </Tabs.TabPane>
      </Tabs>

      <SideSheet
        title={detail ? `${detailMeta.name ?? detailMeta.key} @ ${detailMeta.version ?? ''}` : ''}
        visible={Boolean(detail)}
        onCancel={() => setDetail(null)}
        width={720}
        size='large'
      >
        {detail && (
          <>
            <Tabs activeKey={detailTab} onChange={setDetailTab}>
              <Tabs.TabPane tab={t('概览')} itemKey='overview'>
                <Descriptions
                  row
                  size='small'
                  data={[
                    { key: t('标识'), value: detailMeta.key ?? '-' },
                    { key: t('版本'), value: detailMeta.version ?? '-' },
                    { key: t('作者'), value: detailMeta.author?.name ?? '-' },
                    {
                      key: t('来源层'),
                      value:
                        detail.layer === 'factory'
                          ? t('内置')
                          : detail.layer === 'override'
                            ? t('上传版本')
                            : detail.layer,
                    },
                  ]}
                />
                <Typography.Title heading={6} style={{ marginTop: 12 }}>
                  {t('模型')}
                </Typography.Title>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {(detailMeta.models ?? []).map((model) => (
                    <Tag key={model}>{model}</Tag>
                  ))}
                </div>
                <Typography.Title heading={6} style={{ marginTop: 12 }}>
                  {t('协议声明')}
                </Typography.Title>
                <pre style={{ fontSize: 12, maxHeight: 200, overflow: 'auto' }}>
                  {JSON.stringify(detailMeta.protocols ?? [], null, 2)}
                </pre>
                <Typography.Title heading={6} style={{ marginTop: 12 }}>
                  {t('动态路由')}
                </Typography.Title>
                <pre style={{ fontSize: 12, maxHeight: 200, overflow: 'auto' }}>
                  {JSON.stringify(detailMeta.routes ?? [], null, 2)}
                </pre>
              </Tabs.TabPane>
              <Tabs.TabPane tab={t('计费参数')} itemKey='billing'>
                {renderSchemaTable(detailMeta.usageSchema, t)}
                <Typography.Title heading={6} style={{ marginTop: 12 }}>
                  {t('用量示例')}
                </Typography.Title>
                <pre style={{ fontSize: 12, maxHeight: 240, overflow: 'auto' }}>
                  {JSON.stringify(detailMeta.usageExamples ?? [], null, 2)}
                </pre>
              </Tabs.TabPane>
              <Tabs.TabPane tab={t('插件源码')} itemKey='source'>
                <pre style={{ fontSize: 12, maxHeight: 460, overflow: 'auto' }}>{detail.source}</pre>
              </Tabs.TabPane>
            </Tabs>
            <Button
              style={{ marginTop: 12 }}
              onClick={() => {
                const record = plugins.find((item) => item.meta?.key === detailMeta.key);
                if (record) {
                  showVersions(record);
                } else {
                  showError(t('版本信息加载失败'));
                }
              }}
            >
              {t('查看版本历史')}
            </Button>
          </>
        )}
      </SideSheet>

      <Modal
        title={versions ? `${versions.key} — ${t('版本历史')}` : ''}
        visible={Boolean(versions)}
        onCancel={() => setVersions(null)}
        footer={null}
        width={640}
      >
        {versions && (
          <Table
            columns={[
              { title: 'Version', dataIndex: 'version' },
              { title: t('激活'), dataIndex: 'active', render: (v) => (v ? t('是') : '') },
              { title: t('启用'), dataIndex: 'enabled', render: (v) => (v ? t('是') : t('否')) },
              { title: t('创建时间'), dataIndex: 'created_at' },
              {
                title: t('操作'),
                render: (text, row) =>
                  row.active ? null : (
                    <Button
                      size='small'
                      onClick={async () => {
                        if (await activate(versions.key, row.version)) {
                          setVersions(null);
                        }
                      }}
                    >
                      {t('激活此版本')}
                    </Button>
                  ),
              },
            ]}
            dataSource={versions.list}
            rowKey={(row) => row.id}
            pagination={false}
            size='small'
          />
        )}
      </Modal>

      <Modal
        title={dryRun ? `${dryRun.meta?.key} — Dry Run` : ''}
        visible={Boolean(dryRun)}
        onCancel={() => setDryRun(null)}
        footer={null}
        width={640}
      >
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <Select
            value={dryRunHook}
            onChange={setDryRunHook}
            style={{ width: 240 }}
            optionList={[
              { value: 'extractUsage', label: 'extractUsage' },
              { value: 'parseSubmitResponse', label: 'parseSubmitResponse' },
              { value: 'parseTaskResult', label: 'parseTaskResult' },
              { value: 'buildSubmitRequest', label: 'buildSubmitRequest' },
            ]}
          />
          <TextArea
            value={dryRunArgs}
            onChange={setDryRunArgs}
            maxCount={4000}
            placeholder='[{"seconds": 8, "size": "720x1280"}]'
            autosize
          />
        </div>
        <Button
          theme='solid'
          onClick={() => dryRun && runDryRun(dryRun)}
          style={{ marginBottom: 8 }}
        >
          {t('执行')}
        </Button>
        <pre style={{ maxHeight: 280, overflow: 'auto', fontSize: 12 }}>
          {dryRunOutput || t('输出将显示在这里（脱敏后的插件钩子返回值）')}
        </pre>
      </Modal>

      <Modal
        title={t('上传插件版本')}
        visible={uploadVisible}
        onCancel={() => setUploadVisible(false)}
        footer={null}
        width={720}
      >
        <TextArea
          value={uploadSource}
          onChange={setUploadSource}
          autosize={{ minRows: 10, maxRows: 20 }}
          placeholder={t('粘贴单文件插件源码（export const meta = ...）')}
        />
        <TextArea
          value={uploadRemark}
          onChange={setUploadRemark}
          style={{ marginTop: 8 }}
          placeholder={t('备注（可选）')}
          autosize
        />
        <Checkbox
          checked={uploadForce}
          onChange={(e) => setUploadForce(e.target.checked)}
          style={{ marginTop: 8 }}
        >
          {t('跳过路由冲突预检（force）')}
        </Checkbox>
        <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          <Button theme='solid' type='primary' loading={uploading} onClick={upload}>
            {t('上传并编译')}
          </Button>
          <Typography.Text type='tertiary'>
            {t('上传前会预检 manifest、导出与路由/协议冲突；同版本不同源码会被拒绝。')}
          </Typography.Text>
        </div>
      </Modal>
    </div>
  );
}
