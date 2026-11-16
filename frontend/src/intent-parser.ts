/**
 * 出行场景自然语言意图理解与语义解析引擎 (Semantic Intent Parser)
 * 将用户的模糊口语（如“我饿了”、“想买杯咖啡提神”、“车快没电了”）
 * 映射为高德地图 LBS 周边搜索可识别的专业 POI 分类与检索关键词，并生成智能助理回复话术。
 */

export interface IntentResult {
  intent: string;
  categoryName: string;
  searchKeywords: string[];
  replyMessage: string;
  isFuzzyMatched: boolean;
}

interface IntentRule {
  intent: string;
  categoryName: string;
  patterns: RegExp[];
  searchKeywords: string[];
  replyTemplate: string;
}

const INTENT_RULES: IntentRule[] = [
  {
    intent: "dining",
    categoryName: "餐饮美食",
    patterns: [
      /饿/i,
      /吃/i,
      /想吃/i,
      /找.*?(吃的|餐馆|饭店|餐厅|饭)/i,
      /肚子(饿|咕咕|空)/i,
      /聚餐/i,
      /(午饭|晚饭|中饭|早餐|早点|夜宵|宵夜|快餐)/i,
      /(火锅|烧烤|大排档|肯德基|麦当劳|海鲜)/i,
    ],
    searchKeywords: ["美食", "特色餐厅", "快餐简餐"],
    replyTemplate: "🍽️ 理解到您现在感到饥饿想就餐，已为您匹配周边的热门餐厅与美食：",
  },
  {
    intent: "coffee_drink",
    categoryName: "咖啡茶饮与提神",
    patterns: [
      /(困|犯困|提神|好困|打瞌睡|想睡觉)/i,
      /(喝(点|水|东西|茶|奶茶|果汁))/i,
      /(买(咖啡|奶茶|饮料))/i,
      /(星巴克|瑞幸|喜茶|茶百道|奈雪)/i,
      /想喝/i,
      /口渴/i,
    ],
    searchKeywords: ["咖啡馆", "奶茶店", "饮品店"],
    replyTemplate: "☕ 检测到您想提神或喝点饮品，已为您检索附近的咖啡馆与茶饮店：",
  },
  {
    intent: "charging_station",
    categoryName: "新能源充电",
    patterns: [
      /(没电|快没电|电量(低|不足)|耗尽)/i,
      /(充(电|点电|满)|找充电|快充|超充|慢充|充电桩|充电站)/i,
      /(特斯拉充电|特来电|小鹏超充|蔚来充)/i,
    ],
    searchKeywords: ["充电站", "新能源充电桩", "特来电"],
    replyTemplate: "⚡ 检测到车辆电量告急/充电需求，已为您搜索附近的快充桩与充电站：",
  },
  {
    intent: "gas_station",
    categoryName: "加油服务",
    patterns: [
      /(没油|快没油|油箱(见底|空了)|加(点油|满油|油))/i,
      /(中石化|中石油|加油站|壳牌)/i,
    ],
    searchKeywords: ["加油站", "中国石化", "中国石油"],
    replyTemplate: "⛽ 检测到车辆燃油补充需求，已为您定位周边的加油站：",
  },
  {
    intent: "restroom",
    categoryName: "公共卫生间",
    patterns: [
      /(上厕所|洗手间|卫生间|公共厕所|内急|人有三急|小便|大便|解手)/i,
      /(找公厕|找洗手间)/i,
    ],
    searchKeywords: ["公共厕所", "公共卫生间", "洗手间"],
    replyTemplate: "🚻 检测到紧急生理需求，已为您搜寻距离最近的公共卫生间：",
  },
  {
    intent: "parking",
    categoryName: "停车场",
    patterns: [
      /(停(车|哪|在|一下)|找车位|没位了|泊车|停车场)/i,
      /(车位|地下车库)/i,
    ],
    searchKeywords: ["停车场", "地下车库", "停车位"],
    replyTemplate: "🅿️ 检测到您的停车需求，已为您查找附近的公共停车场与停车位：",
  },
  {
    intent: "car_repair",
    categoryName: "汽车维修与救援",
    patterns: [
      /(车坏了|故障|爆胎|扎钉|漏气|抛锚|不能动|冒烟)/i,
      /(修车|补胎|搭电|拖车|救援|途虎)/i,
    ],
    searchKeywords: ["汽车维修", "轮胎维修", "汽车救援"],
    replyTemplate: "🛠️ 检测到车辆应急与维修需求，已为您查找附近的汽车维修与补胎网点：",
  },
  {
    intent: "convenience_store",
    categoryName: "便利超市与补给",
    patterns: [
      /(买(水|瓶水|矿泉水|烟|包烟|零食|纸巾))/i,
      /(便利店|小超市|美宜佳|7-11|罗森|全家)/i,
    ],
    searchKeywords: ["便利店", "超市", "美宜佳"],
    replyTemplate: "🏪 检测到生活随行补给需求，已为您定位附近的连锁便利店与超市：",
  },
  {
    intent: "hotel",
    categoryName: "酒店住宿",
    patterns: [
      /(住(店|宿|一晚)|找(酒店|宾馆|旅馆)|休息(一晚|一下)|过夜|累了想睡觉)/i,
      /(如家|汉庭|全季|亚朵|希尔顿)/i,
    ],
    searchKeywords: ["酒店", "快捷宾馆", "商务酒店"],
    replyTemplate: "🏨 检测到住宿与休息需求，已为您筛选附近的优质酒店与客房：",
  },
  {
    intent: "pharmacy",
    categoryName: "药店诊所",
    patterns: [
      /(肚子痛|胃痛|头痛|发烧|感冒|咳嗽|中暑|受伤|创口贴)/i,
      /(买(点药|药)|大药房|药店|诊所|医院)/i,
    ],
    searchKeywords: ["药店", "大药房", "门诊"],
    replyTemplate: "💊 检测到身体不适或购药需求，已为您寻找附近的药房与便民诊所：",
  },
];

/**
 * 分析用户口语化自然语言输入，识别真实出行意图
 */
export function analyzeUserIntent(rawInput: string): IntentResult {
  const query = rawInput.trim();
  if (!query) {
    return {
      intent: "unknown",
      categoryName: "通用搜索",
      searchKeywords: [],
      replyMessage: "请输入您想前往的地点或具体需求。",
      isFuzzyMatched: false,
    };
  }

  // 匹配预设模糊语义规则
  for (const rule of INTENT_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(query)) {
        return {
          intent: rule.intent,
          categoryName: rule.categoryName,
          searchKeywords: rule.searchKeywords,
          replyMessage: rule.replyTemplate,
          isFuzzyMatched: true,
        };
      }
    }
  }

  // 若未命中模糊意图，则说明用户输入的是具体地名或专有名词（如“日月贝”、“珠海站”、“星巴克”）
  return {
    intent: "direct_keyword",
    categoryName: "精确地点",
    searchKeywords: [query],
    replyMessage: `📍 已为您在周边搜索关键词“${query}”：`,
    isFuzzyMatched: false,
  };
}
