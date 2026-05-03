import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execFileAsync = promisify(execFile);
const appRoot = path.resolve(__dirname, "..");
const projectRoot = path.resolve(appRoot, "..");
const baseRuntimeDir = process.env.A_SHARE_RUNTIME_DIR || appRoot;
const runtimeDir = process.env.A_SHARE_ACCOUNT_RUNTIME_DIR || baseRuntimeDir;
const dataDir =
  process.env.A_SHARE_DATA_DIR || (process.env.A_SHARE_ACCOUNT_RUNTIME_DIR ? path.join(runtimeDir, "data") : path.join(appRoot, "data"));
const generatorLockFile = path.join(dataDir, "generate.lock");
const marketNotesDir = process.env.MARKET_NOTES_DIR || path.join(projectRoot, "02-market-notes");
const reportDir = process.env.A_SHARE_ACCOUNT_ID
  ? path.join(marketNotesDir, "accounts", process.env.A_SHARE_ACCOUNT_ID, "daily-research")
  : path.join(marketNotesDir, "daily-research");
const configFile = path.join(runtimeDir, "trading-config.json");
const llmSecretConfigFile = path.join(runtimeDir, "llm-secrets.json");
const eventSearchCacheFile = path.join(dataDir, "event-search-cache.json");
const providerFundamentalsScript = path.join(__dirname, "provider-fundamentals.py");
const paperTradingEnabled = process.argv.includes("--paper-trade");

const today =
  process.argv.find((arg) => arg.startsWith("--date="))?.slice("--date=".length) ||
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

const fields = "f12,f14,f2,f3,f4,f6,f62,f297";
const stockGetFields = "f43,f44,f45,f46,f47,f48,f57,f58,f60,f116,f117,f161,f162,f169,f170";
const browserUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 Chrome Safari";
const indexes = [
  { name: "上证指数", secid: "1.000001" },
  { name: "深证成指", secid: "0.399001" },
  { name: "创业板指", secid: "0.399006" },
];

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function readGeneratorLock() {
  try {
    return JSON.parse(await fs.readFile(generatorLockFile, "utf8"));
  } catch {
    return {};
  }
}

function isProcessRunning(pid) {
  if (!pid || !Number.isFinite(Number(pid))) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

async function acquireGeneratorLock({ timeoutMs = 5 * 60 * 1000, staleMs = 10 * 60 * 1000 } = {}) {
  await fs.mkdir(dataDir, { recursive: true });
  const startedAt = Date.now();
  while (true) {
    try {
      const handle = await fs.open(generatorLockFile, "wx");
      await handle.writeFile(
        JSON.stringify({
          pid: process.pid,
          startedAt: new Date().toISOString(),
          command: process.argv.join(" "),
        }),
      );
      await handle.close();
      return async () => {
        await fs.rm(generatorLockFile, { force: true });
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const lock = await readGeneratorLock();
      if (lock.pid && !isProcessRunning(lock.pid)) {
        await fs.rm(generatorLockFile, { force: true });
        continue;
      }
      const stat = await fs.stat(generatorLockFile).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > staleMs) {
        await fs.rm(generatorLockFile, { force: true });
        continue;
      }
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error("已有投研生成任务正在运行，等待超时后放弃本轮生成。");
      }
      await sleep(1000);
    }
  }
}
const coreUniverse = [
  { code: "600938", name: "中国海油", boardName: "油气开采" },
  { code: "600150", name: "中国船舶", boardName: "航海装备" },
  { code: "002463", name: "沪电股份", boardName: "PCB/算力硬件" },
  { code: "603259", name: "药明康德", boardName: "医药/CRO" },
  { code: "601898", name: "中煤能源", boardName: "煤炭" },
  { code: "601088", name: "中国神华", boardName: "煤炭" },
  { code: "300308", name: "中际旭创", boardName: "CPO/光模块" },
  { code: "300502", name: "新易盛", boardName: "CPO/光模块" },
];

function parseWatchlistText(value) {
  const items = [];
  const lines = String(value || "")
    .replaceAll("；", ";")
    .split(/[\n;]+/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const tokens = line.split(/[,\s，、]+/).map((part) => part.trim()).filter(Boolean);
    const pureCodes = tokens
      .map((part) => part.match(/^(?:sh|sz)?(\d{6})$/i)?.[1])
      .filter(Boolean);
    if (pureCodes.length > 1 && pureCodes.length === tokens.length) {
      items.push(...pureCodes.map((code) => ({ code, name: "", boardName: "自选股池" })));
      continue;
    }

    const codeMatch = line.match(/(?:sh|sz)?(\d{6})/i);
    if (!codeMatch) continue;
    const code = codeMatch[1];
    const rest = line
      .replace(codeMatch[0], "")
      .replace(/^[\s,，|/-]+/, "")
      .trim();
    const parts = rest.split(/[,\t，|]+|\s{2,}|\s+/).map((part) => part.trim()).filter(Boolean);
    items.push({
      code,
      name: parts[0] || "",
      boardName: parts.slice(1).join("/") || "自选股池",
    });
  }

  return items;
}

function configuredUniverse(config) {
  const configured = parseWatchlistText([config.watchlistText, process.env.STOCK_LIST].filter(Boolean).join("\n"));
  const byCode = new Map(coreUniverse.map((item) => [item.code, { ...item, source: "内置观察池" }]));
  for (const item of configured) {
    byCode.set(item.code, {
      code: item.code,
      name: item.name || byCode.get(item.code)?.name || item.code,
      boardName: item.boardName || byCode.get(item.code)?.boardName || "自选股池",
      source: "自选股池",
    });
  }
  return [...byCode.values()].slice(0, 80);
}

const companyProfiles = {
  "600938": {
    business: "海上原油和天然气勘探、开发、生产和销售。",
    customers: "炼化企业、天然气下游用户、能源贸易和能源消费客户。",
    profitDrivers: ["国际油价", "油气产量", "桶油成本", "新油气田投产", "分红预期"],
    riskDrivers: ["油价下跌", "项目投产不及预期", "资本开支过高", "地缘政治", "安全环保事故"],
    researchStatus: "已建立基础研究卡",
  },
  "600150": {
    business: "造船、修船、海洋工程装备和船用机电设备。",
    customers: "航运公司、能源运输公司、海工企业、国内外船东和军民用船舶需求方。",
    profitDrivers: ["新船订单", "高端船型占比", "船价", "钢材成本", "交付效率"],
    riskDrivers: ["航运周期下行", "船价下降", "原材料上涨", "交付延期", "周期预期回落"],
    researchStatus: "已建立基础研究卡",
  },
  "002463": {
    business: "印制电路板 PCB，重点服务 AI服务器、高速网络设备、通信设备和汽车电子。",
    customers: "数据中心、通信设备、服务器、高速网络设备、汽车电子和工业控制客户。",
    profitDrivers: ["AI服务器需求", "高端PCB占比", "产能利用率", "产品结构升级", "毛利率"],
    riskDrivers: ["AI需求放缓", "价格竞争", "原材料上涨", "产能爬坡不顺", "客户砍单"],
    researchStatus: "已建立基础研究卡",
  },
  "603259": {
    business: "新药研发和生产外包服务，覆盖 CRO/CDMO/CRDMO 等环节。",
    customers: "全球制药公司、生物科技公司和创新药企业。",
    profitDrivers: ["药企研发投入", "在手订单", "高附加值项目", "产能利用率", "海外需求"],
    riskDrivers: ["海外监管", "地缘政治", "订单延期", "行业竞争", "研发预算收缩"],
    researchStatus: "已建立基础研究卡",
  },
  "601898": {
    business: "煤炭生产销售、煤化工、煤矿装备、电力和相关能源业务。",
    customers: "电厂、钢铁、水泥、化工等用煤企业，以及煤化工产业链客户。",
    profitDrivers: ["煤价", "自产煤销量", "采矿成本", "长协比例", "煤化工价格"],
    riskDrivers: ["煤价下跌", "需求走弱", "安全环保限制", "成本上升", "煤化工景气回落"],
    researchStatus: "已建立基础研究卡",
  },
  "601088": {
    business: "煤炭、电力、铁路、港口、航运和煤化工一体化能源业务。",
    customers: "电力、化工、冶金等能源用户，以及电力和运输服务客户。",
    profitDrivers: ["煤价", "自产煤产量", "一体化运输效率", "电力业务", "分红预期"],
    riskDrivers: ["煤价下跌", "政策限价", "需求回落", "安全生产", "资本开支变化"],
    researchStatus: "已建立基础研究卡",
  },
  "300308": {
    business: "高速光模块，用于数据中心、AI集群和通信网络的数据传输。",
    customers: "云厂商、AI数据中心、通信设备商和海外科技链客户。",
    profitDrivers: ["AI资本开支", "800G/1.6T出货", "大客户订单", "良率", "技术迭代"],
    riskDrivers: ["客户资本开支放缓", "价格竞争", "技术替代", "客户集中", "估值回落"],
    researchStatus: "已建立基础研究卡",
  },
  "300502": {
    business: "高速光模块和光器件，用于 AI集群、云数据中心、数据通信和5G网络。",
    customers: "云厂商、AI数据中心、通信设备商和海外客户。",
    profitDrivers: ["AI算力投资", "高速率产品放量", "境外订单", "毛利率", "交付能力"],
    riskDrivers: ["AI资本开支低于预期", "产品迭代风险", "汇率波动", "客户集中", "增速放缓"],
    researchStatus: "已建立基础研究卡",
  },
};

const defaultTradingConfig = {
  initialCash: 100000,
  maxPositions: 5,
  maxPositionPct: 0.2,
  buyScoreThreshold: 72,
  stopLossPct: -5,
  takeProfitPct: 10,
  adaptiveRisk: {
    enabled: true,
    minStopLossPct: -9,
    maxStopLossPct: -2.5,
    minTakeProfitPct: 4,
    maxTakeProfitPct: 18,
  },
  riskControls: {
    enabled: true,
    maxBoardExposurePct: 0.45,
    maxAccountDrawdownPct: 6,
    pauseAfterLossStreak: 3,
    chasePctLimit: 7.5,
    minAmount: 500000000,
    timeStopDays: 7,
    timeStopMinProfitPct: 1,
  },
  commissionRate: 0.0003,
  minCommission: 5,
  transferFeeRate: 0.00001,
  stampDutyRate: 0.0005,
  slippageRate: 0.0002,
  lotSize: 100,
  pollSeconds: 60,
  watchlistText: "",
  llm: {
    enabled: false,
    decisionMode: "score_veto",
    provider: "openai-responses",
    baseUrl: "https://api.openai.com/v1",
    model: "",
    maxCandidates: 6,
    scoreImpact: 12,
    minConfidence: 60,
    requireBuyApproval: true,
    temperature: 0.2,
    timeoutMs: 90000,
  },
  context: {
    enabled: true,
    includeNews: true,
    includeAnnouncements: true,
    includeF10: true,
    maxNews: 6,
    maxAnnouncements: 4,
    timeoutMs: 8000,
  },
  dataProviders: {
    enabled: true,
    useAkshare: true,
    useBaostock: true,
    useTushare: false,
    maxCandidates: 8,
    timeoutMs: 30000,
    pythonBin: "python3",
  },
  eventSearch: {
    enabled: false,
    useBocha: true,
    useTavily: false,
    useSerpApi: false,
    useAnspire: false,
    maxCandidates: 6,
    maxQueriesPerStock: 2,
    resultsPerQuery: 5,
    freshness: "oneWeek",
    timeoutMs: 12000,
    cacheHours: 6,
  },
};

async function readTradingConfig() {
  let stored = {};
  let secrets = {};
  try {
    stored = JSON.parse(await fs.readFile(configFile, "utf8"));
  } catch {}
  try {
    secrets = JSON.parse(await fs.readFile(llmSecretConfigFile, "utf8"));
  } catch {}
  return {
    ...defaultTradingConfig,
    ...stored,
    llm: { ...defaultTradingConfig.llm, ...(stored.llm || {}), apiKey: secrets?.llm?.apiKey || "" },
    adaptiveRisk: { ...defaultTradingConfig.adaptiveRisk, ...(stored.adaptiveRisk || {}) },
    riskControls: { ...defaultTradingConfig.riskControls, ...(stored.riskControls || {}) },
    context: { ...defaultTradingConfig.context, ...(stored.context || {}) },
    dataProviders: {
      ...defaultTradingConfig.dataProviders,
      ...(stored.dataProviders || {}),
      tushareToken: secrets?.dataProviders?.tushareToken || "",
    },
    eventSearch: {
      ...defaultTradingConfig.eventSearch,
      ...(stored.eventSearch || {}),
      bochaApiKey: secrets?.eventSearch?.bochaApiKey || "",
      tavilyApiKey: secrets?.eventSearch?.tavilyApiKey || "",
      serpApiKey: secrets?.eventSearch?.serpApiKey || "",
      anspireApiKey: secrets?.eventSearch?.anspireApiKey || "",
    },
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeLlmProvider(provider, baseUrl, model) {
  if (String(baseUrl || "").includes("api.z.ai") || /^glm-/i.test(String(model || ""))) return "z-ai-chat";
  return provider || defaultTradingConfig.llm.provider;
}

function normalizeLlmConfig(config) {
  const llm = { ...defaultTradingConfig.llm, ...(config.llm || {}) };
  const provider = normalizeLlmProvider(llm.provider, llm.baseUrl, llm.model);
  const providerDefaults = {
    "openai-chat": "https://api.openai.com/v1",
    "openai-responses": "https://api.openai.com/v1",
    "openai-compatible": "https://api.openai.com/v1",
    "z-ai-chat": "https://api.z.ai/api/coding/paas/v4",
    "anthropic-messages": "https://api.anthropic.com",
  };
  const providerBaseUrl =
    provider === "z-ai-chat"
      ? process.env.ZAI_BASE_URL
      : provider === "anthropic-messages"
        ? process.env.ANTHROPIC_BASE_URL
        : process.env.OPENAI_BASE_URL;
  const configuredBaseUrl = process.env.LLM_BASE_URL || providerBaseUrl || llm.baseUrl || "";
  const baseUrl =
    provider === "anthropic-messages" && configuredBaseUrl === defaultTradingConfig.llm.baseUrl
      ? providerDefaults[provider]
      : configuredBaseUrl || providerDefaults[provider] || "";
  const model = process.env.LLM_MODEL || llm.model || "";
  const apiKey =
    process.env.LLM_API_KEY ||
    (provider === "z-ai-chat" ? process.env.ZAI_API_KEY : "") ||
    (provider === "anthropic-messages" ? process.env.ANTHROPIC_API_KEY : "") ||
    process.env.OPENAI_API_KEY ||
    llm.apiKey ||
    process.env.ARK_API_KEY ||
    process.env.MOONSHOT_API_KEY ||
    process.env.ZHIPUAI_API_KEY ||
    "";
  return {
    enabled: Boolean(llm.enabled),
    decisionMode: ["advisory", "score", "score_veto"].includes(llm.decisionMode) ? llm.decisionMode : "score_veto",
    provider,
    baseUrl: String(baseUrl).replace(/\/+$/, ""),
    model: String(model).trim(),
    apiKey,
    apiKeyConfigured: Boolean(apiKey),
    maxCandidates: clamp(Math.round(Number(llm.maxCandidates || 6)), 1, 12),
    scoreImpact: clamp(Number(llm.scoreImpact || 12), 0, 20),
    minConfidence: clamp(Number(llm.minConfidence || 60), 0, 100),
    requireBuyApproval: Boolean(llm.requireBuyApproval),
    temperature: clamp(Number(llm.temperature ?? 0.2), 0, 1),
    timeoutMs: clamp(Math.round(Number(llm.timeoutMs || 90000)), 5000, 180000),
  };
}

function normalizeContextConfig(config) {
  const context = { ...defaultTradingConfig.context, ...(config.context || {}) };
  return {
    enabled: Boolean(context.enabled),
    includeNews: Boolean(context.includeNews),
    includeAnnouncements: Boolean(context.includeAnnouncements),
    includeF10: Boolean(context.includeF10),
    maxNews: clamp(Math.round(Number(context.maxNews || 6)), 0, 20),
    maxAnnouncements: clamp(Math.round(Number(context.maxAnnouncements || 4)), 0, 10),
    timeoutMs: clamp(Math.round(Number(context.timeoutMs || 8000)), 2000, 30000),
  };
}

function normalizeAdaptiveRiskConfig(config) {
  const risk = { ...defaultTradingConfig.adaptiveRisk, ...(config.adaptiveRisk || {}) };
  const stopA = clamp(Number(risk.minStopLossPct ?? -9), -30, -0.1);
  const stopB = clamp(Number(risk.maxStopLossPct ?? -2.5), -30, -0.1);
  const takeA = clamp(Number(risk.minTakeProfitPct ?? 4), 0.5, 100);
  const takeB = clamp(Number(risk.maxTakeProfitPct ?? 18), 0.5, 100);
  return {
    enabled: risk.enabled !== false,
    minStopLossPct: Math.min(stopA, stopB),
    maxStopLossPct: Math.max(stopA, stopB),
    minTakeProfitPct: Math.min(takeA, takeB),
    maxTakeProfitPct: Math.max(takeA, takeB),
  };
}

function normalizeRiskControlsConfig(config) {
  const input = { ...defaultTradingConfig.riskControls, ...(config.riskControls || {}) };
  return {
    enabled: input.enabled !== false,
    maxBoardExposurePct: clamp(Number(input.maxBoardExposurePct ?? 0.45), 0.1, 1),
    maxAccountDrawdownPct: clamp(Number(input.maxAccountDrawdownPct ?? 6), 1, 80),
    pauseAfterLossStreak: clamp(Math.round(Number(input.pauseAfterLossStreak ?? 3)), 1, 20),
    chasePctLimit: clamp(Number(input.chasePctLimit ?? 7.5), 1, 20),
    minAmount: Math.max(0, num(input.minAmount, 500000000)),
    timeStopDays: clamp(Math.round(Number(input.timeStopDays ?? 7)), 1, 60),
    timeStopMinProfitPct: clamp(Number(input.timeStopMinProfitPct ?? 1), -10, 20),
  };
}

function strategySnapshot(config) {
  const llm = normalizeLlmConfig(config);
  return {
    buyScoreThreshold: config.buyScoreThreshold,
    maxPositions: config.maxPositions,
    maxPositionPct: config.maxPositionPct,
    stopLossPct: config.stopLossPct,
    takeProfitPct: config.takeProfitPct,
    adaptiveRisk: normalizeAdaptiveRiskConfig(config),
    riskControls: normalizeRiskControlsConfig(config),
    llm: {
      enabled: llm.enabled,
      decisionMode: llm.decisionMode,
      provider: llm.provider,
      model: llm.model,
      requireBuyApproval: llm.requireBuyApproval,
      minConfidence: llm.minConfidence,
      scoreImpact: llm.scoreImpact,
    },
  };
}

function buildStrategyVersion(config) {
  const snapshot = strategySnapshot(config);
  const hash = crypto.createHash("sha256").update(JSON.stringify(snapshot)).digest("hex").slice(0, 10);
  return {
    id: `strategy-${hash}`,
    label: `策略 ${hash}`,
    generatedAt: new Date().toISOString(),
    snapshot,
  };
}

function normalizeDataProviderConfig(config) {
  const providers = { ...defaultTradingConfig.dataProviders, ...(config.dataProviders || {}) };
  const envTushareToken = process.env.TUSHARE_TOKEN || "";
  return {
    enabled: Boolean(providers.enabled),
    useAkshare: Boolean(providers.useAkshare),
    useBaostock: Boolean(providers.useBaostock),
    useTushare: Boolean(providers.useTushare),
    maxCandidates: clamp(Math.round(Number(providers.maxCandidates || 8)), 1, 20),
    timeoutMs: clamp(Math.round(Number(providers.timeoutMs || 30000)), 3000, 60000),
    pythonBin: String(process.env.PYTHON_BIN || providers.pythonBin || "python3").trim() || "python3",
    tushareToken: envTushareToken || providers.tushareToken || "",
    tushareTokenConfigured: Boolean(envTushareToken || providers.tushareToken),
    tushareTokenSource: envTushareToken ? "env" : providers.tushareToken ? "page" : "",
  };
}

function normalizeEventSearchConfig(config) {
  const search = { ...defaultTradingConfig.eventSearch, ...(config.eventSearch || {}) };
  const envKeys = {
    bocha: process.env.BOCHA_API_KEY || "",
    tavily: process.env.TAVILY_API_KEY || "",
    serpApi: process.env.SERPAPI_API_KEY || "",
    anspire: process.env.ANSPIRE_API_KEY || "",
  };
  const keys = {
    bocha: envKeys.bocha || search.bochaApiKey || "",
    tavily: envKeys.tavily || search.tavilyApiKey || "",
    serpApi: envKeys.serpApi || search.serpApiKey || "",
    anspire: envKeys.anspire || search.anspireApiKey || "",
  };
  return {
    enabled: Boolean(search.enabled),
    useBocha: Boolean(search.useBocha),
    useTavily: Boolean(search.useTavily),
    useSerpApi: Boolean(search.useSerpApi),
    useAnspire: Boolean(search.useAnspire),
    maxCandidates: clamp(Math.round(Number(search.maxCandidates || 6)), 1, 12),
    maxQueriesPerStock: clamp(Math.round(Number(search.maxQueriesPerStock || 2)), 1, 4),
    resultsPerQuery: clamp(Math.round(Number(search.resultsPerQuery || 5)), 1, 10),
    freshness: ["oneDay", "oneWeek", "oneMonth", "oneYear", "noLimit"].includes(search.freshness)
      ? search.freshness
      : "oneWeek",
    timeoutMs: clamp(Math.round(Number(search.timeoutMs || 12000)), 3000, 30000),
    cacheHours: clamp(Number(search.cacheHours ?? 6), 0, 72),
    keys,
    keySources: {
      bocha: envKeys.bocha ? "env" : search.bochaApiKey ? "page" : "",
      tavily: envKeys.tavily ? "env" : search.tavilyApiKey ? "page" : "",
      serpApi: envKeys.serpApi ? "env" : search.serpApiKey ? "page" : "",
      anspire: envKeys.anspire ? "env" : search.anspireApiKey ? "page" : "",
    },
  };
}

async function fetchJson(url, { timeoutMs = 10000, referer = "https://quote.eastmoney.com/" } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": browserUserAgent,
          Referer: referer,
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!text.trim()) throw new Error("empty response");
      return JSON.parse(text);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 350 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  try {
    const text = await curlText(url, { referer });
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Fetch failed after retries: ${url}`, { cause: error || lastError });
  }
}

async function fetchText(url, encoding = "utf-8", { timeoutMs = 10000, referer = "https://finance.sina.com.cn/" } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": browserUserAgent,
          Referer: referer,
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = await res.arrayBuffer();
      const text = new TextDecoder(encoding).decode(buffer);
      if (!text.trim()) throw new Error("empty response");
      return text;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 350 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  try {
    return await curlText(url, { encoding, referer });
  } catch (error) {
    throw new Error(`Fetch failed after retries: ${url}`, { cause: error || lastError });
  }
}

async function curlText(url, { encoding = "utf-8", referer = "" } = {}) {
  const args = [
    "-L",
    "--compressed",
    "--connect-timeout",
    "8",
    "--max-time",
    "20",
    "-sS",
    "-H",
    `User-Agent: ${browserUserAgent}`,
  ];
  if (referer) args.push("-H", `Referer: ${referer}`);
  args.push(url);
  const { stdout } = await execFileAsync("curl", args, {
    encoding: "buffer",
    maxBuffer: 10 * 1024 * 1024,
  });
  const text = new TextDecoder(encoding).decode(stdout);
  if (!text.trim()) throw new Error("empty response");
  return text;
}

async function fetchJsonQuick(url, { method = "GET", headers = {}, body = null, timeoutMs = 8000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      signal: controller.signal,
      headers: {
        "User-Agent": browserUserAgent,
        ...headers,
      },
      body,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (!text.trim()) throw new Error("empty response");
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

async function getQuotes(secids) {
  const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=${secids}&fields=${fields}`;
  try {
    const json = await fetchJson(url);
    return json?.data?.diff || [];
  } catch (error) {
    const ids = String(secids).split(",").filter(Boolean);
    const sinaRows = await getSinaQuotes(ids).catch(() => []);
    if (sinaRows.length) return sinaRows;
    const rows = await Promise.all(
      ids.map((secid) => getFallbackQuote(secid).catch(() => null))
    );
    const validRows = rows.filter(Boolean);
    if (validRows.length) return validRows;
    throw error;
  }
}

async function getSinaQuotes(secids) {
  const symbols = secids.map(sinaSymbolFromSecid).filter(Boolean);
  if (!symbols.length) return [];
  const text = await fetchText(`https://hq.sinajs.cn/list=${symbols.join(",")}`, "gbk");
  return [...text.matchAll(/var hq_str_([a-z]{2}\d+)="([^"]*)";/g)]
    .map((match) => {
      const symbol = match[1];
      const parts = match[2].split(",");
      const prevClose = num(parts[2]);
      const price = num(parts[3]);
      if (!parts[0] || !price) return null;
      return {
        f12: symbol.slice(2),
        f14: cleanText(parts[0], 40),
        f2: price,
        f3: prevClose ? ((price - prevClose) / prevClose) * 100 : 0,
        f4: prevClose ? price - prevClose : 0,
        f6: num(parts[9]),
        f62: null,
        f297: Number(String(parts[30] || "").replaceAll("-", "")) || null,
      };
    })
    .filter(Boolean);
}

function sinaSymbolFromSecid(secid) {
  const [market, code] = String(secid).split(".");
  if (!code) return "";
  return `${market === "1" ? "sh" : "sz"}${code}`;
}

async function getFallbackQuote(secid) {
  if (/^(1\.000|0\.399)/.test(secid)) {
    return getKlineQuote(secid);
  }
  return getStockQuote(secid).catch(() => getKlineQuote(secid));
}

async function getStockQuote(secid) {
  const url = `https://push2.eastmoney.com/api/qt/stock/get?fltt=2&secid=${secid}&fields=${stockGetFields}`;
  const json = await fetchJson(url);
  const row = json?.data;
  if (!row) return null;
  return {
    f12: row.f57,
    f14: row.f58,
    f2: num(row.f43),
    f3: num(row.f170),
    f4: num(row.f169),
    f6: num(row.f48),
    f62: null,
    f297: null,
  };
}

async function getKlineQuote(secid) {
  const url =
    `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}` +
    `&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61` +
    `&klt=101&fqt=0&beg=${recentCompactDate(45)}&end=20500101`;
  const json = await fetchJson(url);
  const lines = json?.data?.klines || [];
  const latest = String(lines[lines.length - 1] || "");
  if (!latest) return null;
  const [date, , close, , , , amount, , pct, change] = latest.split(",");
  return {
    f12: json.data.code,
    f14: json.data.name,
    f2: num(close),
    f3: num(pct),
    f4: num(change),
    f6: num(amount),
    f62: null,
    f297: Number(String(date).replaceAll("-", "")) || null,
  };
}

function recentCompactDate(daysBack) {
  const date = new Date(`${today}T00:00:00+08:00`);
  date.setDate(date.getDate() - daysBack);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

async function getEastmoneyBoards(order = 1, size = 30) {
  const url = `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=${size}&po=${order}&np=1&fltt=2&invt=2&fid=f3&fs=m:90+t:2&fields=${fields}`;
  const json = await fetchJson(url);
  const rows = json?.data?.diff || [];
  return dedupeBoards(rows)
    .filter((row) => Number.isFinite(Number(row.f3)))
    .sort((a, b) => (order === 1 ? Number(b.f3) - Number(a.f3) : Number(a.f3) - Number(b.f3)))
    .map((row) => ({ ...row, provider: "东方财富行业板块" }));
}

async function getSinaIndustryBoards(order = 1, size = 30) {
  const text = await fetchText("http://vip.stock.finance.sina.com.cn/q/view/newSinaHy.php", "gbk");
  const match = text.match(/\{.*\}/s);
  if (!match) throw new Error("Sina industry payload not found");
  const payload = JSON.parse(match[0]);
  const rows = Object.values(payload)
    .map((line) => {
      const parts = String(line).split(",");
      const leaderRaw = parts[8] || "";
      return {
        f12: `sina:${parts[0]}`,
        f14: parts[1],
        f2: num(parts[3]),
        f3: num(parts[5]),
        f4: num(parts[4]),
        f6: num(parts[7]),
        f62: null,
        provider: "新浪财经行业板块",
        leader: {
          code: leaderRaw.replace(/^(sh|sz)/, ""),
          marketCode: leaderRaw,
          name: parts[12],
          pct: num(parts[9]),
          price: num(parts[10]),
          change: num(parts[11]),
        },
      };
    })
    .filter((row) => row.f14 && Number.isFinite(row.f3));

  return dedupeBoards(rows)
    .sort((a, b) => (order === 1 ? Number(b.f3) - Number(a.f3) : Number(a.f3) - Number(b.f3)))
    .slice(0, size);
}

async function getBoards(order = 1, size = 30, warnings = []) {
  try {
    return await getEastmoneyBoards(order, size);
  } catch (eastmoneyError) {
    try {
      return await getSinaIndustryBoards(order, size);
    } catch (sinaError) {
      pushUniqueWarning(
        warnings,
        `真实行业板块数据源失败：东方财富 ${cleanText(eastmoneyError.message, 120)}；新浪 ${cleanText(sinaError.message, 120)}`,
      );
      throw sinaError;
    }
  }
}

async function getBoardStocks(boardCode, size = 12) {
  if (String(boardCode).startsWith("sina:")) {
    return [];
  }
  const url = `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=${size}&po=1&np=1&fltt=2&invt=2&fid=f3&fs=b:${boardCode}&fields=${fields}`;
  const json = await fetchJson(url);
  return json?.data?.diff || [];
}

function f10Code(code) {
  return `${String(code).startsWith("6") ? "SH" : "SZ"}${code}`;
}

async function getCompanySurvey(code) {
  const url = `https://emweb.securities.eastmoney.com/PC_HSF10/CompanySurvey/PageAjax?code=${f10Code(code)}`;
  const json = await fetchJson(url);
  const base = json?.jbzl?.[0] || null;
  if (!base) return null;
  return {
    industry: base.EM2016 || base.INDUSTRYCSRC1 || "",
    profile: base.ORG_PROFILE || "",
    businessScope: base.BUSINESS_SCOPE || "",
    website: base.ORG_WEB || "",
    employeeCount: base.EMP_NUM || null,
    source: "东方财富F10公司概况",
  };
}

async function getEastmoneyFinanceNews(size, timeoutMs) {
  const url = `https://np-listapi.eastmoney.com/comm/web/getNewsByColumns?client=web&biz=web_news_col&column=350&pageSize=${size}&page=1&req_trace=${Date.now()}`;
  const json = await fetchJsonQuick(url, { timeoutMs });
  return (json?.data?.list || []).map((item) => ({
    title: cleanText(item.title, 120),
    summary: cleanText(item.summary, 180),
    media: item.mediaName || "东方财富",
    time: item.showTime || "",
    url: item.uniqueUrl || item.url || "",
    source: "东方财富财经新闻",
  }));
}

async function getEastmoneyAnnouncements(code, size, timeoutMs) {
  const url = `https://np-anotice-stock.eastmoney.com/api/security/ann?sr=-1&page_size=${size}&page_index=1&ann_type=A&client_source=web&stock_list=${code}&f_node=0&s_node=0`;
  const json = await fetchJsonQuick(url, { timeoutMs });
  const rows = json?.data?.list || json?.data || [];
  return rows.map((item) => ({
    title: cleanText(item.title || item.NOTICE_TITLE || item.announcementTitle, 140),
    type: item.columns?.[0]?.column_name || item.ann_type || item.category || "公告",
    time: item.notice_date || item.eiTime || item.announcementTime || "",
    url: item.art_code
      ? `https://data.eastmoney.com/notices/detail/${code}/${item.art_code}.html`
      : item.url || "",
    source: "东方财富公告",
  }));
}

async function getCninfoAnnouncements(code, size, timeoutMs) {
  const body = new URLSearchParams({
    pageNum: "1",
    pageSize: String(size),
    column: String(code).startsWith("6") ? "sse" : "szse",
    tabName: "fulltext",
    plate: "",
    stock: code,
    searchkey: "",
    secid: "",
    category: "",
    trade: "",
    seDate: "",
    sortName: "",
    sortType: "",
    isHLtitle: "true",
  });
  const json = await fetchJsonQuick("https://www.cninfo.com.cn/new/hisAnnouncement/query", {
    method: "POST",
    timeoutMs,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: "https://www.cninfo.com.cn/new/commonUrl/pageOfSearch?url=disclosure/list/search",
    },
    body,
  });
  return (json?.announcements || []).map((item) => ({
    title: cleanText(item.announcementTitle, 140),
    type: item.categoryName || "公告",
    time: item.announcementTime ? new Date(item.announcementTime).toISOString().slice(0, 10) : "",
    url: item.adjunctUrl ? `https://static.cninfo.com.cn/${item.adjunctUrl}` : "",
    source: "巨潮资讯公告",
  }));
}

async function getCompanyAnnouncements(code, size, timeoutMs) {
  const sources = [
    () => getEastmoneyAnnouncements(code, size, timeoutMs),
    () => getCninfoAnnouncements(code, size, timeoutMs),
  ];
  for (const source of sources) {
    try {
      const rows = await source();
      if (rows.length) return rows.slice(0, size);
    } catch {
      // Try the next real announcement source.
    }
  }
  return [];
}

function eventFreshnessDays(freshness) {
  return {
    oneDay: 1,
    oneWeek: 7,
    oneMonth: 30,
    oneYear: 365,
    noLimit: 0,
  }[freshness] ?? 7;
}

function eventDateRange(freshness) {
  const days = eventFreshnessDays(freshness);
  if (!days) return {};
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  const toIso = (date) => date.toISOString().slice(0, 10);
  return {
    startDate: toIso(start),
    endDate: toIso(end),
    fromTime: `${toIso(start)} 00:00:00`,
    toTime: `${toIso(end)} 23:59:59`,
  };
}

function buildEventSearchQueries(item, maxQueries) {
  const queries = [
    `${item.name} ${item.code} 重大事项 股价 A股`,
    `${item.name} ${item.boardName || ""} 新闻 业绩 公告 舆情`,
    `${item.name} 利好 利空 风险 订单 中标 减持`,
    `${item.name} 机构 调研 投资者互动`,
  ];
  return [...new Set(queries.map((query) => query.replace(/\s+/g, " ").trim()).filter(Boolean))].slice(0, maxQueries);
}

function normalizeEventResult({ provider, query, title, summary, url, source, time, score }) {
  const cleanTitle = cleanText(title, 140);
  if (!cleanTitle) return null;
  return {
    provider,
    query,
    title: cleanTitle,
    summary: cleanText(summary, 240),
    url: cleanText(url, 300),
    source: cleanText(source || provider, 60),
    time: cleanText(time, 40),
    score: Number.isFinite(Number(score)) ? Number(score) : null,
  };
}

function dedupeEventResults(rows, limit = 12) {
  const seen = new Set();
  const result = [];
  for (const row of rows) {
    if (!row) continue;
    const key = row.url || `${row.provider}:${row.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(row);
    if (result.length >= limit) break;
  }
  return result;
}

function classifyEventSentiment(text) {
  const value = String(text || "");
  const positiveWords = ["中标", "订单", "签约", "增持", "回购", "重组", "并购", "涨价", "突破", "创新高", "业绩增长", "预增", "扭亏", "获批", "投产", "扩产", "政策支持", "利好"];
  const negativeWords = ["减持", "立案", "处罚", "问询", "监管", "亏损", "预亏", "下滑", "暴跌", "诉讼", "违约", "退市", "风险警示", "债务", "停产", "利空"];
  const hotWords = ["涨停", "异动", "热点", "主力", "资金", "龙虎榜", "机构调研", "高开", "大涨", "爆发", "活跃"];
  const positive = positiveWords.filter((word) => value.includes(word));
  const negative = negativeWords.filter((word) => value.includes(word));
  const hot = hotWords.filter((word) => value.includes(word));
  const sentiment = negative.length > positive.length ? "negative" : positive.length > negative.length ? "positive" : "neutral";
  return { sentiment, positive, negative, hot };
}

function buildEventHeat(rows) {
  const signals = rows.map((row) => classifyEventSentiment(`${row.title} ${row.summary}`));
  const positive = signals.reduce((sum, item) => sum + item.positive.length, 0);
  const negative = signals.reduce((sum, item) => sum + item.negative.length, 0);
  const hot = signals.reduce((sum, item) => sum + item.hot.length, 0);
  const score = clamp(Math.round(rows.length * 8 + hot * 8 + positive * 6 - negative * 8), 0, 100);
  const tone = negative >= positive + 2 ? "risk" : score >= 65 ? "hot" : score >= 35 ? "warm" : "quiet";
  const label = tone === "risk" ? "风险事件偏多" : tone === "hot" ? "舆情热度较高" : tone === "warm" ? "有事件关注" : "事件较少";
  return {
    label,
    tone,
    score,
    resultCount: rows.length,
    positive,
    negative,
    hot,
    summary: `${label}：检索到${rows.length}条结果，热词${hot}个，正向${positive}个，风险${negative}个。`,
  };
}

async function readEventSearchCache() {
  try {
    const cache = JSON.parse(await fs.readFile(eventSearchCacheFile, "utf8"));
    return { entries: cache.entries || {} };
  } catch {
    return { entries: {} };
  }
}

async function writeEventSearchCache(cache) {
  const entries = Object.fromEntries(
    Object.entries(cache.entries || {})
      .filter(([, value]) => value?.fetchedAt)
      .slice(-500),
  );
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(eventSearchCacheFile, `${JSON.stringify({ entries }, null, 2)}\n`, "utf8");
}

function eventCacheKey(provider, query, searchConfig) {
  return `${provider}:${searchConfig.freshness}:${searchConfig.resultsPerQuery}:${query}`;
}

function getCachedEventResults(cache, key, cacheHours) {
  if (!cacheHours) return null;
  const entry = cache.entries?.[key];
  if (!entry?.fetchedAt || !Array.isArray(entry.results)) return null;
  const ageMs = Date.now() - Date.parse(entry.fetchedAt);
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > cacheHours * 60 * 60 * 1000) return null;
  return entry.results;
}

async function searchBocha(query, searchConfig) {
  const json = await fetchJsonQuick("https://api.bochaai.com/v1/web-search", {
    method: "POST",
    timeoutMs: searchConfig.timeoutMs,
    headers: {
      Authorization: `Bearer ${searchConfig.keys.bocha}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      freshness: searchConfig.freshness,
      summary: true,
      count: searchConfig.resultsPerQuery,
    }),
  });
  return (json?.webPages?.value || []).map((item) =>
    normalizeEventResult({
      provider: "Bocha",
      query,
      title: item.name,
      summary: item.summary || item.snippet,
      url: item.url,
      source: item.siteName,
      time: item.datePublished,
      score: item.score,
    }),
  );
}

async function searchTavily(query, searchConfig) {
  const days = eventFreshnessDays(searchConfig.freshness) || 30;
  const json = await fetchJsonQuick("https://api.tavily.com/search", {
    method: "POST",
    timeoutMs: searchConfig.timeoutMs,
    headers: {
      Authorization: `Bearer ${searchConfig.keys.tavily}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      topic: "news",
      search_depth: "basic",
      max_results: searchConfig.resultsPerQuery,
      days,
      include_answer: false,
      include_raw_content: false,
    }),
  });
  return (json?.results || []).map((item) =>
    normalizeEventResult({
      provider: "Tavily",
      query,
      title: item.title,
      summary: item.content,
      url: item.url,
      source: "Tavily",
      time: item.published_date || item.date,
      score: item.score,
    }),
  );
}

function flattenSerpApiNews(rows) {
  const result = [];
  for (const row of rows || []) {
    if (Array.isArray(row.stories)) {
      result.push(...row.stories);
    } else {
      result.push(row);
    }
  }
  return result;
}

async function searchSerpApi(query, searchConfig) {
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google_news");
  url.searchParams.set("q", query);
  url.searchParams.set("hl", "zh-CN");
  url.searchParams.set("gl", "CN");
  url.searchParams.set("api_key", searchConfig.keys.serpApi);
  const json = await fetchJsonQuick(url.toString(), { timeoutMs: searchConfig.timeoutMs });
  return flattenSerpApiNews(json?.news_results)
    .slice(0, searchConfig.resultsPerQuery)
    .map((item) =>
      normalizeEventResult({
        provider: "SerpAPI",
        query,
        title: item.title,
        summary: item.snippet || item.summary,
        url: item.link,
        source: item.source?.name || item.source,
        time: item.iso_date || item.date,
        score: item.position ? 1 / Number(item.position) : null,
      }),
    );
}

async function searchAnspire(query, searchConfig) {
  const range = eventDateRange(searchConfig.freshness);
  const url = new URL("https://plugin.anspire.cn/api/ntsearch/search");
  url.searchParams.set("query", query.slice(0, 64));
  url.searchParams.set("top_k", String(searchConfig.resultsPerQuery));
  url.searchParams.set("search_type", "web");
  if (range.fromTime) url.searchParams.set("FromTime", range.fromTime);
  if (range.toTime) url.searchParams.set("ToTime", range.toTime);
  const json = await fetchJsonQuick(url.toString(), {
    timeoutMs: searchConfig.timeoutMs,
    headers: {
      Authorization: `Bearer ${searchConfig.keys.anspire}`,
      "Content-Type": "application/json",
    },
  });
  return (json?.results || []).map((item) =>
    normalizeEventResult({
      provider: "Anspire",
      query,
      title: item.title,
      summary: item.content,
      url: item.url,
      source: "Anspire",
      time: item.date,
      score: item.score,
    }),
  );
}

function eventSearchProviders(searchConfig) {
  return [
    { id: "bocha", label: "Bocha", enabled: searchConfig.useBocha, key: searchConfig.keys.bocha, run: searchBocha },
    { id: "tavily", label: "Tavily", enabled: searchConfig.useTavily, key: searchConfig.keys.tavily, run: searchTavily },
    { id: "serpApi", label: "SerpAPI", enabled: searchConfig.useSerpApi, key: searchConfig.keys.serpApi, run: searchSerpApi },
    { id: "anspire", label: "Anspire", enabled: searchConfig.useAnspire, key: searchConfig.keys.anspire, run: searchAnspire },
  ];
}

async function buildEventSearchContexts(config, candidates) {
  const searchConfig = normalizeEventSearchConfig(config);
  const providers = Object.fromEntries(
    eventSearchProviders(searchConfig).map((provider) => [
      provider.id,
      {
        enabled: provider.enabled,
        configured: Boolean(provider.key),
        available: false,
        status: provider.enabled ? (provider.key ? "pending" : "missing_key") : "disabled",
      },
    ]),
  );
  const base = {
    enabled: searchConfig.enabled,
    status: searchConfig.enabled ? "pending" : "disabled",
    fetchedAt: null,
    providers,
    resultCount: 0,
    queryCount: 0,
    cachedCount: 0,
  };
  if (!searchConfig.enabled) return { status: base, byCode: new Map() };

  const activeProviders = eventSearchProviders(searchConfig).filter((provider) => provider.enabled && provider.key);
  if (!activeProviders.length) {
    return { status: { ...base, status: "not_configured", summary: "事件搜索已开启，但没有配置任何搜索 API Key。" }, byCode: new Map() };
  }

  const cache = await readEventSearchCache();
  let cacheChanged = false;
  const byCode = new Map();
  let queryCount = 0;
  let cachedCount = 0;

  for (const item of candidates.slice(0, searchConfig.maxCandidates)) {
    const queries = buildEventSearchQueries(item, searchConfig.maxQueriesPerStock);
    const rows = [];
    const itemWarnings = [];
    for (const query of queries) {
      for (const provider of activeProviders) {
        const key = eventCacheKey(provider.id, query, searchConfig);
        const cached = getCachedEventResults(cache, key, searchConfig.cacheHours);
        if (cached) {
          cachedCount += 1;
          rows.push(...cached);
          providers[provider.id].available = true;
          providers[provider.id].status = "ok_cached";
          continue;
        }
        queryCount += 1;
        try {
          const providerRows = (await provider.run(query, searchConfig)).filter(Boolean);
          providers[provider.id].available = true;
          providers[provider.id].status = "ok";
          rows.push(...providerRows);
          if (searchConfig.cacheHours > 0) {
            cache.entries[key] = { fetchedAt: new Date().toISOString(), results: providerRows };
            cacheChanged = true;
          }
        } catch (error) {
          providers[provider.id].status = cleanText(error.message, 160);
          itemWarnings.push(`${provider.label}搜索失败：${cleanText(error.message, 80)}`);
        }
      }
    }
    const results = dedupeEventResults(rows, searchConfig.resultsPerQuery * searchConfig.maxQueriesPerStock * activeProviders.length);
    byCode.set(item.code, {
      results,
      heat: buildEventHeat(results),
      queries,
      warnings: itemWarnings,
    });
  }

  if (cacheChanged) await writeEventSearchCache(cache);
  const resultCount = [...byCode.values()].reduce((sum, item) => sum + item.results.length, 0);
  const anyAvailable = Object.values(providers).some((provider) => provider.available);
  return {
    status: {
      ...base,
      status: anyAvailable ? "ok" : "error",
      fetchedAt: new Date().toISOString(),
      resultCount,
      queryCount,
      cachedCount,
      providers,
    },
    byCode,
  };
}

function getSinaLeaderStock(board) {
  if (!board?.leader?.code || !board?.leader?.name) return null;
  return {
    f12: board.leader.code,
    f14: board.leader.name,
    f2: board.leader.price,
    f3: board.leader.pct,
    f4: board.leader.change,
    f6: null,
    f62: null,
    source: "新浪行业领涨股",
    amountKnown: false,
  };
}

function dedupeBoards(rows) {
  const seen = new Set();
  const result = [];
  for (const row of rows) {
    const name = String(row.f14 || "");
    const normalized = name.replace(/[ⅠⅡⅢIV]+$/g, "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(row);
  }
  return result;
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function hasNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function signed(value, digits = 2) {
  const n = num(value);
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}`;
}

function compactDate(dateText) {
  return Number(String(dateText).replaceAll("-", ""));
}

function money(value) {
  if (!hasNumber(value)) return "无数据";
  const n = num(value);
  if (Math.abs(n) >= 1e8) return `${(n / 1e8).toFixed(2)}亿`;
  if (Math.abs(n) >= 1e4) return `${(n / 1e4).toFixed(2)}万`;
  return `${n.toFixed(0)}`;
}

function scoreBoard(row) {
  const pct = num(row.f3);
  const amount = Math.max(num(row.f6), 1);
  const main = num(row.f62);
  return Math.round(
    Math.max(0, pct * 12) +
      Math.min(25, Math.log10(amount / 1e8 + 1) * 10) +
      Math.max(-10, Math.min(18, main / 1e8)),
  );
}

function scoreStock(stock, board, learningBias, config = defaultTradingConfig) {
  const pct = num(stock.f3);
  const amount = num(stock.f6);
  const main = num(stock.f62);
  const amountKnown = hasNumber(stock.f6) && amount > 0;
  const mainKnown = hasNumber(stock.f62);
  const riskTags = [];
  let riskPenalty = 0;

  if (String(stock.f14).includes("ST")) {
    riskTags.push("ST/风险警示");
    riskPenalty += 100;
  }
  if (pct >= 9.5) {
    riskTags.push("接近涨停，追高风险");
    riskPenalty += 12;
  }
  if (pct <= -4) {
    riskTags.push("当日明显走弱");
    riskPenalty += 8;
  }
  if (!amountKnown) {
    riskTags.push("个股成交额源未返回");
  } else if (amount < 1e8) {
    riskTags.push("成交额偏低");
    riskPenalty += 6;
  }

  const raw =
    scoreBoard(board) * 0.45 +
    pct * 5 +
    (amountKnown ? Math.min(18, Math.log10(amount / 1e8 + 1) * 8) : 8) +
    (mainKnown ? Math.max(-12, Math.min(16, main / 1e8)) : 0) +
    learningBias -
    riskPenalty;
  const score = Math.max(0, Math.min(100, Math.round(raw)));

  let action = "观察";
  let actionCode = "WATCH";
  if (riskPenalty >= 100) {
    action = "剔除";
    actionCode = "AVOID";
  } else if (score >= config.buyScoreThreshold && pct > 0.8 && pct < 8.5 && main > 0) {
    action = "模拟买入";
    actionCode = "PAPER_BUY";
  } else if (score >= 58) {
    action = "重点观察";
    actionCode = "FOCUS";
  }

  return {
    code: stock.f12,
    name: stock.f14,
    price: num(stock.f2),
    pct,
    change: num(stock.f4),
    amount: amountKnown ? amount : null,
    mainNet: mainKnown ? main : null,
    boardCode: board.f12,
    boardName: board.f14,
    source: stock.source || board.provider || "行情接口",
    score,
    action,
    actionCode,
    riskTags,
    reason: explainStock(stock, board, score, action),
  };
}

function boardForUniverseStock(stockConfig, hotBoards) {
  const direct = hotBoards.find((board) => stockConfig.boardName.includes(board.name) || board.name.includes(stockConfig.boardName));
  const keywordGroups = [
    ["煤", ["煤", "动力煤", "煤炭"]],
    ["油气", ["油气", "炼油", "燃气"]],
    ["航海", ["船", "航海", "海工"]],
    ["PCB", ["PCB", "电子元件", "印制电路"]],
    ["CPO", ["CPO", "光模块", "光通信", "通信设备"]],
    ["医药", ["医药", "CRO", "创新药"]],
  ];
  const group = keywordGroups.find(([key]) => stockConfig.boardName.includes(key));
  const matched = group
    ? hotBoards.find((board) => group[1].some((keyword) => board.name.includes(keyword)))
    : null;
  const board = direct || matched;
  return board
    ? {
        f12: board.code,
        f14: board.name,
        f3: board.pct,
        f6: board.amount,
        f62: board.mainNet,
        provider: board.source,
      }
    : {
        f12: "CORE",
        f14: stockConfig.boardName,
        f3: 0,
        f6: 0,
        f62: 0,
      };
}

function explainStock(stock, board, score, action) {
  const parts = [
    `${board.f14}板块涨幅${signed(board.f3)}%`,
    `个股涨幅${signed(stock.f3)}%`,
    `成交额${money(stock.f6)}`,
  ];
  if (hasNumber(stock.f62) && num(stock.f62) > 0) parts.push(`主力净流入${money(stock.f62)}`);
  if (hasNumber(stock.f62) && num(stock.f62) < 0) parts.push(`主力净流出${money(Math.abs(stock.f62))}`);
  if (stock.source) parts.push(`来源${stock.source}`);
  return `${action}：评分${score}，${parts.join("，")}。`;
}

function extractJsonObject(text) {
  const cleaned = String(text || "")
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("LLM response is not JSON");
  }
}

function normalizeVerdict(value) {
  const text = String(value || "").trim().toUpperCase();
  if (["BUY", "HOLD", "AVOID"].includes(text)) return text;
  if (["买入", "看多", "积极"].includes(text)) return "BUY";
  if (["回避", "规避", "卖出", "谨慎"].includes(text)) return "AVOID";
  return "HOLD";
}

function cleanLlmText(value, max = 120) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function compactLlmTexts(items, limit, mapper) {
  return (items || []).slice(0, limit).map(mapper).filter(Boolean);
}

function explainLlmError(error, llm) {
  const message = error?.message || String(error || "未知错误");
  const aborted = error?.name === "AbortError" || /aborted|abort/i.test(message);
  if (aborted) {
    return `请求超时（${Math.round((llm.timeoutMs || 0) / 1000)}秒未返回）。可能是模型接口响应慢、候选股上下文太长，或网络到模型服务商不稳定`;
  }
  return message;
}

async function callOpenAICompatibleLlm(llm, messages) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), llm.timeoutMs);
  const body = {
    model: llm.model,
    temperature: llm.temperature,
    max_tokens: llm.provider === "z-ai-chat" ? 1600 : 2048,
    stream: false,
    messages,
  };
  if (llm.provider === "z-ai-chat") {
    body.thinking = { type: "disabled" };
  }
  try {
    const res = await fetch(`${llm.baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${llm.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`LLM HTTP ${res.status}${body ? `: ${cleanLlmText(body, 120)}` : ""}`);
    }
    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content || "";
    if (!content.trim()) throw new Error("LLM returned empty content");
    return extractJsonObject(content);
  } finally {
    clearTimeout(timer);
  }
}

function messagesToText(messages) {
  return messages.map((message) => `${message.role.toUpperCase()}:\n${message.content}`).join("\n\n");
}

async function callOpenAIResponsesLlm(llm, messages) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), llm.timeoutMs);
  try {
    const res = await fetch(`${llm.baseUrl}/responses`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${llm.apiKey}`,
      },
      body: JSON.stringify({
        model: llm.model,
        temperature: llm.temperature,
        input: messages.map((message) => ({
          role: message.role === "assistant" ? "assistant" : message.role === "system" ? "system" : "user",
          content: message.content,
        })),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`LLM HTTP ${res.status}${body ? `: ${cleanLlmText(body, 120)}` : ""}`);
    }
    const json = await res.json();
    const content =
      json.output_text ||
      json.output
        ?.flatMap((item) => item.content || [])
        ?.map((part) => part.text || part.output_text || "")
        ?.join("") ||
      "";
    if (!content.trim()) throw new Error("LLM returned empty content");
    return extractJsonObject(content);
  } finally {
    clearTimeout(timer);
  }
}

async function callAnthropicMessagesLlm(llm, messages) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), llm.timeoutMs);
  const system = messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
  const userMessages = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: message.content,
    }));
  try {
    const res = await fetch(`${llm.baseUrl}/v1/messages`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": llm.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: llm.model,
        max_tokens: 2048,
        temperature: llm.temperature,
        system,
        messages: userMessages.length ? userMessages : [{ role: "user", content: messagesToText(messages) }],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`LLM HTTP ${res.status}${body ? `: ${cleanLlmText(body, 120)}` : ""}`);
    }
    const json = await res.json();
    const content = (json.content || []).map((part) => part.text || "").join("");
    if (!content.trim()) throw new Error("LLM returned empty content");
    return extractJsonObject(content);
  } finally {
    clearTimeout(timer);
  }
}

async function callLlm(llm, messages) {
  if (llm.provider === "anthropic-messages") return callAnthropicMessagesLlm(llm, messages);
  if (llm.provider === "openai-responses") return callOpenAIResponsesLlm(llm, messages);
  return callOpenAICompatibleLlm(llm, messages);
}

function compactCandidateForLlm(item) {
  return {
    code: item.code,
    name: item.name,
    boardName: item.boardName,
    ruleScore: item.score,
    ruleAction: item.action,
    pct: Number(item.pct?.toFixed?.(2) ?? item.pct),
    amount: item.amount,
    mainNet: item.mainNet,
    riskTags: (item.riskTags || []).slice(0, 4).map((tag) => cleanLlmText(tag, 40)),
    reason: cleanLlmText(item.reason, 160),
    events: compactDecisionContextForLlm(item.decisionContext),
  };
}

function compactDecisionContextForLlm(context) {
  if (!context) return null;
  const f10 = context.f10
    ? {
        industry: cleanLlmText(context.f10.industry || context.f10.board || "", 80),
        profile: cleanLlmText(context.f10.profile || context.f10.business || context.f10.mainBusiness || "", 180),
        source: context.f10.source,
      }
    : null;
  return {
    news: compactLlmTexts(context.news, 2, (item) => ({
      title: cleanLlmText(item.title, 90),
      summary: cleanLlmText(item.summary, 140),
      source: item.media || item.source,
      time: item.time,
    })),
    eventSearch: compactLlmTexts(context.eventSearch, 2, (item) => ({
      title: cleanLlmText(item.title, 90),
      summary: cleanLlmText(item.summary, 140),
      source: item.source,
      provider: item.provider,
      time: item.time,
    })),
    eventHeat: context.eventHeat || null,
    announcements: compactLlmTexts(context.announcements, 2, (item) => ({
      title: cleanLlmText(item.title, 100),
      type: item.type,
      time: item.time,
      source: item.source,
    })),
    f10,
    fundamentals: context.fundamentals
      ? {
          source: context.fundamentals.source,
          summary: cleanLlmText(summarizeFundamentals(context.fundamentals), 220),
        }
      : null,
    warnings: (context.warnings || []).slice(0, 2).map((item) => cleanLlmText(item, 90)),
  };
}

function summarizeFundamentals(fundamentals) {
  if (!fundamentals) return "";
  const metrics = (fundamentals.metrics || [])
    .slice(0, 6)
    .map((item) => `${item.name}${formatFinancialMetric(item)}${item.period ? `(${item.period})` : ""}`);
  const summary = (fundamentals.summary || []).slice(0, 3);
  return [...metrics, ...summary].filter(Boolean).join("；");
}

function formatFinancialMetric(item) {
  const raw = String(item?.value ?? "").trim();
  if (!raw) return "";
  const hasPercent = raw.includes("%");
  const numeric = Number(raw.replace("%", ""));
  if (!Number.isFinite(numeric)) return raw;
  const value = numeric.toFixed(Math.abs(numeric) >= 100 ? 1 : 2).replace(/\.00$/, "");
  const percentMetrics = new Set(["ROE", "ROA", "毛利率", "净利率", "营收同比", "净利润同比", "资产负债率"]);
  return percentMetrics.has(item.name) && !hasPercent ? `${value}%` : value;
}

async function buildProviderFundamentals(config, candidates, warnings) {
  const providerConfig = normalizeDataProviderConfig(config);
  const base = {
    enabled: providerConfig.enabled,
    status: providerConfig.enabled ? "pending" : "disabled",
    fetchedAt: null,
    codes: [],
    providers: {
      akshare: { enabled: providerConfig.useAkshare, available: false, status: providerConfig.useAkshare ? "pending" : "disabled" },
      baostock: { enabled: providerConfig.useBaostock, available: false, status: providerConfig.useBaostock ? "pending" : "disabled" },
      tushare: {
        enabled: providerConfig.useTushare,
        available: false,
        status: providerConfig.useTushare ? (providerConfig.tushareTokenConfigured ? "pending" : "missing_token") : "disabled",
      },
    },
    results: {},
  };
  if (!providerConfig.enabled) return { status: base, byCode: new Map() };
  if (!providerConfig.useAkshare && !providerConfig.useBaostock && !providerConfig.useTushare) {
    return { status: { ...base, status: "disabled", summary: "增强数据源未启用。" }, byCode: new Map() };
  }

  const codes = [...new Set(candidates.slice(0, providerConfig.maxCandidates).map((item) => item.code).filter(Boolean))];
  if (!codes.length) return { status: { ...base, status: "empty" }, byCode: new Map() };

  try {
    const { stdout } = await execFileAsync(providerConfig.pythonBin, [providerFundamentalsScript], {
      env: {
        ...process.env,
        A_SHARE_PROVIDER_CODES: codes.join(","),
        A_SHARE_ENABLE_AKSHARE: providerConfig.useAkshare ? "1" : "0",
        A_SHARE_ENABLE_BAOSTOCK: providerConfig.useBaostock ? "1" : "0",
        A_SHARE_ENABLE_TUSHARE: providerConfig.useTushare && providerConfig.tushareTokenConfigured ? "1" : "0",
        TUSHARE_TOKEN: providerConfig.tushareToken || "",
      },
      timeout: providerConfig.timeoutMs,
      maxBuffer: 5 * 1024 * 1024,
    });
    const parsed = extractJsonObject(stdout || "{}");
    if (!parsed.ok) throw new Error(parsed.error || "provider bridge failed");
    const byCode = new Map();
    for (const [code, entry] of Object.entries(parsed.results || {})) {
      if (entry?.fundamentals) byCode.set(code, entry.fundamentals);
    }
    return {
      status: {
        ...base,
        status: "ok",
        fetchedAt: new Date().toISOString(),
        codes,
        providers: parsed.providers || base.providers,
        resultCount: byCode.size,
      },
      byCode,
    };
  } catch (error) {
    const summary = `增强数据源暂不可用：${error.message}`;
    return {
      status: {
        ...base,
        status: "error",
        fetchedAt: new Date().toISOString(),
        codes,
        error: cleanText(error.message, 180),
      },
      byCode: new Map(),
    };
  }
}

function keywordSetForCandidate(item) {
  const words = new Set([item.name, item.code, item.boardName]);
  for (const part of String(item.boardName || "").split(/[、/()（）\s-]+/)) {
    if (part && part.length >= 2) words.add(part);
  }
  return [...words].filter(Boolean);
}

function matchNewsForCandidate(news, item, maxNews) {
  const keywords = keywordSetForCandidate(item);
  return news
    .map((entry) => {
      const text = `${entry.title} ${entry.summary}`;
      const hits = keywords.filter((keyword) => text.includes(keyword));
      return { ...entry, matchedKeywords: hits, matchScore: hits.length };
    })
    .filter((entry) => entry.matchScore > 0)
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, maxNews);
}

async function buildDecisionContexts(config, candidates, warnings) {
  const contextConfig = normalizeContextConfig(config);
  const empty = {
    enabled: contextConfig.enabled,
    news: [],
    eventSearch: [],
    eventHeat: null,
    announcements: [],
    f10: null,
    fundamentals: null,
    warnings: [],
  };
  if (!contextConfig.enabled) {
    return {
      contextByCode: new Map(candidates.map((item) => [item.code, { ...empty, enabled: false }])),
      dataProviders: { enabled: false, status: "context_disabled" },
      eventSearch: { enabled: false, status: "context_disabled" },
    };
  }

  const topCandidates = candidates.slice(0, Math.max(1, normalizeLlmConfig(config).maxCandidates));
  const providerPack = await buildProviderFundamentals(config, topCandidates, warnings);
  const eventSearchPack = await buildEventSearchContexts(config, topCandidates);
  let marketNews = [];
  if (contextConfig.includeNews && contextConfig.maxNews > 0) {
    try {
      marketNews = await getEastmoneyFinanceNews(30, contextConfig.timeoutMs);
    } catch (error) {
      pushUniqueWarning(warnings, `财经新闻源暂时不可用：${error.message}`);
    }
  }

  const contextByCode = new Map();
  for (const item of topCandidates) {
    const itemWarnings = [];
    const context = {
      enabled: true,
      news: contextConfig.includeNews ? matchNewsForCandidate(marketNews, item, contextConfig.maxNews) : [],
      eventSearch: eventSearchPack.byCode.get(item.code)?.results || [],
      eventHeat: eventSearchPack.byCode.get(item.code)?.heat || null,
      announcements: [],
      f10: null,
      fundamentals: providerPack.byCode.get(item.code) || null,
      warnings: itemWarnings,
    };
    itemWarnings.push(...(eventSearchPack.byCode.get(item.code)?.warnings || []));

    if (contextConfig.includeAnnouncements && contextConfig.maxAnnouncements > 0) {
      try {
        context.announcements = await getCompanyAnnouncements(item.code, contextConfig.maxAnnouncements, contextConfig.timeoutMs);
        if (!context.announcements.length) itemWarnings.push("未抓到近期公告或公告源暂不可用");
      } catch (error) {
        itemWarnings.push(`公告源失败：${error.message}`);
      }
    }

    if (contextConfig.includeF10) {
      try {
        const survey = await getCompanySurvey(item.code);
        if (survey) {
          context.f10 = {
            industry: survey.industry,
            profile: cleanText(survey.profile || survey.businessScope, 220),
            website: survey.website,
            source: survey.source,
          };
        }
      } catch (error) {
        itemWarnings.push(`F10失败：${error.message}`);
      }
    }

    contextByCode.set(item.code, context);
  }
  return { contextByCode, dataProviders: providerPack.status, eventSearch: eventSearchPack.status };
}

function normalizeLlmDecision(raw, maxImpact) {
  return {
    code: String(raw?.code || "").trim(),
    verdict: normalizeVerdict(raw?.verdict),
    confidence: clamp(Number(raw?.confidence || 0), 0, 100),
    scoreAdjustment: clamp(Number(raw?.scoreAdjustment || 0), -maxImpact, maxImpact),
    reason: cleanLlmText(raw?.reason || raw?.rationale || ""),
    risk: cleanLlmText(raw?.risk || ""),
    researchFocus: cleanLlmText(raw?.researchFocus || ""),
  };
}

async function buildLlmDecisionPack(config, candidates, hotBoards, indexRows, state, warnings, contextByCode = new Map()) {
  const llm = normalizeLlmConfig(config);
  const base = {
    enabled: llm.enabled,
    status: llm.enabled ? "pending" : "disabled",
    provider: llm.provider,
    model: llm.model || "未配置",
    apiKeyConfigured: llm.apiKeyConfigured,
    decisionMode: llm.decisionMode,
    scoreImpact: llm.scoreImpact,
    minConfidence: llm.minConfidence,
    requireBuyApproval: llm.requireBuyApproval,
    summary: llm.enabled ? "等待大模型决策。" : "大模型决策未开启。",
    marketRead: "",
    parameterAdvice: [],
    decisions: [],
  };

  if (!llm.enabled) return base;
  const missing = [];
  if (!llm.apiKey) missing.push("API Key");
  if (!llm.baseUrl) missing.push("LLM_BASE_URL");
  if (!llm.model) missing.push("LLM_MODEL");
  if (missing.length) {
    const summary = `大模型已开启，但缺少 ${missing.join(" / ")}，本轮回退到规则引擎。`;
    pushUniqueWarning(warnings, summary);
    return { ...base, status: "not_configured", summary };
  }

  const reviewPayload = {
    date: today,
    objective: "A股学习系统的纸面交易决策。只允许给模拟交易建议，不构成实盘投资建议。",
    ruleConfig: {
      buyScoreThreshold: config.buyScoreThreshold,
      stopLossPct: config.stopLossPct,
      takeProfitPct: config.takeProfitPct,
      maxPositions: config.maxPositions,
      maxPositionPct: config.maxPositionPct,
    },
    market: {
      indexes: indexRows.map((row) => ({ name: row.f14, pct: num(row.f3), amount: num(row.f6) })),
      hotBoards: hotBoards.slice(0, 8).map((row) => ({
        name: row.name,
        pct: row.pct,
        amount: row.amount,
        mainNet: row.mainNet,
        score: row.score,
      })),
    },
    portfolio: {
      openPositions: (state.positions || [])
        .filter((position) => position.status === "OPEN")
        .map((position) => ({
          code: position.code,
          name: position.name,
          boardName: position.boardName,
          entryDate: position.entryDate,
          costBasis: position.costBasis,
          latestPrice: position.latestPrice,
          unrealizedPnlPct: position.unrealizedPnlPct,
        })),
      learning: state.learning || {},
    },
    candidates: candidates.slice(0, llm.maxCandidates).map((item) =>
      compactCandidateForLlm({ ...item, decisionContext: contextByCode.get(item.code) || null }),
    ),
  };

  const messages = [
    {
      role: "system",
      content:
        "你是A股纸面交易系统的投研和风控委员。你只能参与模拟交易决策，不能给用户实盘指令。优先考虑可解释性、风险、板块共振和追高风险。只返回合法JSON，不要Markdown。",
    },
    {
      role: "user",
      content: `请审查候选股，并返回JSON：{"summary":"一句话总评","marketRead":"市场判断","decisions":[{"code":"股票代码","verdict":"BUY|HOLD|AVOID","confidence":0-100,"scoreAdjustment":-12到12,"reason":"核心理由","risk":"最大风险","researchFocus":"下一步验证"}],"parameterAdvice":["参数建议"]}。\n\n数据：${JSON.stringify(reviewPayload)}`,
    },
  ];

  try {
    const response = await callLlm(llm, messages);
    const decisionCodes = new Set(candidates.slice(0, llm.maxCandidates).map((item) => item.code));
    const decisions = Array.isArray(response.decisions)
      ? response.decisions
          .map((item) => normalizeLlmDecision(item, llm.scoreImpact))
          .filter((item) => item.code && decisionCodes.has(item.code))
      : [];
    return {
      ...base,
      status: "ok",
      summary: cleanLlmText(response.summary || "大模型已参与本轮候选审查。", 200),
      marketRead: cleanLlmText(response.marketRead || "", 200),
      parameterAdvice: Array.isArray(response.parameterAdvice)
        ? response.parameterAdvice.slice(0, 5).map((item) => cleanLlmText(item, 120))
        : [],
      decisions,
      requestedAt: new Date().toISOString(),
    };
  } catch (error) {
    const summary = `大模型决策失败，已回退到规则引擎：${explainLlmError(error, llm)}`;
    pushUniqueWarning(warnings, summary);
    return { ...base, status: "error", summary };
  }
}

function deriveActionFromScore(item, score, config) {
  if (item.riskTags?.includes("ST/风险警示")) return { action: "剔除", actionCode: "AVOID" };
  if (score >= config.buyScoreThreshold && item.pct > 0.8 && item.pct < 8.5 && Number(item.mainNet || 0) > 0) {
    return { action: "模拟买入", actionCode: "PAPER_BUY" };
  }
  if (score >= 58) return { action: "重点观察", actionCode: "FOCUS" };
  return { action: "观察", actionCode: "WATCH" };
}

function applyLlmDecisionLayer(candidates, llmDecision, config) {
  if (!llmDecision?.enabled || llmDecision.status !== "ok") {
    return candidates.map((item) => ({ ...item, ruleScore: item.score, finalScore: item.score }));
  }

  const decisionByCode = new Map((llmDecision.decisions || []).map((item) => [item.code, item]));
  return candidates
    .map((item) => {
      const decision = decisionByCode.get(item.code) || null;
      if (!decision) {
        const next = { ...item, ruleScore: item.score, finalScore: item.score };
        if (
          llmDecision.decisionMode === "score_veto" &&
          llmDecision.requireBuyApproval &&
          next.actionCode === "PAPER_BUY"
        ) {
          next.action = "重点观察";
          next.actionCode = "FOCUS";
          next.reason = `${next.reason} 大模型未覆盖该候选；当前配置要求模型确认买入，本轮降级为观察。`;
        }
        return next;
      }

      const effectiveImpact = llmDecision.decisionMode === "advisory" ? 0 : decision.scoreAdjustment;
      const finalScore = clamp(Math.round(item.score + effectiveImpact), 0, 100);
      const next = {
        ...item,
        ruleScore: item.score,
        score: finalScore,
        finalScore,
        llmDecision: decision,
        llmScoreImpact: effectiveImpact,
      };

      if (llmDecision.decisionMode !== "advisory") {
        const derived = deriveActionFromScore(next, finalScore, config);
        next.action = derived.action;
        next.actionCode = derived.actionCode;

        if (llmDecision.decisionMode === "score_veto" && decision.verdict === "AVOID") {
          next.action = "模型规避";
          next.actionCode = "LLM_AVOID";
        } else if (
          llmDecision.decisionMode === "score_veto" &&
          llmDecision.requireBuyApproval &&
          next.actionCode === "PAPER_BUY" &&
          (decision.verdict !== "BUY" || decision.confidence < llmDecision.minConfidence)
        ) {
          next.action = "重点观察";
          next.actionCode = "FOCUS";
        }
      }

      const impactText = effectiveImpact ? `，模型调分${signed(effectiveImpact, 1)}` : "";
      const riskText = decision.risk ? `，风险：${decision.risk}` : "";
      next.reason = `${next.reason} 模型${decision.verdict}，信心${Math.round(decision.confidence)}${impactText}；${decision.reason || "无额外理由"}${riskText}。`;
      return next;
    })
    .sort((a, b) => b.score - a.score);
}

function currentLossStreak(state) {
  let streak = 0;
  for (const trade of [...(state.closedTrades || [])].reverse()) {
    if (!hasNumber(trade.realizedPnlPct)) continue;
    if (num(trade.realizedPnlPct) <= 0) streak += 1;
    else break;
  }
  return streak;
}

function boardExposure(activePositions) {
  return activePositions.reduce((acc, position) => {
    const board = position.boardName || "UNKNOWN";
    const value = (position.latestPrice || position.entryPrice || 0) * (position.shares || 0);
    acc[board] = (acc[board] || 0) + value;
    return acc;
  }, {});
}

function riskControlStatus(state, config, marketRegime = null, portfolioSummary = null) {
  const controls = normalizeRiskControlsConfig(config);
  const equity = Math.max(0, num(portfolioSummary?.netLiquidation, estimateEquity(state)));
  const initialCash = num(state.portfolio?.initialCash, config.initialCash);
  const peak = Math.max(num(state.portfolio?.peakNetLiquidation, initialCash), equity, initialCash);
  const drawdownPct = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
  const lossStreak = currentLossStreak(state);
  const openPositions = (state.positions || []).filter((position) => position.status === "OPEN");
  const exposures = boardExposure(openPositions);
  const topBoard = Object.entries(exposures).sort((a, b) => b[1] - a[1])[0] || null;
  const reasons = [];

  if (controls.enabled && drawdownPct >= controls.maxAccountDrawdownPct) {
    reasons.push(`账户回撤${signed(drawdownPct)}%达到上限${signed(controls.maxAccountDrawdownPct)}%`);
  }
  if (controls.enabled && lossStreak >= controls.pauseAfterLossStreak) {
    reasons.push(`连续亏损${lossStreak}笔，暂停新开仓`);
  }
  if (controls.enabled && marketRegime?.score > 0 && marketRegime.score < 35) {
    reasons.push(`市场评分${marketRegime.score}偏弱，先防守复盘`);
  }

  return {
    enabled: controls.enabled,
    blocked: reasons.length > 0,
    reasons,
    drawdownPct: roundPercent(drawdownPct),
    peakNetLiquidation: peak,
    lossStreak,
    topBoard: topBoard
      ? {
          name: topBoard[0],
          value: topBoard[1],
          exposurePct: equity > 0 ? roundPercent((topBoard[1] / equity) * 100) : 0,
        }
      : null,
  };
}

function gateCandidate(item, { state, config, activePositions, activeCodes, availableSlots, marketRegime }) {
  const controls = normalizeRiskControlsConfig(config);
  const status = riskControlStatus(state, config, marketRegime);
  const equity = Math.max(estimateEquity(state), num(state.portfolio?.initialCash, config.initialCash));
  const projectedBudget = Math.min(equity * config.maxPositionPct, num(state.portfolio?.cash));
  const exposures = boardExposure(activePositions);
  const boardValue = exposures[item.boardName] || 0;
  const projectedBoardPct = equity > 0 ? (boardValue + projectedBudget) / equity : 0;
  const reasons = [];

  if (!controls.enabled) return { blocked: false, reasons, projectedBoardPct };
  if (status.blocked) reasons.push(...status.reasons);
  if (activeCodes.has(item.code)) reasons.push("当前已持仓，不重复买入");
  if (availableSlots <= 0) reasons.push(`当前模拟持仓已达上限${config.maxPositions}只`);
  if (num(item.pct) >= controls.chasePctLimit) reasons.push(`涨幅${signed(item.pct)}%超过追高阈值${signed(controls.chasePctLimit)}%`);
  if (num(item.amount) < controls.minAmount) reasons.push(`成交额${money(item.amount)}低于流动性阈值${money(controls.minAmount)}`);
  if (projectedBoardPct > controls.maxBoardExposurePct) {
    reasons.push(`买入后${item.boardName}板块预计占比${signed(projectedBoardPct * 100)}%，超过上限${signed(controls.maxBoardExposurePct * 100)}%`);
  }
  return {
    blocked: reasons.length > 0,
    reasons,
    projectedBoardPct: roundPercent(projectedBoardPct * 100),
  };
}

function applyPortfolioConstraints(candidates, state, config, marketRegime = null) {
  const activePositions = (state.positions || []).filter((position) => position.status === "OPEN");
  const activeCodes = new Set(activePositions.map((position) => position.code));
  let availableSlots = Math.max(0, config.maxPositions - activePositions.length);

  return candidates.map((item) => {
    if (item.actionCode !== "PAPER_BUY") return item;
    const gate = gateCandidate(item, { state, config, activePositions, activeCodes, availableSlots, marketRegime });
    if (gate.blocked) {
      return {
        ...item,
        action: activeCodes.has(item.code) ? "已持仓观察" : "风控观察",
        actionCode: "FOCUS",
        riskGate: gate,
        reason: `${item.reason} 风控闸门未放行：${gate.reasons.join("；")}。`,
      };
    }
    availableSlots -= 1;
    activeCodes.add(item.code);
    activePositions.push({
      code: item.code,
      boardName: item.boardName,
      latestPrice: 1,
      entryPrice: 1,
      shares: Math.min(estimateEquity(state) * config.maxPositionPct, num(state.portfolio?.cash)),
      status: "OPEN",
    });
    return { ...item, executablePaperBuy: true, riskGate: { ...gate, passed: true } };
  });
}

function secidFromCode(code) {
  return String(code).startsWith("6") ? `1.${code}` : `0.${code}`;
}

async function readState() {
  const file = path.join(dataDir, "state.json");
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return { positions: [], closedTrades: [], tradeLog: [], learning: {}, riskLearning: {} };
  }
}

async function writeState(state) {
  await fs.writeFile(path.join(dataDir, "state.json"), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function ensureState(state, config) {
  state.positions ||= [];
  state.closedTrades ||= [];
  state.tradeLog ||= [];
  state.learning ||= {};
  state.riskLearning ||= {};
  state.portfolio ||= {
    initialCash: config.initialCash,
    cash: config.initialCash,
    realizedPnl: 0,
    totalFees: 0,
  };
  for (const position of state.positions) {
    if (!position.entryAt) {
      const timestamp = legacyTradeTimestamp(position.entryDate || today);
      position.entryAt = timestamp.executedAt;
      position.entryAtLocal = timestamp.executedAtLocal;
      position.entryTimeEstimated = true;
    }
    if (position.status === "CLOSED" && position.exitDate && !position.exitAt) {
      const timestamp = legacyTradeTimestamp(position.exitDate);
      position.exitAt = timestamp.executedAt;
      position.exitAtLocal = timestamp.executedAtLocal;
      position.exitTimeEstimated = true;
    }
  }
  for (const trade of state.tradeLog) {
    if (!trade.executedAt) {
      Object.assign(trade, legacyTradeTimestamp(trade.date || today));
    }
    trade.quotePrice ??= trade.price;
    trade.slippageCost ??= slippageCost(trade.side, trade.quotePrice, trade.price, trade.shares);
    trade.feeConfig ??= feeConfigSnapshot(config);
  }

  if (!state.portfolio.migratedLegacyPositions) {
    for (const position of state.positions.filter((item) => item.status === "OPEN")) {
      if (position.shares) continue;
      const fillPrice = position.entryPrice || position.latestPrice;
      const targetCash = config.initialCash * config.maxPositionPct;
      const shares = Math.floor(targetCash / fillPrice / config.lotSize) * config.lotSize;
      if (shares <= 0) continue;
      const fees = calcBuyFees(fillPrice, shares, config);
      const totalCost = fillPrice * shares + fees.total;
      position.shares = shares;
      position.entryFillPrice = fillPrice;
      position.buyFees = fees;
      position.totalCost = totalCost;
      position.costBasis = totalCost / shares;
      position.unrealizedPnl = 0;
      position.unrealizedPnlPct = 0;
      state.portfolio.cash -= totalCost;
      state.portfolio.totalFees += fees.total;
      const execution = legacyTradeTimestamp(position.entryDate || today);
      position.entryAt = execution.executedAt;
      position.entryAtLocal = execution.executedAtLocal;
      position.entryTimeEstimated = true;
      state.tradeLog.push({
        date: position.entryDate || today,
        ...execution,
        code: position.code,
        name: position.name,
        side: "BUY",
        shares,
        price: fillPrice,
        quotePrice: fillPrice,
        gross: fillPrice * shares,
        fees,
        slippageCost: 0,
        feeConfig: feeConfigSnapshot(config),
        netCash: -totalCost,
        reason: "迁移旧模拟持仓并补记费用",
      });
    }
    state.portfolio.migratedLegacyPositions = true;
  }

  rebuildRiskLearningFromClosedTrades(state);
  return state;
}

function calcCommission(gross, config) {
  return Math.max(gross * config.commissionRate, config.minCommission);
}

function calcBuyFees(price, shares, config) {
  const gross = price * shares;
  const commission = calcCommission(gross, config);
  const transferFee = gross * config.transferFeeRate;
  return {
    commission,
    transferFee,
    stampDuty: 0,
    total: commission + transferFee,
  };
}

function calcSellFees(price, shares, config) {
  const gross = price * shares;
  const commission = calcCommission(gross, config);
  const transferFee = gross * config.transferFeeRate;
  const stampDuty = gross * config.stampDutyRate;
  return {
    commission,
    transferFee,
    stampDuty,
    total: commission + transferFee + stampDuty,
  };
}

function buyFillPrice(price, config) {
  return price * (1 + config.slippageRate);
}

function sellFillPrice(price, config) {
  return price * (1 - config.slippageRate);
}

function estimateEquity(state) {
  const openValue = state.positions
    .filter((position) => position.status === "OPEN")
    .reduce((sum, position) => sum + (position.latestPrice || position.entryPrice || 0) * (position.shares || 0), 0);
  return state.portfolio.cash + openValue;
}

function canSellToday(position) {
  return position.entryDate && position.entryDate < today;
}

function daysHeld(position) {
  if (!position.entryDate) return 0;
  const start = new Date(`${position.entryDate}T00:00:00+08:00`);
  const end = new Date(`${today}T00:00:00+08:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.max(0, Math.round((end - start) / 86400000));
}

function roundPercent(value) {
  return Number(Number(value || 0).toFixed(2));
}

function riskLearningNudges(state) {
  const learned = state.riskLearning || {};
  return {
    stopLossNudge: learned.sampleCount >= 5 ? num(learned.stopLossNudge) : 0,
    takeProfitNudge: learned.sampleCount >= 5 ? num(learned.takeProfitNudge) : 0,
  };
}

function buildAdaptiveExitPlan(position, { candidate = null, quote = null, config, marketRegime = null, state = {} } = {}) {
  const risk = normalizeAdaptiveRiskConfig(config);
  const baseStopLossPct = clamp(num(config.stopLossPct, -5), risk.minStopLossPct, risk.maxStopLossPct);
  const baseTakeProfitPct = clamp(num(config.takeProfitPct, 10), risk.minTakeProfitPct, risk.maxTakeProfitPct);
  if (!risk.enabled) {
    return {
      enabled: false,
      baseStopLossPct,
      baseTakeProfitPct,
      stopLossPct: roundPercent(baseStopLossPct),
      takeProfitPct: roundPercent(baseTakeProfitPct),
      reasons: ["使用固定止盈止损阈值"],
      summary: `固定阈值：止损${signed(baseStopLossPct)}%，止盈${signed(baseTakeProfitPct)}%。`,
    };
  }

  const reasons = [];
  let stopLossPct = baseStopLossPct;
  let takeProfitPct = baseTakeProfitPct;
  const marketScore = num(marketRegime?.score);
  const quotePct = quote ? num(quote.f3) : num(candidate?.pct);
  const confidence = num(candidate?.llmDecision?.confidence);
  const verdict = candidate?.llmDecision?.verdict || "";
  const riskTags = candidate?.riskTags || [];
  const heat = candidate?.decisionContext?.eventHeat;
  const learning = state.learning?.[position.boardName || candidate?.boardName] || {};
  const nudges = riskLearningNudges(state);

  if (marketScore >= 75) {
    stopLossPct -= 0.6;
    takeProfitPct += 2;
    reasons.push("市场赚钱效应强，给强势持仓更高止盈空间");
  } else if (marketScore > 0 && marketScore < 45) {
    stopLossPct += 0.8;
    takeProfitPct -= 1.5;
    reasons.push("市场偏弱，收紧止损并降低止盈预期");
  }

  if (verdict === "BUY" && confidence >= 70) {
    stopLossPct -= 0.5;
    takeProfitPct += 1.5;
    reasons.push("模型高信心看多，允许更宽容的波动");
  } else if (verdict === "AVOID" && confidence >= 70) {
    stopLossPct += 1;
    takeProfitPct -= 2;
    reasons.push("模型提示规避风险，退出阈值更保守");
  }

  if (quotePct >= 4) {
    stopLossPct -= 0.3;
    takeProfitPct += 1.2;
    reasons.push("个股当日强势，止盈目标顺势上移");
  } else if (quotePct <= -3) {
    stopLossPct += 0.8;
    takeProfitPct -= 1;
    reasons.push("个股当日转弱，动态收紧风控");
  }

  if (riskTags.length) {
    stopLossPct += Math.min(1.2, riskTags.length * 0.4);
    takeProfitPct -= Math.min(2, riskTags.length * 0.6);
    reasons.push(`风险标签${riskTags.length}个，降低容错`);
  }

  if (heat?.tone === "risk") {
    stopLossPct += 0.8;
    takeProfitPct -= 1;
    reasons.push("舆情风险偏多，优先保护本金");
  } else if (heat?.tone === "hot") {
    takeProfitPct += 0.8;
    reasons.push("事件热度较高，保留趋势观察空间");
  }

  if (num(learning.count) >= 5) {
    if (num(learning.avgReturn) > 3) {
      takeProfitPct += 0.8;
      reasons.push("该板块历史模拟样本表现较好");
    } else if (num(learning.avgReturn) < -1) {
      stopLossPct += 0.5;
      reasons.push("该板块历史模拟样本偏弱");
    }
  }

  if (nudges.stopLossNudge || nudges.takeProfitNudge) {
    stopLossPct += nudges.stopLossNudge;
    takeProfitPct += nudges.takeProfitNudge;
    reasons.push("根据已关闭交易样本做轻微学习修正");
  }

  stopLossPct = roundPercent(clamp(stopLossPct, risk.minStopLossPct, risk.maxStopLossPct));
  takeProfitPct = roundPercent(clamp(takeProfitPct, risk.minTakeProfitPct, risk.maxTakeProfitPct));
  const uniqReasons = [...new Set(reasons)].slice(0, 4);
  return {
    enabled: true,
    baseStopLossPct: roundPercent(baseStopLossPct),
    baseTakeProfitPct: roundPercent(baseTakeProfitPct),
    stopLossPct,
    takeProfitPct,
    bounds: {
      stopLoss: [risk.minStopLossPct, risk.maxStopLossPct],
      takeProfit: [risk.minTakeProfitPct, risk.maxTakeProfitPct],
    },
    reasons: uniqReasons.length ? uniqReasons : ["无明显研判偏移，使用基准阈值"],
    summary: `动态阈值：止损${signed(stopLossPct)}%，止盈${signed(takeProfitPct)}%。`,
  };
}

function updateRiskLearning(state, realizedPnlPct) {
  state.riskLearning ||= {};
  const item = state.riskLearning;
  item.sampleCount = num(item.sampleCount) + 1;
  item.wins = num(item.wins) + (realizedPnlPct > 0 ? 1 : 0);
  item.losses = num(item.losses) + (realizedPnlPct <= 0 ? 1 : 0);
  item.avgReturn = ((num(item.avgReturn) * (item.sampleCount - 1)) + realizedPnlPct) / item.sampleCount;
  if (realizedPnlPct > 0) {
    item.avgWin = ((num(item.avgWin) * (item.wins - 1)) + realizedPnlPct) / item.wins;
  } else {
    item.avgLoss = ((num(item.avgLoss) * (item.losses - 1)) + realizedPnlPct) / item.losses;
  }
  const winRate = item.sampleCount ? (item.wins / item.sampleCount) * 100 : 0;
  const avgLossAbs = Math.abs(num(item.avgLoss));
  let stopLossNudge = 0;
  let takeProfitNudge = 0;
  if (item.sampleCount >= 5) {
    if (winRate < 45 || avgLossAbs > Math.max(1, num(item.avgWin) * 1.15)) stopLossNudge += 0.5;
    if (winRate > 55 && num(item.avgWin) > avgLossAbs * 1.15) takeProfitNudge += 0.8;
    if (winRate < 40) takeProfitNudge -= 0.8;
  }
  item.winRate = winRate;
  item.stopLossNudge = roundPercent(clamp(stopLossNudge, -1, 1.5));
  item.takeProfitNudge = roundPercent(clamp(takeProfitNudge, -2, 2));
  item.sourceClosedCount = item.sampleCount;
  item.updatedAt = new Date().toISOString();
}

function rebuildRiskLearningFromClosedTrades(state) {
  const trades = (state.closedTrades || []).filter((trade) => hasNumber(trade.realizedPnlPct));
  if (!trades.length || num(state.riskLearning?.sourceClosedCount) === trades.length) return;
  state.riskLearning = {};
  for (const trade of trades) updateRiskLearning(state, num(trade.realizedPnlPct));
  state.riskLearning.sourceClosedCount = trades.length;
}

async function updatePaperBook(state, candidates, config, tradeEnabled, marketRegime = null, strategyVersion = buildStrategyVersion(config)) {
  const openCodes = new Set(state.positions.filter((p) => p.status === "OPEN").map((p) => p.code));
  const openPositions = state.positions.filter((p) => p.status === "OPEN");
  const candidateByCode = new Map(candidates.map((item) => [item.code, item]));
  const decisions = [];

  if (openPositions.length) {
    const quotes = await getQuotes(openPositions.map((p) => secidFromCode(p.code)).join(","));
    const quoteMap = new Map(quotes.map((row) => [String(row.f12), row]));

    for (const position of openPositions) {
      const quote = quoteMap.get(position.code);
      if (!quote) continue;
      const candidate = candidateByCode.get(position.code) || null;
      const price = num(quote.f2, position.latestPrice);
      const markSellPrice = sellFillPrice(price, config);
      const estimateSellFees = calcSellFees(markSellPrice, position.shares || 0, config);
      const estimateProceeds = markSellPrice * (position.shares || 0) - estimateSellFees.total;
      const totalCost = position.totalCost || (position.entryPrice || 0) * (position.shares || 0);
      const pnl = estimateProceeds - totalCost;
      const pnlPct = totalCost > 0 ? (pnl / totalCost) * 100 : 0;
      const exitPlan = buildAdaptiveExitPlan(position, { candidate, quote, config, marketRegime, state });

      position.latestPrice = price;
      position.latestDate = today;
      position.unrealizedPnl = pnl;
      position.unrealizedPnlPct = pnlPct;
      position.exitPlan = exitPlan;

      let decision = "继续持有";
      let decisionCode = "HOLD";
      if (!canSellToday(position)) {
        decision = "T+1限制，继续持有";
        decisionCode = "T1_HOLD";
      } else if (pnlPct <= exitPlan.stopLossPct) {
        decision = "模拟止损";
        decisionCode = "STOP_LOSS";
      } else if (pnlPct >= exitPlan.takeProfitPct) {
        decision = "模拟止盈";
        decisionCode = "TAKE_PROFIT";
      } else {
        const controls = normalizeRiskControlsConfig(config);
        if (controls.enabled && daysHeld(position) >= controls.timeStopDays && pnlPct < controls.timeStopMinProfitPct) {
          decision = "时间止损";
          decisionCode = "TIME_STOP";
        } else if (num(quote.f3) <= -4) {
          decision = "转弱观察";
          decisionCode = "WEAK_HOLD";
        }
      }

      if (tradeEnabled && ["STOP_LOSS", "TAKE_PROFIT", "TIME_STOP"].includes(decisionCode)) {
        const execution = tradeTimestamp();
        const exitPrice = sellFillPrice(price, config);
        const sellFees = calcSellFees(exitPrice, position.shares || 0, config);
        const gross = exitPrice * (position.shares || 0);
        const proceeds = gross - sellFees.total;
        const realizedPnl = proceeds - totalCost;
        const realizedPnlPct = totalCost > 0 ? (realizedPnl / totalCost) * 100 : 0;

        position.status = "CLOSED";
        position.exitDate = today;
        position.exitAt = execution.executedAt;
        position.exitAtLocal = execution.executedAtLocal;
        position.exitPrice = exitPrice;
        position.exitReason = decision;
        position.exitCode = decisionCode;
        position.exitPlan = exitPlan;
        position.exitAttribution = buildExitAttribution(position, { decision, decisionCode, pnlPct: realizedPnlPct, exitPlan, quote });
        position.sellFees = sellFees;
        position.realizedPnl = realizedPnl;
        position.realizedPnlPct = realizedPnlPct;
        position.strategyVersion ||= strategyVersion;
        state.portfolio.cash += proceeds;
        state.portfolio.realizedPnl += realizedPnl;
        state.portfolio.totalFees += sellFees.total;
        state.closedTrades.push({ ...position });
        state.tradeLog.push({
          date: today,
          ...execution,
          code: position.code,
          name: position.name,
          side: "SELL",
          shares: position.shares,
          price: exitPrice,
          quotePrice: price,
          gross,
          fees: sellFees,
          slippageCost: slippageCost("SELL", price, exitPrice, position.shares),
          feeConfig: feeConfigSnapshot(config),
          netCash: proceeds,
          realizedPnl,
          realizedPnlPct,
          strategyVersion: position.strategyVersion || strategyVersion,
          attribution: position.exitAttribution,
          reason: `${decision}；${exitPlan.summary}`,
        });
        updateLearning(state, position.boardName, realizedPnlPct);
        updateRiskLearning(state, realizedPnlPct);
      }

      decisions.push({
        code: position.code,
        name: position.name,
        boardName: position.boardName,
        entryDate: position.entryDate,
        entryPrice: position.entryPrice,
        shares: position.shares || 0,
        latestPrice: price,
        pnlPct,
        pnl,
        decision,
        decisionCode,
        strategyVersion: position.strategyVersion || strategyVersion,
        attribution: position.exitAttribution || null,
        exitPlan,
      });
    }
  }

  if (tradeEnabled) {
    const activePositions = state.positions.filter((p) => p.status === "OPEN");
    const activeCodes = new Set(activePositions.map((p) => p.code));
    const slots = Math.max(0, config.maxPositions - activePositions.length);
    const buyList = candidates
      .filter((item) => item.actionCode === "PAPER_BUY" && !activeCodes.has(item.code))
      .slice(0, slots);

    for (const item of buyList) {
      const equity = estimateEquity(state);
      const budget = Math.min(equity * config.maxPositionPct, state.portfolio.cash);
      const fillPrice = buyFillPrice(item.price, config);
      let shares = Math.floor(budget / fillPrice / config.lotSize) * config.lotSize;
      while (shares > 0) {
        const fees = calcBuyFees(fillPrice, shares, config);
        const totalCost = fillPrice * shares + fees.total;
        if (totalCost <= state.portfolio.cash) break;
        shares -= config.lotSize;
      }
      if (shares <= 0) continue;
      const fees = calcBuyFees(fillPrice, shares, config);
      const gross = fillPrice * shares;
      const totalCost = gross + fees.total;
      const execution = tradeTimestamp();
      const draftPosition = {
        code: item.code,
        boardName: item.boardName,
        entryDate: today,
      };
      const exitPlan = buildAdaptiveExitPlan(draftPosition, { candidate: item, config, marketRegime, state });
      const entryAttribution = buildEntryAttribution(item, { marketRegime, strategyVersion });

      const position = {
        id: `${today}-${item.code}`,
        code: item.code,
        name: item.name,
        boardName: item.boardName,
        entryDate: today,
        entryAt: execution.executedAt,
        entryAtLocal: execution.executedAtLocal,
        entryPrice: fillPrice,
        latestPrice: item.price,
        latestDate: today,
        shares,
        status: "OPEN",
        signal: "模拟买入",
        reason: item.reason,
        strategyVersion,
        entryAttribution,
        buyFees: fees,
        totalCost,
        costBasis: totalCost / shares,
        unrealizedPnl: -fees.total,
        unrealizedPnlPct: totalCost > 0 ? (-fees.total / totalCost) * 100 : 0,
        exitPlan,
      };
      state.positions.push(position);
      state.portfolio.cash -= totalCost;
      state.portfolio.totalFees += fees.total;
      state.tradeLog.push({
        date: today,
        ...execution,
        code: item.code,
        name: item.name,
        side: "BUY",
        shares,
        price: fillPrice,
        quotePrice: item.price,
        gross,
        fees,
        slippageCost: slippageCost("BUY", item.price, fillPrice, shares),
        feeConfig: feeConfigSnapshot(config),
        netCash: -totalCost,
        strategyVersion,
        attribution: entryAttribution,
        reason: `${item.reason} ${exitPlan.summary}`,
      });
      decisions.push({
        code: item.code,
        name: item.name,
        boardName: item.boardName,
        entryDate: today,
        entryPrice: fillPrice,
        shares,
        latestPrice: item.price,
        pnlPct: position.unrealizedPnlPct,
        pnl: position.unrealizedPnl,
        decision: "新开模拟仓",
        decisionCode: "PAPER_BUY",
        strategyVersion,
        attribution: entryAttribution,
        exitPlan,
      });
    }
  }

  return decisions;
}

function updateLearning(state, boardName, pnlPct) {
  state.learning[boardName] ||= { wins: 0, losses: 0, avgReturn: 0, count: 0, bias: 0 };
  const item = state.learning[boardName];
  item.count += 1;
  item.wins += pnlPct > 0 ? 1 : 0;
  item.losses += pnlPct <= 0 ? 1 : 0;
  item.avgReturn = ((item.avgReturn * (item.count - 1)) + pnlPct) / item.count;
  item.bias = Math.max(-8, Math.min(8, item.avgReturn * 0.5));
}

function learningBiasFor(state, boardName) {
  return num(state.learning?.[boardName]?.bias);
}

function buildMarketRegime(indexRows, hotBoards, candidates) {
  const indexAvg = indexRows.length
    ? indexRows.reduce((sum, row) => sum + num(row.f3), 0) / indexRows.length
    : 0;
  const strongBoards = hotBoards.filter((board) => board.pct >= 2).length;
  const buySignals = candidates.filter((item) => item.actionCode === "PAPER_BUY").length;
  const focusSignals = candidates.filter((item) => item.actionCode === "FOCUS").length;
  const topBoardScore = hotBoards[0]?.score || 0;
  let label = "震荡观察";
  let tone = "neutral";
  let score = Math.round(50 + indexAvg * 8 + strongBoards * 6 + buySignals * 4 + Math.min(15, topBoardScore / 6));

  if (score >= 75) {
    label = "赚钱效应较强";
    tone = "hot";
  } else if (score >= 60) {
    label = "局部赚钱效应";
    tone = "warm";
  } else if (score <= 38) {
    label = "防守优先";
    tone = "cold";
  }

  score = Math.max(0, Math.min(100, score));
  return {
    label,
    tone,
    score,
    indexAvg,
    strongBoards,
    buySignals,
    focusSignals,
    summary: `${label}：指数平均涨跌${signed(indexAvg)}%，强势板块${strongBoards}个，模拟买入信号${buySignals}个。`,
  };
}

function cleanText(text, max = 180) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function pushUniqueWarning(warnings, message) {
  const text = cleanText(message, 240);
  if (!text || warnings.includes(text)) return;
  warnings.push(text);
}

function shanghaiDateTime(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
}

function tradeTimestamp(date = new Date()) {
  return {
    executedAt: date.toISOString(),
    executedAtLocal: shanghaiDateTime(date),
  };
}

function legacyTradeTimestamp(dateText) {
  const parsed = new Date(`${dateText || today}T15:00:00+08:00`);
  return {
    ...tradeTimestamp(Number.isNaN(parsed.getTime()) ? new Date() : parsed),
    timeEstimated: true,
  };
}

function feeConfigSnapshot(config) {
  return {
    commissionRate: config.commissionRate,
    minCommission: config.minCommission,
    transferFeeRate: config.transferFeeRate,
    stampDutyRate: config.stampDutyRate,
    slippageRate: config.slippageRate,
    lotSize: config.lotSize,
  };
}

function slippageCost(side, quotePrice, fillPrice, shares) {
  const diff = side === "SELL" ? Number(quotePrice) - Number(fillPrice) : Number(fillPrice) - Number(quotePrice);
  return Math.max(0, diff * Number(shares || 0));
}

function buildEntryAttribution(item, { marketRegime, strategyVersion }) {
  const factors = [];
  const risks = [];
  if (item.boardName) factors.push(`${item.boardName}板块共振`);
  if (num(item.score) >= 80) factors.push(`高评分${item.score}`);
  else factors.push(`评分${item.score}`);
  if (num(item.amount) >= 1e9) factors.push(`成交额${money(item.amount)}`);
  if (item.llmDecision) factors.push(`模型${item.llmDecision.verdict}，信心${Math.round(item.llmDecision.confidence)}`);
  if (item.decisionContext?.eventSearch?.length) factors.push(`事件搜索${item.decisionContext.eventSearch.length}条`);
  if (item.decisionContext?.fundamentals) factors.push(`财务增强：${item.decisionContext.fundamentals.source}`);
  if (num(item.pct) >= 6) risks.push("涨幅较高，存在追高风险");
  if (item.riskTags?.length) risks.push(...item.riskTags.slice(0, 3));
  if (item.riskGate?.projectedBoardPct) risks.push(`板块预计占比${signed(item.riskGate.projectedBoardPct)}%`);
  return {
    type: "ENTRY",
    strategyVersionId: strategyVersion.id,
    thesis: `${item.name} 属于 ${item.boardName}，本轮纸面买入依据是${factors.slice(0, 3).join("、")}。`,
    factors: [...new Set(factors)].slice(0, 6),
    risks: [...new Set(risks)].slice(0, 6),
    score: item.score,
    ruleScore: item.ruleScore ?? item.score,
    finalScore: item.finalScore ?? item.score,
    marketScore: marketRegime?.score || 0,
    llmVerdict: item.llmDecision?.verdict || "",
    riskGate: item.riskGate || null,
  };
}

function buildExitAttribution(position, { decision, decisionCode, pnlPct, exitPlan, quote }) {
  const trigger =
    decisionCode === "STOP_LOSS"
      ? "动态/固定止损触发"
      : decisionCode === "TAKE_PROFIT"
        ? "动态/固定止盈触发"
        : decisionCode === "TIME_STOP"
          ? "持仓时间过长且收益未兑现"
          : decision;
  return {
    type: "EXIT",
    trigger,
    decisionCode,
    pnlPct: roundPercent(pnlPct),
    heldDays: daysHeld(position),
    exitPlan,
    quotePct: num(quote?.f3),
    lesson:
      pnlPct > 0
        ? "盈利退出，复盘是否卖早或是否符合策略预期。"
        : "亏损/低效退出，复盘买入证据是否不足、是否追高或热点衰退。",
  };
}

async function buildResearchItems(candidates) {
  const items = [];
  for (const item of candidates.slice(0, 18)) {
    const profile = companyProfiles[item.code] || null;
    const survey = profile ? null : await getCompanySurvey(item.code).catch(() => null);
    const fundamentals = item.decisionContext?.fundamentals || null;
    const eventSearch = item.decisionContext?.eventSearch || [];
    const eventHeat = item.decisionContext?.eventHeat || null;
    const fundamentalSummary = summarizeFundamentals(fundamentals);
    const researchScore = Math.round(
      item.score * 0.42 +
        (profile ? 28 : survey ? 22 : 8) +
        (fundamentals ? 8 : 0) +
        (eventSearch.length ? Math.min(8, eventSearch.length * 2 + (eventHeat?.score || 0) / 25) : 0) +
        (item.amount ? Math.min(12, Math.log10(item.amount / 1e8 + 1) * 5) : 0) +
        (item.riskTags?.length ? -item.riskTags.length * 3 : 0),
    );

    const openQuestions = profile
      ? [
          `今天股价变化能否由${profile.profitDrivers.slice(0, 2).join("、")}解释？`,
          `当前风险里最需要验证的是：${profile.riskDrivers[0]}。`,
        ]
      : fundamentals
        ? [
            `已抓取增强财务指标：${fundamentalSummary || fundamentals.source}。`,
            `今天上涨是否能被财务质量和板块共振同时解释？`,
          ]
      : eventSearch.length
        ? [
            `事件搜索显示：${eventHeat?.summary || `检索到${eventSearch.length}条结果`}。`,
            `需要判断这些新闻是实质催化，还是盘后噪音。`,
          ]
      : survey
        ? [
            `已抓取F10概况，但仍需拆主营收入和利润结构。`,
            `今天上涨是否与${survey.industry || item.boardName}板块共振？`,
          ]
      : [
          "公司主营业务尚未进入本地研究库，先不要把它当成可交易标的。",
          "需要补充公告、财报和主营业务后，才允许升级为模拟交易候选。",
        ];

    items.push({
      code: item.code,
      name: item.name,
      boardName: item.boardName,
      action: item.action,
      actionCode: item.actionCode,
      score: item.score,
      researchScore: Math.max(0, Math.min(100, researchScore)),
      price: item.price,
      pct: item.pct,
      amount: item.amount,
      source: item.source,
      profileKnown: Boolean(profile),
      researchStatus:
        profile?.researchStatus ||
        (fundamentals
          ? `已增强财务数据：${fundamentals.source}`
          : eventSearch.length
            ? `已增强事件搜索：${eventHeat?.label || "有搜索结果"}`
            : survey
              ? "已抓取东方财富F10公司概况"
              : "待自动补充公司基本面"),
      business:
        profile?.business ||
        cleanText(survey?.profile || survey?.businessScope) ||
        "待调研：当前只确认了行情、板块和领涨关系，尚未确认主营业务。",
      customers: profile?.customers || (survey ? "待从年报主营构成继续提取" : "待调研"),
      profitDrivers: profile?.profitDrivers || [survey?.industry || item.boardName, "板块热度", "个股涨幅", "成交活跃度", ...(fundamentals?.metrics || []).slice(0, 2).map((metric) => `${metric.name}${formatFinancialMetric(metric)}`), ...(eventHeat?.positive ? [`正向事件词${eventHeat.positive}个`] : [])].filter(Boolean),
      riskDrivers: profile?.riskDrivers || ["主营结构待拆解", "可能是一日游热点", eventHeat?.negative ? `风险事件词${eventHeat.negative}个` : "无法解释上涨原因"],
      researchSource: profile ? "本地研究卡" : fundamentals?.source || (eventSearch.length ? "事件搜索API" : survey?.source || "行情源"),
      financials: fundamentals
        ? {
            source: fundamentals.source,
            summary: fundamentalSummary,
            metrics: (fundamentals.metrics || []).slice(0, 8),
            warnings: fundamentals.warnings || [],
          }
        : null,
      eventSignals: eventSearch.slice(0, 4).map((event) => ({
        title: event.title,
        source: event.source,
        provider: event.provider,
        time: event.time,
        summary: event.summary,
        url: event.url,
      })),
      eventHeat,
      openQuestions,
    });
  }
  return items;
}

function buildStrategyReview(state, candidates, hotBoards, portfolio, config, marketRegime) {
  const closed = state.closedTrades || [];
  const wins = closed.filter((trade) => num(trade.realizedPnlPct) > 0).length;
  const losses = closed.filter((trade) => num(trade.realizedPnlPct) <= 0).length;
  const winRate = closed.length ? (wins / closed.length) * 100 : 0;
  const avgReturn = closed.length
    ? closed.reduce((sum, trade) => sum + num(trade.realizedPnlPct), 0) / closed.length
    : 0;
  const topSignals = candidates.slice(0, 5).map((item) => `${item.name}(${item.action})`);
  const lessons = [];

  if (!closed.length) {
    lessons.push("样本不足：先累计至少20笔模拟交易，再判断策略有效性。");
  }
  if (hotBoards[0]) {
    lessons.push(`当前最强板块是${hotBoards[0].name}，需要连续性验证，避免一日游。`);
  }
  if ((portfolio?.returnPct || 0) < 0) {
    lessons.push("清算净值为负收益，先检查手续费、滑点和追高成本。");
  }
  if (candidates.some((item) => item.riskTags?.includes("接近涨停，追高风险"))) {
    lessons.push("存在接近涨停的候选，实盘学习时要把追高风险单独复盘。");
  }
  const adaptiveRisk = normalizeAdaptiveRiskConfig(config);
  if (adaptiveRisk.enabled) {
    lessons.push("止盈止损已改为动态阈值：基准参数只做锚点，每轮会按市场、模型、风险标签和样本学习修正。");
  }
  const exitExamples = candidates.slice(0, 5).map((item) => ({
    code: item.code,
    name: item.name,
    boardName: item.boardName,
    action: item.action,
    exitPlan: buildAdaptiveExitPlan(
      { code: item.code, boardName: item.boardName, entryDate: today },
      { candidate: item, config, marketRegime, state },
    ),
  }));
  const riskControls = normalizeRiskControlsConfig(config);
  const riskStatus = riskControlStatus(state, config, marketRegime, portfolio);
  const attribution = buildAttributionSummary(state, candidates);

  return {
    sampleCount: closed.length,
    wins,
    losses,
    winRate,
    avgReturn,
    topSignals,
    lessons,
    strategyVersion: buildStrategyVersion(config),
    riskControls: {
      ...riskControls,
      status: riskStatus,
    },
    attribution,
    adaptiveRisk: {
      ...adaptiveRisk,
      learning: state.riskLearning || {},
      examples: exitExamples,
    },
    nextOptimization:
      closed.length < 20
        ? "继续收集样本；动态止盈止损只做小幅修正，不大幅改核心策略。"
        : "按胜率、盈亏比和回撤重新评估买入阈值、止损边界和止盈上限。",
  };
}

function countBy(items, getKey) {
  return items.reduce((acc, item) => {
    const key = getKey(item) || "UNKNOWN";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function candidateCatalysts(item) {
  const catalysts = [];
  if (item.boardName && Number(item.pct || 0) > 0) {
    catalysts.push(`${item.boardName}板块共振，个股${signed(item.pct)}%`);
  }
  for (const news of item.decisionContext?.news?.slice(0, 2) || []) {
    catalysts.push(`新闻：${cleanText(news.title, 80)}`);
  }
  for (const event of item.decisionContext?.eventSearch?.slice(0, 2) || []) {
    catalysts.push(`事件：${cleanText(event.title, 80)}`);
  }
  for (const ann of item.decisionContext?.announcements?.slice(0, 2) || []) {
    catalysts.push(`公告：${cleanText(ann.title, 80)}`);
  }
  return catalysts.slice(0, 3);
}

function buildAttributionSummary(state, candidates) {
  const factorCounts = {};
  const riskCounts = {};
  for (const trade of state.tradeLog || []) {
    if (trade.side !== "BUY") continue;
    for (const factor of trade.attribution?.factors || []) {
      factorCounts[factor] = (factorCounts[factor] || 0) + 1;
    }
    for (const risk of trade.attribution?.risks || []) {
      riskCounts[risk] = (riskCounts[risk] || 0) + 1;
    }
  }
  const exitCounts = countBy(state.closedTrades || [], (trade) => trade.exitAttribution?.trigger || trade.exitReason || "未分类退出");
  const blocked = (candidates || []).filter((item) => item.riskGate?.blocked);
  return {
    topEntryFactors: Object.entries(factorCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, count]) => ({ name, count })),
    topEntryRisks: Object.entries(riskCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, count]) => ({ name, count })),
    exitTriggers: Object.entries(exitCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, count]) => ({ name, count })),
    blockedCount: blocked.length,
    blockedExamples: blocked.slice(0, 5).map((item) => ({
      code: item.code,
      name: item.name,
      reasons: item.riskGate.reasons || [],
    })),
  };
}

function buildDecisionDashboard(payload) {
  const candidates = payload.candidates || [];
  const decisions = payload.llmDecision?.decisions || [];
  const avoidCount = candidates.filter((item) => ["LLM_AVOID", "AVOID"].includes(item.actionCode)).length;
  const buyCount = candidates.filter((item) => item.actionCode === "PAPER_BUY").length;
  const focusCount = candidates.filter((item) => item.actionCode === "FOCUS").length;
  const marketScore = Number(payload.marketRegime?.score || 0);
  const riskRatio = candidates.length ? avoidCount / candidates.length : 0;
  const posture =
    buyCount > 0 && marketScore >= 70 && riskRatio < 0.25
      ? { label: "进攻观察", tone: "attack", reason: "已有模型确认的纸面买入动作，但仍需控制仓位。" }
      : buyCount === 0 && avoidCount > 0
        ? { label: "防守复盘", tone: "defense", reason: "没有模型确认买入，且存在需要规避的高风险候选。" }
        : marketScore >= 45 && riskRatio < 0.45
          ? { label: "均衡等待", tone: "balanced", reason: "市场有结构性机会，但需要确认持续性。" }
          : { label: "防守复盘", tone: "defense", reason: "指数或候选股风险偏高，优先保留现金和复盘。" };

  const riskAlerts = [
    ...(payload.warnings || []).map((item) => `系统：${item}`),
    ...candidates
      .filter((item) => item.llmDecision?.risk || item.riskTags?.length)
      .map((item) => `${item.name}：${item.llmDecision?.risk || item.riskTags.join("、")}`),
    ...(payload.paperDecisions || [])
      .filter((item) => Number(item.pnlPct || 0) <= -2 || Number(item.pnlPct || 0) >= 6)
      .map((item) => `${item.name}持仓浮动${signed(item.pnlPct)}%，检查止盈止损条件。`),
  ]
    .filter(Boolean)
    .map((item) => cleanText(item, 120))
    .slice(0, 8);

  const catalysts = [
    ...(payload.hotBoards || []).slice(0, 4).map((item) => `${item.name}：${signed(item.pct)}%，成交额${money(item.amount)}`),
    ...candidates.flatMap(candidateCatalysts),
  ]
    .filter(Boolean)
    .map((item) => cleanText(item, 110))
    .slice(0, 8);

  const checklist = [
    buyCount ? "模拟买入前确认：模型 verdict 为 BUY，且信心不低于配置阈值。" : "今天没有模型确认的买入动作，不为了参与感强行交易。",
    "接近涨停或大幅高开标的只做复盘观察，不把情绪高潮当成安全边际。",
    "每只候选至少回答：它卖什么、卖给谁、什么因素会让它赚更多或更少。",
    "所有动作仅进入纸面交易账本，实盘前必须重新独立判断。",
  ];

  return {
    headline: payload.llmDecision?.summary || payload.marketRegime?.summary || "等待生成决策仪表盘。",
    posture,
    counts: {
      candidates: candidates.length,
      paperBuy: buyCount,
      focus: focusCount,
      avoid: avoidCount,
      verdicts: countBy(decisions, (item) => item.verdict),
    },
    topActions: candidates.slice(0, 8).map((item) => ({
      code: item.code,
      name: item.name,
      boardName: item.boardName,
      action: item.action,
      actionCode: item.actionCode,
      score: item.score,
      ruleScore: item.ruleScore ?? item.score,
      finalScore: item.finalScore ?? item.score,
      verdict: item.llmDecision?.verdict || "RULE",
      confidence: item.llmDecision?.confidence || 0,
      risk: cleanText(item.llmDecision?.risk || item.riskTags?.join("、") || "", 120),
      researchFocus: cleanText(item.llmDecision?.researchFocus || item.openQuestions?.[0] || "继续观察量价与板块持续性。", 120),
      catalysts: candidateCatalysts(item),
    })),
    riskAlerts,
    catalysts,
    checklist,
  };
}

function buildNotificationPlan(payloadLike) {
  const dashboard = payloadLike.decisionDashboard || buildDecisionDashboard(payloadLike);
  return {
    discord: {
      enabled: false,
      status: "未配置",
      delivery: "不会发送任何外部消息，配置 webhook 并获得确认后才会启用。",
      eventTypes: ["模拟买入", "模拟止盈", "模拟止损", "盘后复盘", "每日学习点"],
    },
    dailyDigest: {
      title: `${payloadLike.date} 决策仪表盘`,
      body: dashboard.headline,
      posture: dashboard.posture,
      counts: dashboard.counts,
      checklist: dashboard.checklist,
    },
    pendingAlerts: [
      ...(payloadLike.candidates || [])
        .filter((item) => ["PAPER_BUY", "FOCUS"].includes(item.actionCode))
        .slice(0, 5)
        .map((item) => ({
          type: item.action,
          title: `${item.name} ${item.code}`,
          body: `${item.boardName}，评分${item.score}，${item.reason}`,
        })),
    ],
  };
}

async function writeDashboard(payload) {
  await fs.writeFile(path.join(dataDir, "dashboard.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function writeReport(payload) {
  await fs.mkdir(reportDir, { recursive: true });
  const lines = [];
  lines.push(`# A股赚钱效应自动复盘：${today}`);
  lines.push("");
  lines.push("说明：本报告用于学习和模拟交易，不构成投资建议。");
  lines.push(`账户：${payload.account?.name || "系统全局"}`);
  lines.push("");
  lines.push("## 决策仪表盘");
  lines.push(`- 核心结论：${payload.decisionDashboard?.headline || "等待生成。"}`);
  lines.push(`- 仓位姿态：${payload.decisionDashboard?.posture?.label || "未知"}；${payload.decisionDashboard?.posture?.reason || ""}`);
  lines.push(
    `- 信号统计：候选${payload.decisionDashboard?.counts?.candidates || 0}，模拟买入${payload.decisionDashboard?.counts?.paperBuy || 0}，重点观察${payload.decisionDashboard?.counts?.focus || 0}，规避${payload.decisionDashboard?.counts?.avoid || 0}`,
  );
  for (const item of payload.decisionDashboard?.riskAlerts?.slice(0, 5) || []) lines.push(`- 风险：${item}`);
  for (const item of payload.decisionDashboard?.checklist?.slice(0, 4) || []) lines.push(`- 检查：${item}`);
  lines.push("");
  lines.push("## 增强数据源");
  lines.push(`- 状态：${payload.dataProviders?.status || "unknown"}；覆盖${payload.dataProviders?.resultCount || 0}只候选。`);
  for (const [name, provider] of Object.entries(payload.dataProviders?.providers || {})) {
    lines.push(`- ${name}：${provider.enabled ? "启用" : "关闭"} / ${provider.available ? "可用" : "不可用"} / ${provider.status || ""}`);
  }
  lines.push("");
  lines.push("## 事件搜索");
  lines.push(`- 状态：${payload.eventSearch?.status || "unknown"}；结果${payload.eventSearch?.resultCount || 0}条，真实请求${payload.eventSearch?.queryCount || 0}次，缓存命中${payload.eventSearch?.cachedCount || 0}次。`);
  for (const [name, provider] of Object.entries(payload.eventSearch?.providers || {})) {
    lines.push(`- ${name}：${provider.enabled ? "启用" : "关闭"} / ${provider.configured ? "已配置Key" : "未配置Key"} / ${provider.available ? "可用" : "不可用"} / ${provider.status || ""}`);
  }
  lines.push("");
  lines.push("## 市场状态");
  lines.push(`- ${payload.marketRegime.summary}`);
  lines.push(`- 清算净值：${money(payload.portfolio.netLiquidation)}，收益率${signed(payload.portfolio.returnPct)}%，累计费用${money(payload.portfolio.totalFees)}。`);
  lines.push("");
  lines.push("## 市场温度");
  for (const index of payload.indexes) {
    lines.push(`- ${index.name}：${index.price.toFixed(2)}，${signed(index.change)}，${signed(index.pct)}%`);
  }
  lines.push("");
  lines.push("## 热门板块");
  for (const board of payload.hotBoards.slice(0, 5)) {
    lines.push(`- ${board.name}：${signed(board.pct)}%，成交额${money(board.amount)}，评分${board.score}，来源${board.source}`);
  }
  if (!payload.hotBoards.length) {
    lines.push("- 真实行业板块数据源暂时不可用，本次不生成热门板块结论。");
  }
  lines.push("");
  lines.push("## 今日候选");
  for (const stock of payload.candidates.slice(0, 10)) {
    const llm = stock.llmDecision ? `，模型${stock.llmDecision.verdict}/信心${Math.round(stock.llmDecision.confidence)}` : "";
    lines.push(`- ${stock.name} ${stock.code}：${stock.action}，评分${stock.score}${llm}，${stock.reason}`);
    for (const news of stock.decisionContext?.news?.slice(0, 2) || []) {
      lines.push(`  - 新闻：${news.title}（${news.media || news.source}，${news.time || "时间未知"}）`);
    }
    if (stock.decisionContext?.eventHeat) {
      lines.push(`  - 事件热度：${stock.decisionContext.eventHeat.summary}`);
    }
    for (const event of stock.decisionContext?.eventSearch?.slice(0, 2) || []) {
      lines.push(`  - 搜索：${event.title}（${event.source || event.provider}，${event.time || "时间未知"}）`);
    }
    for (const ann of stock.decisionContext?.announcements?.slice(0, 2) || []) {
      lines.push(`  - 公告：${ann.title}（${ann.source}，${ann.time || "时间未知"}）`);
    }
  }
  lines.push("");
  lines.push("## 大模型决策");
  lines.push(`- 状态：${payload.llmDecision?.status || "unknown"}；${payload.llmDecision?.summary || "未开启。"}`);
  if (payload.llmDecision?.marketRead) lines.push(`- 市场判断：${payload.llmDecision.marketRead}`);
  for (const advice of payload.llmDecision?.parameterAdvice || []) {
    lines.push(`- 参数建议：${advice}`);
  }
  lines.push("");
  lines.push("## 模拟持仓复盘");
  if (!payload.paperDecisions.length) {
    lines.push("- 暂无模拟持仓。");
  } else {
    for (const item of payload.paperDecisions) {
      lines.push(
        `- ${item.name} ${item.code}：${item.decision}，入场${item.entryPrice.toFixed(2)}，最新${item.latestPrice.toFixed(2)}，模拟收益${signed(item.pnlPct)}%`,
      );
    }
  }
  lines.push("");
  lines.push("## 自动调研重点");
  for (const item of payload.researchItems.slice(0, 6)) {
    lines.push(`- ${item.name} ${item.code}：${item.researchStatus}；业务：${item.business}`);
    if (item.financials?.summary) lines.push(`  - 财务：${item.financials.summary}`);
    if (item.eventHeat?.summary) lines.push(`  - 事件：${item.eventHeat.summary}`);
  }
  lines.push("");
  lines.push("## 策略学习");
  lines.push(`- 已关闭样本：${payload.strategyReview.sampleCount}，胜率${signed(payload.strategyReview.winRate)}%，平均收益${signed(payload.strategyReview.avgReturn)}%。`);
  for (const lesson of payload.strategyReview.lessons) {
    lines.push(`- ${lesson}`);
  }
  lines.push("");
  lines.push("## 明日问题");
  lines.push("1. 热门板块是否继续强，还是一日游？");
  lines.push("2. 模拟买入信号是否来自板块共振，而不是单只票孤立上涨？");
  lines.push("3. 如果出现亏损，失效条件是否触发？");
  await fs.writeFile(path.join(reportDir, `${today}.md`), `${lines.join("\n")}\n`, "utf8");
}

async function main() {
  const releaseGeneratorLock = await acquireGeneratorLock();
  try {
  await fs.mkdir(dataDir, { recursive: true });
  const config = await readTradingConfig();
  const state = ensureState(await readState(), config);
  const warnings = [];
  const indexRows = await getQuotes(indexes.map((item) => item.secid).join(","));
  const marketDataFresh = indexRows.some((row) => num(row.f297) === compactDate(today));
  const effectivePaperTradingEnabled = paperTradingEnabled && marketDataFresh;
  if (paperTradingEnabled && !marketDataFresh) {
    pushUniqueWarning(warnings, "行情日期不是今天，已禁止本轮纸面买卖，避免使用旧行情。");
  }
  const boards = await getBoards(1, 30, warnings).catch((error) => {
    pushUniqueWarning(warnings, `全部真实行业板块数据源失败：${error.message}`);
    return [];
  });
  const weakBoards = await getBoards(0, 10, warnings).catch(() => []);

  const hotBoards = boards.slice(0, 8).map((row) => ({
    code: row.f12,
    name: row.f14,
    pct: num(row.f3),
    price: num(row.f2),
    amount: num(row.f6),
    mainNet: hasNumber(row.f62) ? num(row.f62) : null,
    score: scoreBoard(row),
    source: row.provider || "行情接口",
    leader: row.leader || null,
  }));

  const stockGroups = [];
  for (const board of boards.slice(0, 6)) {
    const leader = getSinaLeaderStock(board);
    if (leader) {
      stockGroups.push(scoreStock(leader, board, learningBiasFor(state, board.f14), config));
      continue;
    }
    try {
      const rows = await getBoardStocks(board.f12, 12);
      stockGroups.push(...rows.map((stock) => scoreStock(stock, board, learningBiasFor(state, board.f14), config)));
    } catch {
      // Ignore a single board failure; the dashboard should still be usable.
    }
  }

  const universe = configuredUniverse(config);
  const universeQuotes = await getQuotes(universe.map((item) => secidFromCode(item.code)).join(",")).catch(() => []);
  const universeConfig = new Map(universe.map((item) => [item.code, item]));
  for (const quote of universeQuotes) {
    const stockConfig = universeConfig.get(String(quote.f12));
    if (!stockConfig) continue;
    const board = boardForUniverseStock(stockConfig, hotBoards);
    stockGroups.push({
      ...scoreStock(quote, board, learningBiasFor(state, board.f14), config),
      source: stockConfig.source || quote.provider || "行情接口",
    });
  }

  const unique = new Map();
  for (const stock of stockGroups) {
    if (!unique.has(stock.code) || unique.get(stock.code).score < stock.score) {
      unique.set(stock.code, stock);
    }
  }
  const ruleCandidates = [...unique.values()]
    .filter((item) => item.actionCode !== "AVOID")
    .sort((a, b) => b.score - a.score)
    .slice(0, 30);
  const contextPack = await buildDecisionContexts(config, ruleCandidates, warnings);
  const decisionContexts = contextPack.contextByCode;
  const enrichedRuleCandidates = ruleCandidates.map((item) => ({
    ...item,
    decisionContext: decisionContexts.get(item.code) || null,
  }));
  const llmDecision = await buildLlmDecisionPack(config, enrichedRuleCandidates, hotBoards, indexRows, state, warnings, decisionContexts);
  const strategyVersion = buildStrategyVersion(config);
  const llmAdjustedCandidates = applyLlmDecisionLayer(enrichedRuleCandidates, llmDecision, config);
  const preliminaryMarketRegime = buildMarketRegime(indexRows, hotBoards, llmAdjustedCandidates);
  const candidates = applyPortfolioConstraints(llmAdjustedCandidates, state, config, preliminaryMarketRegime);
  const marketRegime = buildMarketRegime(indexRows, hotBoards, candidates);

  const paperDecisions = await updatePaperBook(state, candidates, config, effectivePaperTradingEnabled, marketRegime, strategyVersion);
  await writeState(state);
  const openPositions = state.positions.filter((p) => p.status === "OPEN");
  const marketValue = openPositions.reduce((sum, position) => sum + (position.latestPrice || position.entryPrice || 0) * (position.shares || 0), 0);
  const estimatedExitValue = openPositions.reduce((sum, position) => {
    const price = sellFillPrice(position.latestPrice || position.entryPrice || 0, config);
    const fees = calcSellFees(price, position.shares || 0, config);
    return sum + price * (position.shares || 0) - fees.total;
  }, 0);
  const unrealizedPnl = openPositions.reduce((sum, position) => sum + (position.unrealizedPnl || 0), 0);
  const equity = state.portfolio.cash + marketValue;
  const netLiquidation = state.portfolio.cash + estimatedExitValue;
  const portfolioSummary = {
    initialCash: state.portfolio.initialCash,
    cash: state.portfolio.cash,
    marketValue,
    equity,
    netLiquidation,
    realizedPnl: state.portfolio.realizedPnl,
    unrealizedPnl,
    totalFees: state.portfolio.totalFees,
    returnPct: state.portfolio.initialCash ? ((netLiquidation - state.portfolio.initialCash) / state.portfolio.initialCash) * 100 : 0,
  };
  state.portfolio.peakNetLiquidation = Math.max(
    num(state.portfolio.peakNetLiquidation, state.portfolio.initialCash),
    netLiquidation,
    state.portfolio.initialCash,
  );
  state.portfolio.currentDrawdownPct = state.portfolio.peakNetLiquidation
    ? ((state.portfolio.peakNetLiquidation - netLiquidation) / state.portfolio.peakNetLiquidation) * 100
    : 0;
  await writeState(state);
  const researchItems = await buildResearchItems(candidates);
  const strategyReview = buildStrategyReview(state, candidates, hotBoards, portfolioSummary, config, marketRegime);

  const payload = {
    date: today,
    generatedAt: new Date().toISOString(),
    account: {
      id: process.env.A_SHARE_ACCOUNT_ID || "legacy",
      name: process.env.A_SHARE_ACCOUNT_NAME || "系统全局",
    },
    disclaimer: "学习与模拟交易工具，不构成投资建议，不自动下单。",
    paperTradingEnabled: effectivePaperTradingEnabled,
    warnings,
    strategyVersion,
    marketRegime,
    feeConfig: {
      commissionRate: config.commissionRate,
      minCommission: config.minCommission,
      transferFeeRate: config.transferFeeRate,
      stampDutyRate: config.stampDutyRate,
      slippageRate: config.slippageRate,
    },
    adaptiveRisk: normalizeAdaptiveRiskConfig(config),
    riskControls: {
      ...normalizeRiskControlsConfig(config),
      status: riskControlStatus(state, config, marketRegime, portfolioSummary),
    },
    indexes: indexRows.map((row) => ({
      code: row.f12,
      name: row.f14,
      price: num(row.f2),
      change: num(row.f4),
      pct: num(row.f3),
      amount: num(row.f6),
      tradeDate: row.f297 || null,
      source: row.provider || "行情接口",
    })),
    hotBoards,
    weakBoards: weakBoards.slice(0, 5).map((row) => ({
      code: row.f12,
      name: row.f14,
      pct: num(row.f3),
      amount: num(row.f6),
    })),
    dataProviders: contextPack.dataProviders,
    eventSearch: contextPack.eventSearch,
    universe: {
      total: universe.length,
      custom: universe.filter((item) => item.source === "自选股池").length,
      items: universe.slice(0, 30),
    },
    candidates,
    researchItems,
    portfolio: portfolioSummary,
    paperPositions: openPositions,
    paperDecisions,
    tradeLog: state.tradeLog.slice(-50),
    strategyReview,
    learning: state.learning,
    llmDecision,
  };
  payload.decisionDashboard = buildDecisionDashboard(payload);
  payload.notifications = buildNotificationPlan(payload);

  await writeDashboard(payload);
  await writeReport(payload);
  console.log(`Generated A-share research dashboard for ${today}`);
  } finally {
    await releaseGeneratorLock();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
