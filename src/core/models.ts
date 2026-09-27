export type AlertLevel = '蓝色' | '黄色' | '橙色' | '红色';

export interface MoodTagMeta {
  tag: string;
  category: 'sunny' | 'cloudy' | 'rain' | 'storm' | 'snow' | 'fog';
  defaultPressure: number; // 960 - 1040 hPa
  defaultTemp: number;     // Celsius
  defaultHumidity: number; // 0 - 100%
  icon: string;
  windDesc: string;
  themeColor: string;
}

export interface MoodRecord {
  id: string;
  date: string; // YYYY-MM-DD
  tag: string;
  intensity: number; // 1 - 10
  note: string;
  pressureHpa: number; // 整数 hPa，钳制 960–1045（统一标度见 meteorology-scale.ts）
  temperatureC: number; // 整数 °C
  humidityPercent: number; // 整数 %，钳制 20–100
  windSpeedKmH: number; // 整数 km/h
  windDirectionDeg: number;
  windDirectionName: string;
}

export interface BarometricZone {
  code: string;
  name: string;
  psychologicalState: string;
  pressureRange: string; // 由 PRESSURE_THRESHOLDS 生成的展示文案，与分类判定同口径
  activeRatio: number; // 整数 %（0-100）；同一图表各气压带占比按最大余数法分配，合计恒为 100
  status: 'dominant' | 'active' | 'receding';
  description: string;
}

export interface MonsoonTrend {
  vectorName: string;
  originSource: string;
  frequencyDays: number;
  flowSpeed: string;
  windAngle: number;
  weatherImpact: string;
  upcomingForecast: string;
}

export interface ExtremeWeatherAlert {
  id: string;
  level: AlertLevel;
  type: string;
  title: string;
  issuedTime: string;
  triggerCause: string;
  defenseProtocol: string[]; // 防灾自愈指南
}

export interface SynopticChartData {
  chartId: string;
  generatedDate: string;
  currentRecord: MoodRecord;
  records: MoodRecord[];
  averagePressure: number; // 全周期算术平均，统一保留 1 位小数；阈值比较与展示均使用此值
  zones: BarometricZone[];
  monsoon: MonsoonTrend;
  alerts: ExtremeWeatherAlert[];
  pressureSystemType: '强烈冷涡旋' | '副热带高压晴空' | '锋面气旋多变' | '温带反气旋平稳' | '深槽低气压阴霾';
  metSummary: string;
}
