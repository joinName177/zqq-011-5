import { evaluateSynopticSystem, createRecordFromTag } from '../src/core/meteorology-engine';
import {
  roundTo, allocateRatios, classifyPressureBand, formatPressure,
  PRESSURE_LOW_BAND, PRESSURE_HIGH_BAND, PRESSURE_RED_ALERT, HUMIDITY_HIGH, TEMP_COLD_MAX
} from '../src/core/metrics';

let pass = 0, fail = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { pass++; } else { fail++; console.error('FAIL:', msg); }
}

// 1. 对称舍入（负数 .5 不再向 +∞ 偏）
assert(roundTo(-2.5, 0) === -3, 'roundTo(-2.5) should be -3, got ' + roundTo(-2.5, 0));
assert(roundTo(2.5, 0) === 3, 'roundTo(2.5) should be 3');
assert(roundTo(100.15, 1) === 100.2, 'roundTo decimals');

// 2. 百分比最大余数法合计恒为 100（含空集）
const ratios = allocateRatios([1, 1, 1]);
assert(ratios.reduce((a, b) => a + b, 0) === 100, 'ratios sum 100: ' + ratios.join(','));
const ratios2 = allocateRatios([3, 7]);
assert(ratios2.reduce((a, b) => a + b, 0) === 100, 'ratios2 sum 100: ' + ratios2.join(','));
assert(allocateRatios([0, 0, 0]).every(v => v === 0), 'empty ratios all zero');

// 3. 气压带分类：边界值归属与区间文案一致
assert(classifyPressureBand(998, 20) === 'subPolar', '998 <= low band');
assert(classifyPressureBand(999, 20) === 'equatorial', '999 equatorial');
assert(classifyPressureBand(1019, 20) === 'equatorial', '1019 equatorial');
assert(classifyPressureBand(1020, 20) === 'subTropical', '1020 warm -> subTropical');
assert(classifyPressureBand(1020, 10) === 'polarCold', '1020 cold <=10 -> polarCold');
assert(classifyPressureBand(1020, 11) === 'subTropical', '1020 temp 11 -> subTropical (no 11-15 gap)');

// 4. 边界压力值：四舍五入后比较 —— 979.6 显示 980 时不应触发 <980 的红警
function buildChart(pressures: number[], lastTag = '阴转多云', lastHumidity = 50, lastTemp = 20, lastIntensity = 5) {
  const records = pressures.map((p, i) => {
    const isLast = i === pressures.length - 1;
    const r = createRecordFromTag(isLast ? lastTag : '阴转多云', isLast ? lastIntensity : 5, '', `2026-09-${String(14 + i).padStart(2, '0')}`);
    r.pressureHpa = roundTo(p, 0);
    if (isLast) {
      r.humidityPercent = lastHumidity;
      r.temperatureC = lastTemp;
    }
    return r;
  });
  return evaluateSynopticSystem(records);
}

const boundaryChart = buildChart(Array(8).fill(1000).map((_, i) => i === 7 ? 979.6 : 1000));
assert(boundaryChart.currentRecord.pressureHpa === 980, '979.6 rounds to 980 for display');
assert(boundaryChart.alerts.every(a => a.level !== '红色'), '980 hPa must NOT trigger red (<980) — chart/text must agree');

const redChart = buildChart(Array(8).fill(1000).map((_, i) => i === 7 ? 979.4 : 1000));
assert(redChart.currentRecord.pressureHpa === 979, '979.4 rounds to 979');
assert(redChart.alerts.some(a => a.level === '红色'), '979 triggers red alert');
assert(redChart.alerts[0].triggerCause.includes(formatPressure(979)), 'red cause text uses formatted pressure');
assert(redChart.alerts[0].triggerCause.includes(`< ${PRESSURE_RED_ALERT}`), 'red cause text states threshold');

// 5. 橙色焦虑：文案“湿度高达”与判定阈值同源 —— 湿度边界精确为 80
const orangeChart = buildChart(Array(8).fill(1000).map((_, i) => i === 7 ? 1000 : 1000), '局部有焦虑', 79, 26, 7);
assert(orangeChart.alerts.every(a => a.level !== '橙色'), 'humidity 79 no orange (threshold >=80)');
const orangeChart2 = buildChart(Array(8).fill(1000), '局部有焦虑', 80, 26, 7);
assert(orangeChart2.alerts.some(a => a.level === '橙色'), 'humidity 80 triggers orange');
assert(orangeChart2.alerts[0].triggerCause.includes(`≥ ${HUMIDITY_HIGH}%`), 'orange cause states humidity threshold');

// 6. 寒潮黄警：标签 + 低温双条件，文案带阈值
const yellowChart = buildChart(Array(8).fill(1030), '寒潮大风', 30, TEMP_COLD_MAX, 5);
assert(yellowChart.alerts.some(a => a.level === '黄色'), `temp <= ${TEMP_COLD_MAX} triggers yellow`);
assert(yellowChart.alerts[0].triggerCause.includes(`≤ ${TEMP_COLD_MAX} °C`), 'yellow cause states temp threshold');

// 7. 系统分型与季风阈值同源，且必中其一；温带反气旋可达
const calmChart = buildChart(Array(10).fill(1010));
assert(calmChart.pressureSystemType === '温带反气旋平稳', '1010 avg -> temperate anticyclone, got ' + calmChart.pressureSystemType);
assert(calmChart.averagePressure === 1010, 'avg pressure 1010');
assert(calmChart.metSummary.includes(formatPressure(1010)), 'summary uses formatted avg');
assert(calmChart.metSummary.includes(`≥ ${PRESSURE_HIGH_BAND}`), 'summary states high threshold');

const lowChart = buildChart(Array(10).fill(994));
assert(lowChart.pressureSystemType === '强烈冷涡旋', '994 avg -> cold vortex');
const troughChart = buildChart(Array(10).fill(997));
assert(troughChart.pressureSystemType === '深槽低气压阴霾', '997 avg -> deep trough');
const highChart = buildChart(Array(10).fill(1020));
assert(highChart.pressureSystemType === '副热带高压晴空', '1020 avg -> subtropical high');

// 8. 平均气压在边界上：显示值即判定值（原始 994.5 → 每条记录显示 995 → 平均 995，不落 <995 冷涡）
const avgBoundary = buildChart(Array(10).fill(994.5));
assert(avgBoundary.currentRecord.pressureHpa === 995, 'raw 994.5 normalizes to displayed 995');
assert(avgBoundary.averagePressure === 995, 'avg of displayed values is 995');
assert(avgBoundary.pressureSystemType !== '强烈冷涡旋', 'displayed/averaged 995 must not be classified as <995 cold vortex');

// 9. 气压带占比合计 100 且区间文案来自阈值
assert(calmChart.zones.reduce((s, z) => s + z.activeRatio, 0) === 100, 'zone ratios sum 100');
assert(calmChart.zones.find(z => z.code === 'Z-SPL')!.pressureRange.includes(String(PRESSURE_LOW_BAND)), 'zone range derived from constant');

// 10. 空数据安全
const emptyChart = evaluateSynopticSystem([]);
assert(emptyChart.records.length === 1 && emptyChart.alerts.length === 0, 'empty data falls back safely');
assert(Number.isFinite(emptyChart.averagePressure), 'empty avg is finite');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
