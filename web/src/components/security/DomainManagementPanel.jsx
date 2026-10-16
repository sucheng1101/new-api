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

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Button,
  Card,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Switch,
  Table,
  Tag,
  Toast,
} from '@douyinfe/semi-ui';
import {
  Check,
  Copy,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { API } from '../../helpers';

const PAGE_SIZE = 8;

const RECORD_KINDS = ['host', 'base_url', 'endpoint'];
const KIND_TAG_COLORS = {
  host: 'blue',
  base_url: 'cyan',
  endpoint: 'green',
};

const normalizeKind = (value) =>
  RECORD_KINDS.includes(String(value || '').trim())
    ? String(value).trim()
    : 'endpoint';

const formatTime = (value) => {
  if (!value) return '-';
  const date = new Date(Number(value) * 1000);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString();
};

const sortRecords = (records) =>
  [...records].sort((a, b) => {
    const orderA = Number(a.sort_order ?? 0);
    const orderB = Number(b.sort_order ?? 0);
    if (orderA === orderB) return Number(a.id ?? 0) - Number(b.id ?? 0);
    return orderA - orderB;
  });

const EditableDescription = ({ value, onSave, placeholder }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');

  useEffect(() => {
    setDraft(value || '');
  }, [value]);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next !== (value || '')) onSave(next);
  };

  if (editing) {
    return (
      <Input
        size='small'
        autofocus
        value={draft}
        placeholder={placeholder}
        className='max-w-[420px]'
        onChange={setDraft}
        onBlur={commit}
        onEnterPress={commit}
      />
    );
  }

  return (
    <button
      type='button'
      className='flex w-fit max-w-full items-center gap-1 text-left text-xs text-semi-color-text-2 hover:text-semi-color-primary'
      onClick={() => setEditing(true)}
    >
      <span className='truncate'>{value || placeholder}</span>
      <Pencil size={12} className='shrink-0' />
    </button>
  );
};

const DomainManagementPanel = ({
  searchable = false,
  paginated = false,
  recordKinds,
  title = '',
  description = '',
  emptyTitle = '',
  emptyDescription = '',
}) => {
  const { t } = useTranslation();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [copiedKey, setCopiedKey] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const copyTimer = useRef(null);

  useEffect(() => () => clearTimeout(copyTimer.current), []);

  const kindLabel = useCallback(
    (kind) => {
      switch (normalizeKind(kind)) {
        case 'host':
          return t('域名');
        case 'base_url':
          return t('API 地址');
        default:
          return t('端点');
      }
    },
    [t],
  );

  const kindOptions = useMemo(
    () => [
      { value: 'host', label: t('域名') },
      { value: 'base_url', label: t('API 地址') },
      { value: 'endpoint', label: t('端点') },
    ],
    [t],
  );

  const copy = async (key, value) => {
    if (!value) return;
    try {
      await navigator.clipboard?.writeText(value);
    } catch {
      // Clipboard access can be denied; still surface copy intent feedback.
    }
    setCopiedKey(key);
    Toast.success(t('已复制'));
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopiedKey(''), 1500);
  };

  // Domain-page refresh only loads domain/API endpoint configuration. It is
  // intentionally separate from the security-page refresh used by the access,
  // allowlist, and blacklist sections.
  const loadDomains = useCallback(async () => {
    setLoading(true);
    try {
      const response = await API.get('/api/admin/security/direct-api-config');
      if (!response.data?.success)
        throw new Error(response.data?.message || t('加载域名配置失败'));
      const data = response.data.data || {};
      const list = Array.isArray(data.records) ? data.records : [];
      setRecords(sortRecords(list));
    } catch (error) {
      Toast.error(
        error?.response?.data?.message ||
          error.message ||
          t('加载域名配置失败'),
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadDomains();
  }, [loadDomains]);

  const saveRecord = async (values) => {
    try {
      const payload = {
        kind: normalizeKind(values.kind),
        name: (values.name || '').trim(),
        endpoint: (values.endpoint || '').trim(),
        description: (values.description || '').trim(),
        enabled: values.enabled !== false,
        sort_order: Number(values.sort_order || 0),
      };
      const response = editing
        ? await API.patch(
            `/api/admin/security/direct-api-endpoints/${editing.id}`,
            payload,
          )
        : await API.post('/api/admin/security/direct-api-endpoints', payload);
      if (!response.data?.success)
        throw new Error(response.data?.message || t('保存失败'));
      setModalVisible(false);
      setEditing(null);
      await loadDomains();
      Toast.success(t('记录已保存'));
    } catch (error) {
      Toast.error(
        error?.response?.data?.message || error.message || t('保存失败'),
      );
    }
  };

  const patchRecord = async (record, payload) => {
    try {
      const response = await API.patch(
        `/api/admin/security/direct-api-endpoints/${record.id}`,
        payload,
      );
      if (!response.data?.success)
        throw new Error(response.data?.message || t('保存失败'));
      await loadDomains();
    } catch (error) {
      Toast.error(
        error?.response?.data?.message || error.message || t('状态更新失败'),
      );
    }
  };

  const removeRecord = (record) =>
    Modal.confirm({
      title: t('确认删除'),
      content: `${t('确定删除')} ${record.name || record.endpoint}？`,
      onOk: async () => {
        try {
          await API.delete(
            `/api/admin/security/direct-api-endpoints/${record.id}`,
          );
          await loadDomains();
        } catch (error) {
          Toast.error(error?.response?.data?.message || t('删除失败'));
        }
      },
    });

  const openCreate = () => {
    setEditing(null);
    setModalVisible(true);
  };

  const filtered = useMemo(() => {
    const allowedKinds = Array.isArray(recordKinds)
      ? new Set(recordKinds.map(normalizeKind))
      : null;
    const visibleRecords = allowedKinds
      ? records.filter((item) => allowedKinds.has(normalizeKind(item.kind)))
      : records;
    const keyword = query.trim().toLowerCase();
    if (!keyword) return visibleRecords;
    return visibleRecords.filter((item) =>
      [item.name, item.endpoint, item.description]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword)),
    );
  }, [recordKinds, records, query]);

  useEffect(() => {
    setPage(1);
  }, [query, records.length]);

  const displayRecords = paginated
    ? filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
    : filtered;

  return (
    <div className='flex flex-col gap-5'>
      <Card
        className='!rounded-2xl border-0 shadow-sm'
        bodyStyle={{ padding: 0 }}
      >
        <div className='border-b border-semi-color-border px-5 py-4'>
          <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
            <div className='min-w-0'>
              <div className='font-semibold'>
                {title || t('直连域名记录')}{' '}
                <span className='text-xs text-semi-color-text-2'>
                  {t('共 {{total}} 条', { total: filtered.length })}
                </span>
              </div>
              <div className='mt-1 text-xs text-semi-color-text-2'>
                {description || t('直连域名记录可在此启停、排序与编辑说明')}
              </div>
            </div>
            <div className='flex shrink-0 gap-2'>
              <Button
                theme='light'
                icon={<RefreshCw size={15} />}
                loading={loading}
                aria-label={t('刷新域名配置')}
                onClick={loadDomains}
              >
                {t('刷新域名配置')}
              </Button>
              <Button
                type='primary'
                size='small'
                icon={<Plus size={14} />}
                onClick={openCreate}
              >
                {t('新增记录')}
              </Button>
            </div>
          </div>
          {searchable && (
            <div className='mt-3 flex min-w-[220px] gap-2'>
              <Input
                prefix={<Search size={15} />}
                value={searchInput}
                onChange={setSearchInput}
                onEnterPress={() => setQuery(searchInput)}
                placeholder={t('搜索名称、地址或描述')}
                showClear
                className='flex-1'
              />
              <Button
                theme='light'
                icon={<Search size={15} />}
                onClick={() => setQuery(searchInput)}
              >
                {t('搜索')}
              </Button>
            </div>
          )}
        </div>

        <Table
          size='small'
          loading={loading}
          dataSource={displayRecords}
          rowKey='id'
          pagination={
            paginated
              ? {
                  currentPage: page,
                  pageSize: PAGE_SIZE,
                  total: filtered.length,
                  onPageChange: setPage,
                }
              : false
          }
          empty={
            <Empty
              title={emptyTitle || t('暂无直连域名记录')}
              description={
                emptyDescription || t('新增记录后即可在此管理启停与排序')
              }
              style={{ padding: '24px 0' }}
            >
              <Button
                type='primary'
                icon={<Plus size={14} />}
                onClick={openCreate}
              >
                {t('新增记录')}
              </Button>
            </Empty>
          }
          scroll={{ x: 960 }}
          columns={[
            {
              title: t('类型'),
              dataIndex: 'kind',
              width: 110,
              render: (value) => {
                const kind = normalizeKind(value);
                return (
                  <Tag color={KIND_TAG_COLORS[kind]}>{kindLabel(kind)}</Tag>
                );
              },
            },
            {
              title: t('名称'),
              dataIndex: 'name',
              width: 150,
              render: (value) => (
                <span className='block max-w-[150px] truncate font-medium'>
                  {value || '-'}
                </span>
              ),
            },
            {
              title: t('地址'),
              dataIndex: 'endpoint',
              render: (value, record) => (
                <Button
                  theme='borderless'
                  className='!px-0 font-mono text-xs'
                  disabled={!value}
                  onClick={() => copy(`endpoint-${record.id}`, value)}
                >
                  <span className='flex min-w-0 items-center gap-1'>
                    <span className='max-w-[260px] truncate'>
                      {value || '-'}
                    </span>
                    {copiedKey === `endpoint-${record.id}` ? (
                      <Check size={13} className='shrink-0 text-green-500' />
                    ) : (
                      <Copy size={13} className='shrink-0' />
                    )}
                  </span>
                </Button>
              ),
            },
            {
              title: t('描述'),
              dataIndex: 'description',
              render: (value, record) => (
                <EditableDescription
                  value={value}
                  placeholder={t('展示给用户的说明，可编辑')}
                  onSave={(description) => patchRecord(record, { description })}
                />
              ),
            },
            {
              title: t('状态'),
              dataIndex: 'enabled',
              width: 90,
              render: (value, record) => (
                <Switch
                  checked={value}
                  onChange={(checked) =>
                    patchRecord(record, { enabled: checked })
                  }
                />
              ),
            },
            {
              title: t('排序'),
              dataIndex: 'sort_order',
              width: 80,
              render: (value) => value ?? 0,
            },
            {
              title: t('更新时间'),
              dataIndex: 'updated_at',
              width: 170,
              render: formatTime,
            },
            {
              title: t('操作'),
              width: 160,
              render: (_, record) => (
                <div className='flex items-center gap-1'>
                  <Button
                    theme='borderless'
                    icon={<Pencil size={14} />}
                    onClick={() => {
                      setEditing(record);
                      setModalVisible(true);
                    }}
                  >
                    {t('编辑')}
                  </Button>
                  <Button
                    type='danger'
                    theme='borderless'
                    icon={<Trash2 size={14} />}
                    aria-label={t('删除')}
                    onClick={() => removeRecord(record)}
                  />
                </div>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title={editing ? t('编辑记录') : t('新增记录')}
        visible={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          setEditing(null);
        }}
        footer={null}
      >
        <Form
          key={editing?.id || 'new'}
          initValues={
            editing || { kind: 'endpoint', enabled: true, sort_order: 0 }
          }
          onSubmit={saveRecord}
          layout='vertical'
        >
          <Form.Select
            field='kind'
            label={t('类型')}
            optionList={kindOptions}
            rules={[{ required: true, message: t('请选择类型') }]}
          />
          <Form.Input
            field='name'
            label={t('名称')}
            placeholder={t('请输入名称')}
            rules={[{ required: true, message: t('请输入名称') }]}
          />
          <Form.Input
            field='endpoint'
            label={t('地址')}
            placeholder='https://api.example.com/v1'
            rules={[{ required: true, message: t('请输入地址') }]}
          />
          <Form.Input
            field='description'
            label={t('描述')}
            placeholder={t('展示给用户的说明，可编辑')}
          />
          <Form.Input field='sort_order' label={t('排序')} />
          <Form.Switch field='enabled' label={t('启用')} />
          <div className='flex justify-end gap-2'>
            <Button onClick={() => setModalVisible(false)}>{t('取消')}</Button>
            <Button htmlType='submit' type='primary'>
              {t('保存')}
            </Button>
          </div>
        </Form>
      </Modal>
    </div>
  );
};

export default DomainManagementPanel;
