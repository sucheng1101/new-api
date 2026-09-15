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

const HTTP_URL = /^https?:\/\//i;

export const PLUGIN_DETAIL_TABS = [
  { key: 'overview', label: '概览' },
  { key: 'billing', label: '计费参数' },
  { key: 'source', label: '插件源码' },
  { key: 'versions', label: '版本历史' },
  { key: 'diff', label: '源码差异' },
  { key: 'sandbox', label: '插件沙盒' },
];

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function pluginMeta(record) {
  return record?.meta ?? record ?? {};
}

export function getPluginOwnership(record) {
  const source = text(record?.origin ?? record?.source ?? record?.layer);
  if (source === 'factory') return 'factory';
  if (source === 'override_over_factory' || record?.factory_meta) {
    return 'override_over_factory';
  }
  return 'third_party';
}

export function getPluginOwnershipPresentation(record) {
  const ownership = getPluginOwnership(record);
  const presentation = {
    factory: { label: '出厂插件', color: 'blue' },
    third_party: { label: '第三方插件', color: 'purple' },
    override_over_factory: { label: '覆盖出厂版本', color: 'orange' },
  };
  return { ownership, ...presentation[ownership] };
}

export function getPluginFallbackLabel(record) {
  const meta = pluginMeta(record);
  const label = text(meta.name) || text(meta.key) || '?';
  return label.slice(0, 2).toUpperCase();
}

export function buildPluginIconPlan(record) {
  const meta = pluginMeta(record);
  const key = text(meta.key);
  const rawIcon = text(meta.icon ?? record?.icon);
  const metadataImageUrl =
    HTTP_URL.test(rawIcon) || rawIcon.startsWith('data:image/') ? rawIcon : '';

  return {
    key,
    shouldLoadEmbeddedIcon: Boolean(record?.has_icon && key),
    metadataImageUrl,
    metadataIconName: metadataImageUrl ? '' : rawIcon,
    // The older Lobe icon dependency has no Sora glyph. Use the stable OpenAI mark.
    fallbackProvider: key.toLowerCase() === 'sora' ? 'openai' : '',
    channelType: Array.isArray(meta.channelTypes)
      ? meta.channelTypes[0]
      : undefined,
    fallbackLabel: getPluginFallbackLabel(record),
  };
}

export function marketplaceSourceKey(source) {
  return text(source?.index_url);
}

export function selectMarketplaceSourceKey(sources, preferredKey = '') {
  const configuredSources = Array.isArray(sources)
    ? sources.filter((source) => marketplaceSourceKey(source))
    : [];
  const normalizedPreferredKey = text(preferredKey);

  if (
    normalizedPreferredKey &&
    configuredSources.some(
      (source) => marketplaceSourceKey(source) === normalizedPreferredKey,
    )
  ) {
    return normalizedPreferredKey;
  }

  return marketplaceSourceKey(configuredSources[0]);
}

function normalizedHttpUrl(value) {
  const raw = text(value);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      !parsed.hostname
    ) {
      return '';
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

export function validateMarketplaceSources(sources) {
  const rows = Array.isArray(sources) ? sources : [];
  const normalizedSources = rows.map((source) => ({
    name: text(source?.name),
    index_url: text(source?.index_url),
  }));
  const errors = normalizedSources.map(() => ({ name: '', index_url: '' }));
  const names = new Set();
  const urls = new Set();

  normalizedSources.forEach((source, index) => {
    if (!source.name) {
      errors[index].name = 'required';
    } else {
      const nameKey = source.name.toLowerCase();
      if (names.has(nameKey)) {
        errors[index].name = 'duplicate';
      } else {
        names.add(nameKey);
      }
    }

    if (!source.index_url) {
      errors[index].index_url = 'required';
      return;
    }

    const urlKey = normalizedHttpUrl(source.index_url);
    if (!urlKey) {
      errors[index].index_url = 'invalid_http_url';
    } else if (urls.has(urlKey)) {
      errors[index].index_url = 'duplicate';
    } else {
      urls.add(urlKey);
    }
  });

  return {
    valid: errors.every((entry) => !entry.name && !entry.index_url),
    sources: normalizedSources,
    errors,
  };
}

export function buildTaskPluginUploadPayload({
  source,
  remark,
  force,
  expectedKey,
  icon,
}) {
  const payload = { source, remark, force };
  const normalizedExpectedKey = text(expectedKey);
  if (normalizedExpectedKey) payload.expected_key = normalizedExpectedKey;
  const normalizedIcon = text(icon);
  if (normalizedIcon) payload.icon = normalizedIcon;
  return payload;
}

export function getTaskPluginUsageBlocker(response) {
  const data =
    response?.data && typeof response.data === 'object' ? response.data : {};
  const channels = Array.isArray(data.channels)
    ? data.channels
        .filter((channel) => channel && typeof channel === 'object')
        .map((channel) => ({
          id: Number.isFinite(Number(channel.id)) ? Number(channel.id) : null,
          name: text(channel.name),
        }))
        .filter((channel) => channel.id !== null || channel.name)
    : [];
  const inFlight = Number(data.in_flight_count);

  return {
    message: text(response?.message),
    channels,
    inFlightCount:
      Number.isFinite(inFlight) && inFlight > 0 ? Math.trunc(inFlight) : 0,
  };
}

function marketplaceErrorMessage(reason) {
  if (reason instanceof Error) return reason.message;
  return text(String(reason)) || 'Unknown marketplace error';
}

export function buildMarketplaceSourceStates(sources, settledResults) {
  const safeSources = Array.isArray(sources) ? sources : [];
  const results = Array.isArray(settledResults) ? settledResults : [];

  return safeSources.reduce((states, source, index) => {
    const key = marketplaceSourceKey(source);
    if (!key) return states;
    const result = results[index];
    if (!result) {
      states[key] = { status: 'loading' };
      return states;
    }
    if (result.status === 'fulfilled') {
      states[key] = { status: 'ready', index: result.value };
      return states;
    }
    states[key] = {
      status: 'error',
      error: marketplaceErrorMessage(result.reason),
    };
    return states;
  }, {});
}
