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

export const SUPPORTED_MARKETPLACE_INDEX_VERSION = 1;

export function resolveMarketplaceSourceUrl(indexUrl, path) {
  if (!String(path || '').trim()) return null;
  try {
    const base = new URL(indexUrl);
    const resolved = new URL(String(path).trim(), base);
    if (!['http:', 'https:'].includes(resolved.protocol)) return null;
    if (resolved.origin !== base.origin) return null;
    return resolved.toString();
  } catch {
    return null;
  }
}

export function parseMarketplaceIndex(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('市场索引不是对象');
  }
  const raw = payload;
  const indexVersion = Number(raw.indexVersion);
  if (!Number.isFinite(indexVersion)) {
    throw new Error('市场索引缺少 indexVersion');
  }
  if (indexVersion > SUPPORTED_MARKETPLACE_INDEX_VERSION) {
    throw new Error(`暂不支持的市场索引版本 ${indexVersion}`);
  }

  const plugins = [];
  for (const entry of Array.isArray(raw.plugins) ? raw.plugins : []) {
    if (!entry || typeof entry !== 'object') continue;
    const key = typeof entry.key === 'string' ? entry.key.trim() : '';
    const versions = (Array.isArray(entry.versions) ? entry.versions : [])
      .filter((version) => version && typeof version === 'object')
      .map((version) => ({
        version:
          typeof version.version === 'string' ? version.version.trim() : '',
        path: typeof version.path === 'string' ? version.path.trim() : '',
        sha256: typeof version.sha256 === 'string' ? version.sha256.trim() : '',
        minApiVersion: Number.isFinite(Number(version.minApiVersion))
          ? Number(version.minApiVersion)
          : undefined,
      }))
      .filter((version) => version.version && version.path);
    if (!key || !versions.length) continue;

    const latestCandidate =
      typeof entry.latest === 'string' ? entry.latest.trim() : '';
    const latest = versions.some(
      (version) => version.version === latestCandidate,
    )
      ? latestCandidate
      : versions[0].version;
    plugins.push({
      key,
      name: typeof entry.name === 'string' && entry.name ? entry.name : key,
      icon: typeof entry.icon === 'string' ? entry.icon.trim() : '',
      description: entry.description,
      channelTypes: Array.isArray(entry.channelTypes)
        ? entry.channelTypes.filter((value) => Number.isFinite(Number(value)))
        : [],
      models: Array.isArray(entry.models)
        ? entry.models.filter((value) => typeof value === 'string')
        : [],
      latest,
      versions,
    });
  }

  return {
    indexVersion,
    name: typeof raw.name === 'string' ? raw.name : '',
    plugins,
  };
}

export function findMarketplaceVersion(plugin, version) {
  return plugin?.versions?.find((entry) => entry.version === version);
}

export function deriveMarketplaceInstallState(plugin, installed = []) {
  const installedItems = Array.isArray(installed)
    ? installed
    : installed
      ? [installed]
      : [];
  const match = installedItems.find((item) => item.meta?.key === plugin.key);
  if (!match) return { status: 'not_installed' };
  if (match.meta?.version === plugin.latest) {
    return { status: 'up_to_date', installedVersion: match.meta.version };
  }
  const known = plugin.versions.some(
    (entry) => entry.version === match.meta?.version,
  );
  return {
    status: known ? 'upgradable' : 'diverged',
    installedVersion: match.meta?.version,
    latestVersion: plugin.latest,
  };
}

export async function sha256Hex(value) {
  if (!globalThis.crypto?.subtle) return '';
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
