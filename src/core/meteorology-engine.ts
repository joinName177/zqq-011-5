import {
  MoodRecord,
  MoodTagMeta,
  BarometricZone,
  MonsoonTrend,
  ExtremeWeatherAlert,
  SynopticChartData
} from './models';
import {
  AVG_INTENSITY_DECIMALS,
  AVG_PRESSURE_HIGH,
  AVG_PRESSURE_LOW,
  HUMIDITY_HIGH,
  HUMIDITY_MAX,
  HUMIDITY_MIN,
  INTENSITY_HIGH,
  INTENSITY_MAX,
  INTENSITY_MIN,
  INTENSITY_SEVERE,
  PRESSURE_BAND_RANGES,
  PRESSURE_HIGH_BAND,
  PRESSURE_LOW_BAND,
  PRESSURE_MAX,
  PRESSURE_MIN,
  PRESSURE_RED_ALERT,
  PRESSURE_STORM,
  TEMP_COLD_MAX,
  ZONE_DOMINANT_RATIO,
  ZONE_POLAR_DOMINANT_RATIO,
  allocateRatios,
  clamp,
  classifyPressureBand,
  formatHumidity,
  formatPressure,
  formatTemperature,
  roundTo
} from './metrics';

export const TAG_METAS: Record<string, MoodTagMeta> = {
  '晴空万里': {
    tag: '晴空万里',
    category: 'sunny',
    defaultPressure: 1024,
    defaultTemp: 24,
    defaultHumidity: 45,
    icon: '☀️',
    windDesc: '微风拂面 · 东南风 2级',
    themeColor: '#ffb703'
  },
  '微风煦暖': {
    tag: '微风煦暖',
    category: 'sunny',
    defaultPressure: 1018,
    defaultTemp: 22,
    defaultHumidity: 50,
    icon: '🌤️',
    windDesc: '和煦暖风 · 南风 3级',
    themeColor: '#fb8500'
  },
  '阴转多云': {
    tag: '阴转多云',
    category: 'cloudy',
    defaultPressure: 1008,
    defaultTemp: 18,
    defaultHumidity: 65,
    icon: '⛅',
    windDesc: '静风无定向 · 气压平缓',
    themeColor: '#8ecae6'
  },
  '低气压大雾': {
    tag: '低气压大雾',
    category: 'fog',
    defaultPressure: 998,
    defaultTemp: 14,
    defaultHumidity: 92,
    icon: '🌫️',
    windDesc: '无风凝滞 · 能见度不足',
    themeColor: '#6c757d'
  },
  '局部有焦虑': {
    tag: '局部有焦虑',
    category: 'cloudy',
    defaultPressure: 992,
    defaultTemp: 26,
    defaultHumidity: 78,
    icon: '🌦️',
    windDesc: '偏西阵风 5级 · 气旋对流',
    themeColor: '#588157'
  },
  '暖湿气流过境': {
    tag: '暖湿气流过境',
    category: 'rain',
    defaultPressure: 1002,
    defaultTemp: 25,
    defaultHumidity: 85,
    icon: '🌧️',
    windDesc: '西南湿润气流 4级',
    themeColor: '#219ebc'
  },
  '突发雷暴': {
    tag: '突发雷暴',
    category: 'storm',
    defaultPressure: 975,
    defaultTemp: 20,
    defaultHumidity: 95,
    icon: '⛈️',
    windDesc: '强烈飑线 · 偏北强风 8级',
    themeColor: '#7209b7'
  },
  '寒潮大风': {
    tag: '寒潮大风',
    category: 'snow',
    defaultPressure: 1032,
    defaultTemp: -2,
    defaultHumidity: 30,
    icon: '❄️',
    windDesc: '西伯利亚干冷风 7级',
    themeColor: '#023e8a'
  }
};

/** 将任意来源（旧持久化数据 / 示例序列）的记录规范化为统一精度与量程。 */
export function normalizeRecord(record: MoodRecord): MoodRecord {
  const intensity = clamp(roundTo(record.intensity, 0), INTENSITY_MIN, INTENSITY_MAX);
  return {
    ...record,
    intensity,
    pressureHpa: clamp(roundTo(record.pressureHpa, 0), PRESSURE_MIN, PRESSURE_MAX),
    temperatureC: roundTo(record.temperatureC, 0),
    humidityPercent: clamp(roundTo(record.humidityPercent, 0), HUMIDITY_MIN, HUMIDITY_MAX),
    windSpeedKmH: Math.max(0, roundTo(record.windSpeedKmH, 0))
  };
}

export function createRecordFromTag(tag: string, intensity: number, note: string, dateStr?: string): MoodRecord {
  const meta = TAG_METAS[tag] || TAG_METAS['阴转多云'];
  const intensityClamped = clamp(roundTo(intensity, 0), INTENSITY_MIN, INTENSITY_MAX);
  const pressureOffset = (5 - intensityClamped) * 3;
  const rawPressure = meta.defaultPressure + pressureOffset;
  const tempOffset = (intensityClamped - 5) * 1.2;

  const windDirections = ['东北', '东', '东南', '南', '西南', '西', '西北', '北'];
  const dirIdx = Math.abs((tag.charCodeAt(0) + intensityClamped) % 8);
  const windDirName = windDirections[dirIdx];
  const windDeg = dirIdx * 45;

  return normalizeRecord({
    id: `rec-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    date: dateStr || new Date().toISOString().split('T')[0],
    tag,
    intensity: intensityClamped,
    note: note.trim() || '平静观测记录',
    pressureHpa: rawPressure,
    temperatureC: meta.defaultTemp + tempOffset,
    humidityPercent: meta.defaultHumidity + (intensityClamped > 6 ? 10 : -5),
    windSpeedKmH: 5 + intensityClamped * 3.5,
    windDirectionDeg: windDeg,
    windDirectionName: windDirName
  });
}

export function evaluateSynopticSystem(records: MoodRecord[]): SynopticChartData {
  const sorted = [...records]
    .map(normalizeRecord)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  if (sorted.length === 0) {
    const fallback = createRecordFromTag('阴转多云', 5, '默认天气');
    sorted.push(fallback);
  }
  const currentRecord = sorted[sorted.length - 1];

  // 平均值必须从“已按统一精度舍入后的展示值”合成，再舍入一次；
  // 否则边界上会出现“每条记录显示 990、平均值却是 989”的图文矛盾。
  const avgPressure = roundTo(
    sorted.reduce((acc, r) => acc + r.pressureHpa, 0) / sorted.length,
    0
  );
  const avgWindSpeed = roundTo(
    sorted.reduce((acc, r) => acc + r.windSpeedKmH, 0) / sorted.length,
    0
  );

  // Barometric zones analysis（分类规则与区间文案同源，见 metrics.ts）
  const bandCounts = { subTropical: 0, equatorial: 0, subPolar: 0, polarCold: 0 };
  sorted.forEach(r => {
    bandCounts[classifyPressureBand(r.pressureHpa, r.temperatureC)]++;
  });

  const total = sorted.length;
  const bandOrder: Array<keyof typeof bandCounts> = ['subTropical', 'equatorial', 'subPolar', 'polarCold'];
  const ratios = allocateRatios(bandOrder.map(b => bandCounts[b]));
  const ratioOf = (b: keyof typeof bandCounts) => ratios[bandOrder.indexOf(b)];

  const zones: BarometricZone[] = [
    {
      code: 'Z-STH',
      name: '副热带高压带（心境晴朗稳定）',
      psychologicalState: '精力平稳、秩序感充足、心态从容明朗',
      pressureRange: PRESSURE_BAND_RANGES.subTropical,
      activeRatio: ratioOf('subTropical'),
      status: bandCounts.subTropical / total >= ZONE_DOMINANT_RATIO ? 'dominant' : 'active',
      description: '受反气旋沉降气流控制，天空云量稀少，注意力聚焦，内耗极低。'
    },
    {
      code: 'Z-EQU',
      name: '赤道低压槽（充沛对流与灵感）',
      psychologicalState: '情绪敏感、灵感涌动、轻微情绪躁动',
      pressureRange: PRESSURE_BAND_RANGES.equatorial,
      activeRatio: ratioOf('equatorial'),
      status: bandCounts.equatorial / total >= ZONE_DOMINANT_RATIO ? 'dominant' : 'active',
      description: '对流活动旺盛，情绪水汽充沛，容易产生即兴表达欲与探索热情。'
    },
    {
      code: 'Z-SPL',
      name: '副极地低气压带（低落潮湿阻滞）',
      psychologicalState: '情绪内耗、局部焦虑、精力低谷期',
      pressureRange: PRESSURE_BAND_RANGES.subPolar,
      activeRatio: ratioOf('subPolar'),
      status: bandCounts.subPolar / total >= ZONE_DOMINANT_RATIO ? 'dominant' : 'active',
      description: '暖冷气团交汇形成持久锋面雨带，情绪云层厚重，阳光穿透力减弱。'
    },
    {
      code: 'Z-POL',
      name: '极地冷高压区（情感冷却与封闭）',
      psychologicalState: '冷漠理性、拒绝社交、自我防御开启',
      pressureRange: PRESSURE_BAND_RANGES.polarCold,
      activeRatio: ratioOf('polarCold'),
      status: bandCounts.polarCold / total >= ZONE_POLAR_DOMINANT_RATIO ? 'dominant' : 'receding',
      description: '温度跌破防御线，地表热量迅速散失，表现为情绪冷淡与沉默。'
    }
  ];

  // Monsoon trend analysis（阈值全部引用统一常量；比较的是已舍入的展示值）
  const recentSlice = sorted.slice(-7);
  const hasStorm = recentSlice.some(r => r.pressureHpa < PRESSURE_STORM);

  let vectorName = '东亚温和偏南季风';
  let originSource = '来自生活日常与适度社交温和气团';
  let flowSpeed = `微风 ${avgWindSpeed} km/h`;
  let windAngle = 135;
  let weatherImpact = '气压平衡，情绪系统处于舒适自净区间';
  let upcomingForecast = '预计未来三天无明显冷空气入侵，维持多云转晴趋势。';

  if (avgPressure < AVG_PRESSURE_LOW || hasStorm) {
    vectorName = '西南热带气旋逆时针切变流';
    originSource = '来自多重待办任务与社交过载的深层热低压';
    flowSpeed = `疾风 ${Math.max(avgWindSpeed, 48)} km/h`;
    windAngle = 225;
    weatherImpact = '带来间歇性焦虑降水与情绪飑线，心理湿度高居不下';
    upcomingForecast = '警惕情绪二次对流反弹，建议尽早启动防灾避雨防御。';
  } else if (avgPressure >= AVG_PRESSURE_HIGH) {
    vectorName = '高压脊平直西风气流';
    originSource = '来自坚实生活秩序与专注工作带来的稳定反气旋';
    flowSpeed = `清风 ${Math.max(avgWindSpeed, 18)} km/h`;
    windAngle = 270;
    weatherImpact = '视界清晰无云，情绪能见度极高，适合规划长期战略';
    upcomingForecast = '高压系统稳定，气温宜人，建议保持当前生活节律。';
  }

  const monsoon: MonsoonTrend = {
    vectorName,
    originSource,
    frequencyDays: recentSlice.length,
    flowSpeed,
    windAngle,
    weatherImpact,
    upcomingForecast
  };

  // Alerts（所有数值经统一舍入后再比较；阈值与文案由常量合成）
  const alerts: ExtremeWeatherAlert[] = [];
  const lastRecord = currentRecord;

  if (lastRecord.pressureHpa < PRESSURE_RED_ALERT || (lastRecord.tag === '突发雷暴' && lastRecord.intensity >= INTENSITY_SEVERE)) {
    alerts.push({
      id: 'alert-red-storm',
      level: '红色',
      type: '情绪特大暴雨与雷电暴风预警',
      title: '红色暴雨预警 · 情绪超负荷对流',
      issuedTime: lastRecord.date,
      triggerCause: `中心气压降至 ${formatPressure(lastRecord.pressureHpa)}（红色阈值 < ${PRESSURE_RED_ALERT} hPa），阵风超速，局部心理降水量达特大暴雨级别。`,
      defenseProtocol: [
        '立即暂停所有高摩擦高风险的人际沟通与决策。',
        '退回物理安全区（卧室/安静角落），拉上窗帘切断过多声光刺激。',
        '进行5次深长腹式呼吸，允许眼泪或倾诉作为自然水汽释放。',
        '备用应急热饮（热牛奶或洋甘菊茶），等待气旋中心移出。'
      ]
    });
  } else if (
    lastRecord.tag === '局部有焦虑' &&
    lastRecord.intensity >= INTENSITY_HIGH &&
    lastRecord.humidityPercent >= HUMIDITY_HIGH
  ) {
    alerts.push({
      id: 'alert-orange-anxiety',
      level: '橙色',
      type: '干热高温与强对流焦虑预警',
      title: '橙色预警 · 局部焦虑气团盘旋',
      issuedTime: lastRecord.date,
      triggerCause: `心理湿度高达 ${formatHumidity(lastRecord.humidityPercent)}（橙色阈值 ≥ ${HUMIDITY_HIGH}%），强度 ${lastRecord.intensity} 级（≥ ${INTENSITY_HIGH} 级），内热积蓄，出现明显心率过载与思绪乱流。`,
      defenseProtocol: [
        '执行“注意力物理降温”：离开发生焦虑的工位，步行洗脸或冷水洗手。',
        '将脑中盘旋的所有待办事项写在纸上，关停后台大脑线程。',
        '禁止在当夜进行自我复盘或批判，推迟至明早高压回升后再议。'
      ]
    });
  } else if (lastRecord.tag === '寒潮大风' && lastRecord.temperatureC <= TEMP_COLD_MAX) {
    alerts.push({
      id: 'alert-yellow-cold',
      level: '黄色',
      type: '情感寒潮与社交冰封预警',
      title: '黄色预警 · 极地干冷冷锋压境',
      issuedTime: lastRecord.date,
      triggerCause: `气温剧烈骤降至 ${formatTemperature(lastRecord.temperatureC)}（黄色阈值 ≤ ${TEMP_COLD_MAX} °C），情绪能量趋近冰点，防御性坚冰形成。`,
      defenseProtocol: [
        '不必强迫自己热情回应外界信息，开启社交请假条/免打扰模式。',
        '通过热汤、暖水袋、厚毯子提供基础躯体热量。',
        '倾听白噪音或重温一部熟悉的童年治愈老电影。'
      ]
    });
  }

  // Determine system type（阈值与季风/预警口径一致；分型互斥且必中其一）
  let pressureSystemType: SynopticChartData['pressureSystemType'];
  if (avgPressure < AVG_PRESSURE_LOW) {
    pressureSystemType = '强烈冷涡旋';
  } else if (avgPressure >= AVG_PRESSURE_HIGH) {
    pressureSystemType = '副热带高压晴空';
  } else if (alerts.length > 0) {
    pressureSystemType = '锋面气旋多变';
  } else if (avgPressure <= PRESSURE_LOW_BAND) {
    pressureSystemType = '深槽低气压阴霾';
  } else {
    pressureSystemType = '温带反气旋平稳';
  }

  return {
    chartId: `SYN-${Date.now().toString(36).toUpperCase()}`,
    generatedDate: new Date().toLocaleDateString('zh-CN'),
    currentRecord,
    records: sorted,
    averagePressure: avgPressure,
    zones,
    monsoon,
    alerts,
    pressureSystemType,
    metSummary: `气象综观显示：当前心境领空受【${pressureSystemType}】统御。全周期平均气压 ${formatPressure(avgPressure)}（高压阈值 ≥ ${AVG_PRESSURE_HIGH} hPa、低压阈值 < ${AVG_PRESSURE_LOW} hPa），近期主要受【${monsoon.vectorName}】影响。${alerts.length > 0 ? `当前挂起 ${alerts.length} 个灾害性气象预警！` : '整层大气环流平稳，无破坏性对流。'}`
  };
}
