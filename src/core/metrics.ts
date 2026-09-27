/**
 * 统一度量口径（single source of truth）
 *
 * 规则约定：
 * 1. 所有传感器数值（气压 hPa / 温度 °C / 湿度 %）先按本文件声明的精度舍入，
 *    再参与阈值比较与展示 —— 保证“看到的数”和“判定用的数”永远一致，
 *    不存在舍入边界一侧显示达标、另一侧却按未达标处理的情况。
 * 2. 所有阈值常量集中在此处，核心引擎与 UI 展示层必须引用同一份常量，
 *    图表文案、区间文案与判定规则均由这些常量合成。
 */

// ---- 统一精度（小数位数） ----
export const PRESSURE_DECIMALS = 0; // 气压：整数 hPa
export const TEMP_DECIMALS = 0;     // 温度：整数 °C
export const HUMIDITY_DECIMALS = 0; // 湿度：整数 %
export const RATIO_DECIMALS = 0;    // 频次占比：整数 %
export const AVG_INTENSITY_DECIMALS = 1; // 平均强度：1 位小数

// ---- 传感器量程（合成记录时的裁剪边界） ----
export const PRESSURE_MIN = 960;
export const PRESSURE_MAX = 1045;
export const HUMIDITY_MIN = 20;
export const HUMIDITY_MAX = 100;
export const INTENSITY_MIN = 1;
export const INTENSITY_MAX = 10;

// ---- 气压阈值阶梯（单位 hPa，按从低到高排列，禁止在别处另写魔法数字） ----
export const PRESSURE_RED_ALERT = 980;  // 当前气压 < 该值：红色预警
export const PRESSURE_STORM = 985;      // 近期观测 < 该值：记为强对流（季风气旋判定）
export const AVG_PRESSURE_LOW = 995;    // 平均气压 < 该值：冷涡 / 气旋
export const PRESSURE_LOW_BAND = 998;   // 气压 ≤ 该值：副极地低气压带
export const PRESSURE_HIGH_BAND = 1020; // 气压 ≥ 该值：高压带（副热带 / 极地）
export const AVG_PRESSURE_HIGH = 1020;  // 平均气压 ≥ 该值：副热带高压

// ---- 温度阈值 ----
export const TEMP_COLD_MAX = 10; // 气温 ≤ 该值：低温（极地冷高压 / 寒潮预警）

// ---- 湿度阈值 ----
export const HUMIDITY_HIGH = 80; // 湿度 ≥ 该值：高湿（湿润标签 / 橙色焦虑预警）

// ---- 强度阈值 ----
export const INTENSITY_HIGH = 7;   // 橙色焦虑预警
export const INTENSITY_SEVERE = 8; // 红色雷暴预警

// ---- 气压带主导判定 ----
export const ZONE_DOMINANT_RATIO = 0.35;
export const ZONE_POLAR_DOMINANT_RATIO = 0.2;

/**
 * 统一舍入：四舍五入到指定小数位，负数对称（half away from zero），
 * 避免 Math.round(-2.5) = -2 这类正负不对称行为。
 */
export function roundTo(value: number, decimals = 0): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return (Math.sign(value) * Math.round(Math.abs(value) * factor)) / factor;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// ---- 统一展示格式（图表、卡片、文案、预警触因全部走这里） ----
export function formatPressure(value: number): string {
  return `${roundTo(value, PRESSURE_DECIMALS)} hPa`;
}

export function formatTemperature(value: number): string {
  return `${roundTo(value, TEMP_DECIMALS)} °C`;
}

export function formatHumidity(value: number): string {
  return `${roundTo(value, HUMIDITY_DECIMALS)}%`;
}

export function formatRatio(value: number): string {
  return `${roundTo(value, RATIO_DECIMALS)}%`;
}

export type PressureBand = 'subTropical' | 'equatorial' | 'subPolar' | 'polarCold';

/**
 * 气压带分类：四条规则互斥且覆盖全部取值，温度空档归入副热带高压，
 * 与下方 PRESSURE_BAND_RANGES 文案一一对应。
 */
export function classifyPressureBand(pressureHpa: number, temperatureC: number): PressureBand {
  const p = roundTo(pressureHpa, PRESSURE_DECIMALS);
  const t = roundTo(temperatureC, TEMP_DECIMALS);
  if (p >= PRESSURE_HIGH_BAND && t <= TEMP_COLD_MAX) return 'polarCold';
  if (p >= PRESSURE_HIGH_BAND) return 'subTropical';
  if (p <= PRESSURE_LOW_BAND) return 'subPolar';
  return 'equatorial';
}

/** 气压带区间说明：直接由阈值常量合成，保证文案即规则。 */
export const PRESSURE_BAND_RANGES: Record<PressureBand, string> = {
  subTropical: `≥${PRESSURE_HIGH_BAND} hPa · 气温 >${TEMP_COLD_MAX}°C`,
  equatorial: `${PRESSURE_LOW_BAND + 1} ~ ${PRESSURE_HIGH_BAND - 1} hPa`,
  subPolar: `${PRESSURE_MIN} ~ ${PRESSURE_LOW_BAND} hPa`,
  polarCold: `≥${PRESSURE_HIGH_BAND} hPa · 气温 ≤${TEMP_COLD_MAX}°C`
};

/**
 * 将多个计数合成为总和恰好 100 的整数百分比（最大余数法），
 * 避免各区独立四舍五入后加总为 99% / 101%。
 */
export function allocateRatios(counts: readonly number[]): number[] {
  const total = counts.reduce((acc, c) => acc + c, 0);
  if (total === 0) return counts.map(() => 0);
  const exact = counts.map(c => (c / total) * 100);
  const floored = exact.map(v => Math.floor(v));
  let remainder = 100 - floored.reduce((acc, v) => acc + v, 0);
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v), count: counts[i] }))
    .sort((a, b) => b.frac - a.frac || b.count - a.count);
  for (let k = 0; k < remainder; k++) {
    floored[order[k % order.length].i] += 1;
  }
  return floored;
}
