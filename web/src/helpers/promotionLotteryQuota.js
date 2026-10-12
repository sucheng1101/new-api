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

const DEFAULT_QUOTA_PER_RMB = 500000;
const MAX_SAFE_QUOTA = Number.MAX_SAFE_INTEGER;

function toFiniteNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export const getPromotionLotteryQuotaPerUnit = () => {
  const raw = Number(localStorage.getItem('quota_per_unit'));
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_QUOTA_PER_RMB;
};

export const isValidQuota = (quota) => {
  const value = toFiniteNumber(quota);
  return (
    value !== null &&
    value >= 0 &&
    value <= MAX_SAFE_QUOTA &&
    Number.isSafeInteger(value)
  );
};

export const isValidRmbAmount = (amount) => {
  const value = toFiniteNumber(amount);
  if (value === null || value < 0) return false;
  return value <= MAX_SAFE_QUOTA / getPromotionLotteryQuotaPerUnit();
};

export const quotaToRmb = (quota) => {
  if (!isValidQuota(quota)) return null;
  const value = Number(quota);
  return value / getPromotionLotteryQuotaPerUnit();
};

export const rmbToQuota = (amount) => {
  if (!isValidRmbAmount(amount)) return null;
  const value = Number(amount);
  const quota = Math.round(value * getPromotionLotteryQuotaPerUnit());
  return isValidQuota(quota) ? quota : null;
};

export const getRmbFractionDigits = () => {
  const quotaPerUnit = getPromotionLotteryQuotaPerUnit();
  return Math.min(12, Math.max(2, Math.ceil(Math.log10(quotaPerUnit))));
};

export const formatRmb = (amount) => {
  const value = toFiniteNumber(amount);
  if (value === null || value < 0) return '￥--';
  return `￥${value.toFixed(getRmbFractionDigits())}`;
};
