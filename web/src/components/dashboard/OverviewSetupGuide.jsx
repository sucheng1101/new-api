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

import React, { useEffect, useMemo, useState } from 'react';
import { Button, Modal, Progress, Skeleton, Tag } from '@douyinfe/semi-ui';
import {
  ArrowRight,
  BookOpen,
  Check,
  Copy,
  CreditCard,
  FileText,
  KeyRound,
  RadioTower,
  ShieldCheck,
  TerminalSquare,
  Timer,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { API, copy, showError, showSuccess } from '../../helpers';
import { fetchTokenKey } from '../../helpers/token';

const NEW_USER_WINDOW_SECONDS = 7 * 24 * 60 * 60;

const getUserId = (user) => user?.id ?? user?.ID ?? user?.user_id;

const getCreatedAtSeconds = (user) => {
  const raw = Number(user?.created_at || 0);
  if (!raw) return 0;
  return raw > 10 ** 12 ? Math.floor(raw / 1000) : raw;
};

const normalizeEndpoint = (sourceUrl) => {
  const fallback = `${window.location.origin}/v1/chat/completions`;
  const trimmed = String(sourceUrl || '').trim();
  if (!trimmed) return fallback;
  const value = trimmed.replace(/\/+$/, '');
  if (value.endsWith('/v1/chat/completions')) return value;
  if (value.endsWith('/v1')) return `${value}/chat/completions`;
  return `${value}/v1/chat/completions`;
};

const buildCurlCommand = ({ endpoint, apiKey, model }) =>
  [
    `curl ${endpoint} \\`,
    '  -H "Content-Type: application/json" \\',
    `  -H "Authorization: Bearer ${apiKey}" \\`,
    `  -d '{"model":"${model}","messages":[{"role":"user","content":"Say hello in one sentence."}]}'`,
  ].join('\n');

const ActionItem = ({ action, onClick }) => {
  const Icon = action.icon;
  return (
    <button
      type='button'
      onClick={onClick}
      className='group flex w-full items-center gap-3 rounded-xl border border-semi-color-border bg-semi-color-bg-0 px-3 py-3 text-left transition hover:border-semi-color-primary hover:bg-semi-color-primary-light-default'
    >
      <span className='flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-semi-color-fill-0 text-semi-color-primary'>
        <Icon size={17} />
      </span>
      <span className='min-w-0 flex-1'>
        <span className='block truncate text-sm font-medium'>
          {action.title}
        </span>
        <span className='mt-0.5 block line-clamp-2 text-xs text-semi-color-text-2'>
          {action.description}
        </span>
      </span>
      <ArrowRight
        size={15}
        className='shrink-0 text-semi-color-text-2 transition-transform group-hover:translate-x-0.5'
      />
    </button>
  );
};

const OverviewSetupGuide = ({ user, apiInfo = [], isAdminUser, t }) => {
  const navigate = useNavigate();
  const userId = getUserId(user);
  const storageKey = userId ? `dashboard_overview_setup_guide_${userId}` : null;
  const createdAt = getCreatedAtSeconds(user);
  const accountAge = Math.floor(Date.now() / 1000) - createdAt;
  const isNewUser =
    createdAt > 0 && accountAge >= 0 && accountAge <= NEW_USER_WINDOW_SECONDS;
  const [visible, setVisible] = useState(false);
  const [tokens, setTokens] = useState([]);
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [copying, setCopying] = useState(false);

  useEffect(() => {
    if (!storageKey) return;
    const hasSeen = localStorage.getItem(storageKey);
    if (!hasSeen && isNewUser) setVisible(true);
  }, [isNewUser, storageKey]);

  useEffect(() => {
    if (!visible) return undefined;
    let active = true;
    const load = async () => {
      setLoading(true);
      const [tokenResult, modelResult] = await Promise.allSettled([
        API.get('/api/token/?p=1&size=10'),
        API.get('/api/user/models'),
      ]);
      if (!active) return;
      if (
        tokenResult.status === 'fulfilled' &&
        tokenResult.value.data?.success
      ) {
        const payload = tokenResult.value.data.data;
        setTokens(Array.isArray(payload) ? payload : payload?.items || []);
      }
      if (
        modelResult.status === 'fulfilled' &&
        modelResult.value.data?.success
      ) {
        setModels(modelResult.value.data.data || []);
      }
      setLoading(false);
    };
    load();
    return () => {
      active = false;
    };
  }, [visible]);

  const preferredToken = useMemo(
    () => tokens.find((item) => item.status === 1) || tokens[0] || null,
    [tokens],
  );
  const requestCount = Number(user?.request_count || 0);
  const remainQuota = Number(user?.quota || 0);
  const usedQuota = Number(user?.used_quota || 0);
  const steps = useMemo(
    () => [
      {
        title: t('创建 API 令牌'),
        description: t('为应用或服务创建访问令牌'),
        path: '/console/token',
        icon: KeyRound,
        completed: Boolean(preferredToken),
      },
      {
        title: t('补充余额'),
        description: t('在正式调用前确保账户余额充足'),
        path: '/console/topup',
        icon: CreditCard,
        completed: remainQuota > 0 || usedQuota > 0,
      },
      {
        title: t('发送请求'),
        description: t('通过操练场或客户端验证调用链路'),
        path: '/console/playground',
        icon: TerminalSquare,
        completed: requestCount > 0,
      },
    ],
    [preferredToken, remainQuota, requestCount, t, usedQuota],
  );
  const completed = steps.filter((item) => item.completed).length;
  const setupComplete = completed === steps.length;
  const quickActions = useMemo(
    () =>
      [
        {
          title: t('令牌管理'),
          description: t('创建并管理应用访问令牌'),
          path: '/console/token',
          icon: KeyRound,
        },
        {
          title: t('渠道管理'),
          description: t('配置上游提供商和路由'),
          path: '/console/channel',
          icon: RadioTower,
          adminOnly: true,
        },
        {
          title: t('使用日志'),
          description: t('检查请求、错误和计费明细'),
          path: '/console/log',
          icon: FileText,
        },
        {
          title: t('模型定价'),
          description: t('扩展调用前检查模型价格'),
          path: '/pricing',
          icon: BookOpen,
        },
      ].filter((item) => !item.adminOnly || isAdminUser),
    [isAdminUser, t],
  );
  const endpoint = normalizeEndpoint(apiInfo[0]?.url);
  const model = models[0] || 'gpt-4o-mini';
  const displayKey = preferredToken ? 'sk-••••••••••••' : 'sk-...';
  const curlPreview = buildCurlCommand({ endpoint, apiKey: displayKey, model });

  const closeGuide = () => {
    setVisible(false);
    if (storageKey) localStorage.setItem(storageKey, 'seen');
  };

  const copyReadyRequest = async () => {
    if (!preferredToken?.id || copying) return;
    setCopying(true);
    try {
      const key = await fetchTokenKey(preferredToken.id);
      const content = buildCurlCommand({
        endpoint,
        apiKey: `sk-${key}`,
        model,
      });
      if (await copy(content)) {
        showSuccess(t('已复制可运行的请求命令'));
      } else {
        showError(t('复制失败，请手动复制'));
      }
    } catch (error) {
      showError(error.message || t('读取令牌失败'));
    } finally {
      setCopying(false);
    }
  };

  return (
    <>
      <Button
        size='small'
        theme='light'
        type='tertiary'
        icon={<BookOpen size={15} />}
        onClick={() => setVisible(true)}
      >
        <span className='hidden sm:inline'>{t('上手引导')}</span>
      </Button>

      <Modal
        visible={visible}
        title={t('快速开始')}
        width={920}
        centered
        keepDOM={false}
        onCancel={closeGuide}
        footer={
          <div className='flex w-full items-center justify-between gap-2'>
            <Tag color={setupComplete ? 'green' : 'blue'}>
              {t('完成进度 {{completed}}/{{total}}', {
                completed,
                total: steps.length,
              })}
            </Tag>
            <Button type='primary' onClick={closeGuide}>
              {setupComplete ? t('完成') : t('关闭')}
            </Button>
          </div>
        }
      >
        <div className='space-y-4'>
          <div className='rounded-2xl bg-gradient-to-br from-blue-50 via-semi-color-bg-1 to-violet-50 p-4 dark:from-blue-950/30 dark:to-violet-950/30 sm:p-5'>
            <div className='flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between'>
              <div>
                <div className='text-xs font-medium uppercase tracking-wider text-semi-color-text-2'>
                  {t('上手引导')}
                </div>
                <h2 className='mt-1 text-xl font-semibold sm:text-2xl'>
                  {t('几分钟内开始使用 API 网关')}
                </h2>
                <p className='mt-1 text-sm text-semi-color-text-2'>
                  {t('集中完成令牌、余额、路由和服务状态检查。')}
                </p>
              </div>
              <Progress
                percent={Math.round((completed / steps.length) * 100)}
                showInfo
                size='small'
                className='w-full sm:w-40'
              />
            </div>
          </div>

          {loading ? (
            <Skeleton active placeholder={<Skeleton.Paragraph rows={8} />} />
          ) : (
            <div className='grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]'>
              <div className='space-y-2 rounded-2xl border border-semi-color-border bg-semi-color-bg-0 p-2'>
                {steps.map((step, index) => {
                  const Icon = step.icon;
                  return (
                    <button
                      type='button'
                      key={step.path}
                      onClick={() => navigate(step.path)}
                      className='flex w-full items-center gap-3 rounded-xl border border-transparent px-3 py-3 text-left transition hover:border-semi-color-border hover:bg-semi-color-fill-0'
                    >
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${
                          step.completed
                            ? 'border-green-200 bg-green-50 text-green-600 dark:bg-green-950/30'
                            : 'border-semi-color-border bg-semi-color-bg-0'
                        }`}
                      >
                        {step.completed ? (
                          <Check size={15} />
                        ) : (
                          <span className='text-xs'>{index + 1}</span>
                        )}
                      </span>
                      <span className='flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-semi-color-fill-0'>
                        <Icon size={15} />
                      </span>
                      <span className='min-w-0 flex-1'>
                        <span className='block text-sm font-medium'>
                          {step.title}
                        </span>
                        <span className='mt-0.5 block text-xs text-semi-color-text-2'>
                          {step.description}
                        </span>
                      </span>
                      <ArrowRight
                        size={15}
                        className='shrink-0 text-semi-color-text-2'
                      />
                    </button>
                  );
                })}
              </div>

              <div className='rounded-2xl border border-semi-color-border bg-semi-color-bg-0 p-3 shadow-sm'>
                <div className='flex items-center justify-between gap-2 border-b border-semi-color-border pb-3'>
                  <div className='flex min-w-0 items-center gap-2'>
                    <TerminalSquare
                      size={17}
                      className='shrink-0 text-semi-color-primary'
                    />
                    <div className='min-w-0'>
                      <div className='truncate text-sm font-medium'>
                        {t('第一个 API 请求')}
                      </div>
                      <div className='truncate text-xs text-semi-color-text-2'>
                        {preferredToken?.name || t('尚未创建 API 令牌')}
                      </div>
                    </div>
                  </div>
                  {preferredToken ? (
                    <Button
                      size='small'
                      theme='light'
                      type='tertiary'
                      icon={<Copy size={14} />}
                      loading={copying}
                      onClick={copyReadyRequest}
                    >
                      {t('复制')}
                    </Button>
                  ) : (
                    <Button
                      size='small'
                      onClick={() => navigate('/console/token')}
                    >
                      {t('创建令牌')}
                    </Button>
                  )}
                </div>
                <pre className='my-3 max-h-44 overflow-auto rounded-xl bg-gray-950 p-3 text-[11px] leading-5 text-gray-200'>
                  <code>{curlPreview}</code>
                </pre>
                <div className='grid gap-2'>
                  {[
                    [
                      RadioTower,
                      t('路由状态'),
                      apiInfo.length > 0 ? t('在线') : t('当前域名'),
                    ],
                    [
                      ShieldCheck,
                      t('认证状态'),
                      preferredToken ? t('已配置') : t('需要令牌'),
                    ],
                    [Timer, t('当前模型'), model],
                  ].map(([SignalIcon, label, value]) => (
                    <div
                      key={label}
                      className='flex items-center justify-between gap-3 rounded-lg bg-semi-color-fill-0 px-3 py-2 text-xs'
                    >
                      <span className='flex min-w-0 items-center gap-2 font-medium'>
                        <SignalIcon size={14} className='shrink-0' />
                        <span className='truncate'>{label}</span>
                      </span>
                      <span className='max-w-[55%] truncate text-semi-color-text-2'>
                        {value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
            {quickActions.map((action) => (
              <ActionItem
                key={action.path}
                action={action}
                onClick={() => navigate(action.path)}
              />
            ))}
          </div>
        </div>
      </Modal>
    </>
  );
};

export default OverviewSetupGuide;
