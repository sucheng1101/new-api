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
  Button,
  Card,
  Form,
  Spin,
  Table,
  Typography,
} from '@douyinfe/semi-ui';
import { API, showError, showSuccess, toBoolean, getQuotaPerUnit } from '../../helpers';

const emptyPrize = { id: 0, name: '', prize_type: 'gift', reward_quota: 0, weight: 1, stock: -1, enabled: true };

export default function PromotionLotterySetting() {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [options, setOptions] = useState({ PromotionLevel1BasisPoints: 0, PromotionLevel2BasisPoints: 0 });
  const [lottery, setLottery] = useState({ threshold: 0, daily_attempts: 1, keep_attempts: false, invite_register_enabled: false, invite_recharge_enabled: false });
  const [prizes, setPrizes] = useState([]);
  const [prize, setPrize] = useState(emptyPrize);

  const refresh = async () => {
    setLoading(true);
    try {
      const [optionRes, settingsRes, prizesRes] = await Promise.all([
        API.get('/api/option/'),
        API.get('/api/admin/lottery/settings'),
        API.get('/api/admin/lottery/prizes'),
      ]);
      if (optionRes.data.success) {
        const values = {};
        optionRes.data.data.forEach((item) => { if (item.key === 'PromotionLevel1BasisPoints' || item.key === 'PromotionLevel2BasisPoints') values[item.key] = Number(item.value) || 0; });
        setOptions((v) => ({ ...v, ...values }));
      }
      if (settingsRes.data.success) setLottery(settingsRes.data.data);
      if (prizesRes.data.success) setPrizes(prizesRes.data.data || []);
    } catch (e) { showError(e); } finally { setLoading(false); }
  };
  useEffect(() => { refresh(); }, []);

  const saveOptions = async () => {
    setSaving(true);
    try {
      for (const [key, value] of Object.entries(options)) {
        const optionRes = await API.put('/api/option/', { key, value: String(value) });
        if (!optionRes.data.success) throw new Error(optionRes.data.message || '保存推广比例失败');
      }
      showSuccess('推广比例已保存');
      await refresh();
    } catch (e) { showError(e); } finally { setSaving(false); }
  };
  const saveLotterySettings = async () => {
    setSaving(true);
    try {
      const res = await API.put('/api/admin/lottery/settings', lottery);
      if (!res.data.success) throw new Error(res.data.message || '保存抽奖规则失败');
      showSuccess('抽奖规则已保存');
      await refresh();
    } catch (e) { showError(e); } finally { setSaving(false); }
  };
  const savePrize = async () => {
    if (!prize.name.trim()) return showError('请输入奖品名称');
    try {
      const res = await API.put('/api/admin/lottery/prizes', { ...prize, name: prize.name.trim() });
      if (res.data.success) { showSuccess('奖品已保存'); setPrize(emptyPrize); await refresh(); } else showError(res.data.message);
    } catch (e) { showError(e); }
  };
  const deletePrize = async (id) => {
    try { const res = await API.delete(`/api/admin/lottery/prizes/${id}`); if (res.data.success) { showSuccess('奖品已删除'); await refresh(); } else showError(res.data.message); } catch (e) { showError(e); }
  };
  const quotaUnit = getQuotaPerUnit();
  return <Spin spinning={loading}>
    <Card title="推广奖励比例" style={{ marginTop: 10 }}>
      <Form layout="horizontal">
        <Form.InputNumber label="一级奖励比例（%）" value={options.PromotionLevel1BasisPoints / 100} onChange={(v) => setOptions((x) => ({ ...x, PromotionLevel1BasisPoints: Math.round(Number(v || 0) * 100) }))} min={0} max={100} />
        <Form.InputNumber label="二级奖励比例（%）" value={options.PromotionLevel2BasisPoints / 100} onChange={(v) => setOptions((x) => ({ ...x, PromotionLevel2BasisPoints: Math.round(Number(v || 0) * 100) }))} min={0} max={100} />
        <Button theme="solid" type="primary" loading={saving} onClick={saveOptions}>保存推广比例</Button>
      </Form>
    </Card>
    <Card title="抽奖规则" style={{ marginTop: 10 }}>
      <Form layout="horizontal">
        <Form.InputNumber label="每日消费门槛（额度）" value={lottery.threshold} onChange={(v) => setLottery((x) => ({ ...x, threshold: v }))} min={1} />
        <Form.InputNumber label="每日基础次数" value={lottery.daily_attempts} onChange={(v) => setLottery((x) => ({ ...x, daily_attempts: v }))} min={1} max={100} />
        <Form.Switch label="未使用次数顺延" checked={toBoolean(lottery.keep_attempts)} onChange={(v) => setLottery((x) => ({ ...x, keep_attempts: v }))} />
        <Form.Switch label="邀请注册赠送次数" checked={toBoolean(lottery.invite_register_enabled)} onChange={(v) => setLottery((x) => ({ ...x, invite_register_enabled: v }))} />
        <Form.Switch label="邀请充值赠送次数" checked={toBoolean(lottery.invite_recharge_enabled)} onChange={(v) => setLottery((x) => ({ ...x, invite_recharge_enabled: v }))} />
        <Button theme="solid" type="primary" loading={saving} onClick={saveLotterySettings}>保存抽奖规则</Button>
      </Form>
      <Typography.Text type="tertiary">当前门槛约 {((lottery.threshold || 0) / quotaUnit).toFixed(2)} 美元额度</Typography.Text>
    </Card>
    <Card title="奖品池" style={{ marginTop: 10 }}>
      <Form layout="horizontal">
        <Form.Input label="奖品名称" value={prize.name} onChange={(v) => setPrize((x) => ({ ...x, name: v }))} />
        <Form.Select label="奖品类型" value={prize.prize_type} onChange={(v) => setPrize((x) => ({ ...x, prize_type: v }))} optionList={[{ label: '额度', value: 'gift' }, { label: '谢谢参与', value: 'none' }]} />
        <Form.InputNumber label="奖励额度" value={prize.reward_quota} onChange={(v) => setPrize((x) => ({ ...x, reward_quota: v }))} min={0} />
        <Form.InputNumber label="权重" value={prize.weight} onChange={(v) => setPrize((x) => ({ ...x, weight: v }))} min={0} />
        <Form.InputNumber label="库存（-1不限）" value={prize.stock} onChange={(v) => setPrize((x) => ({ ...x, stock: v }))} min={-1} />
        <Form.Switch label="启用" checked={prize.enabled} onChange={(v) => setPrize((x) => ({ ...x, enabled: v }))} />
        <Button theme="solid" onClick={savePrize}>{prize.id ? '更新奖品' : '新增奖品'}</Button>
      </Form>
      <Table dataSource={prizes} rowKey="id" columns={[{ title: '名称', dataIndex: 'name' }, { title: '类型', dataIndex: 'prize_type' }, { title: '奖励额度', render: (_, r) => r.reward_quota }, { title: '权重', dataIndex: 'weight' }, { title: '库存', dataIndex: 'stock' }, { title: '状态', render: (_, r) => r.enabled ? '启用' : '停用' }, { title: '操作', render: (_, r) => <><Button theme="borderless" onClick={() => setPrize(r)}>编辑</Button><Button theme="borderless" type="danger" onClick={() => deletePrize(r.id)}>删除</Button></> }]} pagination={false} />
    </Card>
  </Spin>;
}
