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

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  Card,
  Form,
  Spin,
  Table,
  Tag,
  Typography,
} from '@douyinfe/semi-ui';
import {
  Check,
  CreditCard,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import {
  API,
  showError,
  showSuccess,
  toBoolean,
  getQuotaPerUnit,
} from '../../helpers';

const emptyPrize = {
  id: 0,
  name: '',
  prize_type: 'gift',
  reward_quota: 0,
  weight: 1,
  configured_probability_basis_points: 0,
  probability_percent: 0,
  stock: -1,
  enabled: true,
};

const cardStyle = { marginTop: 12 };
const sectionGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: '0 20px',
  alignItems: 'end',
  width: '100%',
};
const actionRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
  marginTop: 4,
};
const panelGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
  gap: 12,
  alignItems: 'start',
};
const summaryStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 10,
  marginBottom: 12,
};
const summaryItemStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '12px 14px',
  border: '1px solid var(--semi-color-border)',
  borderRadius: 10,
  background: 'var(--semi-color-bg-0)',
};

function getResponseData(response) {
  return response?.data?.success ? response.data.data : undefined;
}

function getPrizesFromResponse(response) {
  const data = getResponseData(response);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  return undefined;
}

function normalizePrize(value) {
  return {
    ...emptyPrize,
    ...value,
    id: Number(value?.id) || 0,
    reward_quota: Number(value?.reward_quota) || 0,
    weight: Number(value?.weight) || 0,
    configured_probability_basis_points:
      Number(value?.configured_probability_basis_points) || 0,
    probability_percent:
      (Number(value?.configured_probability_basis_points) || 0) / 100,
    stock: Number.isFinite(Number(value?.stock)) ? Number(value.stock) : -1,
    enabled: toBoolean(value?.enabled),
    total_weight: Number(value?.total_weight) || 0,
    eligible: toBoolean(value?.eligible),
    probability_basis_points: Number(value?.probability_basis_points) || 0,
  };
}

const formatProbability = (basisPoints) =>
  `${(Number(basisPoints || 0) / 100).toFixed(2)}%`;

export default function PromotionLotterySetting() {
  const [loading, setLoading] = useState(false);
  const [savingSection, setSavingSection] = useState('');
  const [deletingPrizeId, setDeletingPrizeId] = useState(0);
  const [options, setOptions] = useState({
    PromotionLevel1BasisPoints: 0,
    PromotionLevel2BasisPoints: 0,
  });
  const [lottery, setLottery] = useState({
    enabled: true,
    threshold: 0,
    daily_attempts: 1,
    keep_attempts: false,
    invite_register_enabled: false,
    invite_recharge_enabled: false,
    invite_register_attempts: 1,
    invite_recharge_attempts: 1,
  });
  const [prizes, setPrizes] = useState([]);
  const [prize, setPrize] = useState(emptyPrize);
  const optionsFormRef = useRef();
  const lotteryFormRef = useRef();
  const prizeFormRef = useRef();
  const refreshSequence = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    setLoading(true);
    const results = await Promise.allSettled([
      API.get('/api/option/'),
      API.get('/api/admin/lottery/settings'),
      API.get('/api/admin/lottery/prizes'),
    ]);

    if (!mounted.current || sequence !== refreshSequence.current) return;

    const [optionResult, settingsResult, prizesResult] = results;
    if (optionResult.status === 'fulfilled') {
      const data = getResponseData(optionResult.value);
      if (Array.isArray(data)) {
        const values = {};
        data.forEach((item) => {
          if (
            item?.key === 'PromotionLevel1BasisPoints' ||
            item?.key === 'PromotionLevel2BasisPoints'
          ) {
            values[item.key] = Number(item.value) || 0;
          }
        });
        setOptions((current) => ({ ...current, ...values }));
        const formValues = {};
        if (Object.hasOwn(values, 'PromotionLevel1BasisPoints')) {
          formValues.PromotionLevel1BasisPoints =
            values.PromotionLevel1BasisPoints / 100;
        }
        if (Object.hasOwn(values, 'PromotionLevel2BasisPoints')) {
          formValues.PromotionLevel2BasisPoints =
            values.PromotionLevel2BasisPoints / 100;
        }
        optionsFormRef.current?.setValues(formValues);
      } else if (!optionResult.value?.data?.success) {
        showError(optionResult.value?.data?.message || '推广比例加载失败');
      }
    } else {
      showError(optionResult.reason);
    }

    if (settingsResult.status === 'fulfilled') {
      const data = getResponseData(settingsResult.value);
      if (data && typeof data === 'object') {
        setLottery((current) => ({ ...current, ...data }));
        lotteryFormRef.current?.setValues(data);
      } else if (!settingsResult.value?.data?.success) {
        showError(settingsResult.value?.data?.message || '抽奖规则加载失败');
      }
    } else {
      showError(settingsResult.reason);
    }

    if (prizesResult.status === 'fulfilled') {
      const data = getPrizesFromResponse(prizesResult.value);
      // Never replace a valid list with [] when a proxy returns an unexpected payload.
      if (data) setPrizes(data.map(normalizePrize));
      else if (!prizesResult.value?.data?.success) {
        showError(prizesResult.value?.data?.message || '奖品列表加载失败');
      } else {
        showError('奖品列表返回格式异常，已保留当前记录');
      }
    } else {
      showError(prizesResult.reason);
    }

    if (mounted.current && sequence === refreshSequence.current)
      setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    prizeFormRef.current?.setValues(normalizePrize(prize));
  }, [prize]);

  const saveOptions = async () => {
    setSavingSection('options');
    try {
      for (const [key, value] of Object.entries(options)) {
        const optionRes = await API.put('/api/option/', {
          key,
          value: String(value),
        });
        if (!optionRes.data.success) {
          throw new Error(optionRes.data.message || '保存推广比例失败');
        }
      }
      showSuccess('推广比例已保存');
      await refresh();
    } catch (error) {
      showError(error);
    } finally {
      setSavingSection('');
    }
  };

  const saveLotterySettings = async () => {
    setSavingSection('lottery');
    try {
      const response = await API.put('/api/admin/lottery/settings', lottery);
      if (!response.data.success) {
        throw new Error(response.data.message || '保存抽奖规则失败');
      }
      showSuccess('抽奖规则已保存');
      await refresh();
    } catch (error) {
      showError(error);
    } finally {
      setSavingSection('');
    }
  };

  const resetPrize = () => {
    const nextPrize = { ...emptyPrize };
    setPrize(nextPrize);
    prizeFormRef.current?.setValues(nextPrize);
  };

  const editPrize = (row) => {
    const nextPrize = normalizePrize(row);
    setPrize(nextPrize);
    prizeFormRef.current?.setValues(nextPrize);
  };

  const savePrize = async () => {
    const name = prize.name.trim();
    if (!name) {
      showError('请输入奖品名称');
      return;
    }
    setSavingSection('prize');
    try {
      const response = await API.put('/api/admin/lottery/prizes', {
        ...normalizePrize(prize),
        name,
      });
      if (!response.data.success) {
        throw new Error(response.data.message || '保存奖品失败');
      }
      showSuccess(prize.id ? '奖品已更新' : '奖品已新增');
      resetPrize();
      await refresh();
    } catch (error) {
      showError(error);
    } finally {
      setSavingSection('');
    }
  };

  const deletePrize = async (id) => {
    setDeletingPrizeId(id);
    try {
      const response = await API.delete(`/api/admin/lottery/prizes/${id}`);
      if (!response.data.success) {
        throw new Error(response.data.message || '删除奖品失败');
      }
      showSuccess('奖品已删除');
      if (prize.id === id) resetPrize();
      await refresh();
    } catch (error) {
      showError(error);
    } finally {
      setDeletingPrizeId(0);
    }
  };

  const quotaUnit = getQuotaPerUnit();
  const lotteryEnabled = toBoolean(lottery.enabled);
  const isEditingPrize = prize.id > 0;
  const eligiblePrizes = prizes.filter((item) => item.eligible);
  const probabilityTotal = eligiblePrizes.reduce(
    (sum, item) => sum + Number(item.probability_basis_points || 0),
    0,
  );
  const configuredProbabilityTotal = eligiblePrizes.reduce(
    (sum, item) => sum + Number(item.configured_probability_basis_points || 0),
    0,
  );
  const prizeColumns = [
    { title: '名称', dataIndex: 'name', width: 180 },
    {
      title: '类型',
      dataIndex: 'prize_type',
      width: 110,
      render: (value) => (value === 'gift' ? '额度' : '谢谢参与'),
    },
    { title: '奖励额度', dataIndex: 'reward_quota', width: 120 },
    { title: '权重', dataIndex: 'weight', width: 90 },
    {
      title: '配置概率',
      dataIndex: 'configured_probability_basis_points',
      width: 120,
      render: (value, row) =>
        row.eligible && Number(value || 0) > 0
          ? formatProbability(value)
          : row.eligible
            ? '按权重'
            : '不参与',
    },
    {
      title: '当前生效概率',
      dataIndex: 'probability_basis_points',
      width: 120,
      render: (value, row) =>
        row.eligible ? formatProbability(value) : '不参与',
    },
    {
      title: '库存',
      dataIndex: 'stock',
      width: 110,
      render: (value) => (value === -1 ? '不限' : value),
    },
    {
      title: '状态',
      width: 130,
      render: (_, row) => (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <Tag color={row.enabled ? 'green' : 'grey'}>
            {row.enabled ? '启用' : '停用'}
          </Tag>
          {row.enabled && (
            <Tag color={row.eligible ? 'blue' : 'orange'}>
              {row.eligible ? '参与奖池' : '暂不参与'}
            </Tag>
          )}
        </div>
      ),
    },
    {
      title: '操作',
      width: 150,
      render: (_, row) => (
        <div style={{ display: 'flex', gap: 4 }}>
          <Button
            theme='borderless'
            icon={<Pencil size={15} />}
            onClick={() => editPrize(row)}
          >
            编辑
          </Button>
          <Button
            theme='borderless'
            type='danger'
            icon={<Trash2 size={15} />}
            loading={deletingPrizeId === row.id}
            onClick={() => deletePrize(row.id)}
          >
            删除
          </Button>
        </div>
      ),
    },
  ];

  return (
    <Spin spinning={loading}>
      <div style={{ paddingBottom: 12 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            marginBottom: 8,
          }}
        >
          <Button
            theme='borderless'
            icon={<RefreshCw size={16} />}
            loading={loading}
            onClick={refresh}
          >
            刷新配置
          </Button>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
            padding: '16px 18px',
            borderRadius: 14,
            background: lotteryEnabled
              ? 'linear-gradient(120deg, rgba(var(--semi-blue-1), .9), rgba(var(--semi-green-1), .65))'
              : 'var(--semi-color-fill-0)',
            border: '1px solid var(--semi-color-border)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                display: 'grid',
                placeItems: 'center',
                width: 42,
                height: 42,
                borderRadius: 12,
                color: lotteryEnabled
                  ? 'var(--semi-color-primary)'
                  : 'var(--semi-color-text-2)',
                background: 'var(--semi-color-bg-0)',
              }}
            >
              <Sparkles size={21} />
            </div>
            <div>
              <Typography.Title heading={5} style={{ margin: 0 }}>
                推广与抽奖中心
              </Typography.Title>
              <Typography.Text type='tertiary'>
                统一管理推广分成、每日抽奖和邀请奖励规则
              </Typography.Text>
            </div>
          </div>
          <Tag color={lotteryEnabled ? 'green' : 'grey'} size='large'>
            <Power
              size={14}
              style={{ verticalAlign: 'middle', marginRight: 4 }}
            />
            {lotteryEnabled ? '抽奖已开启' : '抽奖已关闭'}
          </Tag>
        </div>

        <div style={summaryStyle}>
          <div style={summaryItemStyle}>
            <Sparkles size={18} color='var(--semi-color-primary)' />
            <div>
              <Typography.Text type='tertiary'>推广分成</Typography.Text>
              <div style={{ fontWeight: 600 }}>
                {((options.PromotionLevel1BasisPoints || 0) / 100).toFixed(2)}%
                / {((options.PromotionLevel2BasisPoints || 0) / 100).toFixed(2)}
                %
              </div>
            </div>
          </div>
          <div style={summaryItemStyle}>
            <UserPlus size={18} color='var(--semi-color-primary)' />
            <div>
              <Typography.Text type='tertiary'>邀请注册奖励</Typography.Text>
              <div style={{ fontWeight: 600 }}>
                {lottery.invite_register_enabled
                  ? `${lottery.invite_register_attempts || 0} 次/人`
                  : '未启用'}
              </div>
            </div>
          </div>
          <div style={summaryItemStyle}>
            <CreditCard size={18} color='var(--semi-color-primary)' />
            <div>
              <Typography.Text type='tertiary'>邀请充值奖励</Typography.Text>
              <div style={{ fontWeight: 600 }}>
                {lottery.invite_recharge_enabled
                  ? `${lottery.invite_recharge_attempts || 0} 次/人`
                  : '未启用'}
              </div>
            </div>
          </div>
        </div>

        <Card title='推广奖励比例' style={cardStyle}>
          <Form
            layout='horizontal'
            getFormApi={(api) => (optionsFormRef.current = api)}
          >
            <div style={sectionGridStyle}>
              <Form.InputNumber
                field='PromotionLevel1BasisPoints'
                label='一级奖励比例（%）'
                onChange={(value) =>
                  setOptions((current) => ({
                    ...current,
                    PromotionLevel1BasisPoints: Math.round(
                      Number(value || 0) * 100,
                    ),
                  }))
                }
                min={0}
                max={100}
                suffix='%'
              />
              <Form.InputNumber
                field='PromotionLevel2BasisPoints'
                label='二级奖励比例（%）'
                onChange={(value) =>
                  setOptions((current) => ({
                    ...current,
                    PromotionLevel2BasisPoints: Math.round(
                      Number(value || 0) * 100,
                    ),
                  }))
                }
                min={0}
                max={100}
                suffix='%'
              />
            </div>
          </Form>
          <div style={actionRowStyle}>
            <Button
              theme='solid'
              type='primary'
              icon={<Save size={16} />}
              loading={savingSection === 'options'}
              onClick={saveOptions}
            >
              保存推广比例
            </Button>
            <Typography.Text type='tertiary'>
              按百分比填写，系统按整数基点保存。
            </Typography.Text>
          </div>
        </Card>

        <div style={panelGridStyle}>
          <Card title='抽奖规则' style={cardStyle}>
            <Form
              layout='horizontal'
              getFormApi={(api) => (lotteryFormRef.current = api)}
            >
              <div style={sectionGridStyle}>
                <Form.Switch
                  field='enabled'
                  label='开启抽奖功能'
                  onChange={(value) =>
                    setLottery((current) => ({ ...current, enabled: value }))
                  }
                />
                <Form.InputNumber
                  field='threshold'
                  label='每日消费门槛（额度）'
                  onChange={(value) =>
                    setLottery((current) => ({ ...current, threshold: value }))
                  }
                  min={1}
                />
                <Form.InputNumber
                  field='daily_attempts'
                  label='每日基础次数'
                  onChange={(value) =>
                    setLottery((current) => ({
                      ...current,
                      daily_attempts: value,
                    }))
                  }
                  min={1}
                  max={100}
                />
                <Form.Switch
                  field='keep_attempts'
                  label='未使用次数顺延'
                  onChange={(value) =>
                    setLottery((current) => ({
                      ...current,
                      keep_attempts: value,
                    }))
                  }
                />
                <Form.Switch
                  field='invite_register_enabled'
                  label='邀请注册赠送'
                  onChange={(value) =>
                    setLottery((current) => ({
                      ...current,
                      invite_register_enabled: value,
                    }))
                  }
                />
                <Form.Switch
                  field='invite_recharge_enabled'
                  label='邀请充值赠送'
                  onChange={(value) =>
                    setLottery((current) => ({
                      ...current,
                      invite_recharge_enabled: value,
                    }))
                  }
                />
                <Form.InputNumber
                  field='invite_register_attempts'
                  label='注册赠送次数'
                  min={0}
                  max={100}
                  suffix='次'
                  disabled={!toBoolean(lottery.invite_register_enabled)}
                  onChange={(value) =>
                    setLottery((current) => ({
                      ...current,
                      invite_register_attempts: value,
                    }))
                  }
                />
                <Form.InputNumber
                  field='invite_recharge_attempts'
                  label='充值赠送次数'
                  min={0}
                  max={100}
                  suffix='次'
                  disabled={!toBoolean(lottery.invite_recharge_enabled)}
                  onChange={(value) =>
                    setLottery((current) => ({
                      ...current,
                      invite_recharge_attempts: value,
                    }))
                  }
                />
              </div>
            </Form>
            <div style={actionRowStyle}>
              <Button
                theme='solid'
                type='primary'
                icon={<Save size={16} />}
                loading={savingSection === 'lottery'}
                onClick={saveLotterySettings}
              >
                保存抽奖规则
              </Button>
              <Typography.Text type='tertiary'>
                当前门槛约 {((lottery.threshold || 0) / quotaUnit).toFixed(2)}{' '}
                美元额度
              </Typography.Text>
            </div>
          </Card>

          <Card title='邀请奖励说明' style={cardStyle}>
            <div style={{ display: 'grid', gap: 12 }}>
              <Typography.Text type='tertiary'>
                开启后，邀请好友注册或充值成功时，会按这里配置的次数增加邀请人的当日抽奖次数。
              </Typography.Text>
              <div style={{ display: 'grid', gap: 8 }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 12,
                  }}
                >
                  <span>注册奖励</span>
                  <Tag
                    color={lottery.invite_register_enabled ? 'green' : 'grey'}
                  >
                    {lottery.invite_register_enabled
                      ? `${lottery.invite_register_attempts || 0} 次`
                      : '关闭'}
                  </Tag>
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 12,
                  }}
                >
                  <span>充值奖励</span>
                  <Tag
                    color={lottery.invite_recharge_enabled ? 'green' : 'grey'}
                  >
                    {lottery.invite_recharge_enabled
                      ? `${lottery.invite_recharge_attempts || 0} 次`
                      : '关闭'}
                  </Tag>
                </div>
              </div>
            </div>
          </Card>
        </div>

        <Card title='奖品池' style={cardStyle}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
              marginBottom: 12,
              padding: '10px 12px',
              borderRadius: 8,
              background: 'var(--semi-color-fill-0)',
            }}
          >
            <Typography.Text type='tertiary'>
              当前概率只按“启用、权重大于 0、库存不为
              0”的奖项计算；库存耗尽或停用后会自动退出奖池。
            </Typography.Text>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Tag
                color={
                  configuredProbabilityTotal === 10000 ? 'green' : 'orange'
                }
              >
                配置合计 {formatProbability(configuredProbabilityTotal)}
              </Tag>
              <Tag color={probabilityTotal === 10000 ? 'blue' : 'grey'}>
                生效合计 {formatProbability(probabilityTotal)}
              </Tag>
              <Tag color='grey'>有效奖项 {eligiblePrizes.length}</Tag>
            </div>
          </div>
          <Form
            layout='horizontal'
            getFormApi={(api) => (prizeFormRef.current = api)}
          >
            <div style={sectionGridStyle}>
              <Form.Input
                field='name'
                label='奖品名称'
                onChange={(value) =>
                  setPrize((current) => ({ ...current, name: value }))
                }
              />
              <Form.Select
                field='prize_type'
                label='奖品类型'
                onChange={(value) =>
                  setPrize((current) => ({ ...current, prize_type: value }))
                }
                optionList={[
                  { label: '额度', value: 'gift' },
                  { label: '谢谢参与', value: 'none' },
                ]}
              />
              <Form.InputNumber
                field='reward_quota'
                label='奖励额度'
                onChange={(value) =>
                  setPrize((current) => ({ ...current, reward_quota: value }))
                }
                min={0}
              />
              <Form.InputNumber
                field='probability_percent'
                label='配置概率（%）'
                onChange={(value) =>
                  setPrize((current) => ({
                    ...current,
                    configured_probability_basis_points: Math.round(
                      Number(value || 0) * 100,
                    ),
                    probability_percent: Number(value || 0),
                  }))
                }
                min={0}
                max={100}
                suffix='%'
              />
              <Form.InputNumber
                field='weight'
                label='兼容权重（未配置概率时使用）'
                onChange={(value) =>
                  setPrize((current) => ({ ...current, weight: value }))
                }
                min={0}
              />
              <Form.InputNumber
                field='stock'
                label='库存（-1不限）'
                onChange={(value) =>
                  setPrize((current) => ({ ...current, stock: value }))
                }
                min={-1}
              />
              <Form.Switch
                field='enabled'
                label='启用'
                onChange={(value) =>
                  setPrize((current) => ({ ...current, enabled: value }))
                }
              />
            </div>
          </Form>
          <div style={actionRowStyle}>
            <Button
              theme='solid'
              type='primary'
              icon={isEditingPrize ? <Check size={16} /> : <Plus size={16} />}
              loading={savingSection === 'prize'}
              onClick={savePrize}
            >
              {isEditingPrize ? '更新奖品' : '新增奖品'}
            </Button>
            {isEditingPrize && (
              <Button
                theme='borderless'
                icon={<X size={16} />}
                onClick={resetPrize}
              >
                取消编辑
              </Button>
            )}
          </div>

          <Table
            style={{ marginTop: 16 }}
            dataSource={prizes}
            rowKey='id'
            columns={prizeColumns}
            pagination={false}
            scroll={{ x: 980 }}
            empty='暂无奖品记录'
          />
        </Card>
      </div>
    </Spin>
  );
}
