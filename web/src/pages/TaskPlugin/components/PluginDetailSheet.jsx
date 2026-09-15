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
  Descriptions,
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
import { FlaskConical, RefreshCw, RotateCcw } from 'lucide-react';
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

function UsageSchemaTable({ schema, t }) {
  if (!schema || Object.keys(schema).length === 0) {
    return (
      <Typography.Text type='tertiary'>{t('未声明用量字段')}</Typography.Text>
    );
  }

  return (
    <Table
      columns={[
        { title: t('字段'), dataIndex: 'field', width: 132 },
        {
          title: t('类型'),
          width: 132,
          render: (_, record) => (
            <Tag>
              {record.definition.type}
              {record.definition.unit
                ? ` (${UNIT_LABELS[record.definition.unit] ?? record.definition.unit})`
                : ''}
            </Tag>
          ),
        },
        {
          title: t('枚举/约束'),
          render: (_, record) =>
            record.definition.enum?.length ? (
              <div className='task-plugin-models'>
                {record.definition.enum.map((value) => (
                  <Tag key={value}>{value}</Tag>
                ))}
              </div>
            ) : (
              '-'
            ),
        },
        {
          title: t('说明'),
          render: (_, record) =>
            localizedText(record.definition.description) || '-',
        },
      ]}
      dataSource={Object.entries(schema).map(([field, definition]) => ({
        key: field,
        field,
        definition,
      }))}
      pagination={false}
      size='small'
      scroll={{ x: 640 }}
    />
  );
}

function displayValue(value) {
  if (value === undefined || value === null || value === '') return '-';
  if (typeof value === 'string' || typeof value === 'number')
    return String(value);
  if (Array.isArray(value)) return value.join(', ') || '-';
  return JSON.stringify(value, null, 2);
}

function EndpointSummary({ meta, t }) {
  const endpoints = meta.endpoints ?? meta.routes ?? [];
  const protocols = meta.protocols ?? [];
  if (!endpoints.length && !protocols.length) {
    return <Typography.Text type='tertiary'>-</Typography.Text>;
  }
  return (
    <div className='task-plugin-overview-jsons'>
      {endpoints.length ? (
        <div>
          <Typography.Text type='tertiary' size='small'>
            {t('端点')}
          </Typography.Text>
          <pre className='task-plugin-code-block'>
            {JSON.stringify(endpoints, null, 2)}
          </pre>
        </div>
      ) : null}
      {protocols.length ? (
        <div>
          <Typography.Text type='tertiary' size='small'>
            {t('协议声明')}
          </Typography.Text>
          <pre className='task-plugin-code-block'>
            {JSON.stringify(protocols, null, 2)}
          </pre>
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
    [t('插件 Key'), meta.key ?? '-'],
    [t('版本'), meta.version ?? '-'],
    [t('API 版本'), meta.apiVersion ?? '-'],
    [t('作者'), author],
    [t('官网'), meta.website ?? '-'],
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
      <div className='task-plugin-detail-overview-block'>
        <Typography.Text strong>{t('支持模型')}</Typography.Text>
        <ModelTags models={meta.models ?? []} />
      </div>
      <div className='task-plugin-detail-overview-block'>
        <Typography.Text strong>{t('描述')}</Typography.Text>
        <Typography.Paragraph type='tertiary'>
          {localizedText(meta.description) || t('未提供插件描述')}
        </Typography.Paragraph>
      </div>
      <div className='task-plugin-detail-overview-block'>
        <Typography.Text strong>{t('端点与协议')}</Typography.Text>
        <EndpointSummary meta={meta} t={t} />
      </div>
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
        <section>
          {usageProfiles.length ? (
            <div className='task-plugin-detail-overview-block'>
              <Typography.Text strong>{t('默认模型')}</Typography.Text>
              <ModelTags models={defaultModels} />
            </div>
          ) : null}
          <UsageSchemaTable schema={meta.usageSchema} t={t} />
        </section>
      ) : null}
      {usageProfiles.map((profile, index) => (
        <section key={`${profile.models?.join('|')}-${index}`}>
          <div className='task-plugin-detail-overview-block'>
            <Typography.Text strong>{t('适用模型')}</Typography.Text>
            <ModelTags models={profile.models ?? []} />
          </div>
          <UsageSchemaTable schema={profile.schema} t={t} />
          {profile.examples?.length ? (
            <pre className='task-plugin-code-block'>
              {JSON.stringify(profile.examples, null, 2)}
            </pre>
          ) : null}
        </section>
      ))}
      {meta.usageExamples?.length ? (
        <section>
          <Typography.Text strong>{t('用量示例')}</Typography.Text>
          <pre className='task-plugin-code-block'>
            {JSON.stringify(meta.usageExamples, null, 2)}
          </pre>
        </section>
      ) : null}
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
                  <pre className='task-plugin-code-block task-plugin-source-code'>
                    {currentDetail.source || t('源码不可用')}
                  </pre>
                ) : null}
                {tab.key === 'versions' && activeTab === 'versions' ? (
                  <div className='task-plugin-detail-section'>
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
                  </div>
                ) : null}
                {tab.key === 'diff' && activeTab === 'diff' ? (
                  <div className='task-plugin-detail-section'>
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
                  </div>
                ) : null}
                {tab.key === 'sandbox' && activeTab === 'sandbox' ? (
                  <PluginSandbox pluginKey={key} t={t} />
                ) : null}
              </Tabs.TabPane>
            ))}
          </Tabs>
        </div>
      ) : null}
    </SideSheet>
  );
}
