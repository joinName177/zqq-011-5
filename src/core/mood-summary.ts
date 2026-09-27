import type { MoodRecord, SynopticChartData } from './models';
import { AVG_INTENSITY_DECIMALS, roundTo } from './metrics';

export interface MoodSummary { count: number; averageIntensity: number; tags: string[]; dominant: string; }
export function summarizeMood(records: readonly MoodRecord[]): MoodSummary {
  const count = records.length;
  const averageIntensity = count
    ? roundTo(records.reduce((sum, record) => sum + record.intensity, 0) / count, AVG_INTENSITY_DECIMALS)
    : 0;
  const tags = [...new Set(records.map((record) => record.tag))];
  const dominant = tags.sort((a, b) => records.filter((record) => record.tag === b).length - records.filter((record) => record.tag === a).length)[0] ?? '暂无';
  return { count, averageIntensity, tags, dominant };
}
export function chartSummary(chart: SynopticChartData): string { return chart.currentRecord.tag + ' · ' + chart.zones.length + ' 个气压带'; }
