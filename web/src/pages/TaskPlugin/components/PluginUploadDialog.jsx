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
import {
  Banner,
  Button,
  Checkbox,
  Input,
  Modal,
  TextArea,
  Tooltip,
  Typography,
  Upload,
} from '@douyinfe/semi-ui';
import { IconBolt } from '@douyinfe/semi-icons';
import { FileCode2, ImagePlus, Link2, ShieldAlert, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import PluginIcon from './PluginIcon';
import {
  MAX_TASK_PLUGIN_SOURCE_BYTES,
  normalizeTaskPluginSourceUrl,
} from './pluginViewModel';

const MAX_ICON_BYTES = 512 * 1024;

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

function latestFile(fileList) {
  const item = Array.isArray(fileList) ? fileList.at(-1) : null;
  return item?.fileInstance ?? null;
}

export default function PluginUploadDialog({
  visible,
  target,
  submitting,
  onCancel,
  onSubmit,
}) {
  const { t } = useTranslation();
  const [source, setSource] = useState('');
  const [remark, setRemark] = useState('');
  const [icon, setIcon] = useState('');
  const [iconName, setIconName] = useState('');
  const [sourceFileList, setSourceFileList] = useState([]);
  const [iconFileList, setIconFileList] = useState([]);
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceUrlLoading, setSourceUrlLoading] = useState(false);
  const [sourceUrlError, setSourceUrlError] = useState('');
  const [iconError, setIconError] = useState('');
  const [force, setForce] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!visible) return;
    setSource('');
    setRemark('');
    setIcon('');
    setIconName('');
    setSourceFileList([]);
    setIconFileList([]);
    setSourceUrl('');
    setSourceUrlError('');
    setIconError('');
    setForce(false);
    setError('');
  }, [target?.meta?.key, visible]);

  const onSourceFilesChange = async ({ fileList }) => {
    const file = latestFile(fileList);
    setSourceFileList(file ? [fileList.at(-1)] : []);
    if (!file) return;
    if (!/\.m?js$/i.test(file.name) && !/javascript/.test(file.type)) {
      setError(t('插件源码必须是一个 JavaScript 文件'));
      return;
    }
    if (file.size > MAX_TASK_PLUGIN_SOURCE_BYTES) {
      setError(t('插件源码不能超过 1 MiB'));
      return;
    }
    try {
      setSource(await file.text());
      setError('');
    } catch (readError) {
      setError(`${t('读取插件源码失败')}: ${String(readError)}`);
    }
  };

  const onIconFilesChange = async ({ fileList }) => {
    const file = latestFile(fileList);
    setIconFileList(file ? [fileList.at(-1)] : []);
    if (!file) {
      setIcon('');
      setIconName('');
      return;
    }
    const validType =
      ['image/svg+xml', 'image/png'].includes(file.type) ||
      /\.(svg|png)$/i.test(file.name);
    if (!validType) {
      setIconError(t('插件图标必须是 SVG 或 PNG 文件'));
      return;
    }
    if (file.size > MAX_ICON_BYTES) {
      setIconError(t('插件图标不能超过 512 KiB'));
      return;
    }
    try {
      setIcon(await readFileAsDataUrl(file));
      setIconName(file.name);
      setIconError('');
    } catch (readError) {
      setIconError(`${t('读取插件图标失败')}: ${String(readError)}`);
    }
  };

  const importUrl = async () => {
    const value = sourceUrl.trim();
    if (!value) {
      setSourceUrlError(t('请输入插件源码 URL'));
      return;
    }
    const normalizedUrl = normalizeTaskPluginSourceUrl(value);
    if (!normalizedUrl) {
      setSourceUrlError(t('插件源码 URL 必须使用 HTTP(S)'));
      return;
    }
    setSourceUrlLoading(true);
    setSourceUrlError('');
    try {
      const response = await fetch(normalizedUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const declaredLength = Number(response.headers.get('content-length'));
      if (
        Number.isFinite(declaredLength) &&
        declaredLength > MAX_TASK_PLUGIN_SOURCE_BYTES
      ) {
        throw new Error(t('插件源码不能超过 1 MiB'));
      }
      const nextSource = await response.text();
      if (
        new TextEncoder().encode(nextSource).length >
        MAX_TASK_PLUGIN_SOURCE_BYTES
      ) {
        throw new Error(t('插件源码不能超过 1 MiB'));
      }
      setSource(nextSource);
      setSourceFileList([]);
    } catch (importError) {
      setSourceUrlError(
        `${t('导入插件源码失败')}: ${t('浏览器可能被目标站点的跨域策略拦截，请下载后粘贴源码。')} ${String(importError)}`,
      );
    } finally {
      setSourceUrlLoading(false);
    }
  };

  const submit = async () => {
    if (!source.trim()) {
      setError(t('插件源码不能为空'));
      return;
    }
    setError('');
    try {
      await onSubmit?.({
        source,
        remark,
        icon,
        force,
        expectedKey: target?.meta?.key || '',
      });
    } catch (submitError) {
      setError(String(submitError));
    }
  };

  const isVersionUpdate = Boolean(target?.meta?.key);
  return (
    <Modal
      title={isVersionUpdate ? t('上传插件新版本') : t('上传第三方插件')}
      visible={visible}
      onCancel={onCancel}
      width={820}
      bodyStyle={{ paddingBottom: 40 }}
      className='task-plugin-upload-modal'
      okText={submitting ? t('上传中...') : t('上传并编译')}
      cancelText={t('取消')}
      confirmLoading={submitting}
      onOk={() => void submit()}
    >
      <div className='task-plugin-upload-dialog'>
        <Banner
          type='warning'
          closeIcon={null}
          icon={<ShieldAlert size={17} />}
          title={t('第三方插件风险提示')}
          description={t(
            '上传的 JavaScript 会在任务插件运行时执行。仅导入已审查的来源，并在插件沙盒中先验证输入输出。',
          )}
        />
        {isVersionUpdate ? (
          <Typography.Text type='tertiary' size='small'>
            {t('本次上传将更新插件 {{key}}，系统会校验源码中的插件 Key。', {
              key: target.meta.key,
            })}
          </Typography.Text>
        ) : null}

        <div className='task-plugin-upload-metadata-grid'>
          <div className='task-plugin-upload-field'>
            <Typography.Text strong>{t('插件图标')}</Typography.Text>
            <div className='task-plugin-upload-icon-control'>
              <Upload
                className='task-plugin-upload-dropzone task-plugin-upload-icon-dropzone'
                draggable
                accept='.svg,.png,image/svg+xml,image/png'
                limit={1}
                uploadTrigger='custom'
                beforeUpload={() => false}
                fileList={iconFileList}
                dragIcon={<ImagePlus size={20} />}
                dragMainText={t('拖入 SVG 或 PNG 图标')}
                dragSubText={t('最大 512 KiB')}
                onChange={onIconFilesChange}
              />
              {icon ? (
                <div className='task-plugin-upload-icon-preview'>
                  <PluginIcon
                    record={{ meta: { key: 'upload', icon } }}
                    size={34}
                  />
                  <Typography.Text
                    type='tertiary'
                    size='small'
                    ellipsis={{ showTooltip: true }}
                  >
                    {iconName}
                  </Typography.Text>
                  <Tooltip content={t('移除图标')}>
                    <Button
                      aria-label={t('移除图标')}
                      icon={<X size={14} />}
                      size='small'
                      theme='borderless'
                      type='tertiary'
                      onClick={() => {
                        setIcon('');
                        setIconName('');
                        setIconFileList([]);
                        setIconError('');
                      }}
                    />
                  </Tooltip>
                </div>
              ) : null}
            </div>
            {iconError ? (
              <Typography.Text type='danger' size='small'>
                {iconError}
              </Typography.Text>
            ) : null}
          </div>
          <div className='task-plugin-upload-field'>
            <Typography.Text strong>{t('备注')}</Typography.Text>
            <TextArea
              value={remark}
              onChange={setRemark}
              placeholder={t('例如：来源、审核结论或此版本的变更说明')}
              autosize={{ minRows: 5, maxRows: 8 }}
              maxCount={500}
            />
          </div>
        </div>

        <div className='task-plugin-upload-field'>
          <Typography.Text strong>{t('插件文件')}</Typography.Text>
          <Upload
            className='task-plugin-upload-dropzone task-plugin-upload-source-dropzone'
            draggable
            accept='.js,.mjs,text/javascript,application/javascript'
            limit={1}
            uploadTrigger='custom'
            beforeUpload={() => false}
            fileList={sourceFileList}
            dragIcon={<IconBolt />}
            dragMainText={t('拖入一个 JavaScript 插件文件')}
            dragSubText={t(
              '也可以在下方通过 URL 导入或直接编辑源码，最大 1 MiB',
            )}
            onChange={onSourceFilesChange}
          />
        </div>

        <div className='task-plugin-upload-field'>
          <Typography.Text strong>{t('从 URL 导入')}</Typography.Text>
          <Input
            value={sourceUrl}
            prefix={<Link2 size={15} />}
            placeholder='https://example.com/plugin.js'
            showClear
            onChange={setSourceUrl}
            suffix={
              <Button
                size='small'
                theme='borderless'
                loading={sourceUrlLoading}
                disabled={sourceUrlLoading}
                onClick={() => void importUrl()}
              >
                {t('导入')}
              </Button>
            }
          />
          {sourceUrlError ? (
            <Typography.Text type='danger' size='small'>
              {sourceUrlError}
            </Typography.Text>
          ) : null}
        </div>

        <div className='task-plugin-upload-field'>
          <Typography.Text strong>{t('插件源码')}</Typography.Text>
          <TextArea
            value={source}
            onChange={setSource}
            prefix={<FileCode2 size={15} />}
            placeholder={t('粘贴或修改 JavaScript 插件源码')}
            autosize={{ minRows: 16, maxRows: 28 }}
            className='task-plugin-upload-source'
          />
        </div>
        <Checkbox
          checked={force}
          onChange={(event) => setForce(event.target.checked)}
        >
          {t('忽略路由冲突检查（不能覆盖相同 Key 和版本的不同源码）')}
        </Checkbox>
        {error ? (
          <Banner type='error' closeIcon={null} description={error} />
        ) : null}
      </div>
    </Modal>
  );
}
