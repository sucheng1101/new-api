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
import { Typography } from '@douyinfe/semi-ui';
import { Globe2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import DomainManagementPanel from '../../components/security/DomainManagementPanel';

export default function DomainManagement() {
  const { t } = useTranslation();

  return (
    <div className='mx-auto w-full max-w-[1500px] px-3 pb-8 sm:px-6'>
      <div className='mb-5 flex items-center gap-2'>
        <span className='flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-300'>
          <Globe2 size={17} />
        </span>
        <Typography.Title heading={3} style={{ margin: 0 }}>
          {t('域名管理')}
        </Typography.Title>
      </div>
      <DomainManagementPanel />
    </div>
  );
}
