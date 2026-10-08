import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  Form,
  Modal,
  Skeleton,
  Switch,
  Table,
  Tag,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import {
  Activity,
  Ban,
  CheckCircle2,
  Globe2,
  History,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
  UserRound,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { API } from '../../helpers';

const formatTime = (value) => {
  if (!value) return '-';
  const date = new Date(Number(value) * 1000);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString();
};

const AUDIT_ACTION_LABELS = {
  login: '登录',
  'login.failed': '登录失败',
  register: '注册',
  logout: '退出登录',
  'wallet.get': '查询钱包',
  'wallet.post': '钱包操作',
  'wallet.put': '更新钱包',
  'wallet.patch': '更新钱包',
  'wallet.delete': '删除钱包',
  'post.api.user.amount': '发起充值',
  'post.api.user.stripe.amount': '发起 Stripe 充值',
  'post.api.user.waffo.amount': '发起 Waffo 充值',
  'post.api.user.waffo-pancake.amount': '发起 Waffo Pancake 充值',
};

const formatAuditAction = (value, translate = (label) => label) => {
  if (!value) return '-';
  if (AUDIT_ACTION_LABELS[value]) return translate(AUDIT_ACTION_LABELS[value]);
  if (value.startsWith('wallet.')) return translate('钱包操作');
  if (value.startsWith('post.api.user.')) return translate('用户操作');
  if (value.startsWith('post.api.admin.')) return translate('管理操作');
  return translate('其他操作');
};

const formatGeoLocation = (record, translate = (value) => value) => {
  const location = [record.country, record.region, record.city]
    .filter(Boolean)
    .join(' · ');
  if (location) return location;
  if (record.geo_status === 'local') return translate('本机地址');
  if (record.geo_status === 'private') return translate('内网地址');
  if (record.geo_status === 'invalid') return translate('无效 IP');
  return translate('暂无归属地');
};

const TONE_CLASSES = {
  blue: 'bg-blue-50 text-blue-600 dark:bg-blue-950/30',
  cyan: 'bg-cyan-50 text-cyan-600 dark:bg-cyan-950/30',
  violet: 'bg-violet-50 text-violet-600 dark:bg-violet-950/30',
  green: 'bg-green-50 text-green-600 dark:bg-green-950/30',
  orange: 'bg-orange-50 text-orange-600 dark:bg-orange-950/30',
  red: 'bg-red-50 text-red-600 dark:bg-red-950/30',
};

const MetricCard = ({ icon, label, value, tone = 'blue', loading }) => (
  <Card className='!rounded-2xl border-0 shadow-sm' bodyStyle={{ padding: 18 }}>
    <div className='flex items-center gap-3'>
      <div
        className={`rounded-xl p-2.5 ${TONE_CLASSES[tone] || TONE_CLASSES.blue}`}
      >
        {icon}
      </div>
      <div className='min-w-0'>
        <div className='text-xs text-semi-color-text-2'>{label}</div>
        {loading ? (
          <Skeleton.Title className='mt-2' style={{ width: 72, height: 24 }} />
        ) : (
          <div className='mt-1 text-2xl font-semibold'>{value ?? 0}</div>
        )}
      </div>
    </div>
  </Card>
);

const SecurityAccess = () => {
  const { t } = useTranslation();
  const [summary, setSummary] = useState(null);
  const [risks, setRisks] = useState([]);
  const [events, setEvents] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [eventsTotal, setEventsTotal] = useState(0);
  const [blocksTotal, setBlocksTotal] = useState(0);
  const [eventsPage, setEventsPage] = useState(1);
  const [blocksPage, setBlocksPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [summaryRes, riskRes, eventRes, blockRes] = await Promise.all([
        API.get('/api/admin/security/summary'),
        API.get('/api/admin/security/ip-risks', { params: { limit: 8 } }),
        API.get('/api/admin/security/events', {
          params: { p: eventsPage, page_size: 8 },
        }),
        API.get('/api/admin/security/ip-blocks', {
          params: { p: blocksPage, page_size: 8 },
        }),
      ]);
      if (summaryRes.data?.success) setSummary(summaryRes.data.data || {});
      if (riskRes.data?.success) setRisks(riskRes.data.data || []);
      if (eventRes.data?.success) {
        setEvents(eventRes.data.data?.items || []);
        setEventsTotal(eventRes.data.data?.total || 0);
      }
      if (blockRes.data?.success) {
        setBlocks(blockRes.data.data?.items || []);
        setBlocksTotal(blockRes.data.data?.total || 0);
      }
    } catch (error) {
      Toast.error(error?.response?.data?.message || t('安全数据加载失败'));
    } finally {
      setLoading(false);
    }
  }, [blocksPage, eventsPage, t]);

  useEffect(() => {
    load();
  }, [load]);

  const createBlock = async (values) => {
    try {
      const response = await API.post('/api/admin/security/ip-blocks', values);
      if (!response.data?.success)
        throw new Error(response.data?.message || t('操作失败'));
      Toast.success(t('IP 已加入黑名单'));
      setModalVisible(false);
      await load();
    } catch (error) {
      Toast.error(
        error?.response?.data?.message || error.message || t('操作失败'),
      );
    }
  };

  const updateBlock = async (record, enabled) => {
    try {
      await API.patch(`/api/admin/security/ip-blocks/${record.id}`, {
        enabled,
      });
      await load();
    } catch (error) {
      Toast.error(error?.response?.data?.message || t('状态更新失败'));
    }
  };

  const deleteBlock = (record) => {
    Modal.confirm({
      title: t('移除 IP 黑名单'),
      content: t('确定移除 {{address}} 吗？', {
        address: record.address,
      }),
      onOk: async () => {
        try {
          await API.delete(`/api/admin/security/ip-blocks/${record.id}`);
          await load();
        } catch (error) {
          Toast.error(error?.response?.data?.message || t('删除失败'));
        }
      },
    });
  };

  const showGeoDetails = (record) => {
    const rows = [
      { label: t('IP 地址'), value: record.address, mono: true },
      { label: t('归属地'), value: formatGeoLocation(record, t) },
      { label: t('运营商'), value: record.isp },
      { label: 'ASN', value: record.asn },
      { label: t('时区'), value: record.timezone },
    ];
    Modal.info({
      title: t('IP 归属地详情'),
      content: (
        <div className='space-y-2 text-sm'>
          {rows.map((row) => (
            <div className='grid grid-cols-[80px_1fr] gap-3' key={row.label}>
              <span className='text-semi-color-text-2'>{row.label}</span>
              <span className={row.mono ? 'font-mono' : ''}>
                {row.value || '-'}
              </span>
            </div>
          ))}
        </div>
      ),
      okText: t('关闭'),
    });
  };

  const metricItems = useMemo(
    () => [
      {
        label: t('审计事件'),
        value: summary?.audit_events,
        icon: <History size={18} />,
        tone: 'blue',
      },
      {
        label: t('活跃 IP'),
        value: summary?.distinct_ips,
        icon: <Globe2 size={18} />,
        tone: 'cyan',
      },
      {
        label: t('注册事件'),
        value: summary?.registrations,
        icon: <UserRound size={18} />,
        tone: 'violet',
      },
      {
        label: t('登录事件'),
        value: summary?.logins,
        icon: <CheckCircle2 size={18} />,
        tone: 'green',
      },
      {
        label: t('钱包操作'),
        value: summary?.wallet_actions,
        icon: <Activity size={18} />,
        tone: 'orange',
      },
      {
        label: t('封禁 IP'),
        value: summary?.active_blocks,
        icon: <Ban size={18} />,
        tone: 'red',
      },
    ],
    [summary, t],
  );

  return (
    <div className='mx-auto w-full max-w-[1800px] px-3 pb-8 sm:px-6'>
      <div className='mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
        <div className='flex items-center gap-2'>
          <span className='flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-300'>
            <ShieldAlert size={17} />
          </span>
          <Typography.Title heading={3} style={{ margin: 0 }}>
            {t('安全与访问')}
          </Typography.Title>
        </div>
        <div className='flex gap-2'>
          <Button
            theme='light'
            icon={<RefreshCw size={15} />}
            loading={loading}
            onClick={load}
          >
            {t('刷新')}
          </Button>
          <Button
            type='primary'
            icon={<Plus size={15} />}
            onClick={() => setModalVisible(true)}
          >
            {t('拉黑 IP')}
          </Button>
        </div>
      </div>

      <div className='mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6'>
        {metricItems.map((item) => (
          <MetricCard
            key={item.label}
            {...item}
            loading={loading && !summary}
          />
        ))}
      </div>

      <div className='grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]'>
        <Card
          className='!rounded-2xl border-0 shadow-sm'
          bodyStyle={{ padding: 0 }}
        >
          <div className='flex items-center justify-between border-b border-semi-color-border px-5 py-4'>
            <div>
              <div className='font-semibold'>{t('异常 IP')}</div>
              <div className='mt-1 text-xs text-semi-color-text-2'>
                {t('同一 IP 关联多个用户的风险聚合')}
              </div>
            </div>
            <ShieldAlert className='text-orange-500' size={20} />
          </div>
          <Table
            size='small'
            pagination={false}
            loading={loading}
            dataSource={risks}
            rowKey='address'
            empty={t('暂无异常 IP')}
            columns={[
              {
                title: t('IP 地址'),
                dataIndex: 'address',
                render: (value) => (
                  <span className='font-mono text-xs'>{value}</span>
                ),
              },
              {
                title: t('归属地'),
                dataIndex: 'country',
                width: 190,
                render: (_, record) => {
                  const location = formatGeoLocation(record, t);
                  const hasDetails = Boolean(
                    record.country ||
                      record.region ||
                      record.city ||
                      record.isp ||
                      record.asn ||
                      record.timezone,
                  );
                  return hasDetails ? (
                    <Button
                      theme='borderless'
                      type='tertiary'
                      className='!px-0 text-left'
                      onClick={() => showGeoDetails(record)}
                    >
                      {location}
                    </Button>
                  ) : (
                    <span className='text-semi-color-text-2'>{location}</span>
                  );
                },
              },
              {
                title: t('用户数'),
                dataIndex: 'user_count',
                render: (value) => <Tag color='orange'>{value}</Tag>,
              },
              { title: t('事件数'), dataIndex: 'event_count' },
              {
                title: t('最近活动'),
                dataIndex: 'last_seen',
                render: formatTime,
              },
            ]}
          />
        </Card>

        <Card
          className='!rounded-2xl border-0 shadow-sm'
          bodyStyle={{ padding: 0 }}
        >
          <div className='border-b border-semi-color-border px-5 py-4'>
            <div className='font-semibold'>{t('最近操作')}</div>
            <div className='mt-1 text-xs text-semi-color-text-2'>
              {t('仅记录操作元数据，不保存密码、Token 或请求正文')}
            </div>
          </div>
          <Table
            size='small'
            pagination={{
              currentPage: eventsPage,
              pageSize: 8,
              total: eventsTotal,
              onPageChange: setEventsPage,
            }}
            loading={loading}
            dataSource={events}
            rowKey='event_id'
            empty={t('暂无审计事件')}
            scroll={{ x: 720 }}
            columns={[
              { title: t('时间'), dataIndex: 'created_at', render: formatTime },
              {
                title: t('用户'),
                dataIndex: 'username',
                render: (value) => value || t('系统'),
              },
              {
                title: t('动作'),
                dataIndex: 'action',
                render: (value) => (
                  <Tag title={value}>{formatAuditAction(value, t)}</Tag>
                ),
              },
              {
                title: 'IP',
                dataIndex: 'ip',
                render: (value) => (
                  <span className='font-mono text-xs'>{value || '-'}</span>
                ),
              },
              {
                title: t('结果'),
                dataIndex: 'success',
                render: (value) => (
                  <Tag color={value ? 'green' : 'red'}>
                    {value ? t('成功') : t('失败')}
                  </Tag>
                ),
              },
            ]}
          />
        </Card>
      </div>

      <Card
        className='mt-5 !rounded-2xl border-0 shadow-sm'
        bodyStyle={{ padding: 0 }}
      >
        <div className='flex items-center justify-between border-b border-semi-color-border px-5 py-4'>
          <div>
            <div className='font-semibold'>{t('IP 黑名单')}</div>
            <div className='mt-1 text-xs text-semi-color-text-2'>
              {t('规则立即生效于 API 和控制台入口')}
            </div>
          </div>
          <Ban size={20} className='text-red-500' />
        </div>
        <Table
          size='small'
          pagination={{
            currentPage: blocksPage,
            pageSize: 8,
            total: blocksTotal,
            onPageChange: setBlocksPage,
          }}
          loading={loading}
          dataSource={blocks}
          rowKey='id'
          empty={t('暂无 IP 黑名单')}
          columns={[
            {
              title: t('IP 地址'),
              dataIndex: 'address',
              render: (value) => <span className='font-mono'>{value}</span>,
            },
            {
              title: t('原因'),
              dataIndex: 'reason',
              render: (value) => value || '-',
            },
            {
              title: t('状态'),
              dataIndex: 'enabled',
              render: (value, record) => (
                <Switch
                  checked={value}
                  onChange={(checked) => updateBlock(record, checked)}
                />
              ),
            },
            {
              title: t('创建时间'),
              dataIndex: 'created_at',
              render: formatTime,
            },
            {
              title: t('操作'),
              render: (_, record) => (
                <Button
                  type='danger'
                  theme='borderless'
                  icon={<Trash2 size={15} />}
                  onClick={() => deleteBlock(record)}
                >
                  {t('移除')}
                </Button>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title={t('拉黑 IP 地址')}
        visible={modalVisible}
        onCancel={() => setModalVisible(false)}
        footer={null}
      >
        <Form onSubmit={createBlock} layout='vertical'>
          <Form.Input
            field='address'
            label={t('IP 地址')}
            placeholder={t('例如 203.0.113.10')}
            rules={[{ required: true, message: t('请输入 IP 地址') }]}
          />
          <Form.Input
            field='reason'
            label={t('原因')}
            placeholder={t('例如：异常注册、撞库行为')}
          />
          <div className='flex justify-end gap-2'>
            <Button onClick={() => setModalVisible(false)}>{t('取消')}</Button>
            <Button htmlType='submit' type='primary'>
              {t('确认拉黑')}
            </Button>
          </div>
        </Form>
      </Modal>
    </div>
  );
};

export default SecurityAccess;
