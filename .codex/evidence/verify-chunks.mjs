const base = 'http://127.0.0.1:5200/assets/';
const names = [
  'index-B1cO8hJl.js',
  'index-B6UgENrw.js',
  'index-BLbCbkSe.js',
  'index-BLDawsMU.js',
  'index-BZwFA12l.js',
  'index-CKRkWOT0.js',
  'index-CncHKVyq.js',
  'index-DQr5WFAe.js',
  'index-YBPDX53x.js',
];
const markers = [
  '直连 API 地址配置',
  '全部时间',
  '近 24 小时',
  '直连白名单管理',
  '异常 IP',
  '最近操作',
  '安全与访问',
  'IP 详情',
];
for (const n of names) {
  const r = await fetch(base + n);
  const t = r.ok ? await r.text() : '';
  const found = markers.filter((m) => t.includes(m));
  console.log(`${n}\tstatus=${r.status}\tlen=${t.length}\tfound=${found.join(' | ') || 'NONE'}`);
}
