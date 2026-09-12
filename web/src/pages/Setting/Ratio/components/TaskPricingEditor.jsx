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
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Banner,
  Button,
  InputNumber,
  Modal,
  Select,
  Table,
  Tabs,
  Tag,
  TextArea,
  Typography,
} from '@douyinfe/semi-ui';
import { IconDelete } from '@douyinfe/semi-icons';
import { useTranslation } from 'react-i18next';

import {
  combineBillingExpr,
  splitBillingExprAndRequestRules,
} from './requestRuleExpr';
import {
  createDefaultTaskMatrixConfig,
  evaluateTaskUsageExamples,
  generateTaskExprFromConfig,
  getTaskEnumFields,
  getTaskNumberFields,
  taskMatrixRowLabel,
  taskMatrixToTiers,
  evaluateTaskVisualConfig,
  tryParseTaskMatrixConfig,
  tryParseTaskVisualConfig,
} from './task-expr';

const UNIT_LABELS = {
  second: '秒',
  count: '次',
  token: 'token',
  credit: 'credit',
};

const hasSchema = (schema) => Boolean(Object.keys(schema ?? {}).length);

const fieldLabel = (field, definition) => {
  const description = definition?.description;
  if (typeof description === 'string') return description;
  return description?.zh ?? description?.en ?? field;
};

const toPrice = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
};

const formatFacts = (facts, schema) =>
  Object.entries(facts ?? {})
    .filter(([field]) => schema?.[field])
    .map(([field, value]) => `${fieldLabel(field, schema[field])}: ${value}`)
    .join(' · ');

const taskPricingSourceKey = ({
  modelName,
  schema,
  billingExpr,
  requestRuleExpr,
}) =>
  JSON.stringify({
    modelName,
    schema: schema ?? {},
    billingExpr: billingExpr ?? '',
    requestRuleExpr: requestRuleExpr ?? '',
  });

const createPreviewFacts = (schema, examples) => {
  if (examples[0]?.facts) return { ...examples[0].facts };
  const facts = {};
  for (const [field, definition] of getTaskEnumFields(schema)) {
    facts[field] = definition.enum?.[0] ?? '';
  }
  for (const [field, definition] of getTaskNumberFields(schema)) {
    facts[field] = definition.unit === 'second' ? 5 : 0;
  }
  return facts;
};

export default function TaskPricingEditor({
  modelName,
  schema,
  examples = [],
  billingExpr,
  requestRuleExpr = '',
  onBillingExprChange,
  onRequestRuleExprChange,
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState('visual');
  const [matrix, setMatrix] = useState(null);
  const [rawExpr, setRawExpr] = useState('');
  const [previewFacts, setPreviewFacts] = useState(() =>
    createPreviewFacts(schema, examples),
  );
  const [confirmVisualSwitch, setConfirmVisualSwitch] = useState(false);
  const combinedExpression = combineBillingExpr(billingExpr, requestRuleExpr);
  const sourceKey = useMemo(
    () =>
      taskPricingSourceKey({
        modelName,
        schema,
        billingExpr,
        requestRuleExpr,
      }),
    [billingExpr, modelName, requestRuleExpr, schema],
  );
  const localSourceKeyRef = useRef(null);

  const markLocalUpdate = (nextBillingExpr, nextRequestRuleExpr) => {
    localSourceKeyRef.current = taskPricingSourceKey({
      modelName,
      schema,
      billingExpr: nextBillingExpr,
      requestRuleExpr: nextRequestRuleExpr,
    });
  };

  useEffect(() => {
    if (sourceKey === localSourceKeyRef.current) {
      localSourceKeyRef.current = null;
      return;
    }
    if (!hasSchema(schema)) {
      setMatrix(null);
      setRawExpr('');
      setMode('raw');
      return;
    }
    const expression = billingExpr ?? '';
    const parsed = tryParseTaskMatrixConfig(expression, schema);
    setMatrix(parsed ?? createDefaultTaskMatrixConfig(schema));
    setRawExpr(combinedExpression);
    setMode(parsed || !expression ? 'visual' : 'raw');
  }, [billingExpr, combinedExpression, schema, sourceKey]);

  useEffect(() => {
    setPreviewFacts(createPreviewFacts(schema, examples));
  }, [examples, modelName, schema]);

  const numberFields = useMemo(() => getTaskNumberFields(schema), [schema]);
  const enumFields = useMemo(() => getTaskEnumFields(schema), [schema]);

  const buildMatrixExpression = (nextMatrix) =>
    generateTaskExprFromConfig(
      { tiers: taskMatrixToTiers(nextMatrix, schema) },
      schema,
    );

  const publishMatrix = (nextMatrix) => {
    const nextBillingExpr = buildMatrixExpression(nextMatrix);
    setMatrix(nextMatrix);
    markLocalUpdate(nextBillingExpr, requestRuleExpr);
    onBillingExprChange(nextBillingExpr);
  };

  const updateRow = (rowIndex, updater) => {
    if (!matrix) return;
    publishMatrix({
      rows: matrix.rows.map((row, index) =>
        index === rowIndex ? updater(row) : row,
      ),
    });
  };

  const handleRawChange = (value) => {
    setRawExpr(value);
    const split = splitBillingExprAndRequestRules(value);
    markLocalUpdate(split.billingExpr, split.requestRuleExpr);
    onBillingExprChange(split.billingExpr);
    onRequestRuleExprChange(split.requestRuleExpr);
  };

  const handleRequestRuleChange = (value) => {
    markLocalUpdate(billingExpr, value);
    onRequestRuleExprChange(value);
  };

  const handleModeChange = (nextMode) => {
    if (nextMode === mode) return;
    if (nextMode === 'raw') {
      setRawExpr(combinedExpression);
      setMode('raw');
      return;
    }
    if (billingExpr && !tryParseTaskMatrixConfig(billingExpr, schema)) {
      setConfirmVisualSwitch(true);
      return;
    }
    setMode('visual');
  };

  const switchToVisual = () => {
    const parsed = tryParseTaskMatrixConfig(billingExpr, schema);
    const nextMatrix = parsed ?? createDefaultTaskMatrixConfig(schema);
    setMatrix(nextMatrix);
    if (!parsed) {
      const nextBillingExpr = buildMatrixExpression(nextMatrix);
      markLocalUpdate(nextBillingExpr, '');
      onBillingExprChange(nextBillingExpr);
      onRequestRuleExprChange('');
    }
    setConfirmVisualSwitch(false);
    setMode('visual');
  };

  const handleClear = () => {
    markLocalUpdate('', '');
    onBillingExprChange('');
    onRequestRuleExprChange('');
  };

  const rawSplit = splitBillingExprAndRequestRules(rawExpr);
  const previewBillingExpr =
    mode === 'visual' && matrix
      ? buildMatrixExpression(matrix)
      : rawSplit.billingExpr;
  const previewExpression = combineBillingExpr(
    previewBillingExpr,
    mode === 'visual' ? requestRuleExpr : rawSplit.requestRuleExpr,
  );
  const previewConfig = useMemo(
    () => tryParseTaskVisualConfig(previewBillingExpr, schema),
    [previewBillingExpr, schema],
  );
  const previews = useMemo(
    () => evaluateTaskUsageExamples(previewBillingExpr, schema, examples),
    [examples, previewBillingExpr, schema],
  );
  const livePreview = useMemo(
    () =>
      previewConfig
        ? evaluateTaskVisualConfig(previewConfig, previewFacts, schema)
        : null,
    [previewConfig, previewFacts, schema],
  );
  const updatePreviewFact = (field, value) => {
    setPreviewFacts((current) => ({ ...current, [field]: value }));
  };

  if (!hasSchema(schema)) {
    return (
      <Banner
        type='warning'
        closeIcon={null}
        description={t('该模型没有声明任务用量 schema，无法配置规格计费。')}
      />
    );
  }

  const matrixColumns = [
    {
      title: t('规格组合'),
      dataIndex: '__label',
      width: 160,
      render: (text) => <Tag>{text}</Tag>,
    },
    ...numberFields.map(([field, definition]) => ({
      title: `${t('每')}${fieldLabel(field, definition)}${t('单价')}`,
      dataIndex: field,
      width: 184,
      render: (_, row, rowIndex) => (
        <InputNumber
          min={0}
          step={definition.unit === 'token' ? 0.001 : 0.000001}
          value={row.unitPrices?.[field] ?? 0}
          prefix='$'
          suffix={`/${UNIT_LABELS[definition.unit] ?? field}`}
          onChange={(nextValue) =>
            updateRow(rowIndex, (current) => ({
              ...current,
              unitPrices: {
                ...current.unitPrices,
                [field]: toPrice(nextValue),
              },
            }))
          }
        />
      ),
    })),
    {
      title: t('每次附加费用'),
      dataIndex: 'constant',
      width: 164,
      render: (_, row, rowIndex) => (
        <InputNumber
          min={0}
          step={0.000001}
          value={row.constant ?? 0}
          prefix='$'
          suffix={`/${t('次')}`}
          onChange={(nextValue) =>
            updateRow(rowIndex, (current) => ({
              ...current,
              constant: toPrice(nextValue),
            }))
          }
        />
      ),
    },
  ];

  return (
    <div>
      <Modal
        title={t('切换到可视化矩阵')}
        visible={confirmVisualSwitch}
        okText={t('切换并重建矩阵')}
        cancelText={t('保留表达式')}
        onCancel={() => setConfirmVisualSwitch(false)}
        onOk={switchToVisual}
      >
        <Typography.Paragraph>
          {t(
            '当前表达式不能完整映射到价格矩阵。确认后会用空白规格矩阵替换表达式和请求规则，变更仅在点击“应用更改”后保存。',
          )}
        </Typography.Paragraph>
      </Modal>
      <Banner
        type='info'
        closeIcon={null}
        style={{ marginBottom: 12 }}
        description={t(
          '规格价格会随模型配置版本保存；已提交任务使用提交时冻结的价格快照。',
        )}
      />
      <div style={{ padding: 16, background: 'var(--semi-color-fill-0)' }}>
        <div className='mb-3 flex items-center justify-between gap-3'>
          <div>
            <Typography.Text strong>{t('任务规格定价')}</Typography.Text>
            <Typography.Text type='tertiary' className='ml-2'>
              {modelName}
            </Typography.Text>
          </div>
          {billingExpr || requestRuleExpr ? (
            <Button
              icon={<IconDelete />}
              size='small'
              type='danger'
              theme='borderless'
              onClick={handleClear}
            >
              {t('清除配置')}
            </Button>
          ) : null}
        </div>
        <div className='mb-4 flex flex-wrap gap-2'>
          {enumFields.map(([field, definition]) => (
            <Tag key={field} color='blue'>
              {fieldLabel(field, definition)}:{' '}
              {(definition.enum ?? []).join(' / ')}
            </Tag>
          ))}
          {numberFields.map(([field, definition]) => (
            <Tag key={field} color='grey'>
              {fieldLabel(field, definition)} (
              {UNIT_LABELS[definition.unit] ?? definition.unit})
            </Tag>
          ))}
        </div>
        <Tabs type='button' activeKey={mode} onChange={handleModeChange}>
          <Tabs.TabPane tab={t('可视化矩阵')} itemKey='visual'>
            {matrix?.rows?.length ? (
              <Table
                columns={matrixColumns}
                dataSource={matrix.rows.map((row) => ({
                  ...row,
                  __label: taskMatrixRowLabel(row.combination),
                }))}
                rowKey='__label'
                pagination={false}
                size='small'
                scroll={{ x: 760 }}
              />
            ) : (
              <Banner
                type='warning'
                closeIcon={null}
                description={t(
                  '该 schema 缺少可计量字段，无法生成任务计费表达式。',
                )}
              />
            )}
            <Typography.Text
              type='tertiary'
              style={{ display: 'block', marginTop: 10 }}
            >
              {t('每一行对应一个规格组合；保存时会生成可审计的计费表达式。')}
            </Typography.Text>
            {matrix?.rows?.length ? (
              <div style={{ marginTop: 14 }}>
                <Typography.Text strong>{t('请求规则')}</Typography.Text>
                <TextArea
                  value={requestRuleExpr}
                  onChange={handleRequestRuleChange}
                  autosize={{ minRows: 2, maxRows: 5 }}
                  placeholder='when(header("x-priority") == "high") * 2'
                  style={{ marginTop: 6 }}
                />
              </div>
            ) : null}
          </Tabs.TabPane>
          <Tabs.TabPane tab={t('表达式')} itemKey='raw'>
            <Banner
              type='info'
              closeIcon={null}
              style={{ marginBottom: 10 }}
              description={t('可用参数：{{fields}}', {
                fields: Object.keys(schema)
                  .sort((left, right) => left.localeCompare(right))
                  .map((field) => `u(${JSON.stringify(field)})`)
                  .join(', '),
              })}
            />
            <TextArea
              value={rawExpr}
              onChange={handleRawChange}
              autosize={{ minRows: 8, maxRows: 18 }}
              placeholder={
                'u("resolution") == "2K" ? tier("2K", u("seconds") * 0.1) : tier("768P", u("seconds") * 0.05)'
              }
            />
            <Typography.Text
              type='tertiary'
              style={{ display: 'block', marginTop: 10 }}
            >
              {t(
                '用 u("字段") 引用插件声明的用量事实；tier(名称, 价格) 记录结算档位。',
              )}
            </Typography.Text>
          </Tabs.TabPane>
        </Tabs>
      </div>
      {examples.length > 0 ? (
        <div style={{ marginTop: 18 }}>
          <Typography.Text strong>{t('任务价格预估')}</Typography.Text>
          <Typography.Text
            type='tertiary'
            style={{ display: 'block', marginTop: 4 }}
          >
            {t(
              '按当前规格预览基础价格；分组倍率和请求规则会在结算时额外应用。',
            )}
          </Typography.Text>
          {examples.length > 0 ? (
            <Select
              style={{ width: '100%', marginTop: 10 }}
              placeholder={t('选择规格示例')}
              value={
                examples.find((example) =>
                  Object.entries(example.facts ?? {}).every(
                    ([field, value]) => previewFacts[field] === value,
                  ),
                )?.label
              }
              optionList={examples.map((example) => ({
                label: example.label,
                value: example.label,
              }))}
              onChange={(label) => {
                const example = examples.find((item) => item.label === label);
                if (example) setPreviewFacts({ ...example.facts });
              }}
            />
          ) : null}
          <div
            style={{
              display: 'grid',
              gap: 10,
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              marginTop: 10,
            }}
          >
            {enumFields.map(([field, definition]) => (
              <div key={field}>
                <Typography.Text type='tertiary'>
                  {fieldLabel(field, definition)}
                </Typography.Text>
                <Select
                  style={{ marginTop: 4, width: '100%' }}
                  value={previewFacts[field] ?? ''}
                  optionList={(definition.enum ?? []).map((value) => ({
                    label: value,
                    value,
                  }))}
                  onChange={(value) => updatePreviewFact(field, value)}
                />
              </div>
            ))}
            {numberFields.map(([field, definition]) => (
              <div key={field}>
                <Typography.Text type='tertiary'>
                  {fieldLabel(field, definition)} (
                  {UNIT_LABELS[definition.unit] ?? definition.unit})
                </Typography.Text>
                <InputNumber
                  style={{ marginTop: 4, width: '100%' }}
                  min={0}
                  value={previewFacts[field] ?? 0}
                  onChange={(value) => updatePreviewFact(field, toPrice(value))}
                />
              </div>
            ))}
          </div>
          {livePreview ? (
            <div
              style={{
                marginTop: 10,
                padding: 12,
                background: 'var(--semi-color-primary-light-default)',
              }}
            >
              <Typography.Text type='tertiary'>
                {t('当前规格预估价格')}
              </Typography.Text>
              <Typography.Text
                strong
                style={{ display: 'block', marginTop: 4 }}
              >
                ${Number(livePreview.total).toFixed(6)}
              </Typography.Text>
            </div>
          ) : (
            <Typography.Text
              type='tertiary'
              style={{ display: 'block', marginTop: 10 }}
            >
              {t('自定义表达式将在保存时由服务端校验。')}
            </Typography.Text>
          )}
          <Typography.Text strong style={{ display: 'block', marginTop: 18 }}>
            {t('规格示例预览')}
          </Typography.Text>
          {previews.length > 0 ? (
            <Table
              style={{ marginTop: 8 }}
              columns={[
                {
                  title: t('示例'),
                  dataIndex: 'label',
                  render: (label) => <Tag>{label}</Tag>,
                },
                {
                  title: t('用量'),
                  dataIndex: 'facts',
                  render: (facts) => formatFacts(facts, schema),
                },
                {
                  title: t('预估价格'),
                  dataIndex: 'total',
                  width: 140,
                  render: (total) => (
                    <Typography.Text strong>
                      ${Number(total).toFixed(6)}
                    </Typography.Text>
                  ),
                },
              ]}
              dataSource={previews}
              rowKey='label'
              pagination={false}
              size='small'
              scroll={{ x: 680 }}
            />
          ) : (
            <Typography.Text type='tertiary'>
              {t('自定义表达式将在保存时由服务端校验。')}
            </Typography.Text>
          )}
          <Typography.Text
            type='tertiary'
            style={{ display: 'block', marginTop: 8, wordBreak: 'break-all' }}
          >
            {previewExpression}
          </Typography.Text>
        </div>
      ) : null}
    </div>
  );
}
