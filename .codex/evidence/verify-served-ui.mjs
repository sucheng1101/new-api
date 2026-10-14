const base = 'http://127.0.0.1:5200';
const markers = [
  '直连 API 地址配置',
  '全部时间',
  '近 24 小时',
  '近 7 天',
  '近 30 天',
  '直连白名单管理',
  '异常 IP',
  '最近操作',
  '安全与访问',
  'IP 详情',
  '事件详情',
];

async function getText(url) {
  for (let i = 0; i < 8; i++) {
    const r = await fetch(url);
    if (r.status === 429) {
      await new Promise((rs) => setTimeout(rs, 8000 * (i + 1)));
      continue;
    }
    return r.ok ? await r.text() : null;
  }
  return null;
}

const html = await getText(base + '/');
const entryName = new URL(
  [...html.matchAll(/assets\/([A-Za-z0-9_.-]+\.js)/g)][0][0],
  base + '/',
).pathname;
const entry = await getText(base + entryName);
const names = [
  ...new Set([...entry.matchAll(/index-[A-Za-z0-9_-]+\.js/g)].map((m) => m[0])),
];
console.log('entry:', entryName, 'page chunks:', names.join(', '));

for (const n of names) {
  const text = (await getText(base + '/assets/' + n)) || '';
  const found = markers.filter((m) => text.includes(m));
  console.log(`${n}\tlen=${text.length}\tfound=${found.join(' | ') || 'NONE'}`);
  await new Promise((rs) => setTimeout(rs, 2000));
}
