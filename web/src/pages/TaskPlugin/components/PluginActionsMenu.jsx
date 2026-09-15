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
import { Button, Dropdown } from '@douyinfe/semi-ui';
import { Eye, MoreHorizontal, Trash2, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { getPluginOwnership } from './pluginViewModel';

export default function PluginActionsMenu({
  record,
  onDetails,
  onUploadVersion,
  onDeleteVersion,
}) {
  const { t } = useTranslation();
  const ownership = getPluginOwnership(record);
  const isBundledPlugin = record?.source === 'factory';

  return (
    <Dropdown
      trigger='click'
      position='bottomRight'
      render={
        <Dropdown.Menu>
          <Dropdown.Item
            icon={<Eye size={15} />}
            onClick={() => onDetails?.(record)}
          >
            {t('详情')}
          </Dropdown.Item>
          <Dropdown.Item
            icon={<Upload size={15} />}
            onClick={() => onUploadVersion?.(record)}
          >
            {t('上传新版本')}
          </Dropdown.Item>
          <Dropdown.Divider />
          <Dropdown.Item
            type='danger'
            disabled={isBundledPlugin}
            icon={<Trash2 size={15} />}
            onClick={() => onDeleteVersion?.(record)}
          >
            {isBundledPlugin
              ? ownership === 'factory'
                ? t('删除当前版本（出厂插件不可删除）')
                : t('删除当前版本（预置插件不可删除）')
              : t('删除当前版本')}
          </Dropdown.Item>
        </Dropdown.Menu>
      }
    >
      <Button
        aria-label={t('更多操作')}
        icon={<MoreHorizontal size={18} />}
        size='small'
        theme='borderless'
        type='tertiary'
      />
    </Dropdown>
  );
}
