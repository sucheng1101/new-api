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

import assert from 'node:assert/strict';
import test from 'node:test';
import { formatAuditAction } from './auditActionLabel.js';

test('translates authentication and wallet actions', () => {
  assert.equal(formatAuditAction('login'), '登录');
  assert.equal(formatAuditAction('login.failed'), '登录失败');
  assert.equal(formatAuditAction('wallet.get'), '查询钱包');
  assert.equal(formatAuditAction('wallet.delete'), '删除钱包');
});

test('translates each audited mutation method by actor scope', () => {
  assert.equal(formatAuditAction('post.api.user.token'), '用户提交');
  assert.equal(formatAuditAction('put.api.admin.user'), '管理员更新');
  assert.equal(formatAuditAction('patch.api.user.profile'), '用户修改');
  assert.equal(formatAuditAction('delete.api.admin.user'), '管理员删除');
});

test('never exposes unknown action identifiers as display text', () => {
  assert.equal(formatAuditAction('post.api.other.endpoint'), '系统提交');
  assert.equal(formatAuditAction('unknown.action'), '其他操作');
  assert.equal(formatAuditAction(''), '-');
  assert.equal(formatAuditAction(undefined), '-');
});
