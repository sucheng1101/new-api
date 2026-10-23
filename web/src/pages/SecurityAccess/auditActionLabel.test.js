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
