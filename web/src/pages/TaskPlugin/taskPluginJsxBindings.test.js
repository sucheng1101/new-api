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
import { readFileSync } from 'node:fs';

import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import { describe, expect, test } from 'bun:test';

function findUnboundJsxComponents(source) {
  const ast = parse(source, {
    sourceType: 'module',
    plugins: ['jsx'],
  });
  const unbound = new Set();

  traverse(ast, {
    JSXOpeningElement(path) {
      const name = path.node.name;
      if (
        name.type === 'JSXIdentifier' &&
        /^[A-Z]/.test(name.name) &&
        !path.scope.hasBinding(name.name)
      ) {
        unbound.add(name.name);
      }
    },
  });

  return [...unbound].sort();
}

describe('TaskPlugin page JSX bindings', () => {
  test('binds every upper-case JSX component before browser rendering', () => {
    const source = readFileSync(
      new URL('./index.jsx', import.meta.url),
      'utf8',
    );

    expect(findUnboundJsxComponents(source)).toEqual([]);
  });

  test('mounts the delete-version dialog instead of discarding usage blockers in a toast', () => {
    const source = readFileSync(
      new URL('./index.jsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain(
      "import PluginDeleteVersionModal from './components/PluginDeleteVersionModal';",
    );
    expect(source).toContain('<PluginDeleteVersionModal');
    expect(source).toContain('onDeleteVersion={state.setDeleteTarget}');
  });

  test('passes the translation function to every always-mounted task-plugin dialog that renders translated labels', () => {
    const source = readFileSync(
      new URL('./index.jsx', import.meta.url),
      'utf8',
    );
    const columnModalSource = readFileSync(
      new URL(
        './components/TaskPluginColumnSelectorModal.jsx',
        import.meta.url,
      ),
      'utf8',
    );

    expect(source).toMatch(
      /<TaskPluginColumnSelectorModal[\s\S]*?onReset=\{state\.resetVisibleColumns\}[\s\S]*?t=\{t\}/,
    );
    expect(columnModalSource).toContain('t = (key) => key');
  });

  test('describes the upload conflict override without implying that an installed version can be overwritten', () => {
    const source = readFileSync(
      new URL('./components/PluginUploadDialog.jsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('忽略路由冲突检查');
    expect(source).toContain('不能覆盖相同 Key 和版本的不同源码');
    expect(source).not.toContain('强制覆盖当前版本');
  });

  test('keeps the plugin page below the fixed console navigation and uses the management-page layout', () => {
    const source = readFileSync(
      new URL('./index.jsx', import.meta.url),
      'utf8',
    );
    const detailSource = readFileSync(
      new URL('./components/PluginDetailSheet.jsx', import.meta.url),
      'utf8',
    );
    const cssSource = readFileSync(
      new URL('./TaskPlugin.css', import.meta.url),
      'utf8',
    );

    expect(source).toContain("className='mt-[60px] px-2 task-plugin-page'");
    expect(source).toContain(
      "import CardPro from '../../components/common/ui/CardPro';",
    );
    expect(source).toContain("type='type3'");
    expect(source).toContain("className='task-plugin-page-heading'");
    expect(source).toContain("className='task-plugin-command-row'");
    expect(source).not.toContain('task-plugin-page-context');
    expect(source).toContain('const state = useTaskPluginPageState(t);');
    expect(detailSource).toContain('task-plugin-detail-title-copy');
    expect(detailSource).toContain('task-plugin-detail-block');
    expect(detailSource).toContain('{titleMeta.key}');
    expect(cssSource).toContain('.task-plugin-detail-title-copy');
    expect(cssSource).toContain('.task-plugin-detail-block');
  });
});
