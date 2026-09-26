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
  Empty,
  Select,
  SideSheet,
  Space,
  Table,
  Tabs,
  Tag,
  TextArea,
  Typography,
} from '@douyinfe/semi-ui';
import {
  Code2,
  FlaskConical,
  History,
  Info,
  Layers3,
  Network,
  Package,
  RefreshCw,
  RotateCcw,
  Settings2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { API, showError, showSuccess } from '../../../helpers';
import PluginIcon from './PluginIcon';
import {
  getPluginOwnershipPresentation,
  PLUGIN_DETAIL_TABS,
} from './pluginViewModel';

const UNIT_LABELS = {
  second: '秒',
  count: '次',
  token: 'token',
  credit: 'credit',
};

function localizedText(value) {
  if (typeof value === 'string') return value;
  return value?.zh ?? value?.en ?? '';
}

function ModelTags({ models = [] }) {
  if (!models.length)
    return <Typography.Text type='tertiary'>-</Typography.Text>;

  return (
    <div className='task-plugin-models'>
      {models.map((model) => (
        <Tag key={model} className='task-plugin-model-tag'>
          {model}
        </Tag>
      ))}
    </div>
  );
}

function DetailSection({
  icon: Icon = Info,
  title,
  description,
  children,
  className = '',
}) {
  return (
    <section className={`task-plugin-detail-block ${className}`.trim()}>
      <header className='task-plugin-detail-block-heading'>
        <span className='task-plugin-detail-block-icon'>
          <Icon size={16} strokeWidth={1.8} />
        </span>
        <div className='task-plugin-detail-block-heading-copy'>
          <Typography.Text strong>{title}</Typography.Text>
          {description ? (
            <Typography.Text type='tertiary' size='small'>
              {description}
            </Typography.Text>
          ) : null}
        </div>
      </header>
      <div className='task-plugin-detail-block-content'>{children}</div>
    </section>
  );
}

function UsageSchemaFacts({ schema, t }) {
  const entries = Object.entries(schema ?? {});
  if (!entries.length) {
    return (
      <Typography.Text type='tertiary'>{t('未声明用量字段')}</Typography.Text>
    );
  }
  return (
    <div className='task-plugin-usage-schema-grid'>
      {entries.map(([field, definition]) => (
        <div className='task-plugin-usage-schema-item' key={field}>
          <div className='task-plugin-usage-schema-title'>
            <Typography.Text strong>
              {localizedText(definition.description) || field}
            </Typography.Text>
            <Typography.Text type='tertiary' size='small' code>
              {field}
            </Typography.Text>
          </div>
          <div className='task-plugin-usage-schema-tags'>
            {definition.type ? <Tag>{definition.type}</Tag> : null}
            {definition.unit ? (
              <Tag color='grey'>
                {UNIT_LABELS[definition.unit] ?? definition.unit}
              </Tag>
            ) : null}
            {(definition.enum ?? []).map((value) => (
              <Tag key={value} color='blue'>
                {localizedText(definition.enumLabels?.[value]) || value}
              </Tag>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function UsageExamples({ examples, schema, t }) {
  if (!examples?.length) return null;
  return (
    <div className='task-plugin-usage-example-list'>
      {examples.map((example, index) => (
        <div
          className='task-plugin-usage-example'
          key={`${example.label}-${index}`}
        >
          <Typography.Text strong>
            {example.label || t('规格示例')}
          </Typography.Text>
          <div className='task-plugin-usage-example-facts'>
            {Object.entries(example.facts ?? {}).map(([field, value]) => (
              <Tag key={field} color='grey'>
                {localizedText(schema?.[field]?.description) || field}:{' '}
                {String(value)}
              </Tag>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function EndpointSummary({ meta, t }) {
  const endpoints = meta.routes ?? meta.endpoints ?? [];
  const protocols = meta.protocols ?? [];
  if (!endpoints.length && !protocols.length) {
    return <Typography.Text type='tertiary'>-</Typography.Text>;
  }
  return (
    <div className='task-plugin-contract-list'>
      {endpoints.length ? (
        <div className='task-plugin-contract-row'>
          <Typography.Text type='tertiary' size='small'>
            {t('自定义端点')}
          </Typography.Text>
          <div className='task-plugin-contract-tags'>
            {endpoints.map((endpoint, index) => {
              if (typeof endpoint === 'string')
                return <Tag key={endpoint}>{endpoint}</Tag>;
              const method = endpoint.method ? `${endpoint.method} ` : '';
              const path =
                endpoint.path ||
                endpoint.name ||
                endpoint.type ||
                t('未命名端点');
              return (
                <Tag key={`${method}-${path}-${index}`} color='blue'>
                  {method}
                  {path}
                </Tag>
              );
            })}
          </div>
        </div>
      ) : null}
      {protocols.length ? (
        <div className='task-plugin-contract-row'>
          <Typography.Text type='tertiary' size='small'>
            {t('协议')}
          </Typography.Text>
          <div className='task-plugin-contract-tags'>
            {protocols.map((protocol, index) => {
              if (typeof protocol === 'string')
                return (
                  <Tag key={protocol} color='green'>
                    {protocol}
                  </Tag>
                );
              const supports =
                Array.isArray(protocol.supports) && protocol.supports.length
                  ? ` (${protocol.supports.join(', ')})`
                  : '';
              return (
                <Tag key={`${protocol.name}-${index}`} color='green'>
                  {protocol.name || t('未命名协议')}
                  {supports}
                </Tag>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PluginOverview({ detail, listRecord, t }) {
  const meta = detail?.meta ?? {};
  const ownership = getPluginOwnershipPresentation({
    origin: listRecord?.origin ?? detail?.origin,
    source: listRecord?.source ?? detail?.layer,
    factory_meta: listRecord?.factory_meta,
  });
  const author = meta.author?.name ?? meta.author ?? '-';
  const runtimeStatus = listRecord?.runtime_status || '-';

  const info = [
    [t('版本'), meta.version ?? '-'],
    [t('API 版本'), meta.apiVersion ?? '-'],
    [t('作者'), author],
    [t('来源'), <Tag color={ownership.color}>{t(ownership.label)}</Tag>],
    [t('渠道类型'), meta.channelTypes?.join(', ') || '-'],
    [t('获取模式'), meta.fetchMode ?? '-'],
    [
      t('运行状态'),
      <Tag color={runtimeStatus === 'registered' ? 'green' : 'grey'}>
        {runtimeStatus}
      </Tag>,
    ],
    [t('已绑定渠道'), listRecord?.channel_count ?? 0],
    [t('进行中任务'), listRecord?.in_flight_count ?? 0],
  ];

  return (
    <div className='task-plugin-detail-section'>
      <DetailSection
        icon={Info}
        title={t('运行概览')}
        description={t('插件版本、运行状态和已绑定任务概况')}
      >
        <div className='task-plugin-detail-info-grid'>
          {info.map(([label, value]) => (
            <div className='task-plugin-detail-info-cell' key={label}>
              <Typography.Text type='tertiary' size='small'>
                {label}
              </Typography.Text>
              <div className='task-plugin-detail-info-value'>{value}</div>
            </div>
          ))}
        </div>
      </DetailSection>
      <DetailSection
        icon={Package}
        title={t('支持模型')}
        description={t('这些模型会由此插件声明协议能力与参数约束')}
      >
        <ModelTags models={meta.models ?? []} />
      </DetailSection>
      <DetailSection
        icon={Network}
        title={t('接口能力')}
        description={t('插件对外声明的请求入口与协议')}
      >
        <EndpointSummary meta={meta} t={t} />
      </DetailSection>
      <DetailSection icon={Layers3} title={t('插件说明')}>
        <Typography.Paragraph type='tertiary'>
          {localizedText(meta.description) || t('未提供插件描述')}
        </Typography.Paragraph>
        {meta.website ? (
          <Typography.Text link={{ href: meta.website, target: '_blank' }}>
            {meta.website}
          </Typography.Text>
        ) : null}
      </DetailSection>
    </div>
  );
}

function PluginBillingParameters({ detail, t }) {
  const meta = detail?.meta ?? {};
  const usageProfiles = meta.usageProfiles ?? meta.usage_profiles ?? [];
  const profileModels = new Set(
    usageProfiles.flatMap((profile) => profile.models ?? []),
  );
  const defaultModels = (meta.models ?? []).filter(
    (model) => !profileModels.has(model),
  );
  const hasDefaultSchema = Object.keys(meta.usageSchema ?? {}).length > 0;

  if (!hasDefaultSchema && !usageProfiles.length) {
    return <Empty title={t('未声明计费参数')} />;
  }

  return (
    <div className='task-plugin-detail-section task-plugin-billing-parameters'>
      {hasDefaultSchema ? (
        <DetailSection
          icon={Settings2}
          title={usageProfiles.length ? t('默认计费参数') : t('计费参数')}
          description={t('参数和计费事实由插件声明，用户价格在模型价格页配置')}
        >
          {usageProfiles.length ? <ModelTags models={defaultModels} /> : null}
          <UsageSchemaFacts schema={meta.usageSchema} t={t} />
          <UsageExamples
            examples={meta.usageExamples}
            schema={meta.usageSchema}
            t={t}
          />
        </DetailSection>
      ) : null}
      {usageProfiles.map((profile, index) => (
        <DetailSection
          icon={Settings2}
          key={`${profile.models?.join('|')}-${index}`}
          title={t('模型专属计费参数')}
          description={t('该 profile 会覆盖默认参数约束')}
        >
          <ModelTags models={profile.models ?? []} />
          <UsageSchemaFacts schema={profile.schema} t={t} />
          <UsageExamples
            examples={profile.examples}
            schema={profile.schema}
            t={t}
          />
        </DetailSection>
      ))}
    </div>
  );
}

function PluginSandbox({ pluginKey, t }) {
  const [hook, setHook] = useState('extractUsage');
  const [argsText, setArgsText] = useState('[]');
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    let args;
    try {
      args = JSON.parse(argsText || '[]');
      if (!Array.isArray(args)) throw new Error('args must be an array');
    } catch {
      showError(t('插件沙盒参数必须是 JSON 数组'));
      return;
    }

    setLoading(true);
    try {
      const response = await API.post(`/api/plugin/task/${pluginKey}/dryrun`, {
        hook,
        args,
      });
      setOutput(
        response?.data?.success
          ? JSON.stringify(response.data.data, null, 2)
          : `ERROR: ${response?.data?.message ?? t('执行失败')}`,
      );
    } catch (error) {
      setOutput(`ERROR: ${String(error)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className='task-plugin-dry-run-form'>
      <Select
        value={hook}
        onChange={setHook}
        optionList={[
          { value: 'extractUsage', label: 'extractUsage' },
          { value: 'parseSubmitResponse', label: 'parseSubmitResponse' },
          { value: 'parseTaskResult', label: 'parseTaskResult' },
          { value: 'buildSubmitRequest', label: 'buildSubmitRequest' },
        ]}
      />
      <TextArea
        value={argsText}
        onChange={setArgsText}
        placeholder='[{"seconds": 8, "resolution": "720P"}]'
        autosize={{ minRows: 5, maxRows: 12 }}
      />
      <Button
        theme='solid'
        type='primary'
        icon={<FlaskConical size={16} />}
        loading={loading}
        onClick={() => void submit()}
      >
        {t('执行插件沙盒')}
      </Button>
      <pre className='task-plugin-code-block task-plugin-dry-run-output'>
        {output || t('输出将显示在这里')}
      </pre>
    </div>
  );
}

export default function PluginDetailSheet({
  detail,
  listRecord,
  visible,
  onCancel,
  onPluginChanged,
}) {
  const { t } = useTranslation();
  const [currentDetail, setCurrentDetail] = useState(detail);
  const [activeTab, setActiveTab] = useState('overview');
  const [versions, setVersions] = useState([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState('');
  const [compareVersion, setCompareVersion] = useState('');
  const [activatingVersion, setActivatingVersion] = useState('');

  const key = currentDetail?.meta?.key ?? detail?.meta?.key ?? '';
  const version = currentDetail?.meta?.version ?? detail?.meta?.version ?? '';

  useEffect(() => {
    setCurrentDetail(detail);
    setActiveTab('overview');
    setVersions([]);
    setVersionsError('');
    setCompareVersion('');
  }, [detail?.meta?.key, detail?.meta?.version]);

  const loadVersions = useCallback(async () => {
    if (!key) return;
    setVersionsLoading(true);
    setVersionsError('');
    try {
      const response = await API.get(`/api/plugin/task/${key}/versions`);
      if (!response?.data?.success) {
        throw new Error(response?.data?.message ?? t('加载版本历史失败'));
      }
      setVersions(response.data.data ?? []);
    } catch (error) {
      setVersions([]);
      setVersionsError(String(error));
    } finally {
      setVersionsLoading(false);
    }
  }, [key, t]);

  const reloadCurrentDetail = useCallback(async () => {
    if (!key) return;
    const response = await API.get(`/api/plugin/task/${key}`);
    if (!response?.data?.success) {
      throw new Error(response?.data?.message ?? t('加载插件详情失败'));
    }
    setCurrentDetail(response.data.data ?? null);
  }, [key, t]);

  const activateVersion = async (targetVersion) => {
    if (!key) return;
    setActivatingVersion(targetVersion);
    try {
      const response = await API.post(`/api/plugin/task/${key}/activate`, {
        version: targetVersion,
      });
      if (!response?.data?.success) {
        throw new Error(response?.data?.message ?? t('激活失败'));
      }
      showSuccess(t('已激活') + ` ${key}@${targetVersion}`);
      await Promise.all([
        loadVersions(),
        reloadCurrentDetail(),
        Promise.resolve(onPluginChanged?.()),
      ]);
      setCompareVersion('');
    } catch (error) {
      showError(t('激活失败') + ': ' + String(error));
    } finally {
      setActivatingVersion('');
    }
  };

  const handleTabChange = (nextTab) => {
    setActiveTab(nextTab);
    if ((nextTab === 'versions' || nextTab === 'diff') && !versionsLoading) {
      void loadVersions();
    }
  };

  const selectedComparison = useMemo(
    () => versions.find((item) => item.version === compareVersion),
    [compareVersion, versions],
  );
  const titleMeta = currentDetail?.meta ?? {};
  const titleOwnership = getPluginOwnershipPresentation({
    origin: listRecord?.origin ?? currentDetail?.origin,
    source: listRecord?.source ?? currentDetail?.layer,
    factory_meta: listRecord?.factory_meta,
  });

  return (
    <SideSheet
      title={
        currentDetail ? (
          <div className='task-plugin-detail-title'>
            <PluginIcon record={currentDetail} size={32} />
            <div className='task-plugin-detail-title-copy'>
              <Typography.Text
                strong
                className='task-plugin-detail-title-name'
                ellipsis={{ showTooltip: true }}
              >
                {titleMeta.name ?? titleMeta.key}
              </Typography.Text>
              <Typography.Text
                type='tertiary'
                size='small'
                code
                className='task-plugin-detail-title-key'
                ellipsis={{ showTooltip: true }}
              >
                {titleMeta.key}
              </Typography.Text>
              <div className='task-plugin-detail-title-meta'>
                <Tag color='grey' size='small'>
                  v{titleMeta.version ?? '-'}
                </Tag>
                <Tag color={titleOwnership.color} size='small'>
                  {t(titleOwnership.label)}
                </Tag>
              </div>
            </div>
          </div>
        ) : (
          ''
        )
      }
      visible={visible}
      onCancel={onCancel}
      width={800}
      size='large'
    >
      {currentDetail ? (
        <div className='task-plugin-detail'>
          <Tabs activeKey={activeTab} onChange={handleTabChange} type='line'>
            {PLUGIN_DETAIL_TABS.map((tab) => (
              <Tabs.TabPane tab={t(tab.label)} itemKey={tab.key} key={tab.key}>
                {tab.key === 'overview' ? (
                  <PluginOverview
                    detail={currentDetail}
                    listRecord={listRecord}
                    t={t}
                  />
                ) : null}
                {tab.key === 'billing' ? (
                  <PluginBillingParameters detail={currentDetail} t={t} />
                ) : null}
                {tab.key === 'source' && activeTab === 'source' ? (
                  <DetailSection
                    icon={Code2}
                    title={t('插件源码')}
                    description={t('上传前应审查来源、权限和版本差异')}
                  >
                    <pre className='task-plugin-code-block task-plugin-source-code'>
                      {currentDetail.source || t('源码不可用')}
                    </pre>
                  </DetailSection>
                ) : null}
                {tab.key === 'versions' && activeTab === 'versions' ? (
                  <DetailSection
                    icon={History}
                    title={t('版本历史')}
                    description={t('选择历史版本回滚或进入源码差异比较')}
                  >
                    <div className='task-plugin-detail-actions'>
                      <Button
                        size='small'
                        icon={<RefreshCw size={15} />}
                        loading={versionsLoading}
                        onClick={() => void loadVersions()}
                      >
                        {t('刷新版本历史')}
                      </Button>
                    </div>
                    {versionsError ? (
                      <Banner
                        type='error'
                        closeIcon={null}
                        description={versionsError}
                      />
                    ) : null}
                    {versionsLoading ? (
                      <Banner
                        type='info'
                        closeIcon={null}
                        description={t('正在加载版本历史...')}
                      />
                    ) : null}
                    {!versionsLoading && !versionsError && !versions.length ? (
                      <Empty title={t('暂无版本历史')} />
                    ) : null}
                    {!versionsLoading && versions.length ? (
                      <Table
                        columns={[
                          { title: t('版本'), dataIndex: 'version' },
                          {
                            title: t('状态'),
                            dataIndex: 'active',
                            render: (value) =>
                              value ? (
                                <Tag color='green'>{t('当前')}</Tag>
                              ) : (
                                '-'
                              ),
                          },
                          { title: t('备注'), dataIndex: 'remark' },
                          {
                            title: t('操作'),
                            render: (_, row) => (
                              <Space>
                                <Button
                                  size='small'
                                  onClick={() => {
                                    setCompareVersion(row.version);
                                    handleTabChange('diff');
                                  }}
                                >
                                  {t('查看差异')}
                                </Button>
                                <Button
                                  size='small'
                                  icon={<RotateCcw size={14} />}
                                  disabled={row.active}
                                  loading={activatingVersion === row.version}
                                  onClick={() =>
                                    void activateVersion(row.version)
                                  }
                                >
                                  {t('激活')}
                                </Button>
                              </Space>
                            ),
                          },
                        ]}
                        dataSource={versions}
                        rowKey={(row) => row.id ?? row.version}
                        pagination={false}
                        size='small'
                        scroll={{ x: 620 }}
                      />
                    ) : null}
                  </DetailSection>
                ) : null}
                {tab.key === 'diff' && activeTab === 'diff' ? (
                  <DetailSection
                    icon={Code2}
                    title={t('源码差异')}
                    description={t('对比当前激活版本和一个历史版本的源码')}
                  >
                    {versionsError ? (
                      <Banner
                        type='error'
                        closeIcon={null}
                        description={versionsError}
                      />
                    ) : null}
                    <Select
                      value={compareVersion}
                      placeholder={t('选择要对比的版本')}
                      loading={versionsLoading}
                      optionList={versions
                        .filter((item) => item.version !== version)
                        .map((item) => ({
                          value: item.version,
                          label: item.version,
                        }))}
                      onChange={setCompareVersion}
                    />
                    {compareVersion && selectedComparison ? (
                      <div className='task-plugin-source-diff'>
                        <div>
                          <Typography.Text type='tertiary' size='small'>
                            {t('版本 {{version}}', { version: compareVersion })}
                          </Typography.Text>
                          <pre className='task-plugin-code-block task-plugin-source-code'>
                            {selectedComparison.source || t('源码不可用')}
                          </pre>
                        </div>
                        <div>
                          <Typography.Text type='tertiary' size='small'>
                            {t('当前版本 {{version}}', { version })}
                          </Typography.Text>
                          <pre className='task-plugin-code-block task-plugin-source-code'>
                            {currentDetail.source || t('源码不可用')}
                          </pre>
                        </div>
                      </div>
                    ) : (
                      <Empty title={t('请选择一个历史版本')} />
                    )}
                  </DetailSection>
                ) : null}
                {tab.key === 'sandbox' && activeTab === 'sandbox' ? (
                  <DetailSection
                    icon={FlaskConical}
                    title={t('插件沙盒')}
                    description={t('使用脱敏样例验证 hook 输入和输出')}
                  >
                    <PluginSandbox pluginKey={key} t={t} />
                  </DetailSection>
                ) : null}
              </Tabs.TabPane>
            ))}
          </Tabs>
        </div>
      ) : null}
    </SideSheet>
  );
}
