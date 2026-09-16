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
import { describe, expect, test } from 'bun:test';

import {
  canRenderTaskPricingMatrix,
  createDefaultTaskMatrixConfig,
  evaluateTaskUsageExamples,
  generateTaskExprFromConfig,
  taskMatrixToTiers,
  tryParseTaskMatrixConfig,
} from './task-expr';

const h3Schema = {
  seconds: { type: 'number', unit: 'second' },
  resolution: { enum: ['768P', '2K'] },
  input_images: { type: 'number', unit: 'count' },
  input_video_seconds: { type: 'number', unit: 'second' },
};

describe('task pricing expression matrix', () => {
  test('round-trips the MiniMax-H3 resolution and duration matrix', () => {
    const matrix = createDefaultTaskMatrixConfig(h3Schema);
    const lowResolution = matrix.rows.find(
      (row) => row.combination.resolution === '768P',
    );
    const highResolution = matrix.rows.find(
      (row) => row.combination.resolution === '2K',
    );
    lowResolution.unitPrices.seconds = 0.05;
    highResolution.unitPrices.seconds = 0.2;

    const expression = generateTaskExprFromConfig(
      { tiers: taskMatrixToTiers(matrix, h3Schema) },
      h3Schema,
    );

    expect(tryParseTaskMatrixConfig(expression, h3Schema)).toEqual(matrix);
    expect(
      evaluateTaskUsageExamples(expression, h3Schema, [
        { label: '768P 5s', facts: { seconds: 5, resolution: '768P' } },
        { label: '2K 5s', facts: { seconds: 5, resolution: '2K' } },
      ]),
    ).toEqual([
      {
        label: '768P 5s',
        facts: { seconds: 5, resolution: '768P' },
        total: 0.25,
      },
      {
        label: '2K 5s',
        facts: { seconds: 5, resolution: '2K' },
        total: 1,
      },
    ]);
  });

  test('keeps preview facts paired with the example that evaluated', () => {
    const expression = 'tier("base", u("seconds") * 0.1)';
    const previews = evaluateTaskUsageExamples(expression, h3Schema, [
      { label: 'invalid', facts: { seconds: -1, resolution: '768P' } },
      { label: 'valid', facts: { seconds: 5, resolution: '2K' } },
    ]);

    expect(previews).toEqual([
      {
        label: 'valid',
        facts: { seconds: 5, resolution: '2K' },
        total: 0.5,
      },
    ]);
  });

  test('round-trips chained resolution tiers', () => {
    const schema = {
      seconds: { type: 'number', unit: 'second' },
      resolution: { enum: ['480P', '720P', '1080P'] },
    };
    const matrix = createDefaultTaskMatrixConfig(schema);
    matrix.rows[0].unitPrices.seconds = 0.01;
    matrix.rows[1].unitPrices.seconds = 0.02;
    matrix.rows[2].unitPrices.seconds = 0.03;

    const expression = generateTaskExprFromConfig(
      { tiers: taskMatrixToTiers(matrix, schema) },
      schema,
    );

    expect(tryParseTaskMatrixConfig(expression, schema)).toEqual(matrix);
  });

  test('keeps the Hailuo H3 resolution as an addon pricing selector', () => {
    const addonSchema = {
      resolution: { enum: ['768', '2K'] },
      input_images: { type: 'number', unit: 'count' },
      input_video_seconds: { type: 'number', unit: 'second' },
    };
    const matrix = createDefaultTaskMatrixConfig(addonSchema);

    expect(canRenderTaskPricingMatrix(matrix, addonSchema)).toBe(true);
    expect(matrix.rows.map((row) => row.combination.resolution)).toEqual([
      '768',
      '2K',
    ]);
    expect(
      canRenderTaskPricingMatrix(matrix, { reference_mode: { enum: ['a'] } }),
    ).toBe(false);
  });
});
