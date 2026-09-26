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
import { Banner, Descriptions, Modal, Typography } from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';

import { API, showError, showSuccess } from '../../../helpers';
import {
  findMarketplaceVersion,
  resolveMarketplaceSourceUrl,
  sha256Hex,
} from '../marketplace';

export default function MarketplaceInstallDialog({
  target,
  visible,
  onCancel,
  onInstalled,
}) {
  const { t } = useTranslation();
  const [source, setSource] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceHash, setSourceHash] = useState('');
  const [loadingSource, setLoadingSource] = useState(false);
  const [sourceError, setSourceError] = useState('');
  const [installing, setInstalling] = useState(false);
  const entry = target
    ? findMarketplaceVersion(target.plugin, target.plugin.latest)
    : null;

  useEffect(() => {
    let active = true;
    setSource('');
    setSourceUrl('');
    setSourceHash('');
    setSourceError('');
    if (!visible || !target || !entry) return undefined;

    const url = resolveMarketplaceSourceUrl(target.source.index_url, entry.path);
    if (!url) {
      setSourceError(t('插件源码地址无效，必须与市场索引保持同源。'));
      return undefined;
    }

    setLoadingSource(true);
    fetch(url)
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then(async (value) => {
        if (!active) return;
        setSource(value);
        setSourceUrl(url);
        setSourceHash(await sha256Hex(value));
      })
      .catch((error) => {
        if (active) setSourceError(String(error));
      })
      .finally(() => {
        if (active) setLoadingSource(false);
      });

    return () => {
      active = false;
    };
  }, [entry, t, target, visible]);

  const digestMismatch = Boolean(
    entry?.sha256 &&
      sourceHash &&
      entry.sha256.toLowerCase() !== sourceHash.toLowerCase(),
  );

  const install = async () => {
    if (!source || digestMismatch) return;
    setInstalling(true);
    try {
      const response = await API.post('/api/plugin/task', {
        source,
        sourceSha256: entry?.sha256 || sourceHash,
        enabled: true,
        remark: `${target.source.name} v${target.plugin.latest}`,
      });
      if (!response?.data?.success) {
        throw new Error(response?.data?.message || t('安装失败'));
      }
      showSuccess(t('插件已安装并编译'));
      await onInstalled?.();
    } catch (error) {
      showError(`${t('安装失败')}: ${String(error)}`);
    } finally {
      setInstalling(false);
    }
  };

  return (
    <Modal
      title={target ? `${target.plugin.name} v${target.plugin.latest}` : t('安装插件')}
      visible={visible}
      onCancel={onCancel}
      width={760}
      okText={installing ? t('安装中...') : t('安装并启用')}
      cancelText={t('取消')}
      confirmLoading={installing}
      okButtonProps={{
        disabled:
          loadingSource || !source || Boolean(sourceError) || digestMismatch,
      }}
      onOk={() => void install()}
    >
      {target ? (
        <div className='task-plugin-install-dialog'>
          <Descriptions
            size='small'
            row
            data={[
              { key: t('插件标识'), value: target.plugin.key },
              { key: t('来源'), value: target.source.name },
              { key: t('源码地址'), value: sourceUrl || '-' },
              { key: 'SHA-256', value: entry?.sha256 || sourceHash || t('未提供') },
            ]}
          />
          {loadingSource ? (
            <Banner type='info' closeIcon={null} description={t('正在读取插件源码...')} />
          ) : null}
          {sourceError ? (
            <Banner type='error' closeIcon={null} description={sourceError} />
          ) : null}
          {digestMismatch ? (
            <Banner
              type='error'
              closeIcon={null}
              description={t('源码 SHA-256 与市场索引不一致，已停止安装。')}
            />
          ) : null}
          {!entry?.sha256 && !sourceError ? (
            <Banner
              type='warning'
              closeIcon={null}
              description={t('该市场源未提供完整性校验值，请确认源码后再安装。')}
            />
          ) : null}
          <Typography.Title heading={6}>{t('源码预览')}</Typography.Title>
          <pre className='task-plugin-code-block task-plugin-marketplace-source-preview'>
            {source || t('源码将在这里显示')}
          </pre>
        </div>
      ) : null}
    </Modal>
  );
}
