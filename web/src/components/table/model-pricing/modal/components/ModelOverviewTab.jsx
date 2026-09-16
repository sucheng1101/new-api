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
import { Divider } from '@douyinfe/semi-ui';
import ModelBasicInfo from './ModelBasicInfo';
import ModelPricingTable from './ModelPricingTable';
import DynamicPricingBreakdown from './DynamicPricingBreakdown';
import TaskPricingBreakdown from './TaskPricingBreakdown';

const ModelOverviewTab = ({
  modelData,
  groupRatio,
  currency,
  siteDisplayType,
  tokenUnit,
  displayPrice,
  showRatio,
  usableGroup,
  autoGroups,
  vendorsMap,
  t,
}) => {
  const hasTaskPricing = Boolean(
    Object.keys(modelData?.billing_usage_schema ?? {}).length,
  );

  return (
    <div>
      <ModelBasicInfo modelData={modelData} vendorsMap={vendorsMap} t={t} />
      {modelData.billing_mode === 'tiered_expr' && modelData.billing_expr && (
        <>
          <Divider margin={16} />
          {hasTaskPricing ? (
            <TaskPricingBreakdown
              modelData={modelData}
              groupRatio={groupRatio}
              usableGroup={usableGroup}
              displayPrice={displayPrice}
              t={t}
            />
          ) : (
            <DynamicPricingBreakdown billingExpr={modelData.billing_expr} t={t} />
          )}
        </>
      )}
      {hasTaskPricing && !modelData.billing_expr && (
        <>
          <Divider margin={16} />
          <TaskPricingBreakdown
            modelData={modelData}
            groupRatio={groupRatio}
            usableGroup={usableGroup}
            displayPrice={displayPrice}
            t={t}
          />
        </>
      )}
      <Divider margin={16} />
      {!hasTaskPricing ? (
        <ModelPricingTable
          modelData={modelData}
          groupRatio={groupRatio}
          currency={currency}
          siteDisplayType={siteDisplayType}
          tokenUnit={tokenUnit}
          displayPrice={displayPrice}
          showRatio={showRatio}
          usableGroup={usableGroup}
          autoGroups={autoGroups}
          t={t}
        />
      ) : null}
    </div>
  );
};

export default ModelOverviewTab;
