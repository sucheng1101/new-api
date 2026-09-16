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

/*
 * 任务用量计费的"规范表达式"逻辑库。
 *
 * 自官方 v1.0.0-rc.37 web/src/features/pricing/lib/task-expr.ts 移植并适配：
 * - 官方的往返解析依赖其自带 expr-lang 解析器（parser.ts/structure.ts，约 2000 行）；
 *   本 Fork 只需要往返"可视化编辑器自己生成的规范形态"，这里用紧凑解析器实现，
 *   超出规范形态的表达式（手写复杂分支）自动回退为纯表达式模式。
 * - 预览求值同样用本地算术实现（规范 tier 结构下与表达式语义一致）。
 *
 * 规范形态（与官方 generateTaskExprFromConfig 输出一致）：
 *   tier("base", 0.5 + u("seconds") * 0.03)
 *   u("resolution") == "720p" ? tier("720p", u("seconds") * 1) : tier("base", u("seconds") * 2)
 *   条件用 && 连接；token 单位字段写作 u("tokens") * price / 1000000
 */

export const TASK_TOKEN_PRICE_SCALE = 1000000;

export function getTaskNumberFields(schema) {
  if (!schema) return [];
  return Object.entries(schema)
    .filter((entry) => entry[1].type === 'number' && Boolean(entry[1].unit))
    .sort(([left], [right]) => left.localeCompare(right));
}

export function canRenderTaskPricingMatrix(matrix, schema) {
  return Boolean(matrix?.rows?.length && getTaskNumberFields(schema).length);
}

export function getTaskEnumFields(schema) {
  if (!schema) return [];
  return Object.entries(schema)
    .filter((entry) => Boolean(entry[1].enum?.length))
    .sort(([left], [right]) => left.localeCompare(right));
}

export function getTaskEnumCombinations(schema) {
  let combinations = [{}];
  for (const [field, definition] of getTaskEnumFields(schema)) {
    const nextCombinations = [];
    for (const combination of combinations) {
      for (const value of definition.enum ?? []) {
        nextCombinations.push({ ...combination, [field]: value });
      }
    }
    combinations = nextCombinations;
  }
  return combinations;
}

export function createDefaultTaskVisualConfig(schema) {
  return {
    tiers: [
      {
        label: 'base',
        conditions: [],
        constant: 0,
        unitPrices: Object.fromEntries(
          getTaskNumberFields(schema).map(([field]) => [field, 0]),
        ),
      },
    ],
  };
}

export function createDefaultTaskMatrixConfig(schema) {
  const unitPrices = Object.fromEntries(
    getTaskNumberFields(schema).map(([field]) => [field, 0]),
  );
  return {
    rows: getTaskEnumCombinations(schema).map((combination) => ({
      combination,
      constant: 0,
      unitPrices: { ...unitPrices },
    })),
  };
}

export function taskMatrixRowLabel(combination) {
  const values = Object.entries(combination)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => value);
  return values.length > 0 ? values.join('·') : 'base';
}

export function taskMatrixToTiers(config, schema) {
  const numberFields = getTaskNumberFields(schema);
  const firstRow = config.rows[0];
  if (numberFields.length === 0 || !firstRow) return [];

  const isUniform = config.rows.every(
    (row) =>
      row.constant === firstRow.constant &&
      numberFields.every(
        ([field]) => row.unitPrices[field] === firstRow.unitPrices[field],
      ),
  );
  if (isUniform) {
    return [
      {
        label: 'base',
        conditions: [],
        constant: firstRow.constant,
        unitPrices: Object.fromEntries(
          numberFields.map(([field]) => [
            field,
            firstRow.unitPrices[field] ?? 0,
          ]),
        ),
      },
    ];
  }

  return config.rows.map((row, index) => ({
    label: taskMatrixRowLabel(row.combination),
    conditions:
      index === config.rows.length - 1
        ? []
        : Object.entries(row.combination)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([field, value]) => ({ field, value })),
    constant: row.constant,
    unitPrices: Object.fromEntries(
      numberFields.map(([field]) => [field, row.unitPrices[field] ?? 0]),
    ),
  }));
}

// ---------------------------------------------------------------------------
// 规范形态解析（紧凑实现，替代官方 parser.ts/structure.ts 的完整解析链）
// ---------------------------------------------------------------------------

function splitTopLevel(text, separator) {
  const parts = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let current = '';
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      current += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      current += char;
      continue;
    }
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (
      depth === 0 &&
      text.startsWith(separator, index) &&
      !/\d/.test(separator[0])
    ) {
      parts.push(current);
      current = '';
      index += separator.length - 1;
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

function findTopLevelToken(text, token) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (depth === 0 && text.startsWith(token, index)) return index;
  }
  return -1;
}

function parseConditionExpression(text) {
  const conditions = [];
  for (const rawCondition of splitTopLevel(text, '&&')) {
    const match = rawCondition.match(
      /^u\(\s*"((?:[^"\\]|\\.)*)"\s*\)\s*==\s*("(?:[^"\\]|\\.)*"|true|false|-?\d+(?:\.\d+)?)$/,
    );
    if (!match) return null;
    let value = match[2];
    if (value.startsWith('"')) {
      try {
        value = JSON.parse(value);
      } catch {
        return null;
      }
    } else if (value === 'true' || value === 'false') {
      value = value === 'true';
    } else {
      value = Number(value);
    }
    conditions.push({ field: match[1], value });
  }
  return conditions;
}

function parseTierCall(text, schema) {
  const match = text.match(/^tier\(\s*"((?:[^"\\]|\\.)*)"\s*,\s*(.*)\)$/s);
  if (!match) return null;
  const label = match[1];
  let constant = 0;
  const unitPrices = {};
  for (const rawTerm of splitTopLevel(match[2], '+')) {
    const numberMatch = rawTerm.match(/^-?\d+(\.\d+)?$/);
    if (numberMatch) {
      constant += Number(rawTerm);
      continue;
    }
    const usageMatch = rawTerm.match(
      /^u\(\s*"((?:[^"\\]|\\.)*)"\s*\)\s*\*\s*(-?\d+(?:\.\d+)?)(\s*\/\s*1000000)?$/,
    );
    if (!usageMatch) return null;
    const field = usageMatch[1];
    const price = Number(usageMatch[2]);
    const hasTokenScale = Boolean(usageMatch[3]);
    const isTokenUnit = schema?.[field]?.unit === 'token';
    // 规范形态：token 字段必须带 /1000000 缩放，非 token 字段必须不带
    if (hasTokenScale !== isTokenUnit) return null;
    unitPrices[field] = price;
  }
  return { label, constant, unitPrices };
}

export function parseTaskTiersFromCanonicalExpr(exprStr, schema) {
  if (!exprStr || !schema || Object.keys(schema).length === 0) return [];
  let remaining = exprStr.trim();
  const tiers = [];
  while (remaining) {
    const questionMark = findTopLevelToken(remaining, ' ? ');
    if (questionMark === -1) {
      const fallback = parseTierCall(remaining, schema);
      if (!fallback) return [];
      tiers.push({ ...fallback, conditions: [] });
      break;
    }

    const conditions = parseConditionExpression(
      remaining.slice(0, questionMark),
    );
    if (!conditions) return [];
    const trueAndFallback = remaining.slice(questionMark + 3);
    const colon = findTopLevelToken(trueAndFallback, ' : ');
    if (colon === -1) return [];
    const call = parseTierCall(trueAndFallback.slice(0, colon), schema);
    if (!call) return [];
    tiers.push({ ...call, conditions });
    remaining = trueAndFallback.slice(colon + 3).trim();
  }
  if (tiers.length === 0) return [];
  const fallback = tiers[tiers.length - 1];
  if (fallback.conditions.length !== 0) return [];
  return tiers;
}

export function normalizeTaskVisualConfig(config, schema) {
  if (!config?.tiers?.length) return createDefaultTaskVisualConfig(schema);
  const numberFields = new Set(
    getTaskNumberFields(schema).map(([field]) => field),
  );
  const enumFields = new Map(
    getTaskEnumFields(schema).map(([field, definition]) => [
      field,
      definition.enum ?? [],
    ]),
  );

  return {
    tiers: config.tiers.map((tier, index) => {
      const unitPrices = Object.fromEntries(
        [...numberFields].map((field) => {
          const value = Number(tier.unitPrices?.[field]);
          return [field, Number.isFinite(value) && value >= 0 ? value : 0];
        }),
      );
      const constant = Number(tier.constant);
      return {
        label: tier.label || (index === 0 ? 'base' : `tier_${index + 1}`),
        conditions: (tier.conditions ?? []).filter((condition) =>
          enumFields.get(condition.field)?.includes(condition.value),
        ),
        constant: Number.isFinite(constant) && constant >= 0 ? constant : 0,
        unitPrices,
      };
    }),
  };
}

export function tryParseTaskVisualConfig(expression, schema) {
  if (!expression) return null;
  const tiers = parseTaskTiersFromCanonicalExpr(expression, schema);
  if (tiers.length === 0) return null;
  return normalizeTaskVisualConfig({ tiers }, schema);
}

export function tryParseTaskMatrixConfig(expression, schema) {
  if (!expression) return null;
  const tiers = parseTaskTiersFromCanonicalExpr(expression, schema);
  if (tiers.length === 0) return null;

  const numberFields = getTaskNumberFields(schema);
  const combinations = getTaskEnumCombinations(schema);
  const fallbackTier = tiers[tiers.length - 1];
  if (!fallbackTier || fallbackTier.conditions.length !== 0) return null;

  for (const tier of tiers) {
    const fields = new Set(tier.conditions.map((condition) => condition.field));
    if (fields.size !== tier.conditions.length) return null;
  }

  const rows = combinations.map((combination) => {
    const tier =
      tiers.find((candidate) =>
        candidate.conditions.every(
          (condition) => combination[condition.field] === condition.value,
        ),
      ) ?? fallbackTier;
    return {
      combination,
      constant: tier.constant,
      unitPrices: Object.fromEntries(
        numberFields.map(([field]) => [field, tier.unitPrices[field] ?? 0]),
      ),
    };
  });
  return { rows };
}

// ---------------------------------------------------------------------------
// 生成与预览
// ---------------------------------------------------------------------------

function generateTaskTierBody(tier, numberFields) {
  const parts = [];
  if (tier.constant > 0) parts.push(String(tier.constant));
  for (const [field, definition] of numberFields) {
    const price = tier.unitPrices[field] ?? 0;
    if (definition.unit === 'token') {
      parts.push(
        `u(${JSON.stringify(field)}) * ${price} / ${TASK_TOKEN_PRICE_SCALE}`,
      );
      continue;
    }
    parts.push(`u(${JSON.stringify(field)}) * ${price}`);
  }
  return parts.join(' + ');
}

function generateTaskTierCall(tier, numberFields) {
  return `tier(${JSON.stringify(tier.label)}, ${generateTaskTierBody(tier, numberFields)})`;
}

function generateTaskCondition(conditions) {
  return conditions
    .map(
      (condition) =>
        `u(${JSON.stringify(condition.field)}) == ${JSON.stringify(condition.value)}`,
    )
    .join(' && ');
}

export function generateTaskExprFromConfig(config, schema) {
  const numberFields = getTaskNumberFields(schema);
  if (numberFields.length === 0) return '';
  const normalized = normalizeTaskVisualConfig(config, schema);
  if (normalized.tiers.length === 1) {
    return generateTaskTierCall(normalized.tiers[0], numberFields);
  }

  const parts = [];
  for (let index = 0; index < normalized.tiers.length; index += 1) {
    const tier = normalized.tiers[index];
    const call = generateTaskTierCall(tier, numberFields);
    if (index === normalized.tiers.length - 1) {
      parts.push(call);
      continue;
    }
    const condition = generateTaskCondition(tier.conditions);
    if (!condition) return '';
    parts.push(`${condition} ? ${call}`);
  }
  return parts.join(' : ');
}

export function evaluateTaskVisualConfig(config, sample, schema) {
  const fallback = config.tiers[config.tiers.length - 1];
  if (!fallback) return null;

  let matchedTier = fallback;
  for (const tier of config.tiers.slice(0, -1)) {
    const matches = tier.conditions.every(
      (condition) => sample[condition.field] === condition.value,
    );
    if (matches) {
      matchedTier = tier;
      break;
    }
  }

  const constant = Number(matchedTier.constant);
  if (!Number.isFinite(constant) || constant < 0) return null;

  const parts = [];
  if (constant > 0) {
    parts.push({ kind: 'constant', amount: constant });
  }

  let total = constant;
  for (const [field, rawUnitPrice] of Object.entries(matchedTier.unitPrices)) {
    const unitPrice = Number(rawUnitPrice);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) return null;
    if (unitPrice === 0) continue;

    const quantity = Number(sample[field]);
    if (!Number.isFinite(quantity) || quantity < 0) return null;
    const isToken = schema?.[field]?.unit === 'token';
    const amount = isToken
      ? (quantity * unitPrice) / TASK_TOKEN_PRICE_SCALE
      : quantity * unitPrice;
    if (!Number.isFinite(amount)) return null;
    parts.push({ kind: 'usage', field, amount, quantity, unitPrice });
    total += amount;
  }

  return { tier: matchedTier, total, parts };
}

export function evaluateTaskUsageExamples(expression, schema, examples) {
  if (!expression || !schema || !examples?.length) return [];
  const config = tryParseTaskVisualConfig(expression, schema);
  if (!config) return [];
  const rows = [];
  for (const example of examples) {
    const result = evaluateTaskVisualConfig(config, example.facts, schema);
    if (!result) continue;
    rows.push({
      label: example.label,
      facts: example.facts,
      total: result.total,
    });
  }
  return rows;
}
