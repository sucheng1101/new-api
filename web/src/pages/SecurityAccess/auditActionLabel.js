const AUDIT_ACTION_LABELS = {
  login: '登录',
  'login.failed': '登录失败',
  register: '注册',
  logout: '退出登录',
  'wallet.get': '查询钱包',
  'wallet.post': '钱包操作',
  'wallet.put': '更新钱包',
  'wallet.patch': '更新钱包',
  'wallet.delete': '删除钱包',
};

const AUDIT_METHOD_LABELS = {
  get: '查询',
  post: '提交',
  put: '更新',
  patch: '修改',
  delete: '删除',
};

export const formatAuditAction = (value) => {
  if (typeof value !== 'string' || !value.trim()) return '-';

  const action = value.trim().toLowerCase();
  if (AUDIT_ACTION_LABELS[action]) return AUDIT_ACTION_LABELS[action];
  if (action.startsWith('wallet.')) return '钱包操作';

  const separator = action.indexOf('.');
  if (separator < 1) return '其他操作';

  const method = action.slice(0, separator);
  const route = action.slice(separator + 1);
  const methodLabel = AUDIT_METHOD_LABELS[method];
  if (!methodLabel || !route) return '其他操作';

  const scope = route.startsWith('api.admin.')
    ? '管理员'
    : route.startsWith('api.user.')
      ? '用户'
      : '系统';

  return `${scope}${methodLabel}`;
};
