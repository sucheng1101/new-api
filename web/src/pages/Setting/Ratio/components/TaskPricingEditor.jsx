/*
 * 任务用量定价编辑器（时长 × 分辨率等 usage facts 的后台可配置定价）。
 *
 * 自官方 v1.0.0-rc.37 task-usage-pricing-editor / task-pricing-matrix 移植，
 * 壳适配本 Fork 的 jsx + Semi UI 结构。支持 D6 双模式：
 *   - 可视化矩阵：按 schema 的枚举字段组合 × 数值字段单价生成规范表达式
 *   - 表达式：直接编辑表达式（后端保存时做 schema 引用与 smoke 校验）
 * 数据契约：billing_setting.plugin_billing_expr = {"pluginKey::model": expr}
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Banner,
  Button,
  Card,
  InputNumber,
  Select,
  Spin,
  Table,
  Tabs,
  Tag,
  TextArea,
  Typography,
} from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';
import { API, showError, showSuccess } from '../../../../helpers';

import {
  createDefaultTaskMatrixConfig,
  evaluateTaskUsageExamples,
  generateTaskExprFromConfig,
  getTaskEnumFields,
  getTaskNumberFields,
  taskMatrixRowLabel,
  tryParseTaskMatrixConfig,
} from './task-expr';

const PLUGIN_EXPR_OPTION_KEY = 'billing_setting.plugin_billing_expr';

function parseExprMap(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function resolveSchema(plugin, model) {
  if (!plugin) return null;
  const profiles = plugin.usageProfiles ?? [];
  for (const profile of profiles) {
    if (Array.isArray(profile.models) && profile.models.includes(model)) {
      return profile.schema ?? plugin.usageSchema ?? null;
    }
  }
  return plugin.usageSchema ?? null;
}

function resolveExamples(plugin, model) {
  if (!plugin) return null;
  const profiles = plugin.usageProfiles ?? [];
  for (const profile of profiles) {
    if (Array.isArray(profile.models) && profile.models.includes(model)) {
      return profile.examples ?? profile.usageExamples ?? plugin.usageExamples ?? null;
    }
  }
  return plugin.usageExamples ?? null;
}

const UNIT_LABELS = {
  second: '秒',
  count: '次',
  token: 'token',
  credit: 'credit',
};

export default function TaskPricingEditor({ options, refresh }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [plugins, setPlugins] = useState([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [exprMap, setExprMap] = useState({});
  const [mode, setMode] = useState('visual');
  const [matrix, setMatrix] = useState(null);
  const [rawExpr, setRawExpr] = useState('');

  const currentKey = selectedKey && selectedModel ? `${selectedKey}::${selectedModel}` : '';
  const currentExpr = exprMap[currentKey] ?? '';

  const plugin = useMemo(
    () => plugins.find((item) => item.key === selectedKey) ?? null,
    [plugins, selectedKey],
  );
  const schema = useMemo(
    () => resolveSchema(plugin, selectedModel),
    [plugin, selectedModel],
  );
  const examples = useMemo(
    () => resolveExamples(plugin, selectedModel),
    [plugin, selectedModel],
  );

  const loadPlugins = async () => {
    setLoading(true);
    try {
      const res = await API.get('/api/task_plugin_options');
      if (res?.data?.success) {
        setPlugins(res.data.data ?? []);
      } else {
        showError(res?.data?.message ?? t('加载任务插件失败'));
      }
    } catch (error) {
      showError(t('加载任务插件失败') + ': ' + String(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPlugins();
    setExprMap(parseExprMap(options?.[PLUGIN_EXPR_OPTION_KEY]));
  }, []);

  useEffect(() => {
    setExprMap(parseExprMap(options?.[PLUGIN_EXPR_OPTION_KEY]));
  }, [options]);

  useEffect(() => {
    if (plugin && !selectedModel && plugin.models?.length) {
      setSelectedModel(plugin.models[0]);
    }
  }, [plugin]);

  useEffect(() => {
    // 切换目标时载入既有表达式；能解析为规范形态则进入矩阵模式
    setRawExpr(currentExpr);
    if (schema) {
      const parsed = tryParseTaskMatrixConfig(currentExpr, schema);
      setMatrix(parsed ?? createDefaultTaskMatrixConfig(schema));
      setMode(parsed ? 'visual' : 'raw');
    } else {
      setMatrix(null);
      setMode('raw');
    }
  }, [currentKey, schema]);

  const numberFields = getTaskNumberFields(schema);
  const enumFields = getTaskEnumFields(schema);

  const generateExpr = () => {
    if (mode === 'visual' && matrix) {
      return generateTaskExprFromConfig({ tiers: taskMatrixToTiers(matrix, schema) }, schema);
    }
    return rawExpr.trim();
  };

  const previews = useMemo(() => {
    if (mode === 'visual' && matrix) {
      const expr = generateExpr();
      return evaluateTaskUsageExamples(expr, schema, examples);
    }
    return evaluateTaskUsageExamples(rawExpr.trim(), schema, examples);
  }, [mode, matrix, rawExpr, schema, examples]);

  const save = async () => {
    const expr = generateExpr();
    if (!expr) {
      showError(t('表达式为空或无法生成，请检查 schema 配置'));
      return;
    }
    const nextMap = { ...exprMap };
    if (expr) {
      nextMap[currentKey] = expr;
    } else {
      delete nextMap[currentKey];
    }
    setSaving(true);
    try {
      const res = await API.put('/api/option/', {
        key: PLUGIN_EXPR_OPTION_KEY,
        value: JSON.stringify(nextMap, null, 2),
      });
      if (res?.data?.success) {
        showSuccess(t('任务计费表达式已保存（后端已做 schema 引用与 smoke 校验）'));
        setExprMap(nextMap);
        refresh?.();
      } else {
        showError(res?.data?.message ?? t('保存失败'));
      }
    } catch (error) {
      showError(t('保存失败，请重试'));
    } finally {
      setSaving(false);
    }
  };

  const removeExpr = async () => {
    const nextMap = { ...exprMap };
    delete nextMap[currentKey];
    setSaving(true);
    try {
      const res = await API.put('/api/option/', {
        key: PLUGIN_EXPR_OPTION_KEY,
        value: JSON.stringify(nextMap, null, 2),
      });
      if (res?.data?.success) {
        showSuccess(t('已清除该模型的任务计费表达式'));
        setExprMap(nextMap);
        setRawExpr('');
        refresh?.();
      } else {
        showError(res?.data?.message ?? t('保存失败'));
      }
    } catch (error) {
      showError(t('保存失败，请重试'));
    } finally {
      setSaving(false);
    }
  };

  if (loading && plugins.length === 0) {
    return <Spin style={{ display: 'block', margin: '24px auto' }} />;
  }

  if (plugins.length === 0) {
    return (
      <Banner
        type='info'
        description={t('当前没有可用的任务插件。请先在"任务插件"设置页上传或启用插件。')}
      />
    );
  }

  const matrixColumns = [
    {
      title: t('规格组合'),
      dataIndex: '__label',
      width: 180,
      render: (text, row) => <Tag>{taskMatrixRowLabel(row.combination)}</Tag>,
    },
    ...numberFields.map(([field, definition]) => ({
      title:
        t('每') +
        (UNIT_LABELS[definition.unit] ?? field) +
        t('单价') +
        ` (${field})`,
      dataIndex: field,
      render: (text, row) => (
        <InputNumber
          min={0}
          step={definition.unit === 'token' ? 0.001 : 0.01}
          value={row.unitPrices[field] ?? 0}
          onChange={(value) =>
            setMatrix((prev) => ({
              rows: prev.rows.map((item) =>
                taskMatrixRowLabel(item.combination) ===
                taskMatrixRowLabel(row.combination)
                  ? {
                      ...item,
                      unitPrices: { ...item.unitPrices, [field]: Number(value) || 0 },
                    }
                  : item,
              ),
            }))
          }
        />
      ),
    })),
  ];

  return (
    <Card
      title={t('任务用量计费（时长 × 分辨率等维度）')}
      style={{ marginTop: 12 }}
    >
      <Banner
        type='info'
        closeIcon={null}
        description={t(
          '任务表达式按提交时冻结的快照结算：修改只影响新任务，历史任务按其保存的规则版本结算。',
        )}
        style={{ marginBottom: 12 }}
      />
      <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <Select
          placeholder={t('选择任务插件')}
          value={selectedKey}
          onChange={(value) => {
            setSelectedKey(value);
            setSelectedModel('');
          }}
          style={{ width: 240 }}
          optionList={plugins.map((item) => ({
            value: item.key,
            label: item.name ? `${item.name} (${item.key})` : item.key,
          }))}
        />
        <Select
          placeholder={t('选择模型')}
          value={selectedModel}
          onChange={setSelectedModel}
          style={{ width: 280 }}
          optionList={(plugin?.models ?? []).map((model) => ({
            value: model,
            label: model,
          }))}
        />
        {currentExpr ? (
          <Tag color='green' style={{ alignSelf: 'center' }}>
            {t('已配置')}
          </Tag>
        ) : (
          <Tag color='grey' style={{ alignSelf: 'center' }}>
            {t('未配置')}
          </Tag>
        )}
      </div>

      {selectedKey && selectedModel && (
        <>
          {schema ? (
            <Card title={t('用量 Schema（字段声明）')} style={{ marginBottom: 12 }}>
              <Table
                columns={[
                  { title: t('字段'), dataIndex: 'field' },
                  {
                    title: t('类型'),
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
                        <span>{record.def.enum ? '[]' : '-'}</span>
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
                dataSource={Object.entries(schema).map(([field, def]) => ({
                  key: field,
                  field,
                  def,
                }))}
                pagination={false}
                size='small'
              />
            </Card>
          ) : (
            <Banner
              type='warning'
              closeIcon={null}
              description={t('该模型没有声明 usageSchema，无法配置任务表达式计费。')}
              style={{ marginBottom: 12 }}
            />
          )}

          {schema && (
            <Tabs
              type='button'
              activeKey={mode}
              onChange={(key) => setMode(key)}
              tabBarExtraContent={
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button
                    theme='solid'
                    type='primary'
                    loading={saving}
                    onClick={save}
                  >
                    {t('保存表达式')}
                  </Button>
                  {currentExpr && (
                    <Button type='danger' loading={saving} onClick={removeExpr}>
                      {t('清除')}
                    </Button>
                  )}
                </div>
              }
            >
              <Tabs.TabPane tab={t('可视化矩阵')} itemKey='visual'>
                {matrix && matrix.rows.length > 0 ? (
                  <Table
                    columns={matrixColumns}
                    dataSource={matrix.rows.map((row) => ({
                      ...row,
                      __label: taskMatrixRowLabel(row.combination),
                      __key: taskMatrixRowLabel(row.combination),
                    }))}
                    rowKey='__key'
                    pagination={false}
                    size='small'
                  />
                ) : (
                  <Banner
                    type='warning'
                    closeIcon={null}
                    description={t(
                      '该 schema 缺少数值字段（如 seconds），无法生成任务表达式。',
                    )}
                  />
                )}
                <Typography.Text type='tertiary' style={{ display: 'block', marginTop: 8 }}>
                  {t(
                    '矩阵行 = 枚举字段组合，列 = 数量字段的单位价格；保存时按首条匹配规则生成 tier 表达式。',
                  )}
                </Typography.Text>
              </Tabs.TabPane>
              <Tabs.TabPane tab={t('表达式')} itemKey='raw'>
                <TextArea
                  value={rawExpr}
                  onChange={(value) => setRawExpr(value)}
                  autosize={{ minRows: 6, maxRows: 16 }}
                  placeholder={'u("resolution") == "720p" ? tier("720p", u("seconds") * 0.03) : tier("base", u("seconds") * 0.06)'}
                />
                <Typography.Text type='tertiary' style={{ display: 'block', marginTop: 8 }}>
                  {t(
                    '变量通过 u("字段名") 读取用量事实；tier(名称, 表达式) 记录匹配档位。可视化矩阵仅支持规范形态的表达式。',
                  )}
                </Typography.Text>
              </Tabs.TabPane>
            </Tabs>
          )}

          {previews.length > 0 && (
            <Card title={t('规格示例预览')} style={{ marginTop: 12 }}>
              {previews.map((row) => (
                <div key={row.label} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Tag>{row.label}</Tag>
                  <Typography.Text strong>
                    {row.total.toFixed(4)} {t('美元额度单位')}
                  </Typography.Text>
                </div>
              ))}
            </Card>
          )}
        </>
      )}
    </Card>
  );
}
