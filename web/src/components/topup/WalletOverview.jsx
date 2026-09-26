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

import React from 'react';
import { Button, Typography } from '@douyinfe/semi-ui';
import { BarChart2, Receipt, TrendingUp } from 'lucide-react';

const { Text } = Typography;

const WalletOverview = ({ t, userState, renderQuota, onOpenHistory }) => {
  const user = userState?.user || {};
  const subBalances = [
    {
      key: 'cash',
      label: t('现金余额'),
      value: user.cash_quota || 0,
      note: t('按充值批次先进先出'),
    },
    {
      key: 'gift',
      label: t('赠送余额'),
      value: user.gift_quota || 0,
      note: t('优先消费'),
    },
    {
      key: 'promotion',
      label: t('推广余额'),
      value: user.aff_quota || 0,
      note: t('仅可转入赠送余额，不支持提现'),
    },
  ];

  return (
    <div
      className='wallet-overview'
      style={{
        '--wallet-cover-channel': '37 99 235',
        backgroundImage: `linear-gradient(0deg, rgba(var(--wallet-cover-channel) / 86%), rgba(var(--wallet-cover-channel) / 86%)), url('/cover-4.webp')`,
      }}
    >
      <div className='wallet-overview-head'>
        <Text strong style={{ color: 'white', fontSize: '16px' }}>
          {t('账户统计')}
        </Text>
        <Button
          size='small'
          theme='solid'
          icon={<Receipt size={14} />}
          onClick={onOpenHistory}
        >
          {t('账单')}
        </Button>
      </div>
      <div className='wallet-overview-body'>
        <div className='wallet-overview-main'>
          <div>
            <div className='wallet-overview-total'>
              {renderQuota(user.quota)}
            </div>
            <div className='wallet-overview-label'>{t('总可用余额')}</div>
          </div>
          <div className='wallet-overview-meta'>
            <div className='wallet-overview-meta-row'>
              <TrendingUp size={13} />
              <span>
                {t('历史消耗')} {renderQuota(user.used_quota)}
              </span>
            </div>
            <div className='wallet-overview-meta-row'>
              <BarChart2 size={13} />
              <span>
                {t('请求次数')} {user.request_count || 0}
              </span>
            </div>
          </div>
        </div>
        <div className='wallet-overview-divider' />
        <div className='wallet-overview-subs'>
          {subBalances.map((item) => (
            <div className='wallet-overview-sub' key={item.key}>
              <div className='wallet-overview-label'>{item.label}</div>
              <div className='wallet-overview-sub-value'>
                {renderQuota(item.value)}
              </div>
              <div className='wallet-overview-sub-note'>{item.note}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default WalletOverview;
