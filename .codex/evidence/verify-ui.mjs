const base = 'http://127.0.0.1:5200';
const markers = [
  '直连 API 地址配置',
  '全部时间',
  '近 24 小时',
  '直连白名单管理',
  '安全与访问',
  '异常 IP',
  '最近操作',
];

async function getText(url) {
  const r = await fetch(url);
  return r.ok ? await r.text() : null;
}

const html = await getText(base + '/');
if (!html) throw new Error('index.html unavailable');
const seed = [...html.matchAll(/assets\/[A-Za-z0-9_.-]+\.js/g)].map((m) => m[0]);
console.log('index.html chunks:', seed.join(', '));

const seen = new Set();
const queue = [...seed];
const hits = {};

while (queue.length) {
  const ref = queue.shift();
  if (seen.has(ref)) continue;
  seen.add(ref);
  let txt;
  try {
    txt = await getText(base + '/' + ref);
  } catch {
    continue;
  }
  if (!txt) continue;
  for (const mk of markers) {
    if (txt.includes(mk)) (hits[mk] ||= []).push(ref);
  }
  for (const m of txt.matchAll(/(?:assets\/)?([A-Za-z0-9_-]+\.js)/g)) {
    const name = 'assets/' + m[1];
    if (!seen.has(name)) queue.push(name);
  }
}

console.log('assets fetched:', seen.size);
for (const mk of markers) {
  console.log(`MARKER ${JSON.stringify(mk)} => ${(hits[mk] || []).join(', ') || 'NOT FOUND'}`);
}
