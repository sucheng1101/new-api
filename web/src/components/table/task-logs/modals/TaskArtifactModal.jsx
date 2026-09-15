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

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Empty, Modal, Spin, Tag, Typography } from '@douyinfe/semi-ui';
import { IconDownload, IconRefresh } from '@douyinfe/semi-icons';
import { useTranslation } from 'react-i18next';
import { API, showError } from '../../../../helpers';

const { Text, Title } = Typography;

const getErrorMessage = (error, fallback) =>
  error?.response?.data?.message || error?.message || fallback;

const artifactLabel = (type, t) => {
  switch (type) {
    case 'video':
      return t('视频');
    case 'audio':
      return t('音频');
    case 'image':
      return t('图片');
    default:
      return t('文件');
  }
};

const ArtifactCard = ({ artifact, t }) => {
  const [mediaFailed, setMediaFailed] = useState(false);
  const contentURL = artifact.content_url;
  const downloadName = `${artifact.key || 'artifact'}.${
    artifact.type === 'video'
      ? 'mp4'
      : artifact.type === 'audio'
        ? 'mp3'
        : artifact.type === 'image'
          ? 'png'
          : 'bin'
  }`;

  const media = (() => {
    if (mediaFailed) return null;
    if (artifact.type === 'video') {
      return (
        <video
          src={contentURL}
          controls
          preload='metadata'
          onError={() => setMediaFailed(true)}
          style={{ width: '100%', maxHeight: 360, borderRadius: 6 }}
        />
      );
    }
    if (artifact.type === 'audio') {
      return (
        <audio
          src={contentURL}
          controls
          preload='metadata'
          onError={() => setMediaFailed(true)}
          style={{ width: '100%' }}
        />
      );
    }
    if (artifact.type === 'image') {
      return (
        <img
          src={contentURL}
          alt={artifact.key}
          onError={() => setMediaFailed(true)}
          style={{ width: '100%', maxHeight: 360, objectFit: 'contain' }}
        />
      );
    }
    return null;
  })();

  return (
    <div
      style={{
        border: '1px solid var(--semi-color-border)',
        borderRadius: 8,
        padding: 16,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 12,
        }}
      >
        <Title heading={6} style={{ margin: 0 }}>
          {artifact.key}
        </Title>
        <Tag color='blue'>{artifactLabel(artifact.type, t)}</Tag>
        {artifact.mime_type ? (
          <Text type='tertiary'>{artifact.mime_type}</Text>
        ) : null}
      </div>
      {media || mediaFailed ? (
        media || <Text type='warning'>{t('当前制品无法直接预览')}</Text>
      ) : (
        <Text type='tertiary'>{t('该制品不支持内嵌预览')}</Text>
      )}
      <div style={{ marginTop: 12 }}>
        <a
          href={contentURL}
          download={downloadName}
          style={{
            color: 'var(--semi-color-primary)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 13,
            textDecoration: 'none',
          }}
        >
          <IconDownload />
          {t('下载')}
        </a>
      </div>
    </div>
  );
};

const TaskArtifactModal = ({ visible, onCancel, task }) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [artifacts, setArtifacts] = useState([]);
  const [error, setError] = useState('');
  const taskID = task?.task_id;

  const loadArtifacts = useCallback(async () => {
    if (!taskID) return;
    setLoading(true);
    setError('');
    try {
      const response = await API.get(
        `/api/task/${encodeURIComponent(taskID)}/artifacts`,
        { skipErrorHandler: true },
      );
      const payload = response?.data;
      if (!payload?.success) {
        throw new Error(payload?.message || t('加载制品失败'));
      }
      const items = Array.isArray(payload?.data?.artifacts)
        ? payload.data.artifacts
        : [];
      const legacyContentURL = payload?.data?.legacy_content_url;
      if (items.length === 0 && legacyContentURL) {
        setArtifacts([
          { key: 'video', type: 'video', content_url: legacyContentURL },
        ]);
      } else {
        setArtifacts(items);
      }
    } catch (requestError) {
      const message = getErrorMessage(requestError, t('加载制品失败'));
      setError(message);
      showError(message);
    } finally {
      setLoading(false);
    }
  }, [t, taskID]);

  useEffect(() => {
    if (visible) loadArtifacts();
    if (!visible) {
      setArtifacts([]);
      setError('');
    }
  }, [visible, loadArtifacts]);

  return (
    <Modal
      title={t('制品')}
      visible={visible}
      onCancel={onCancel}
      footer={null}
      width={860}
      bodyStyle={{ maxHeight: '72vh', overflow: 'auto' }}
    >
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
          <Spin size='large' />
        </div>
      ) : error ? (
        <div style={{ textAlign: 'center', padding: 28 }}>
          <Text type='danger'>{error}</Text>
          <div style={{ marginTop: 14 }}>
            <Button icon={<IconRefresh />} onClick={loadArtifacts}>
              {t('重试')}
            </Button>
          </div>
        </div>
      ) : artifacts.length === 0 ? (
        <Empty description={t('暂无制品')} style={{ padding: 32 }} />
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          {artifacts.map((artifact) => (
            <ArtifactCard key={artifact.key} artifact={artifact} t={t} />
          ))}
        </div>
      )}
    </Modal>
  );
};

export default TaskArtifactModal;
