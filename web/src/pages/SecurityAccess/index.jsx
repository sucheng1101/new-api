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
      Toast.error(
        error?.response?.data?.message || t('Security data failed to load'),
      );
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
        throw new Error(response.data?.message || t('Operation failed'));
      Toast.success(t('IP added to blocklist'));
      setModalVisible(false);
      await load();
    } catch (error) {
      Toast.error(
        error?.response?.data?.message ||
          error.message ||
          t('Operation failed'),
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
      Toast.error(error?.response?.data?.message || t('Status update failed'));
    }
  };

  const deleteBlock = (record) => {
    Modal.confirm({
      title: t('Remove IP block'),
      content: t('Remove {{address}} from the blocklist?', {
        address: record.address,
      }),
      onOk: async () => {
        try {
          await API.delete(`/api/admin/security/ip-blocks/${record.id}`);
          await load();
        } catch (error) {
          Toast.error(error?.response?.data?.message || t('Delete failed'));
        }
      },
    });
  };

  const metricItems = useMemo(
    () => [
      {
        label: t('Audit events'),
        value: summary?.audit_events,
        icon: <History size={18} />,
        tone: 'blue',
      },
      {
        label: t('Active IPs'),
        value: summary?.distinct_ips,
        icon: <Globe2 size={18} />,
        tone: 'cyan',
      },
      {
        label: t('Registration events'),
        value: summary?.registrations,
        icon: <UserRound size={18} />,
        tone: 'violet',
      },
      {
        label: t('Login events'),
        value: summary?.logins,
        icon: <CheckCircle2 size={18} />,
        tone: 'green',
      },
      {
        label: t('Wallet actions'),
        value: summary?.wallet_actions,
        icon: <Activity size={18} />,
        tone: 'orange',
      },
      {
        label: t('Blocked IPs'),
        value: summary?.active_blocks,
        icon: <Ban size={18} />,
        tone: 'red',
      },
    ],
    [summary, t],
  );

  return (
    <div className='mx-auto w-full max-w-[1800px] px-3 pb-8 sm:px-6'>
      <div className='mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between'>
        <div>
          <Typography.Title heading={3} style={{ margin: 0 }}>
            {t('Security & Access')}
          </Typography.Title>
          <div className='mt-1 text-sm text-semi-color-text-2'>
            {t(
              'Review registrations, logins, wallet actions, and administrator activity, then respond to risky IPs.',
            )}
          </div>
        </div>
        <div className='flex gap-2'>
          <Button
            theme='light'
            icon={<RefreshCw size={15} />}
            loading={loading}
            onClick={load}
          >
            {t('Refresh')}
          </Button>
          <Button
            type='primary'
            icon={<Plus size={15} />}
            onClick={() => setModalVisible(true)}
          >
            {t('Block IP')}
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
              <div className='font-semibold'>{t('Risky IPs')}</div>
              <div className='mt-1 text-xs text-semi-color-text-2'>
                {t('IPs associated with multiple users')}
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
            empty={t('No risky IPs')}
            columns={[
              {
                title: t('IP address'),
                dataIndex: 'address',
                render: (value) => (
                  <span className='font-mono text-xs'>{value}</span>
                ),
              },
              {
                title: t('Users'),
                dataIndex: 'user_count',
                render: (value) => <Tag color='orange'>{value}</Tag>,
              },
              { title: t('Events'), dataIndex: 'event_count' },
              {
                title: t('Last activity'),
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
            <div className='font-semibold'>{t('Recent activity')}</div>
            <div className='mt-1 text-xs text-semi-color-text-2'>
              {t(
                'Only metadata is stored; passwords, tokens, and request bodies are excluded.',
              )}
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
            empty={t('No audit events')}
            scroll={{ x: 720 }}
            columns={[
              { title: t('Time'), dataIndex: 'created_at', render: formatTime },
              {
                title: t('User'),
                dataIndex: 'username',
                render: (value) => value || t('System'),
              },
              {
                title: t('Action'),
                dataIndex: 'action',
                render: (value) => <Tag>{value}</Tag>,
              },
              {
                title: 'IP',
                dataIndex: 'ip',
                render: (value) => (
                  <span className='font-mono text-xs'>{value || '-'}</span>
                ),
              },
              {
                title: t('Result'),
                dataIndex: 'success',
                render: (value) => (
                  <Tag color={value ? 'green' : 'red'}>
                    {value ? t('Success') : t('Failed')}
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
            <div className='font-semibold'>{t('IP blocklist')}</div>
            <div className='mt-1 text-xs text-semi-color-text-2'>
              {t('Rules apply immediately to API and console entry points.')}
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
          empty={t('No blocked IPs')}
          columns={[
            {
              title: t('IP address'),
              dataIndex: 'address',
              render: (value) => <span className='font-mono'>{value}</span>,
            },
            {
              title: t('Reason'),
              dataIndex: 'reason',
              render: (value) => value || '-',
            },
            {
              title: t('Status'),
              dataIndex: 'enabled',
              render: (value, record) => (
                <Switch
                  checked={value}
                  onChange={(checked) => updateBlock(record, checked)}
                />
              ),
            },
            {
              title: t('Created at'),
              dataIndex: 'created_at',
              render: formatTime,
            },
            {
              title: t('Action'),
              render: (_, record) => (
                <Button
                  type='danger'
                  theme='borderless'
                  icon={<Trash2 size={15} />}
                  onClick={() => deleteBlock(record)}
                >
                  {t('Remove')}
                </Button>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title={t('Block an IP address')}
        visible={modalVisible}
        onCancel={() => setModalVisible(false)}
        footer={null}
      >
        <Form onSubmit={createBlock} layout='vertical'>
          <Form.Input
            field='address'
            label={t('IP address')}
            placeholder={t('203.0.113.10')}
            rules={[{ required: true, message: t('Enter an IP address') }]}
          />
          <Form.Input
            field='reason'
            label={t('Reason')}
            placeholder={t('Example: suspicious registration')}
          />
          <div className='flex justify-end gap-2'>
            <Button onClick={() => setModalVisible(false)}>
              {t('Cancel')}
            </Button>
            <Button htmlType='submit' type='primary'>
              {t('Confirm block')}
            </Button>
          </div>
        </Form>
      </Modal>
    </div>
  );
};

export default SecurityAccess;
