/*
 * 任务插件管理页（自官方 v1.0.0-rc.37 的插件管理面移植，壳适配 Fork 的
 * jsx + Semi UI 结构）。能力：列表/详情（meta + usageSchema + 源码）、
 * 激活、启停、删除版本、上传新版本、dry run、运行时状态。
 *
 * 后端 API（RootAuth，见 controller/task_plugin.go 与 router/api-router.go）：
 *   GET    /api/plugin/task                     列表（含 factory 层与 DB 层状态）
 *   POST   /api/plugin/task                     上传新版本 {source, remark, force, enabled}
 *   GET    /api/plugin/task/runtime/status      运行时 generation / 错误
 *   GET    /api/plugin/task/:key                详情（激活版本或 factory 源码）
 *   GET    /api/plugin/task/:key/versions       版本列表
 *   POST   /api/plugin/task/:key/activate       激活指定版本
 *   POST   /api/plugin/task/:key/status         启停
 *   POST   /api/plugin/task/:key/dryrun         受控 dry run（单钩子）
 *   DELETE /api/plugin/task/:key/versions/:v    删除版本
 */
import React, { useEffect, useState } from 'react';
import {
  Banner,
  Button,
  Card,
  Checkbox,
  Modal,
  Popconfirm,
  Select,
  Spin,
  Table,
  Tag,
  TextArea,
  Typography,
} from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';
import { API, showError, showSuccess } from '../../helpers';

const LAYER_LABELS = {
  factory: '内置',
  override: '上传版本',
  override_over_factory: '上传覆盖内置',
};

function layerTag(record, t) {
  // 后端 ListTaskPlugins 的 source 字段是层级标记："override" / "override_over_factory"，
  // 内置-only 插件为空串。
  const layer = record.source
    ? record.source === 'override_over_factory'
      ? 'override_over_factory'
      : 'override'
    : 'factory';
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {record.active ? <Tag color='green'>{t('激活版本')}</Tag> : null}
      <Tag color={layer === 'factory' ? 'blue' : 'purple'}>
        {layer === 'factory'
          ? t('内置')
          : layer === 'override'
            ? t('上传版本')
            : t('上传覆盖内置')}
      </Tag>
      {record.enabled ? null : <Tag color='red'>{t('已停用')}</Tag>}
      {record.runtime_status === 'compile_failed' ? (
        <Tag color='red'>{t('编译失败')}</Tag>
      ) : null}
    </div>
  );
}

export default function TaskPlugin() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [plugins, setPlugins] = useState([]);
  const [runtime, setRuntime] = useState(null);
  const [detail, setDetail] = useState(null);
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

  const load = async () => {
    setLoading(true);
    try {
      const [listRes, runtimeRes] = await Promise.all([
        API.get('/api/plugin/task'),
        API.get('/api/plugin/task/runtime/status'),
      ]);
      if (listRes?.data?.success) {
        setPlugins(listRes.data.data ?? []);
      } else {
        showError(listRes?.data?.message ?? t('加载任务插件失败'));
      }
      if (runtimeRes?.data?.success) {
        setRuntime(runtimeRes.data.data ?? null);
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

  const activate = async (record) => {
    try {
      const res = await API.post(`/api/plugin/task/${record.meta.key}/activate`, {
        version: record.meta.version,
      });
      if (res?.data?.success) {
        showSuccess(t('已激活') + ` ${record.meta.key}@${record.meta.version}`);
        load();
      } else {
        showError(res?.data?.message ?? t('操作失败'));
      }
    } catch (error) {
      showError(t('操作失败') + ': ' + String(error));
    }
  };

  const toggleStatus = async (record, enabled) => {
    try {
      const res = await API.post(`/api/plugin/task/${record.meta.key}/status`, {
        enabled,
      });
      if (res?.data?.success) {
        showSuccess(enabled ? t('已启用') : t('已停用'));
        load();
      } else {
        showError(res?.data?.message ?? t('操作失败'));
        load();
      }
    } catch (error) {
      showError(t('操作失败') + ': ' + String(error));
      load();
    }
  };

  const deleteVersion = async (record) => {
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
    setDryRunOutput('');
    setDryRun(record);
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

  const columns = [
    {
      title: t('插件'),
      render: (text, record) => (
        <div>
          <Typography.Text strong>{record.meta?.name ?? record.meta?.key}</Typography.Text>
          <div>
            <Typography.Text type='tertiary' size='small'>
              {record.meta?.key}
            </Typography.Text>
          </div>
        </div>
      ),
    },
    { title: t('版本'), render: (text, record) => record.meta?.version ?? '-' },
    {
      title: t('状态'),
      render: (text, record) => layerTag(record, t),
    },
    {
      title: t('模型'),
      render: (text, record) =>
        (record.meta?.models ?? []).map((model) => (
          <Tag key={model} style={{ margin: 2 }}>
            {model}
          </Tag>
        )),
    },
    { title: t('绑定渠道数'), dataIndex: 'channel_count', width: 110 },
    { title: t('在途任务'), dataIndex: 'in_flight_count', width: 90 },
    {
      title: t('操作'),
      render: (text, record) => (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Button size='small' onClick={() => showDetail(record)}>
            {t('详情')}
          </Button>
          {!record.active && (
            <Button size='small' type='primary' onClick={() => activate(record)}>
              {t('激活')}
            </Button>
          )}
          <Button
            size='small'
            onClick={() => toggleStatus(record, !record.enabled)}
          >
            {record.enabled ? t('停用') : t('启用')}
          </Button>
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

  return (
    <div>
      <Banner
        type='info'
        closeIcon={null}
        description={t(
          '任务插件把视频等异步任务的协议解析与用量事实提取上移为可运营的插件版本；定价在"任务计费"页配置。插件只做数据变换，网络、凭据、账务仍由宿主掌管。',
        )}
        style={{ marginBottom: 12 }}
      />
      {runtime && (
        <Card style={{ marginBottom: 12 }} bodyStyle={{ padding: '12px 16px' }}>
          <Typography.Text>
            {t('运行时')}: generation {runtime.current_generation} |{' '}
            {t('数据库修订')} {runtime.database_revision?.slice(0, 12)}…
          </Typography.Text>
          {runtime.plugin_errors &&
            Object.keys(runtime.plugin_errors).length > 0 && (
              <div style={{ marginTop: 4 }}>
                {Object.entries(runtime.plugin_errors).map(([key, message]) => (
                  <Banner
                    key={key}
                    type='alert'
                    closeIcon={null}
                    description={`${key}: ${message}`}
                  />
                ))}
              </div>
            )}
        </Card>
      )}
      <div style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
        <Button
          theme='solid'
          type='primary'
          onClick={() => setUploadVisible(true)}
        >
          {t('上传插件版本')}
        </Button>
        <Button onClick={load} loading={loading}>
          {t('刷新')}
        </Button>
      </div>
      <Table
        columns={columns}
        dataSource={plugins}
        rowKey={(record) => record.meta?.key + '@' + record.meta?.version}
        loading={loading}
        pagination={false}
        size='small'
      />

      <Modal
        title={detail ? `${detail.meta?.key} @ ${detail.meta?.version}` : ''}
        visible={Boolean(detail)}
        onCancel={() => setDetail(null)}
        footer={null}
        width={720}
      >
        {detail && (
          <>
            <Typography.Title heading={6}>{t('用量 Schema')}</Typography.Title>
            <pre style={{ maxHeight: 240, overflow: 'auto', fontSize: 12 }}>
              {JSON.stringify(detail.meta?.usageSchema ?? {}, null, 2)}
            </pre>
            <Typography.Title heading={6}>{t('源码')}</Typography.Title>
            <pre style={{ maxHeight: 320, overflow: 'auto', fontSize: 12 }}>
              {detail.source}
            </pre>
          </>
        )}
      </Modal>

      <Modal
        title={versions ? `${versions.key} — ${t('版本列表')}` : ''}
        visible={Boolean(versions)}
        onCancel={() => setVersions(null)}
        footer={null}
      >
        {versions && (
          <Table
            columns={[
              { title: 'Version', dataIndex: 'version' },
              { title: t('激活'), dataIndex: 'active', render: (v) => (v ? t('是') : '') },
              { title: t('启用'), dataIndex: 'enabled', render: (v) => (v ? t('是') : t('否')) },
              { title: t('创建时间'), dataIndex: 'created_at' },
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
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <Button
            theme='solid'
            type='primary'
            loading={uploading}
            onClick={upload}
          >
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
