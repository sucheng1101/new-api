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

import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const SEGMENT_COLORS = [
  '#4f7cf7',
  '#22c55e',
  '#f59e0b',
  '#8b5cf6',
  '#06b6d4',
  '#ef4444',
  '#84cc16',
  '#ec4899',
  '#f97316',
  '#14b8a6',
  '#6366f1',
  '#a855f7',
];

const polar = (cx, cy, r, angleDeg) => {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
};

const sectorPath = (cx, cy, r, a0, a1) => {
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`;
};

const truncateName = (name, prizeType) => {
  const prefix = prizeType === 'quota' ? '' : '';
  const text = prefix + String(name || '');
  return text.length > 6 ? `${text.slice(0, 6)}…` : text;
};

/**
 * SVG 转盘：扇区数量跟随奖品列表，抽奖结果由 targetIndex 指定，
 * 指针（顶部）最终停在真实中奖扇区。
 */
export default function LotteryWheel({
  prizes = [],
  targetIndex = null,
  spinning = false,
  onSpinEnd,
  onCenterClick,
  disabled = false,
  spinDuration = 4200,
}) {
  const { t } = useTranslation();
  const [rotation, setRotation] = useState(0);
  const lastTargetRef = useRef(null);

  const count = Math.max(1, prizes.length);
  const segAngle = 360 / count;
  const R = 96;
  const CX = 110;
  const CY = 110;

  useEffect(() => {
    if (targetIndex == null || spinning === false) return;
    if (lastTargetRef.current === targetIndex) return;
    lastTargetRef.current = targetIndex;
    setRotation((prev) => {
      const segCenter = targetIndex * segAngle + segAngle / 2;
      // 指针在正上方（12 点方向），需要把中奖扇区中心转到顶部
      const target = 360 - segCenter;
      const current = ((prev % 360) + 360) % 360;
      const delta = (((target - current) % 360) + 360) % 360;
      return prev + 360 * 5 + delta;
    });
    const timer = setTimeout(() => {
      onSpinEnd && onSpinEnd();
    }, spinDuration + 150);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetIndex, spinning]);

  if (!prizes.length) {
    return <div className='lottery-wheel-empty'>{t('暂未配置抽奖奖品')}</div>;
  }

  return (
    <div className='lottery-wheel-wrap'>
      <div className='lottery-wheel-pointer' aria-hidden='true' />
      <svg
        className={`lottery-wheel-svg${spinning ? ' lottery-wheel-spinning' : ''}`}
        viewBox='0 0 220 220'
        style={{
          transform: `rotate(${rotation}deg)`,
          transition: spinning
            ? `transform ${spinDuration}ms cubic-bezier(0.16, 0.84, 0.24, 1)`
            : 'none',
        }}
        role='img'
        aria-label={t('抽奖转盘')}
      >
        {prizes.map((prize, index) => {
          const a0 = index * segAngle;
          const a1 = a0 + segAngle;
          const mid = a0 + segAngle / 2;
          const [lx, ly] = polar(CX, CY, R * 0.66, mid);
          const color = SEGMENT_COLORS[index % SEGMENT_COLORS.length];
          return (
            <g key={prize.id || index}>
              <path
                d={sectorPath(CX, CY, R, a0, a1)}
                fill={color}
                stroke='rgba(255,255,255,0.85)'
                strokeWidth='1.5'
              />
              <text
                x={lx}
                y={ly}
                fill='#fff'
                fontSize='11'
                fontWeight='700'
                textAnchor='middle'
                dominantBaseline='central'
                style={{ paintOrder: 'stroke', pointerEvents: 'none' }}
              >
                {truncateName(prize.name, prize.prize_type)}
              </text>
            </g>
          );
        })}
        {/* 中心圆钮 */}
        <circle
          cx={CX}
          cy={CY}
          r='30'
          fill='var(--semi-color-bg-0)'
          stroke='var(--semi-color-border)'
          strokeWidth='2'
          style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}
          onClick={disabled ? undefined : onCenterClick}
        />
        <text
          x={CX}
          y={CY - 4}
          fill='var(--semi-color-primary)'
          fontSize='15'
          fontWeight='800'
          textAnchor='middle'
          dominantBaseline='central'
          style={{ pointerEvents: 'none' }}
        >
          {t('抽奖')}
        </text>
        <text
          x={CX}
          y={CY + 12}
          fill='var(--semi-color-text-2)'
          fontSize='9'
          textAnchor='middle'
          dominantBaseline='central'
          style={{ pointerEvents: 'none' }}
        >
          GO!
        </text>
      </svg>
    </div>
  );
}
