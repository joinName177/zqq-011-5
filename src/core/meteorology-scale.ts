import type { MoodRecord } from './models';

/**
 * 统一气象标度（Single Source of Truth）
 *
 * 精度与合成规则约定（domain 层契约，core / adapter / ui 必须共同遵守）：
 *  - 气压：单条记录为整数 hPa（钳制 960–1045）；跨周期平均气压保留 1 位小数，
 *    阈值比较与文案展示一律使用同一个已舍入值，禁止各自再舍入。
 *  - 温度：整数 °C；湿度：整数 %（钳制 20–100）；风速：整数 km/h。
 *  - 百分比：整数 %；同一图表内各气压带占比按最大余数法分配，合计恒为 100。
 */

export const PRESSURE_LIMITS = { min: 960, max: 1045 } as const;

/** 气压阈值（hPa）。比较统一走 isLowPressure / isHighPressure 等谓词，禁止散落魔数。 */
export const PRESSURE_THRESHOLDS = {
  RED_ALERT: 980, // 当前气压 < 980：红色暴雨预警
  STORM_TROUGH: 985, // 近 7 日任一记录 < 985：季风气旋判定
  COLD_VORTEX: 990, // 平均气压 < 990：强烈冷涡旋
  LOW: 995, // 气压 <= 995：副极地低气压带（低压）
  HIGH: 1020 // 气压 >= 1020：副热带高压带（高压）
} as const;

export const TEMPERATURE_THRESHOLDS = {
  COLD: 10, // <= 10 °C：寒冷（极地冷高压）
  HOT: 28 // >= 28 °C：偏热
} as const;

export const HUMIDITY_THRESHOLDS = {
  MIN: 20,
  MAX: 100,
  HUMID: 80 // > 80%：湿润
} as const;

/** 保留 1 位小数（平均值、强度的统一精度） */
export const roundTo1 = (value: number): number => Math.round(value * 10) / 10;

/** 取整（单条观测值的统一精度） */
export const roundTo0 = (value: number): number => Math.round(value);

export const clampPressure = (value: number): number =>
  Math.min(PRESSURE_LIMITS.max, Math.max(PRESSURE_LIMITS.min, roundTo0(value)));

export const clampHumidity = (value: number): number =>
  Math.min(HUMIDITY_THRESHOLDS.MAX, Math.max(HUMIDITY_THRESHOLDS.MIN, roundTo0(value)));

export const isLowPressure = (hpa: number): boolean => hpa <= PRESSURE_THRESHOLDS.LOW;
export const isHighPressure = (hpa: number): boolean => hpa >= PRESSURE_THRESHOLDS.HIGH;
export const isColdTemp = (celsius: number): boolean => celsius <= TEMPERATURE_THRESHOLDS.COLD;
export const isHotTemp = (celsius: number): boolean => celsius >= TEMPERATURE_THRESHOLDS.HOT;
export const isHumid = (percent: number): boolean => percent > HUMIDITY_THRESHOLDS.HUMID;

/** 气压展示格式：最多 1 位小数，整数不带尾巴（1008 → "1008"，995.4 → "995.4"） */
export const formatPressure = (hpa: number): string => roundTo1(hpa).toFixed(1).replace(/\.0$/, '');

/**
 * 最大余数法百分比分配：各部分合计恒为 100，
 * 保证分区文字百分比与进度条、整体总量口径一致。
 */
export function distributePercentages(counts: readonly number[]): number[] {
  const total = counts.reduce((sum, c) => sum + c, 0);
  if (total <= 0) return counts.map(() => 0);
  const exact = counts.map(c => (c / total) * 100);
  const result = exact.map(v => Math.floor(v));
  let remainder = 100 - result.reduce((sum, v) => sum + v, 0);
  const byFractionDesc = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const slot of byFractionDesc) {
    if (remainder <= 0) break;
    result[slot.i] += 1;
    remainder -= 1;
  }
  return result;
}

/**
 * 持久化/外部数据读入规整：把历史缓存中可能存在的非统一精度数值
 * 归一到当前标度，保证旧数据与新数据走同一套阈值比较与展示。
 */
export function normalizeRecordMetrics(record: MoodRecord): MoodRecord {
  return {
    ...record,
    pressureHpa: clampPressure(record.pressureHpa),
    temperatureC: roundTo0(record.temperatureC),
    humidityPercent: clampHumidity(record.humidityPercent),
    windSpeedKmH: roundTo0(record.windSpeedKmH)
  };
}
