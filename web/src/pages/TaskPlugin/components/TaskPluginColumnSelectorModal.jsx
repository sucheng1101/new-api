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
import { Button, Checkbox, Modal } from '@douyinfe/semi-ui';

export default function TaskPluginColumnSelectorModal({
  visible,
  columns,
  visibleColumns,
  onChange,
  onReset,
  onCancel,
  t,
}) {
  const selectableColumns = (columns ?? []).filter((column) => column.title);
  const allVisible = selectableColumns.every(
    (column) => visibleColumns?.[column.key],
  );
  const someVisible = selectableColumns.some(
    (column) => visibleColumns?.[column.key],
  );

  return (
    <Modal
      title={t('列设置')}
      visible={visible}
      onCancel={onCancel}
      footer={
        <div className='task-plugin-column-modal-footer'>
          <Button type='tertiary' onClick={onReset}>
            {t('重置')}
          </Button>
          <Button type='primary' onClick={onCancel}>
            {t('确定')}
          </Button>
        </div>
      }
    >
      <div className='task-plugin-column-modal-select-all'>
        <Checkbox
          checked={allVisible}
          indeterminate={someVisible && !allVisible}
          onChange={(event) => onChange('__all__', event.target.checked)}
        >
          {t('全选')}
        </Checkbox>
      </div>
      <div className='task-plugin-column-modal-grid'>
        {selectableColumns.map((column) => {
          const required = column.key === 'plugin' || column.key === 'actions';
          return (
            <Checkbox
              key={column.key}
              checked={Boolean(visibleColumns?.[column.key])}
              disabled={required}
              onChange={(event) => onChange(column.key, event.target.checked)}
            >
              {column.title}
            </Checkbox>
          );
        })}
      </div>
    </Modal>
  );
}
