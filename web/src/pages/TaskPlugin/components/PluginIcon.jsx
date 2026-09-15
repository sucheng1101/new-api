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
import React, { useEffect, useState } from 'react';
import { Clapperboard, PlugZap } from 'lucide-react';

import { API, getChannelIcon, getLobeHubIcon } from '../../../helpers';
import { buildPluginIconPlan } from './pluginViewModel';

function iconClassName(className) {
  return ['task-plugin-icon', className].filter(Boolean).join(' ');
}

function semanticIcon(name, size) {
  if (/^(video|film|clapperboard)$/i.test(name)) {
    return <Clapperboard size={size} strokeWidth={1.8} />;
  }
  return getLobeHubIcon(name, size);
}

function providerIcon(channelType, size) {
  const icon = getChannelIcon(channelType);
  if (!React.isValidElement(icon)) return null;
  return React.cloneElement(icon, {
    size: Math.max(14, Math.round(size * 0.72)),
  });
}

export default function PluginIcon({ record, size = 32, className = '' }) {
  const plan = buildPluginIconPlan(record);
  const [embeddedSrc, setEmbeddedSrc] = useState('');
  const [embeddedFailed, setEmbeddedFailed] = useState(false);
  const [metadataImageFailed, setMetadataImageFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    let objectUrl = '';

    setEmbeddedSrc('');
    setEmbeddedFailed(false);
    setMetadataImageFailed(false);

    if (!plan.shouldLoadEmbeddedIcon) return undefined;

    API.get(`/api/plugin/task/${encodeURIComponent(plan.key)}/icon`, {
      responseType: 'blob',
      disableDuplicate: true,
      skipErrorHandler: true,
    })
      .then((response) => {
        if (!alive || !response.data?.type?.startsWith('image/')) {
          if (alive) setEmbeddedFailed(true);
          return;
        }
        objectUrl = URL.createObjectURL(response.data);
        setEmbeddedSrc(objectUrl);
      })
      .catch(() => {
        if (alive) setEmbeddedFailed(true);
      });

    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [plan.key, plan.shouldLoadEmbeddedIcon]);

  const iconStyle = { width: size, height: size };
  if (embeddedSrc && !embeddedFailed) {
    return (
      <span className={iconClassName(className)} style={iconStyle}>
        <img
          src={embeddedSrc}
          alt=''
          draggable={false}
          onError={() => setEmbeddedFailed(true)}
        />
      </span>
    );
  }

  if (plan.metadataImageUrl && !metadataImageFailed) {
    return (
      <span className={iconClassName(className)} style={iconStyle}>
        <img
          src={plan.metadataImageUrl}
          alt=''
          draggable={false}
          onError={() => setMetadataImageFailed(true)}
        />
      </span>
    );
  }

  const fallbackChannelIcon =
    plan.fallbackProvider === 'openai' ? providerIcon(1, size) : null;
  if (fallbackChannelIcon) {
    return (
      <span className={iconClassName(className)} style={iconStyle}>
        {fallbackChannelIcon}
      </span>
    );
  }

  if (plan.metadataIconName) {
    return (
      <span className={iconClassName(className)} style={iconStyle}>
        {semanticIcon(
          plan.metadataIconName,
          Math.max(16, Math.round(size * 0.72)),
        )}
      </span>
    );
  }

  const channelIcon = providerIcon(plan.channelType, size);
  if (channelIcon) {
    return (
      <span className={iconClassName(className)} style={iconStyle}>
        {channelIcon}
      </span>
    );
  }

  if (plan.fallbackLabel && plan.fallbackLabel !== '?') {
    return (
      <span
        className={`${iconClassName(className)} task-plugin-icon-text`}
        style={iconStyle}
      >
        {plan.fallbackLabel}
      </span>
    );
  }

  return (
    <span className={iconClassName(className)} style={iconStyle}>
      <PlugZap size={Math.max(16, Math.round(size * 0.68))} strokeWidth={1.8} />
    </span>
  );
}
