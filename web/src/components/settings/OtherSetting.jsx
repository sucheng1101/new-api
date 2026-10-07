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

import React, { useContext, useEffect, useRef, useState } from 'react';
import {
  Banner,
  Button,
  Col,
  Form,
  Row,
  Modal,
  Space,
  Card,
} from '@douyinfe/semi-ui';
import { API, showError, showSuccess, timestamp2string } from '../../helpers';
import { marked } from 'marked';
import { useTranslation } from 'react-i18next';
import { StatusContext } from '../../context/Status';
import Text from '@douyinfe/semi-ui/lib/es/typography/text';

const LEGAL_USER_AGREEMENT_KEY = 'legal.user_agreement';
const LEGAL_PRIVACY_POLICY_KEY = 'legal.privacy_policy';
const GENERAL_DOCS_LINK_KEY = 'general_setting.docs_link';

const OtherSetting = () => {
  const { t } = useTranslation();
  let [inputs, setInputs] = useState({
    Notice: '',
    [LEGAL_USER_AGREEMENT_KEY]: '',
    [LEGAL_PRIVACY_POLICY_KEY]: '',
    SystemName: '',
    Logo: '',
    Footer: '',
    About: '',
    HomePageContent: '',
    [GENERAL_DOCS_LINK_KEY]: '',
  });
  let [loading, setLoading] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [statusState, statusDispatch] = useContext(StatusContext);
  const [updateData, setUpdateData] = useState({
    tag_name: '',
    content: '',
    html_url: '',
    source: '',
    published_at: '',
  });
  const [updateRunning, setUpdateRunning] = useState(false);
  const [updateMessage, setUpdateMessage] = useState('');
  const [updateMode, setUpdateMode] = useState('systemd');
  const [updatePhase, setUpdatePhase] = useState('idle');
  const [updateLog, setUpdateLog] = useState('');

  const updateOption = async (key, value) => {
    setLoading(true);
    try {
      const res = await API.put('/api/option/', {
        key,
        value,
      });
      const { success, message } = res.data;
      if (success) {
        setInputs((inputs) => ({ ...inputs, [key]: value }));
        return true;
      }
      showError(message);
      return false;
    } finally {
      setLoading(false);
    }
  };

  const [loadingInput, setLoadingInput] = useState({
    Notice: false,
    [LEGAL_USER_AGREEMENT_KEY]: false,
    [LEGAL_PRIVACY_POLICY_KEY]: false,
    SystemName: false,
    Logo: false,
    HomePageContent: false,
    About: false,
    [GENERAL_DOCS_LINK_KEY]: false,
    Footer: false,
    CheckUpdate: false,
  });
  const handleInputChange = async (value, e) => {
    const name = e.target.id;
    setInputs((inputs) => ({ ...inputs, [name]: value }));
  };

  // 通用设置
  const formAPISettingGeneral = useRef();
  // 通用设置 - Notice
  const submitNotice = async () => {
    try {
      setLoadingInput((loadingInput) => ({ ...loadingInput, Notice: true }));
      await updateOption('Notice', inputs.Notice);
      showSuccess(t('公告已更新'));
    } catch (error) {
      console.error(t('公告更新失败'), error);
      showError(t('公告更新失败'));
    } finally {
      setLoadingInput((loadingInput) => ({ ...loadingInput, Notice: false }));
    }
  };
  // 通用设置 - UserAgreement
  const submitUserAgreement = async () => {
    try {
      setLoadingInput((loadingInput) => ({
        ...loadingInput,
        [LEGAL_USER_AGREEMENT_KEY]: true,
      }));
      await updateOption(
        LEGAL_USER_AGREEMENT_KEY,
        inputs[LEGAL_USER_AGREEMENT_KEY],
      );
      showSuccess(t('用户协议已更新'));
    } catch (error) {
      console.error(t('用户协议更新失败'), error);
      showError(t('用户协议更新失败'));
    } finally {
      setLoadingInput((loadingInput) => ({
        ...loadingInput,
        [LEGAL_USER_AGREEMENT_KEY]: false,
      }));
    }
  };
  // 通用设置 - PrivacyPolicy
  const submitPrivacyPolicy = async () => {
    try {
      setLoadingInput((loadingInput) => ({
        ...loadingInput,
        [LEGAL_PRIVACY_POLICY_KEY]: true,
      }));
      await updateOption(
        LEGAL_PRIVACY_POLICY_KEY,
        inputs[LEGAL_PRIVACY_POLICY_KEY],
      );
      showSuccess(t('隐私政策已更新'));
    } catch (error) {
      console.error(t('隐私政策更新失败'), error);
      showError(t('隐私政策更新失败'));
    } finally {
      setLoadingInput((loadingInput) => ({
        ...loadingInput,
        [LEGAL_PRIVACY_POLICY_KEY]: false,
      }));
    }
  };
  // 个性化设置
  const formAPIPersonalization = useRef();
  //  个性化设置 - SystemName
  const submitSystemName = async () => {
    try {
      setLoadingInput((loadingInput) => ({
        ...loadingInput,
        SystemName: true,
      }));
      await updateOption('SystemName', inputs.SystemName);
      showSuccess(t('系统名称已更新'));
    } catch (error) {
      console.error(t('系统名称更新失败'), error);
      showError(t('系统名称更新失败'));
    } finally {
      setLoadingInput((loadingInput) => ({
        ...loadingInput,
        SystemName: false,
      }));
    }
  };

  // 个性化设置 - Logo
  const submitLogo = async () => {
    try {
      setLoadingInput((loadingInput) => ({ ...loadingInput, Logo: true }));
      await updateOption('Logo', inputs.Logo);
      showSuccess('Logo 已更新');
    } catch (error) {
      console.error('Logo 更新失败', error);
      showError('Logo 更新失败');
    } finally {
      setLoadingInput((loadingInput) => ({ ...loadingInput, Logo: false }));
    }
  };
  // 个性化设置 - 首页内容
  const submitOption = async (key) => {
    try {
      setLoadingInput((loadingInput) => ({
        ...loadingInput,
        HomePageContent: true,
      }));
      await updateOption(key, inputs[key]);
      showSuccess('首页内容已更新');
    } catch (error) {
      console.error('首页内容更新失败', error);
      showError('首页内容更新失败');
    } finally {
      setLoadingInput((loadingInput) => ({
        ...loadingInput,
        HomePageContent: false,
      }));
    }
  };
  // 个性化设置 - 文档地址
  const submitDocsLink = async () => {
    try {
      setLoadingInput((loadingInput) => ({
        ...loadingInput,
        [GENERAL_DOCS_LINK_KEY]: true,
      }));
      const saved = await updateOption(
        GENERAL_DOCS_LINK_KEY,
        inputs[GENERAL_DOCS_LINK_KEY],
      );
      if (!saved) return;

      statusDispatch({
        type: 'set',
        payload: {
          ...statusState.status,
          docs_link: inputs[GENERAL_DOCS_LINK_KEY],
        },
      });
      showSuccess(t('保存成功'));
    } catch (error) {
      console.error(t('文档地址更新失败'), error);
      showError(t('保存失败，请重试'));
    } finally {
      setLoadingInput((loadingInput) => ({
        ...loadingInput,
        [GENERAL_DOCS_LINK_KEY]: false,
      }));
    }
  };
  // 个性化设置 - 关于
  const submitAbout = async () => {
    try {
      setLoadingInput((loadingInput) => ({ ...loadingInput, About: true }));
      await updateOption('About', inputs.About);
      showSuccess('关于内容已更新');
    } catch (error) {
      console.error('关于内容更新失败', error);
      showError('关于内容更新失败');
    } finally {
      setLoadingInput((loadingInput) => ({ ...loadingInput, About: false }));
    }
  };
  // 个性化设置 - 页脚
  const submitFooter = async () => {
    try {
      setLoadingInput((loadingInput) => ({ ...loadingInput, Footer: true }));
      await updateOption('Footer', inputs.Footer);
      showSuccess('页脚内容已更新');
    } catch (error) {
      console.error('页脚内容更新失败', error);
      showError('页脚内容更新失败');
    } finally {
      setLoadingInput((loadingInput) => ({ ...loadingInput, Footer: false }));
    }
  };

  const checkUpdate = async () => {
    try {
      setLoadingInput((loadingInput) => ({
        ...loadingInput,
        CheckUpdate: true,
      }));
      const releaseResponse = await API.get('/api/status/latest-release');
      const { success, data, message } = releaseResponse.data;
      const release = data?.release;
      if (!success || !release?.tag_name) {
        showError(message || t('检查更新失败，请稍后再试'));
        return;
      }
      if (release.tag_name === statusState?.status?.version) {
        showSuccess(`${t('当前版本')}：${release.tag_name}`);
        return;
      }
      setUpdateData({
        tag_name: release.tag_name,
        content: marked.parse(release.body || ''),
        html_url: release.html_url || '',
        source: data.source || '',
        published_at: release.published_at || '',
      });
      setShowUpdateModal(true);
    } catch (error) {
      console.error('Failed to check for updates:', error);
      showError('检查更新失败，请稍后再试');
    } finally {
      setLoadingInput((loadingInput) => ({
        ...loadingInput,
        CheckUpdate: false,
      }));
    }
  };
  const startUpdate = async () => {
    try {
      setUpdateRunning(true);
      setUpdateMessage('正在下载、校验并备份当前版本…');
      await API.post('/api/status/update', { tag: updateData.tag_name });
      const timer = setInterval(async () => {
        const response = await API.get('/api/status/update');
        const state = response.data?.data;
        setUpdateMode(state?.mode || 'systemd');
        setUpdateLog(state?.log || '');
        setUpdatePhase(state?.running ? 'running' : state?.message === 'completed' ? 'completed' : 'failed');
        setUpdateMessage(state?.message || '升级处理中…');
        if (!state?.running) {
          clearInterval(timer);
          setUpdateRunning(false);
          if (state?.message === 'completed') showSuccess('升级完成，请刷新页面');
          else showError(`升级失败：${state?.log || state?.message || '未知错误'}`);
        }
      }, 2000);
    } catch (error) {
      setUpdateRunning(false);
      showError(error?.response?.data?.message || '升级启动失败');
    }
  };
  const modeLabel = { windows: 'Windows 本地程序', docker: 'Docker / Compose', systemd: 'Linux systemd' }[updateMode] || '自动识别';
  const updateSteps = ['检查运行环境', '下载升级包', '校验 SHA-256', '备份当前版本', '替换并重启服务', '健康检查'];
  const getOptions = async () => {
    const res = await API.get('/api/option/');
    const { success, message, data } = res.data;
    if (success) {
      let newInputs = {};
      data.forEach((item) => {
        if (item.key in inputs) {
          newInputs[item.key] = item.value;
        }
      });
      setInputs(newInputs);
      formAPISettingGeneral.current.setValues(newInputs);
      formAPIPersonalization.current.setValues(newInputs);
    } else {
      showError(message);
    }
  };

  useEffect(() => {
    getOptions();
  }, []);

  // Function to open GitHub release page
  const openRelease = () => {
    window.open(
      updateData.html_url ||
        `https://github.com/sucheng1101/new-api/releases/tag/${updateData.tag_name}`,
      '_blank',
    );
  };

  const getStartTimeString = () => {
    const timestamp = statusState?.status?.start_time;
    return statusState.status ? timestamp2string(timestamp) : '';
  };

  return (
    <Row>
      <Col
        span={24}
        style={{
          marginTop: '10px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}
      >
        {/* 版本信息 */}
        <Form>
          <Card>
            <Form.Section text={t('系统信息')}>
              <Row>
                <Col span={16}>
                  <Space>
                    <Text>
                      {t('当前版本')}：
                      {statusState?.status?.version || t('未知')}
                    </Text>
                    <Button
                      type='primary'
                      onClick={checkUpdate}
                      loading={loadingInput['CheckUpdate']}
                    >
                      {t('检查更新')}
                    </Button>
                  </Space>
                </Col>
              </Row>
              <Row>
                <Col span={16}>
                  <Text>
                    {t('启动时间')}：{getStartTimeString()}
                  </Text>
                </Col>
              </Row>
            </Form.Section>
          </Card>
        </Form>
        {/* 通用设置 */}
        <Form
          values={inputs}
          getFormApi={(formAPI) => (formAPISettingGeneral.current = formAPI)}
        >
          <Card>
            <Form.Section text={t('通用设置')}>
              <Form.TextArea
                label={t('公告')}
                placeholder={t(
                  '在此输入新的公告内容，支持 Markdown & HTML 代码',
                )}
                field={'Notice'}
                onChange={handleInputChange}
                style={{ fontFamily: 'JetBrains Mono, Consolas' }}
                autosize={{ minRows: 6, maxRows: 12 }}
              />
              <Button onClick={submitNotice} loading={loadingInput['Notice']}>
                {t('设置公告')}
              </Button>
              <Form.TextArea
                label={t('用户协议')}
                placeholder={t(
                  '在此输入用户协议内容，支持 Markdown & HTML 代码',
                )}
                field={LEGAL_USER_AGREEMENT_KEY}
                onChange={handleInputChange}
                style={{ fontFamily: 'JetBrains Mono, Consolas' }}
                autosize={{ minRows: 6, maxRows: 12 }}
                helpText={t(
                  '填写用户协议内容后，用户注册时将被要求勾选已阅读用户协议',
                )}
              />
              <Button
                onClick={submitUserAgreement}
                loading={loadingInput[LEGAL_USER_AGREEMENT_KEY]}
              >
                {t('设置用户协议')}
              </Button>
              <Form.TextArea
                label={t('隐私政策')}
                placeholder={t(
                  '在此输入隐私政策内容，支持 Markdown & HTML 代码',
                )}
                field={LEGAL_PRIVACY_POLICY_KEY}
                onChange={handleInputChange}
                style={{ fontFamily: 'JetBrains Mono, Consolas' }}
                autosize={{ minRows: 6, maxRows: 12 }}
                helpText={t(
                  '填写隐私政策内容后，用户注册时将被要求勾选已阅读隐私政策',
                )}
              />
              <Button
                onClick={submitPrivacyPolicy}
                loading={loadingInput[LEGAL_PRIVACY_POLICY_KEY]}
              >
                {t('设置隐私政策')}
              </Button>
            </Form.Section>
          </Card>
        </Form>
        {/* 个性化设置 */}
        <Form
          values={inputs}
          getFormApi={(formAPI) => (formAPIPersonalization.current = formAPI)}
        >
          <Card>
            <Form.Section text={t('个性化设置')}>
              <Form.Input
                label={t('系统名称')}
                placeholder={t('在此输入系统名称')}
                field={'SystemName'}
                onChange={handleInputChange}
              />
              <Button
                onClick={submitSystemName}
                loading={loadingInput['SystemName']}
              >
                {t('设置系统名称')}
              </Button>
              <Form.Input
                label={t('Logo 图片地址')}
                placeholder={t('在此输入 Logo 图片地址')}
                field={'Logo'}
                onChange={handleInputChange}
              />
              <Button onClick={submitLogo} loading={loadingInput['Logo']}>
                {t('设置 Logo')}
              </Button>
              <Form.TextArea
                label={t('首页内容')}
                placeholder={t(
                  '在此输入首页内容，支持 Markdown & HTML 代码，设置后首页的状态信息将不再显示。如果输入的是一个链接，则会使用该链接作为 iframe 的 src 属性，这允许你设置任意网页作为首页',
                )}
                field={'HomePageContent'}
                onChange={handleInputChange}
                style={{ fontFamily: 'JetBrains Mono, Consolas' }}
                autosize={{ minRows: 6, maxRows: 12 }}
              />
              <Button
                onClick={() => submitOption('HomePageContent')}
                loading={loadingInput['HomePageContent']}
              >
                {t('设置首页内容')}
              </Button>
              <Form.Input
                label={t('文档地址')}
                placeholder={t('例如 https://docs.newapi.pro')}
                field={GENERAL_DOCS_LINK_KEY}
                onChange={handleInputChange}
                showClear
              />
              <Button
                onClick={submitDocsLink}
                loading={loadingInput[GENERAL_DOCS_LINK_KEY]}
              >
                {t('保存')}
              </Button>
              <Form.TextArea
                label={t('关于')}
                placeholder={t(
                  '在此输入新的关于内容，支持 Markdown & HTML 代码。如果输入的是一个链接，则会使用该链接作为 iframe 的 src 属性，这允许你设置任意网页作为关于页面',
                )}
                field={'About'}
                onChange={handleInputChange}
                style={{ fontFamily: 'JetBrains Mono, Consolas' }}
                autosize={{ minRows: 6, maxRows: 12 }}
              />
              <Button onClick={submitAbout} loading={loadingInput['About']}>
                {t('设置关于')}
              </Button>
              {/*  */}
              <Banner
                fullMode={false}
                type='info'
                description={t(
                  '移除 One API 的版权标识必须首先获得授权，项目维护需要花费大量精力，如果本项目对你有意义，请主动支持本项目',
                )}
                closeIcon={null}
                style={{ marginTop: 15 }}
              />
              <Form.Input
                label={t('页脚')}
                placeholder={t(
                  '在此输入新的页脚，留空则使用默认页脚，支持 HTML 代码',
                )}
                field={'Footer'}
                onChange={handleInputChange}
              />
              <Button onClick={submitFooter} loading={loadingInput['Footer']}>
                {t('设置页脚')}
              </Button>
            </Form.Section>
          </Card>
        </Form>
      </Col>
      <Modal width={560}
        title={t('新版本') + '：' + updateData.tag_name}
        visible={showUpdateModal}
        onCancel={() => setShowUpdateModal(false)}
        footer={[
          <Button key='update' type='primary' theme='solid' loading={updateRunning} onClick={startUpdate}>
            {updateRunning ? updateMessage : '立即升级'}
          </Button>,
          <Button
            key='details'
            type='primary'
            onClick={() => {
              setShowUpdateModal(false);
              openRelease();
            }}
          >
            {t('详情')}
          </Button>,
        ]}
      >
        <Text>来源：{updateData.source || 'GitHub'}</Text>
        {updateData.published_at && <Text type='tertiary'>发布时间：{updateData.published_at}</Text>}
        <div style={{ padding: '12px 14px', marginBottom: 14, borderRadius: 10, background: 'linear-gradient(135deg,#f8fbff,#eef6ff)', border: '1px solid #dcecff' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#1d2939' }}>发现新的稳定版本</div>
          <div style={{ marginTop: 4, fontSize: 12, color: '#667085' }}>建议在业务低峰期升级，系统会自动备份并支持失败回滚。</div>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 18 }}>
          <div style={{ flex: 1, padding: 16, borderRadius: 12, background: '#f5f7fa' }}><Text type='tertiary'>当前版本</Text><div style={{ fontSize: 24, fontWeight: 700 }}>{statusState?.status?.version || 'v0.0.0'}</div></div>
          <div style={{ color: '#9ca3af', fontSize: 22 }}>→</div>
          <div style={{ flex: 1, padding: 16, borderRadius: 12, background: '#eef6ff' }}><Text type='tertiary'>最新版本</Text><div style={{ fontSize: 24, fontWeight: 700, color: '#1677ff' }}>{updateData.tag_name}</div></div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}><span style={{ padding: '4px 10px', borderRadius: 999, background: '#f0f5ff', color: '#1677ff' }}>{updateData.source || 'GitHub'}</span><span style={{ padding: '4px 10px', borderRadius: 999, background: '#f5f5f5' }}>{modeLabel}</span>{updateData.published_at && <span style={{ padding: '4px 10px', borderRadius: 999, background: '#f5f5f5' }}>{updateData.published_at}</span>}</div>
        <div style={{ maxHeight: 220, overflow: 'auto', padding: '4px 4px 4px 0' }} dangerouslySetInnerHTML={{ __html: updateData.content }} />
        {(updateRunning || updatePhase !== 'idle') && <div style={{ marginTop: 18, padding: 16, borderRadius: 12, background: '#fafafa' }}>
          <div style={{ fontWeight: 600, marginBottom: 12 }}>{updatePhase === 'completed' ? '升级完成' : updatePhase === 'failed' ? '升级失败，已尝试回滚' : updateMessage || '升级处理中'}</div>
          {updateSteps.map((label, index) => { const done = updatePhase === 'completed' || (updatePhase === 'running' && index < 3); const active = updatePhase === 'running' && index === 3; return <div key={label} style={{ display: 'flex', gap: 10, padding: '5px 0', color: done ? '#16a34a' : active ? '#1677ff' : '#9ca3af' }}><span>{done ? '✓' : active ? '●' : '○'}</span><span>{label}</span></div>; })}
          {updateLog && <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'auto', marginTop: 10, fontSize: 11 }}>{updateLog}</pre>}
        </div>}
        <Text type='tertiary'>升级会自动下载并校验制品，备份当前程序；启动失败时自动回滚。</Text>
      </Modal>
    </Row>
  );
};

export default OtherSetting;
