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

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  Form,
  Input,
  Modal,
  Select,
  Skeleton,
  Switch,
  Table,
  Tabs,
  Tag,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import {
  Activity,
  Ban,
  CheckCircle2,
  Copy,
  Globe2,
  History,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserRound,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { API } from '../../helpers';
import DomainManagementPanel from '../../components/security/DomainManagementPanel';

const PAGE_SIZE = 8;
const RANGE_OPTIONS = [
  { value: 24, label: '近 24 小时' },
  { value: 168, label: '近 7 天' },
  { value: 720, label: '近 30 天' },
  { value: 0, label: '全部时间' },
];
const rangeParams = (hours) => {
  if (!hours) return {};
  const end = Math.floor(Date.now() / 1000);
  return { start_timestamp: end - Number(hours) * 3600, end_timestamp: end };
};
const RangeSelect = ({ value, onChange }) => (
  <Select
    size='small'
    value={value}
    style={{ width: 132 }}
    optionList={RANGE_OPTIONS}
    onChange={onChange}
  />
);
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
};
const formatAuditAction = (value) => {
  if (!value) return '-';
  if (AUDIT_ACTION_LABELS[value]) return AUDIT_ACTION_LABELS[value];
  if (value.startsWith('wallet.')) return '钱包操作';
  if (value.startsWith('post.api.user.')) return '用户操作';
  if (value.startsWith('post.api.admin.')) return '管理员操作';
  return value;
};
const formatGeoLocation = (record) => {
  const location = [record.country, record.region, record.city]
    .filter(Boolean)
    .join(' · ');
  if (location) return location;
  if (record.geo_status === 'local') return '本机地址';
  if (record.geo_status === 'private') return '内网地址';
  if (record.geo_status === 'invalid') return '无效 IP';
  return '暂无归属地';
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
const SearchBar = ({ value, onChange, onSearch, placeholder }) => (
  <div className='flex min-w-[220px] flex-1 gap-2'>
    <Input
      prefix={<Search size={15} />}
      value={value}
      onChange={onChange}
      onEnterPress={onSearch}
      placeholder={placeholder}
      showClear
      className='flex-1'
    />
    <Button theme='light' onClick={onSearch} icon={<Search size={15} />}>
      搜索
    </Button>
  </div>
);
const DetailModalBody = ({ data }) => {
  if (!data || typeof data !== 'object')
    return (
      <pre className='max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-semi-color-fill-0 p-3 text-xs'>
        暂无详情
      </pre>
    );
  const rows = Object.entries(data).filter(
    ([, value]) => value !== null && value !== undefined && value !== '',
  );
  return (
    <div className='max-h-[60vh] overflow-auto rounded-lg bg-semi-color-fill-0 p-3'>
      <div className='grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-2'>
        {rows.map(([key, value]) => (
          <div key={key} className='flex min-w-0 gap-2'>
            <span className='shrink-0 font-medium text-semi-color-text-2'>
              {key}
            </span>
            <span className='min-w-0 break-words font-mono'>
              {typeof value === 'object'
                ? JSON.stringify(value)
                : String(value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

const SecurityAccess = () => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('access');
  const [summary, setSummary] = useState(null),
    [risks, setRisks] = useState([]),
    [risksTotal, setRisksTotal] = useState(0),
    [risksPage, setRisksPage] = useState(1),
    [riskQuery, setRiskQuery] = useState(''),
    [riskSearch, setRiskSearch] = useState(''),
    [riskRange, setRiskRange] = useState(24);
  const [events, setEvents] = useState([]),
    [eventsTotal, setEventsTotal] = useState(0),
    [eventsPage, setEventsPage] = useState(1),
    [eventQuery, setEventQuery] = useState(''),
    [eventSearch, setEventSearch] = useState(''),
    [eventRange, setEventRange] = useState(24);
  const [blocks, setBlocks] = useState([]),
    [blocksTotal, setBlocksTotal] = useState(0),
    [blocksPage, setBlocksPage] = useState(1),
    [blockQuery, setBlockQuery] = useState(''),
    [blockSearch, setBlockSearch] = useState('');
  const [allowlists, setAllowlists] = useState([]),
    [allowlistsTotal, setAllowlistsTotal] = useState(0),
    [allowlistsPage, setAllowlistsPage] = useState(1),
    [allowlistQuery, setAllowlistQuery] = useState(''),
    [allowlistSearch, setAllowlistSearch] = useState('');
  const [loading, setLoading] = useState(true),
    [modalVisible, setModalVisible] = useState(false),
    [detailVisible, setDetailVisible] = useState(false),
    [detailTitle, setDetailTitle] = useState('详情'),
    [detailData, setDetailData] = useState(null);
  const copy = async (value) => {
    if (!value) return;
    await navigator.clipboard?.writeText(value);
    Toast.success('已复制');
  };
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [summaryRes, riskRes, eventRes, blockRes, allowlistRes] =
        await Promise.all([
          API.get('/api/admin/security/summary'),
          API.get('/api/admin/security/ip-risks', {
            params: {
              p: risksPage,
              page_size: PAGE_SIZE,
              query: riskQuery,
              ...rangeParams(riskRange),
            },
          }),
          API.get('/api/admin/security/events', {
            params: {
              p: eventsPage,
              page_size: PAGE_SIZE,
              query: eventQuery,
              ...rangeParams(eventRange),
            },
          }),
          API.get('/api/admin/security/ip-blocks', {
            params: { p: blocksPage, page_size: PAGE_SIZE, query: blockQuery },
          }),
          API.get('/api/admin/security/direct-ip-whitelist', {
            params: {
              p: allowlistsPage,
              page_size: PAGE_SIZE,
              query: allowlistQuery,
            },
          }),
        ]);
      if (summaryRes.data?.success) setSummary(summaryRes.data.data || {});
      if (riskRes.data?.success) {
        setRisks(riskRes.data.data?.items || []);
        setRisksTotal(riskRes.data.data?.total || 0);
      }
      if (eventRes.data?.success) {
        setEvents(eventRes.data.data?.items || []);
        setEventsTotal(eventRes.data.data?.total || 0);
      }
      if (blockRes.data?.success) {
        setBlocks(blockRes.data.data?.items || []);
        setBlocksTotal(blockRes.data.data?.total || 0);
      }
      if (allowlistRes.data?.success) {
        setAllowlists(allowlistRes.data.data?.items || []);
        setAllowlistsTotal(allowlistRes.data.data?.total || 0);
      }
    } catch (error) {
      Toast.error(error?.response?.data?.message || '安全数据加载失败');
    } finally {
      setLoading(false);
    }
  }, [
    allowlistQuery,
    allowlistsPage,
    blockQuery,
    blocksPage,
    eventQuery,
    eventRange,
    eventsPage,
    riskQuery,
    riskRange,
    risksPage,
  ]);
  useEffect(() => {
    load();
  }, [load]);
  const openDetail = async (event) => {
    try {
      const response = await API.get(
        `/api/admin/security/events/${event.event_id}`,
      );
      if (!response.data?.success)
        throw new Error(response.data?.message || '详情加载失败');
      setDetailTitle(`事件详情 · ${event.event_id}`);
      setDetailData(response.data.data);
      setDetailVisible(true);
    } catch (error) {
      Toast.error(error?.response?.data?.message || error.message);
    }
  };
  const showGeoDetails = (record) => {
    setDetailTitle(`IP 详情 · ${record.address}`);
    setDetailData(record);
    setDetailVisible(true);
  };
  const createBlock = async (values) => {
    try {
      const response = await API.post('/api/admin/security/ip-blocks', values);
      if (!response.data?.success)
        throw new Error(response.data?.message || '操作失败');
      Toast.success('IP 已加入黑名单');
      setModalVisible(false);
      await load();
    } catch (error) {
      Toast.error(
        error?.response?.data?.message || error.message || '操作失败',
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
      Toast.error(error?.response?.data?.message || '状态更新失败');
    }
  };
  const updateAllowlist = async (record, enabled) => {
    try {
      await API.patch(`/api/admin/security/direct-ip-whitelist/${record.id}`, {
        enabled,
      });
      await load();
    } catch (error) {
      Toast.error(error?.response?.data?.message || '状态更新失败');
    }
  };
  const deleteRecord = (url, message) =>
    Modal.confirm({
      title: '确认删除',
      content: message,
      onOk: async () => {
        try {
          await API.delete(url);
          await load();
        } catch (error) {
          Toast.error(error?.response?.data?.message || '删除失败');
        }
      },
    });
  const metricItems = useMemo(
    () => [
      {
        label: '审计事件',
        value: summary?.audit_events,
        icon: <History size={18} />,
        tone: 'blue',
      },
      {
        label: '活跃 IP',
        value: summary?.distinct_ips,
        icon: <Globe2 size={18} />,
        tone: 'cyan',
      },
      {
        label: '注册事件',
        value: summary?.registrations,
        icon: <UserRound size={18} />,
        tone: 'violet',
      },
      {
        label: '登录事件',
        value: summary?.logins,
        icon: <CheckCircle2 size={18} />,
        tone: 'green',
      },
      {
        label: '钱包操作',
        value: summary?.wallet_actions,
        icon: <Activity size={18} />,
        tone: 'orange',
      },
      {
        label: '封禁 IP',
        value: summary?.active_blocks,
        icon: <Ban size={18} />,
        tone: 'red',
      },
    ],
    [summary],
  );
  return (
    <div className='mx-auto w-full max-w-[1800px] px-3 pb-8 sm:px-6'>
      <div className='mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
        <div className='flex items-center gap-2'>
          <span className='flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-300'>
            <ShieldAlert size={17} />
          </span>
          <Typography.Title heading={3} style={{ margin: 0 }}>
            安全与访问
          </Typography.Title>
        </div>
        <div className='flex gap-2'>
          <Button
            theme='light'
            icon={<RefreshCw size={15} />}
            loading={loading}
            onClick={load}
          >
            刷新
          </Button>
          <Button
            type='primary'
            icon={<Plus size={15} />}
            onClick={() => setModalVisible(true)}
          >
            拉黑 IP
          </Button>
        </div>
      </div>
      <Tabs type='button' activeKey={activeTab} onChange={setActiveTab}>
        <Tabs.TabPane itemKey='access' tab='安全与访问'>
          <div className='mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6'>
            {metricItems.map((item) => (
              <MetricCard
                key={item.label}
                {...item}
                loading={loading && !summary}
              />
            ))}
          </div>
          <div className='grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.22fr)_minmax(0,1fr)]'>
            <Card
              className='!rounded-2xl border-0 shadow-sm'
              bodyStyle={{ padding: 0 }}
            >
              <div className='border-b border-semi-color-border px-5 py-4'>
                <div className='flex items-center justify-between gap-3'>
                  <div>
                    <div className='font-semibold'>
                      异常 IP{' '}
                      <span className='text-xs text-semi-color-text-2'>
                        共 {risksTotal} 条
                      </span>
                    </div>
                    <div className='mt-1 text-xs text-semi-color-text-2'>
                      按用户聚合，点击 IP 可复制，点击归属地查看详情
                    </div>
                  </div>
                  <ShieldAlert className='text-orange-500' size={20} />
                </div>
                <div className='mt-3 flex flex-col gap-2 sm:flex-row'>
                  <SearchBar
                    value={riskSearch}
                    onChange={setRiskSearch}
                    onSearch={() => {
                      setRisksPage(1);
                      setRiskQuery(riskSearch);
                    }}
                    placeholder='搜索 IP 地址'
                  />
                  <RangeSelect
                    value={riskRange}
                    onChange={(value) => {
                      setRiskRange(value);
                      setRisksPage(1);
                    }}
                  />
                </div>
              </div>
              <Table
                size='small'
                pagination={{
                  currentPage: risksPage,
                  pageSize: PAGE_SIZE,
                  total: risksTotal,
                  onPageChange: setRisksPage,
                }}
                loading={loading}
                dataSource={risks}
                rowKey='address'
                empty='暂无异常 IP'
                scroll={{ x: 760 }}
                columns={[
                  {
                    title: 'IP 地址',
                    dataIndex: 'address',
                    render: (value) => (
                      <Button
                        theme='borderless'
                        className='!px-0 font-mono text-xs'
                        onClick={() => copy(value)}
                      >
                        {value}
                        <Copy size={13} className='ml-1' />
                      </Button>
                    ),
                  },
                  {
                    title: '归属地',
                    dataIndex: 'country',
                    width: 180,
                    render: (_, record) => (
                      <Button
                        theme='borderless'
                        type='tertiary'
                        className='!px-0 text-left'
                        onClick={() => showGeoDetails(record)}
                      >
                        {formatGeoLocation(record)}
                      </Button>
                    ),
                  },
                  {
                    title: '用户',
                    dataIndex: 'users',
                    render: (value, record) => (
                      <span title={(value || []).join(', ')}>
                        {value?.length
                          ? value.slice(0, 2).join('、')
                          : `${record.user_count} 个用户`}
                        {value?.length > 2 ? '…' : ''}
                      </span>
                    ),
                  },
                  {
                    title: '事件',
                    dataIndex: 'event_count',
                    render: (value) => <Tag color='orange'>{value}</Tag>,
                  },
                  {
                    title: '最近活动',
                    dataIndex: 'last_seen',
                    render: formatTime,
                  },
                  {
                    title: '详情',
                    render: (_, record) => (
                      <Button
                        theme='borderless'
                        onClick={() => showGeoDetails(record)}
                      >
                        查看
                      </Button>
                    ),
                  },
                ]}
              />
            </Card>
            <Card
              className='!rounded-2xl border-0 shadow-sm'
              bodyStyle={{ padding: 0 }}
            >
              <div className='border-b border-semi-color-border px-5 py-4'>
                <div className='flex items-center justify-between'>
                  <div>
                    <div className='font-semibold'>
                      最近操作{' '}
                      <span className='text-xs text-semi-color-text-2'>
                        共 {eventsTotal} 条
                      </span>
                    </div>
                    <div className='mt-1 text-xs text-semi-color-text-2'>
                      系统操作展示动作与来源，点击详情查看完整事件
                    </div>
                  </div>
                  <History className='text-blue-500' size={20} />
                </div>
                <div className='mt-3 flex flex-col gap-2 sm:flex-row'>
                  <SearchBar
                    value={eventSearch}
                    onChange={setEventSearch}
                    onSearch={() => {
                      setEventsPage(1);
                      setEventQuery(eventSearch);
                    }}
                    placeholder='搜索用户、IP、动作或来源'
                  />
                  <RangeSelect
                    value={eventRange}
                    onChange={(value) => {
                      setEventRange(value);
                      setEventsPage(1);
                    }}
                  />
                </div>
              </div>
              <Table
                size='small'
                pagination={{
                  currentPage: eventsPage,
                  pageSize: PAGE_SIZE,
                  total: eventsTotal,
                  onPageChange: setEventsPage,
                }}
                loading={loading}
                dataSource={events}
                rowKey='event_id'
                empty='暂无审计事件'
                scroll={{ x: 720 }}
                columns={[
                  {
                    title: '时间',
                    dataIndex: 'created_at',
                    render: formatTime,
                  },
                  {
                    title: '用户 / 来源',
                    dataIndex: 'username',
                    render: (value, record) =>
                      value ? (
                        <span>{value}</span>
                      ) : (
                        <div>
                          <div className='font-medium'>系统</div>
                          <div
                            className='max-w-[180px] truncate text-xs text-semi-color-text-2'
                            title={`${record.action} · ${record.route}`}
                          >
                            {formatAuditAction(record.action)} ·{' '}
                            {record.route || '-'}
                          </div>
                        </div>
                      ),
                  },
                  {
                    title: '动作',
                    dataIndex: 'action',
                    render: (value) => (
                      <Tag title={value}>{formatAuditAction(value)}</Tag>
                    ),
                  },
                  {
                    title: 'IP',
                    dataIndex: 'ip',
                    render: (value) => (
                      <Button
                        theme='borderless'
                        className='!px-0 font-mono text-xs'
                        onClick={() => copy(value)}
                      >
                        {value || '-'}
                        {value && <Copy size={12} className='ml-1' />}
                      </Button>
                    ),
                  },
                  {
                    title: '结果',
                    dataIndex: 'success',
                    render: (value) => (
                      <Tag color={value ? 'green' : 'red'}>
                        {value ? '成功' : '失败'}
                      </Tag>
                    ),
                  },
                  {
                    title: '详情',
                    render: (_, record) => (
                      <Button
                        theme='borderless'
                        onClick={() => openDetail(record)}
                      >
                        查看
                      </Button>
                    ),
                  },
                ]}
              />
            </Card>
          </div>
        </Tabs.TabPane>
        <Tabs.TabPane itemKey='allowlist' tab='白名单'>
          <div className='flex flex-col gap-5'>
            <Card
              className='!rounded-2xl border-0 shadow-sm'
              bodyStyle={{ padding: 0 }}
            >
              <div className='border-b border-semi-color-border px-5 py-4'>
                <div className='flex items-center justify-between gap-3'>
                  <div>
                    <div className='font-semibold'>
                      直连白名单管理{' '}
                      <span className='text-xs text-semi-color-text-2'>
                        共 {allowlistsTotal} 条
                      </span>
                    </div>
                    <div className='mt-1 text-xs text-semi-color-text-2'>
                      管理员可查看用户、IP、备注，并停用或删除授权记录
                    </div>
                  </div>
                  <ShieldCheck size={20} className='text-green-500' />
                </div>
                <div className='mt-3'>
                  <SearchBar
                    value={allowlistSearch}
                    onChange={setAllowlistSearch}
                    onSearch={() => {
                      setAllowlistsPage(1);
                      setAllowlistQuery(allowlistSearch);
                    }}
                    placeholder='搜索用户名、用户 ID、IP 或备注'
                  />
                </div>
              </div>
              <Table
                size='small'
                pagination={{
                  currentPage: allowlistsPage,
                  pageSize: PAGE_SIZE,
                  total: allowlistsTotal,
                  onPageChange: setAllowlistsPage,
                }}
                loading={loading}
                dataSource={allowlists}
                rowKey='id'
                empty='暂无直连白名单'
                scroll={{ x: 780 }}
                columns={[
                  {
                    title: '用户',
                    dataIndex: 'username',
                    render: (value, record) => (
                      <span>{value || `用户 #${record.user_id}`}</span>
                    ),
                  },
                  {
                    title: 'IP 地址',
                    dataIndex: 'ip',
                    render: (value) => (
                      <Button
                        theme='borderless'
                        className='!px-0 font-mono'
                        onClick={() => copy(value)}
                      >
                        {value}
                        <Copy size={13} className='ml-1' />
                      </Button>
                    ),
                  },
                  {
                    title: '备注',
                    dataIndex: 'remark',
                    render: (value) => value || '-',
                  },
                  {
                    title: '状态',
                    dataIndex: 'enabled',
                    render: (value, record) => (
                      <Switch
                        checked={value}
                        onChange={(checked) => updateAllowlist(record, checked)}
                      />
                    ),
                  },
                  {
                    title: '最近访问',
                    dataIndex: 'last_access_at',
                    render: formatTime,
                  },
                  {
                    title: '操作',
                    render: (_, record) => (
                      <Button
                        type='danger'
                        theme='borderless'
                        icon={<Trash2 size={15} />}
                        onClick={() =>
                          deleteRecord(
                            `/api/admin/security/direct-ip-whitelist/${record.id}`,
                            `确定删除 ${record.ip} 吗？`,
                          )
                        }
                      >
                        删除
                      </Button>
                    ),
                  },
                ]}
              />
            </Card>
          </div>
        </Tabs.TabPane>
        <Tabs.TabPane itemKey='blacklist' tab='黑名单'>
          <Card
            className='!rounded-2xl border-0 shadow-sm'
            bodyStyle={{ padding: 0 }}
          >
            <div className='border-b border-semi-color-border px-5 py-4'>
              <div className='flex items-center justify-between gap-3'>
                <div>
                  <div className='font-semibold'>
                    IP 黑名单{' '}
                    <span className='text-xs text-semi-color-text-2'>
                      共 {blocksTotal} 条
                    </span>
                  </div>
                  <div className='mt-1 text-xs text-semi-color-text-2'>
                    规则立即作用于 API 与控制台入口
                  </div>
                </div>
                <Ban size={20} className='text-red-500' />
              </div>
              <div className='mt-3'>
                <SearchBar
                  value={blockSearch}
                  onChange={setBlockSearch}
                  onSearch={() => {
                    setBlocksPage(1);
                    setBlockQuery(blockSearch);
                  }}
                  placeholder='搜索 IP 或原因'
                />
              </div>
            </div>
            <Table
              size='small'
              pagination={{
                currentPage: blocksPage,
                pageSize: PAGE_SIZE,
                total: blocksTotal,
                onPageChange: setBlocksPage,
              }}
              loading={loading}
              dataSource={blocks}
              rowKey='id'
              empty='暂无 IP 黑名单'
              columns={[
                {
                  title: 'IP 地址',
                  dataIndex: 'address',
                  render: (value) => (
                    <Button
                      theme='borderless'
                      className='!px-0 font-mono'
                      onClick={() => copy(value)}
                    >
                      {value}
                      <Copy size={13} className='ml-1' />
                    </Button>
                  ),
                },
                {
                  title: '原因',
                  dataIndex: 'reason',
                  render: (value) => value || '-',
                },
                {
                  title: '状态',
                  dataIndex: 'enabled',
                  render: (value, record) => (
                    <Switch
                      checked={value}
                      onChange={(checked) => updateBlock(record, checked)}
                    />
                  ),
                },
                {
                  title: '创建时间',
                  dataIndex: 'created_at',
                  render: formatTime,
                },
                {
                  title: '操作',
                  render: (_, record) => (
                    <Button
                      type='danger'
                      theme='borderless'
                      icon={<Trash2 size={15} />}
                      onClick={() =>
                        deleteRecord(
                          `/api/admin/security/ip-blocks/${record.id}`,
                          `确定移除 ${record.address} 吗？`,
                        )
                      }
                    >
                      移除
                    </Button>
                  ),
                },
              ]}
            />
          </Card>
        </Tabs.TabPane>
        <Tabs.TabPane itemKey='domain' tab='域名管理'>
          <DomainManagementPanel />
        </Tabs.TabPane>
      </Tabs>
      <Modal
        title='拉黑 IP 地址'
        visible={modalVisible}
        onCancel={() => setModalVisible(false)}
        footer={null}
      >
        <Form onSubmit={createBlock} layout='vertical'>
          <Form.Input
            field='address'
            label='IP 地址'
            placeholder='例如 203.0.113.10'
            rules={[{ required: true, message: '请输入 IP 地址' }]}
          />
          <Form.Input
            field='reason'
            label='原因'
            placeholder='例如异常注册、撞库行为'
          />
          <div className='flex justify-end gap-2'>
            <Button onClick={() => setModalVisible(false)}>取消</Button>
            <Button htmlType='submit' type='primary'>
              确认拉黑
            </Button>
          </div>
        </Form>
      </Modal>
      <Modal
        title={detailTitle}
        visible={detailVisible}
        onCancel={() => setDetailVisible(false)}
        footer={
          <Button type='primary' onClick={() => setDetailVisible(false)}>
            关闭
          </Button>
        }
      >
        <DetailModalBody data={detailData} />
      </Modal>
    </div>
  );
};
export default SecurityAccess;
