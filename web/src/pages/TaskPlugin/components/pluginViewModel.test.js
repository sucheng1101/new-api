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
  buildTaskPluginUploadPayload,
  buildMarketplaceSourceStates,
  buildPluginIconPlan,
  getTaskPluginUsageBlocker,
  getPluginOwnership,
  normalizeTaskPluginSourceUrl,
  PLUGIN_DETAIL_TABS,
  selectMarketplaceSourceKey,
  validateMarketplaceSources,
} from './pluginViewModel';

describe('task plugin view model', () => {
  test('labels factory, third-party, and factory override plugins distinctly', () => {
    expect(getPluginOwnership({ source: 'factory' })).toBe('factory');
    expect(getPluginOwnership({ source: 'override' })).toBe('third_party');
    expect(
      getPluginOwnership({ source: 'factory', origin: 'third_party' }),
    ).toBe('third_party');
    expect(
      getPluginOwnership({
        source: 'override_over_factory',
        factory_meta: { key: 'hailuo' },
      }),
    ).toBe('override_over_factory');
    expect(
      getPluginOwnership({
        source: 'override',
        factory_meta: { key: 'hailuo' },
      }),
    ).toBe('override_over_factory');
  });

  test('orders embedded, metadata, provider, and text icon fallbacks', () => {
    expect(
      buildPluginIconPlan({
        has_icon: true,
        meta: {
          key: 'prompt-hubs',
          name: 'Prompt Hubs Video',
          icon: 'https://cdn.example.com/prompt-hubs.svg',
          channelTypes: [61],
        },
      }),
    ).toEqual({
      key: 'prompt-hubs',
      shouldLoadEmbeddedIcon: true,
      metadataImageUrl: 'https://cdn.example.com/prompt-hubs.svg',
      metadataIconName: '',
      fallbackProvider: '',
      channelType: 61,
      fallbackLabel: 'PR',
    });

    expect(
      buildPluginIconPlan({
        meta: {
          key: 'hailuo',
          name: 'Hailuo',
          icon: 'Minimax.Color',
          channelTypes: [35],
        },
      }),
    ).toMatchObject({
      shouldLoadEmbeddedIcon: false,
      metadataImageUrl: '',
      metadataIconName: 'Minimax.Color',
      fallbackProvider: '',
      channelType: 35,
      fallbackLabel: 'HA',
    });

    expect(
      buildPluginIconPlan({
        meta: {
          key: 'sora',
          name: 'Sora',
          icon: 'Sora.Color',
          channelTypes: [55],
        },
      }),
    ).toMatchObject({
      metadataIconName: 'Sora.Color',
      fallbackProvider: 'openai',
    });

    expect(
      buildPluginIconPlan({
        meta: { key: 'upload', icon: 'data:image/svg+xml;base64,AAAA' },
      }),
    ).toMatchObject({
      metadataImageUrl: 'data:image/svg+xml;base64,AAAA',
      metadataIconName: '',
    });
  });

  test('keeps Prompt Hubs as a third-party plugin when it has no factory fallback', () => {
    expect(
      getPluginOwnership({ source: 'override', meta: { key: 'prompt-hubs' } }),
    ).toBe('third_party');
  });

  test('keeps healthy marketplace sources visible when another source fails', () => {
    const sources = [
      { name: 'Official', index_url: 'https://official.example/index.json' },
      { name: 'Broken', index_url: 'https://broken.example/index.json' },
    ];
    const states = buildMarketplaceSourceStates(sources, [
      {
        status: 'fulfilled',
        value: { name: 'Official index', indexVersion: 1, plugins: [] },
      },
      { status: 'rejected', reason: new Error('CORS blocked') },
    ]);

    expect(states['https://official.example/index.json']).toMatchObject({
      status: 'ready',
      index: { name: 'Official index' },
    });
    expect(states['https://broken.example/index.json']).toEqual({
      status: 'error',
      error: 'CORS blocked',
    });
  });

  test('retains the selected marketplace source and falls back to the first configured source', () => {
    const sources = [
      { name: 'Official', index_url: 'https://official.example/index.json' },
      { name: 'Mirror', index_url: 'https://mirror.example/index.json' },
    ];

    expect(
      selectMarketplaceSourceKey(sources, 'https://mirror.example/index.json'),
    ).toBe('https://mirror.example/index.json');
    expect(selectMarketplaceSourceKey(sources, 'https://removed.example')).toBe(
      'https://official.example/index.json',
    );
    expect(selectMarketplaceSourceKey([], 'https://official.example')).toBe('');
  });

  test('normalizes valid marketplace sources before saving', () => {
    expect(
      validateMarketplaceSources([
        {
          name: ' Official ',
          index_url: ' https://plugins.example.com/index.json ',
        },
        { name: 'Mirror', index_url: 'http://127.0.0.1:18080/index.json' },
      ]),
    ).toEqual({
      valid: true,
      sources: [
        {
          name: 'Official',
          index_url: 'https://plugins.example.com/index.json',
        },
        { name: 'Mirror', index_url: 'http://127.0.0.1:18080/index.json' },
      ],
      errors: [
        { name: '', index_url: '' },
        { name: '', index_url: '' },
      ],
    });
  });

  test('reports missing, duplicate, and non-HTTP marketplace source fields', () => {
    expect(
      validateMarketplaceSources([
        {
          name: 'Official',
          index_url: 'https://plugins.example.com/index.json',
        },
        {
          name: ' official ',
          index_url: 'https://mirror.example.com/index.json',
        },
        { name: 'Mirror', index_url: 'https://PLUGINS.example.com/index.json' },
        { name: 'FTP', index_url: 'ftp://plugins.example.com/index.json' },
        { name: ' ', index_url: ' ' },
      ]),
    ).toEqual({
      valid: false,
      sources: [
        {
          name: 'Official',
          index_url: 'https://plugins.example.com/index.json',
        },
        {
          name: 'official',
          index_url: 'https://mirror.example.com/index.json',
        },
        { name: 'Mirror', index_url: 'https://PLUGINS.example.com/index.json' },
        { name: 'FTP', index_url: 'ftp://plugins.example.com/index.json' },
        { name: '', index_url: '' },
      ],
      errors: [
        { name: '', index_url: '' },
        { name: 'duplicate', index_url: '' },
        { name: '', index_url: 'duplicate' },
        { name: '', index_url: 'invalid_http_url' },
        { name: 'required', index_url: 'required' },
      ],
    });
  });

  test('normalizes GitHub and gist source pages before browser import', () => {
    expect(
      normalizeTaskPluginSourceUrl(
        'https://github.com/acme/plugins/blob/main/video/plugin.js#L12',
      ),
    ).toBe(
      'https://raw.githubusercontent.com/acme/plugins/main/video/plugin.js',
    );
    expect(
      normalizeTaskPluginSourceUrl('https://gist.github.com/acme/abc123'),
    ).toBe('https://gist.githubusercontent.com/acme/abc123/raw');
    expect(
      normalizeTaskPluginSourceUrl('ftp://plugins.example/plugin.js'),
    ).toBe('');
  });

  test('adds an expected key only for an explicit version update', () => {
    expect(
      buildTaskPluginUploadPayload({
        source: 'export const meta = {}',
        remark: 'release candidate',
        force: false,
        expectedKey: 'hailuo',
      }),
    ).toEqual({
      source: 'export const meta = {}',
      remark: 'release candidate',
      force: false,
      expected_key: 'hailuo',
    });
    expect(
      buildTaskPluginUploadPayload({
        source: 'export const meta = {}',
        remark: '',
        force: true,
        expectedKey: '   ',
      }),
    ).toEqual({
      source: 'export const meta = {}',
      remark: '',
      force: true,
    });
    expect(
      buildTaskPluginUploadPayload({
        source: 'export const meta = {}',
        remark: 'with icon',
        force: false,
        icon: 'data:image/png;base64,AAAA',
      }),
    ).toEqual({
      source: 'export const meta = {}',
      remark: 'with icon',
      force: false,
      icon: 'data:image/png;base64,AAAA',
    });
  });

  test('retains the server usage blocker and its bound channel details', () => {
    expect(
      getTaskPluginUsageBlocker({
        message: 'task plugin is still in use',
        data: {
          channels: [
            { id: 7, name: 'Prompt Hubs Video' },
            { id: 9, name: 'Archive channel' },
          ],
          in_flight_count: 2,
        },
      }),
    ).toEqual({
      message: 'task plugin is still in use',
      channels: [
        { id: 7, name: 'Prompt Hubs Video' },
        { id: 9, name: 'Archive channel' },
      ],
      inFlightCount: 2,
    });
  });

  test('keeps the plugin detail workflow in the required six-tab order', () => {
    expect(PLUGIN_DETAIL_TABS).toEqual([
      { key: 'overview', label: '概览' },
      { key: 'billing', label: '计费参数' },
      { key: 'source', label: '插件源码' },
      { key: 'versions', label: '版本历史' },
      { key: 'diff', label: '源码差异' },
      { key: 'sandbox', label: '插件沙盒' },
    ]);
  });
});
