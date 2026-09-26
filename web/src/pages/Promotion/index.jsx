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
import {
  Button,
  Empty,
  InputNumber,
  Table,
  Tag,
  Tabs,
  TabPane,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import {
  ChevronRight,
  Gift,
  Share2,
  Sparkles,
  Users,
  Wallet,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  API,
  copy,
  getQuotaPerUnit,
  renderQuota,
  showError,
  showSuccess,
} from '../../helpers';

const REWARD_STATUS_META = {
  credited: { label: '已入账', color: 'green' },
  frozen: { label: '冻结中', color: 'orange' },
  voided: { label: '已作废', color: 'red' },
  rounded_zero: { label: '舍入为零', color: 'grey' },
};

const Promotion = () => {
  const { t } = useTranslation();
  const [summary, setSummary] = useState(null);
  const [rewards, setRewards] = useState([]);
  const [invitees, setInvitees] = useState([]);
  const [affCode, setAffCode] = useState('');
  const [transferQuota, setTransferQuota] = useState(getQuotaPerUnit());
  const [loading, setLoading] = useState(true);
  const [transferLoading, setTransferLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('rewards');

  const affLink = useMemo(
    () => (affCode ? `${window.location.origin}/register?aff=${affCode}` : ''),
    [affCode],
  );
  const availableAffQuota = Number(summary?.aff_quota || 0);
  const directInvitees = useMemo(
    () => invitees.filter((item) => Number(item.level) === 1).length,
    [invitees],
  );
  const secondInvitees = useMemo(
    () => invitees.filter((item) => Number(item.level) === 2).length,
    [invitees],
  );
  const level1Rate = ((summary?.level1_rate_basis_points || 0) / 100).toFixed(
    2,
  );
  const level2Rate = ((summary?.level2_rate_basis_points || 0) / 100).toFixed(
    2,
  );

  const load = async () => {
    setLoading(true);
    try {
      const [summaryRes, rewardsRes, inviteesRes, codeRes] = await Promise.all([
        API.get('/api/user/promotion/summary'),
        API.get('/api/user/promotion/rewards?limit=100'),
        API.get('/api/user/promotion/invitees?limit=100'),
        API.get('/api/user/aff'),
      ]);
      if (summaryRes.data?.success) setSummary(summaryRes.data.data);
      if (rewardsRes.data?.success)
        setRewards(rewardsRes.data.data?.items || []);
      if (inviteesRes.data?.success)
        setInvitees(inviteesRes.data.data?.items || []);
      if (codeRes.data?.success) setAffCode(codeRes.data.data || '');
    } catch (error) {
      showError(error?.message || t('加载推广信息失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const copyValue = async (value, message) => {
    if (!value) return;
    await copy(value);
    showSuccess(message);
  };

  const transfer = async () => {
    const quota = Number(transferQuota);
    if (!Number.isInteger(quota) || quota <= 0 || quota > availableAffQuota) {
      Toast.error({ content: t('请输入有效的转入额度') });
      return;
    }
    setTransferLoading(true);
    try {
      const res = await API.post('/api/user/aff_transfer', {
        quota,
        idempotency_key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      });
      if (!res.data?.success)
        throw new Error(res.data?.message || t('转入失败'));
      showSuccess(t('推广余额已转入赠送余额'));
      await load();
    } catch (error) {
      showError(error?.message || t('转入失败'));
    } finally {
      setTransferLoading(false);
    }
  };

  const renderRewardStatus = (value) => {
    const meta = REWARD_STATUS_META[value];
    if (!meta) return <Tag color='orange'>{value}</Tag>;
    return <Tag color={meta.color}>{t(meta.label)}</Tag>;
  };

  const rewardColumns = [
    {
      title: t('时间'),
      dataIndex: 'created_at',
      render: (value) => new Date(value * 1000).toLocaleString(),
    },
    {
      title: t('级别'),
      dataIndex: 'level',
      render: (value) => (
        <Tag color='blue'>{value === 1 ? t('一级') : t('二级')}</Tag>
      ),
    },
    {
      title: t('来源'),
      dataIndex: 'source_type',
      render: (value) =>
        value === 'redemption'
          ? t('兑换码')
          : value === 'history_migration'
            ? t('历史迁移')
            : t('充值'),
    },
    {
      title: t('奖励'),
      dataIndex: 'reward_quota',
      render: (value) => <strong>{renderQuota(value || 0)}</strong>,
    },
    {
      title: t('状态'),
      dataIndex: 'status',
      render: renderRewardStatus,
    },
  ];
  const inviteeColumns = [
    { title: t('用户'), dataIndex: 'username' },
    {
      title: t('注册时间'),
      dataIndex: 'created_at',
      render: (value) => new Date(value * 1000).toLocaleString(),
    },
    {
      title: t('级别'),
      dataIndex: 'level',
      render: (value) => (value === 1 ? t('一级') : t('二级')),
    },
    {
      title: t('累计贡献'),
      dataIndex: 'reward_quota',
      render: (value) => renderQuota(value || 0),
    },
  ];
  const stats = [
    {
      label: t('可用推广余额'),
      value: renderQuota(summary?.aff_quota || 0),
      icon: Wallet,
      tone: 'gold',
    },
    {
      label: t('累计获得奖励'),
      value: renderQuota(summary?.aff_history_quota || 0),
      icon: Gift,
      tone: 'green',
    },
    {
      label: t('累计邀请用户'),
      value: summary?.invited_count || 0,
      icon: Users,
      tone: 'blue',
    },
    {
      label: t('当前分成比例'),
      value: `${level1Rate}% / ${level2Rate}%`,
      icon: Sparkles,
      tone: 'violet',
    },
  ];

  return (
    <div className='promotion-page w-full max-w-7xl mx-auto mt-[60px] px-3 pb-10'>
      <section className='promotion-hero'>
        <div className='promotion-hero-row'>
          <div className='promotion-hero-intro'>
            <div className='promotion-eyebrow'>
              <Sparkles size={15} /> {t('合作伙伴计划')}
            </div>
            <div className='promotion-hero-titleline'>
              <Typography.Title heading={3}>
                {t('一起分享，持续获得奖励')}
              </Typography.Title>
              <Typography.Text>
                {t('一级')} {level1Rate}% · {t('二级')} {level2Rate}%
              </Typography.Text>
            </div>
          </div>
          <div className='promotion-hero-transfer'>
            <span className='promotion-transfer-label'>
              {t('可用推广余额')}
            </span>
            <strong className='promotion-transfer-balance'>
              {renderQuota(availableAffQuota)}
            </strong>
            <InputNumber
              className='promotion-transfer-input'
              value={transferQuota}
              min={getQuotaPerUnit()}
              max={availableAffQuota}
              step={getQuotaPerUnit()}
              onChange={setTransferQuota}
              placeholder={t('转入赠送余额')}
            />
            <Button
              theme='solid'
              type='primary'
              loading={transferLoading}
              disabled={availableAffQuota < getQuotaPerUnit()}
              onClick={transfer}
            >
              {t('立即转入')}
            </Button>
          </div>
        </div>
        <div className='promotion-hero-subrow'>
          <div className='promotion-hero-actions'>
            <Button
              theme='solid'
              type='primary'
              icon={<Share2 size={16} />}
              onClick={() => copyValue(affLink, t('邀请链接已复制'))}
            >
              {t('复制邀请链接')}
            </Button>
          </div>
          <div className='promotion-hero-link'>
            <span>{t('你的专属邀请链接')}</span>
            <code title={affLink}>{affLink || '-'}</code>
          </div>
        </div>
      </section>

      <section className='promotion-stats' aria-label={t('推广数据')}>
        {stats.map(({ label, value, icon: Icon, tone }) => (
          <div className={`promotion-stat promotion-stat-${tone}`} key={label}>
            <div className='promotion-stat-icon'>
              <Icon size={19} />
            </div>
            <div>
              <div className='promotion-stat-label'>{label}</div>
              <div className='promotion-stat-value'>{value}</div>
            </div>
          </div>
        ))}
      </section>

      <section className='promotion-steps-strip' aria-label={t('两级推广奖励')}>
        {[
          {
            num: '01',
            title: t('直接邀请'),
            desc: t('好友通过你的链接注册并完成有效消费，你获得一级奖励。'),
          },
          {
            num: '02',
            title: t('扩散网络'),
            desc: t('你的好友继续邀请用户，你仍可获得二级奖励。'),
          },
          {
            num: '03',
            title: t('余额转入'),
            desc: t('推广余额可按需转入赠送余额，用于平台消费。'),
          },
        ].map(({ num, title, desc }, i) => (
          <div className='promotion-strip-step' key={num}>
            <div className='promotion-strip-num'>{num}</div>
            <div className='promotion-strip-body'>
              <strong>{title}</strong>
              <p>{desc}</p>
            </div>
            {i < 2 && (
              <ChevronRight size={16} className='promotion-strip-arrow' />
            )}
          </div>
        ))}
      </section>

      <section className='promotion-bottom-grid'>
        <div className='promotion-section-block promotion-table-block'>
          <Tabs
            type='card'
            activeKey={activeTab}
            onChange={setActiveTab}
            className='promotion-table-tabs'
          >
            <TabPane
              tab={
                <span>
                  {t('奖励流水')} · {rewards.length}
                </span>
              }
              itemKey='rewards'
            >
              {rewards.length ? (
                <Table
                  columns={rewardColumns}
                  dataSource={rewards}
                  loading={loading}
                  pagination={false}
                />
              ) : (
                <Empty description={t('暂无返佣记录')} />
              )}
            </TabPane>
            <TabPane
              tab={
                <span>
                  {t('我的邀请用户')} · {invitees.length}
                </span>
              }
              itemKey='invitees'
            >
              {invitees.length ? (
                <Table
                  columns={inviteeColumns}
                  dataSource={invitees}
                  loading={loading}
                  pagination={false}
                />
              ) : (
                <Empty description={t('暂无下级用户')} />
              )}
            </TabPane>
          </Tabs>
        </div>
      </section>
    </div>
  );
};

export default Promotion;
