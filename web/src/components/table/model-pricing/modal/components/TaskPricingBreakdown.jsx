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

import React, { useMemo } from 'react';
import { Avatar, Table, Tag, Typography } from '@douyinfe/semi-ui';
import { IconCoinMoneyStroked } from '@douyinfe/semi-icons';
import { Layers3, UsersRound } from 'lucide-react';

import {
  evaluateTaskUsageExamples,
  getTaskNumberFields,
  parseTaskTiersFromCanonicalExpr,
} from '../../../../../pages/Setting/Ratio/components/task-expr';
import './TaskPricingBreakdown.css';

const { Text } = Typography;

const UNIT_LABELS = {
  second: '秒',
  count: '次',
  token: '1M token',
  credit: 'credit',
};

function localizedText(value) {
  if (typeof value === 'string') return value;
  return value?.zh ?? value?.en ?? '';
}

function fieldLabel(field, definition) {
  return localizedText(definition?.description) || field;
}

function unitLabel(definition, t) {
  if (definition?.unit === 'count') {
    return localizedText(definition?.unitLabel) || t('次');
  }
  return t(UNIT_LABELS[definition?.unit] ?? definition?.unit ?? '次');
}

function tierLabel(tier, schema, t) {
  if (!tier.conditions?.length) return t('全部规格');
  return tier.conditions
    .map(({ field, value }) => {
      const definition = schema?.[field];
      const label = fieldLabel(field, definition);
      const enumLabel = localizedText(definition?.enumLabels?.[value]) || value;
      return enumLabel === value ? `${label}: ${enumLabel}` : enumLabel;
    })
    .join(' · ');
}

function formatPrice(value, definition, ratio, displayPrice, t) {
  const price = Number(value);
  if (!Number.isFinite(price) || price < 0) return '-';
  if (price === 0) return t('免费');
  return `${displayPrice(price * ratio)}/${unitLabel(definition, t)}`;
}

function formatFacts(facts, schema) {
  return Object.entries(facts ?? {})
    .map(([field, value]) => {
      const definition = schema?.[field];
      const label = fieldLabel(field, definition);
      const enumLabel = localizedText(definition?.enumLabels?.[value]) || value;
      const suffix = definition?.unit
        ? ` ${UNIT_LABELS[definition.unit] ?? definition.unit}`
        : '';
      return `${label}: ${enumLabel}${suffix}`;
    })
    .join(' · ');
}

function availableGroups(modelData, usableGroup, groupRatio) {
  const enabled = Array.isArray(modelData?.enable_groups)
    ? modelData.enable_groups
    : [];
  const groups = Object.keys(usableGroup ?? {}).filter(
    (group) =>
      group !== '' &&
      group !== 'auto' &&
      (enabled.includes('all') || enabled.includes(group)),
  );
  if (groups.length) {
    return groups.map((group) => ({
      key: group,
      ratio: Number(groupRatio?.[group]) || 1,
    }));
  }
  return [{ key: 'default', ratio: 1, fallback: true }];
}

function SpecificationExamples({ rows, ratio, displayPrice, schema, t }) {
  if (!rows.length) return null;
  return (
    <div className='task-pricing-example-section'>
      <Text
        type='tertiary'
        size='small'
        className='task-pricing-example-heading'
      >
        {t('常用规格价格')}
      </Text>
      <div className='task-pricing-example-list'>
        {rows.map((row) => (
          <div className='task-pricing-example' key={row.label}>
            <div className='task-pricing-example-copy'>
              <Text strong className='task-pricing-example-label'>
                {row.label}
              </Text>
              <Text type='tertiary' size='small'>
                {formatFacts(row.facts, schema)}
              </Text>
            </div>
            <Text strong className='task-pricing-example-value'>
              {row.total === 0 ? t('免费') : displayPrice(row.total * ratio)}
            </Text>
          </div>
        ))}
      </div>
    </div>
  );
}

function TierSpecification({ tier, schema, t }) {
  const facts = tier.conditions
    .map(({ field, value }) => {
      const definition = schema?.[field];
      return localizedText(definition?.enumLabels?.[value]) || value;
    })
    .join(' · ');

  return (
    <div className='task-pricing-tier-cell'>
      <Tag color='blue'>{tierLabel(tier, schema, t)}</Tag>
      <Text type='tertiary' size='small'>
        {facts || t('适用于所有规格')}
      </Text>
    </div>
  );
}

function GroupHeading({ group, t }) {
  return (
    <div className='task-pricing-group-name'>
      <span className='task-pricing-group-icon'>
        <UsersRound size={15} />
      </span>
      <div>
        <Text strong>{group.fallback ? t('默认分组') : group.key}</Text>
        <Text type='tertiary' size='small'>
          {t('用户分组价格')}
        </Text>
      </div>
    </div>
  );
}

function PluginAddonPricing({ addon, groups, displayPrice, t }) {
  const schema = addon?.usage_schema ?? {};
  const expression = addon?.billing_expr ?? '';
  const numberFields = useMemo(() => getTaskNumberFields(schema), [schema]);
  const tiers = useMemo(
    () => parseTaskTiersFromCanonicalExpr(expression, schema),
    [expression, schema],
  );
  const examples = useMemo(
    () =>
      evaluateTaskUsageExamples(
        expression,
        schema,
        addon?.usage_examples ?? [],
      ),
    [addon?.usage_examples, expression, schema],
  );
  const hasConstantFee = tiers.some((tier) => Number(tier.constant) > 0);
  const columns = [
    {
      title: t('适用附加规格'),
      key: 'tier',
      width: 198,
      render: (_, tier) => (
        <TierSpecification tier={tier} schema={schema} t={t} />
      ),
    },
    ...numberFields.map(([field, definition]) => ({
      title: `${t('每')}${fieldLabel(field, definition)} / ${unitLabel(definition, t)}`,
      key: field,
      width: 170,
      render: (_, tier, __, context) =>
        formatPrice(
          tier.unitPrices?.[field] ?? 0,
          definition,
          context?.ratio ?? 1,
          displayPrice,
          t,
        ),
    })),
    ...(hasConstantFee
      ? [
          {
            title: t('每次附加费用'),
            key: 'constant',
            width: 154,
            render: (_, tier, __, context) =>
              formatPrice(
                tier.constant ?? 0,
                { unit: 'count', unitLabel: { zh: '次', en: 'request' } },
                context?.ratio ?? 1,
                displayPrice,
                t,
              ),
          },
        ]
      : []),
  ];

  if (!expression || tiers.length === 0) return null;
  const pluginName = addon?.plugin_name || addon?.plugin_key || t('任务插件');
  return (
    <section className='task-pricing-addon'>
      <div className='task-pricing-addon-heading'>
        <Avatar size='small' color='cyan'>
          {pluginName.slice(0, 1).toUpperCase()}
        </Avatar>
        <div>
          <Text strong>{pluginName}</Text>
          <Text type='tertiary' size='small'>
            {t('插件独有用量附加价，实际选中该插件时叠加到基础价格')}
          </Text>
        </div>
      </div>
      <div className='task-pricing-group-list'>
        {groups.map((group) => (
          <div className='task-pricing-group' key={`${addon.plugin_key}-${group.key}`}>
            <div className='task-pricing-group-header'>
              <GroupHeading group={group} t={t} />
              <Tag color='cyan' shape='circle'>
                {group.ratio}x
              </Tag>
            </div>
            <Table
              className='task-pricing-group-table'
              columns={columns.map((column) => ({
                ...column,
                render: (value, tier, index) =>
                  column.render(value, tier, index, group),
              }))}
              dataSource={tiers}
              rowKey={(tier, index) =>
                `${addon.plugin_key}-${group.key}-${tier.label || index}`
              }
              pagination={false}
              size='small'
              scroll={{ x: 720 }}
            />
            <SpecificationExamples
              rows={examples}
              ratio={group.ratio}
              displayPrice={displayPrice}
              schema={schema}
              t={t}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

export default function TaskPricingBreakdown({
  modelData,
  groupRatio,
  usableGroup,
  displayPrice,
  t,
}) {
  const schema = modelData?.billing_usage_schema ?? {};
  const expression = modelData?.billing_expr ?? '';
  const numberFields = useMemo(() => getTaskNumberFields(schema), [schema]);
  const tiers = useMemo(
    () => parseTaskTiersFromCanonicalExpr(expression, schema),
    [expression, schema],
  );
  const examples = useMemo(
    () =>
      evaluateTaskUsageExamples(
        expression,
        schema,
        modelData?.billing_usage_examples ?? [],
      ),
    [expression, modelData?.billing_usage_examples, schema],
  );
  const groups = useMemo(
    () => availableGroups(modelData, usableGroup, groupRatio),
    [groupRatio, modelData, usableGroup],
  );
  const hasConstantFee = tiers.some((tier) => Number(tier.constant) > 0);
  const pluginAddons = Array.isArray(modelData?.billing_plugin_addons)
    ? modelData.billing_plugin_addons
    : [];

  const columns = [
    {
      title: t('适用规格'),
      key: 'tier',
      width: 198,
      render: (_, tier) => (
        <TierSpecification tier={tier} schema={schema} t={t} />
      ),
    },
    ...numberFields.map(([field, definition]) => ({
      title: `${t('每')}${fieldLabel(field, definition)} / ${unitLabel(definition, t)}`,
      key: field,
      width: 170,
      render: (_, tier, __, context) =>
        formatPrice(
          tier.unitPrices?.[field] ?? 0,
          definition,
          context?.ratio ?? 1,
          displayPrice,
          t,
        ),
    })),
    ...(hasConstantFee
      ? [
          {
            title: t('每次附加费用'),
            key: 'constant',
            width: 154,
            render: (_, tier, __, context) =>
              formatPrice(
                tier.constant ?? 0,
                { unit: 'count', unitLabel: { zh: '次', en: 'request' } },
                context?.ratio ?? 1,
                displayPrice,
                t,
              ),
          },
        ]
      : []),
  ];

  return (
    <section className='task-pricing-breakdown'>
      <div className='task-pricing-breakdown-heading'>
        <Avatar size='small' color='orange' className='shadow-md'>
          <IconCoinMoneyStroked size={16} />
        </Avatar>
        <div>
          <Text className='task-pricing-section-title'>{t('按规格计费')}</Text>
          <div className='task-pricing-section-description'>
            {t('按分辨率、时长等已声明规格展示当前用户分组价格')}
          </div>
        </div>
      </div>

      {!expression ? (
        <div className='task-pricing-unconfigured'>
          <Layers3 size={17} />
          <span>{t('该模型已声明规格参数，管理员尚未配置规格价格。')}</span>
        </div>
      ) : tiers.length === 0 ? (
        <div className='task-pricing-unconfigured'>
          <Layers3 size={17} />
          <span>{t('当前表达式不能展开为规格价格表。')}</span>
        </div>
      ) : (
        <div className='task-pricing-group-list'>
          {groups.map((group) => (
            <div className='task-pricing-group' key={group.key}>
              <div className='task-pricing-group-header'>
                <GroupHeading group={group} t={t} />
                <Tag color='grey' shape='circle'>
                  {group.ratio}x
                </Tag>
              </div>
              <Table
                className='task-pricing-group-table'
                columns={columns.map((column) => ({
                  ...column,
                  render: (value, tier, index) =>
                    column.render(value, tier, index, group),
                }))}
                dataSource={tiers}
                rowKey={(tier, index) => `${group.key}-${tier.label || index}`}
                pagination={false}
                size='small'
                scroll={{ x: 720 }}
              />
              <SpecificationExamples
                rows={examples}
                ratio={group.ratio}
                displayPrice={displayPrice}
                schema={schema}
                t={t}
              />
            </div>
          ))}
        </div>
      )}
      {pluginAddons.length > 0 ? (
        <div className='task-pricing-addon-list'>
          {pluginAddons.map((addon) => (
            <PluginAddonPricing
              key={addon.plugin_key}
              addon={addon}
              groups={groups}
              displayPrice={displayPrice}
              t={t}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
