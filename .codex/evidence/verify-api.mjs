const base = 'http://127.0.0.1:5200';
const urls = [
  '/api/admin/security/summary?start_timestamp=1&end_timestamp=9999999999',
  '/api/admin/security/events?p=1&page_size=8&start_timestamp=1&end_timestamp=9999999999',
  '/api/admin/security/ip-risks?p=1&page_size=8&start_timestamp=1&end_timestamp=9999999999',
  '/api/admin/security/events/does-not-exist-detail',
  '/api/admin/security/ip-blocks?p=1&page_size=8',
  '/api/admin/security/direct-ip-whitelist?p=1&page_size=8',
  '/api/admin/security/direct-api-config',
  '/api/user/direct-ip-whitelist',
  '/api/user/direct-ip-whitelist/current-ip',
];
for (const u of urls) {
  try {
    const r = await fetch(base + u);
    const t = await r.text();
    console.log(`${u}\tstatus=${r.status}\tbody=${t.slice(0, 140).replace(/\s+/g, ' ')}`);
  } catch (e) {
    console.log(`${u}\tERR\t${e.message}`);
  }
  await new Promise((rs) => setTimeout(rs, 800));
}
