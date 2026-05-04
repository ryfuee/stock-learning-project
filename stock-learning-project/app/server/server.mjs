import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  createPaperAccount,
  getAuthContext,
  initAuthStore,
  loginUser,
  logoutUser,
  selectPaperAccount,
  setupAdmin,
} from "./auth-store.mjs";
import {
  accountRuntimePaths,
  ensureAccountRuntime,
  legacyRuntimePaths,
  scriptEnvForAccount,
} from "./account-runtime.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");
const publicDir = path.join(appRoot, "public");
const runtimeDir = process.env.A_SHARE_RUNTIME_DIR || appRoot;
const notificationExampleFile = path.join(appRoot, "notification-config.example.json");
const legacyPaths = legacyRuntimePaths({ appRoot, runtimeDir });
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
const defaultLlmConfig = {
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
};
const defaultContextConfig = {
  enabled: true,
  includeNews: true,
  includeAnnouncements: true,
  includeF10: true,
  maxNews: 6,
  maxAnnouncements: 4,
  timeoutMs: 8000,
};
const defaultWatchlistText = "";
const defaultAdaptiveRiskConfig = {
  enabled: true,
  minStopLossPct: -9,
  maxStopLossPct: -2.5,
  minTakeProfitPct: 4,
  maxTakeProfitPct: 18,
};
const defaultRiskControlsConfig = {
  enabled: true,
  maxBoardExposurePct: 0.45,
  maxAccountDrawdownPct: 6,
  pauseAfterLossStreak: 3,
  chasePctLimit: 7.5,
  minAmount: 500000000,
  timeStopDays: 7,
  timeStopMinProfitPct: 1,
};
const defaultDataProviderConfig = {
  enabled: true,
  useAkshare: true,
  useBaostock: true,
  useTushare: false,
  maxCandidates: 8,
  timeoutMs: 30000,
  pythonBin: "python3",
};
const defaultEventSearchConfig = {
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
};
const providerDefaultBaseUrl = {
  "openai-chat": "https://api.openai.com/v1",
  "openai-responses": "https://api.openai.com/v1",
  "openai-compatible": "https://api.openai.com/v1",
  "z-ai-chat": "https://api.z.ai/api/coding/paas/v4",
  "anthropic-messages": "https://api.anthropic.com",
};
const updateInFlight = new Map();
const backtestInFlight = new Map();
const optimizerInFlight = new Map();
const decisionAgentInFlight = new Map();
const parameterSweepInFlight = new Map();
const strategyLabInFlight = new Map();

await initAuthStore({ runtimeDir });

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function send(res, status, body, contentType = "text/plain; charset=utf-8", headers = {}) {
  res.writeHead(status, { ...headers, "Content-Type": contentType, "Cache-Control": "no-store" });
  res.end(body);
}

function shouldSeedLegacy(auth) {
  return Boolean(auth?.currentAccount?.id && auth.accounts?.[0]?.id === auth.currentAccount.id);
}

async function pathsForAuth(auth) {
  const paths = accountRuntimePaths({ runtimeDir, account: auth.currentAccount });
  await ensureAccountRuntime(paths, legacyPaths, { seedLegacy: shouldSeedLegacy(auth) });
  return paths;
}

async function ensureAuthRuntimePayload(payload) {
  if (!payload?.authenticated || !payload.currentAccount) return payload;
  const paths = accountRuntimePaths({ runtimeDir, account: payload.currentAccount });
  await ensureAccountRuntime(paths, legacyPaths, { seedLegacy: payload.accounts?.[0]?.id === payload.currentAccount.id });
  return payload;
}

async function readJson(file, fallback = {}) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function readBodyJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return {};
  return JSON.parse(text);
}

async function readLlmSecrets(paths = legacyPaths) {
  return readJson(paths.llmSecretConfigFile, { llm: {} });
}

function maskSecret(value) {
  if (!value) return "";
  const text = String(value);
  if (text.length <= 12) return "已配置";
  return `${text.slice(0, 8)}...${text.slice(-4)}`;
}

function providerEnvApiKey(provider) {
  if (provider === "z-ai-chat") return process.env.ZAI_API_KEY || "";
  if (provider === "anthropic-messages") return process.env.ANTHROPIC_API_KEY || "";
  return (
    process.env.OPENAI_API_KEY ||
    process.env.ARK_API_KEY ||
    process.env.MOONSHOT_API_KEY ||
    process.env.ZHIPUAI_API_KEY ||
    ""
  );
}

function resolveLlmApiKey(provider, secrets) {
  const envApiKey = process.env.LLM_API_KEY || providerEnvApiKey(provider);
  if (envApiKey) return { value: envApiKey, source: "env" };
  const savedApiKey = secrets?.llm?.apiKey || "";
  if (savedApiKey) return { value: savedApiKey, source: "page" };
  return { value: "", source: "" };
}

function eventSearchEnvApiKey(name) {
  return {
    bocha: process.env.BOCHA_API_KEY || "",
    tavily: process.env.TAVILY_API_KEY || "",
    serpApi: process.env.SERPAPI_API_KEY || "",
    anspire: process.env.ANSPIRE_API_KEY || "",
  }[name] || "";
}

function eventSearchSecretField(name) {
  return {
    bocha: "bochaApiKey",
    tavily: "tavilyApiKey",
    serpApi: "serpApiKey",
    anspire: "anspireApiKey",
  }[name] || `${name}ApiKey`;
}

function eventSearchClearField(name) {
  return {
    bocha: "clearBochaApiKey",
    tavily: "clearTavilyApiKey",
    serpApi: "clearSerpApiKey",
    anspire: "clearAnspireApiKey",
  }[name] || `clear${name[0]?.toUpperCase() || ""}${name.slice(1)}ApiKey`;
}

function resolveEventSearchApiKey(name, secrets) {
  const envApiKey = eventSearchEnvApiKey(name);
  if (envApiKey) return { value: envApiKey, source: "env" };
  const field = eventSearchSecretField(name);
  const savedApiKey = secrets?.eventSearch?.[field] || "";
  if (savedApiKey) return { value: savedApiKey, source: "page" };
  return { value: "", source: "" };
}

function eventSearchKeyMeta(secrets) {
  return Object.fromEntries(
    ["bocha", "tavily", "serpApi", "anspire"].map((name) => {
      const key = resolveEventSearchApiKey(name, secrets);
      return [
        name,
        {
          configured: Boolean(key.value),
          preview: maskSecret(key.value),
          source: key.source,
        },
      ];
    }),
  );
}

function normalizeLlmProvider(provider, baseUrl, model) {
  if (String(baseUrl || "").includes("api.z.ai") || /^glm-/i.test(String(model || ""))) return "z-ai-chat";
  return provider || defaultLlmConfig.provider;
}

function providerEnvBaseUrl(provider) {
  if (provider === "z-ai-chat") return process.env.ZAI_BASE_URL || "";
  if (provider === "anthropic-messages") return process.env.ANTHROPIC_BASE_URL || "";
  return process.env.OPENAI_BASE_URL || "";
}

function resolveLlmBaseUrl(provider, configuredBaseUrl = "") {
  const baseUrl = process.env.LLM_BASE_URL || providerEnvBaseUrl(provider) || configuredBaseUrl || "";
  const resolved =
    provider === "anthropic-messages" && baseUrl === defaultLlmConfig.baseUrl
      ? providerDefaultBaseUrl[provider]
      : baseUrl || providerDefaultBaseUrl[provider] || defaultLlmConfig.baseUrl;
  return String(resolved).replace(/\/+$/, "");
}

async function getLlmRuntime(input = {}, paths = legacyPaths) {
  const tradingRaw = await readJson(paths.tradingConfigFile, {});
  const llmSecrets = await readLlmSecrets(paths);
  const inputLlm = sanitizeLlmConfig(input.trading?.llm || {});
  const llm = { ...defaultLlmConfig, ...(tradingRaw.llm || {}), ...inputLlm };
  const provider = normalizeLlmProvider(llm.provider, llm.baseUrl, llm.model);
  const submittedApiKey = typeof input.secrets?.llm?.apiKey === "string" ? input.secrets.llm.apiKey.trim() : "";
  const secretsForLookup = input.secrets?.llm?.clearApiKey ? { llm: {} } : llmSecrets;
  const apiKey = submittedApiKey ? { value: submittedApiKey, source: "form" } : resolveLlmApiKey(provider, secretsForLookup);
  return {
    tradingRaw,
    tradingSecrets: llmSecrets,
    llm,
    provider,
    baseUrl: resolveLlmBaseUrl(provider, llm.baseUrl),
    model: process.env.LLM_MODEL || llm.model || "",
    apiKey: apiKey.value,
    apiKeySource: apiKey.source,
  };
}

function sanitizeTradingConfig(input) {
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const numberFields = [
    "initialCash",
    "maxPositions",
    "maxPositionPct",
    "buyScoreThreshold",
    "stopLossPct",
    "takeProfitPct",
    "commissionRate",
    "minCommission",
    "transferFeeRate",
    "stampDutyRate",
    "slippageRate",
    "lotSize",
    "pollSeconds",
  ];
  const result = {};
  for (const field of numberFields) {
    if (input[field] === undefined || input[field] === "") continue;
    const value = Number(input[field]);
    if (Number.isFinite(value)) result[field] = value;
  }

  if (result.initialCash !== undefined) result.initialCash = Math.max(1000, result.initialCash);
  if (result.maxPositions !== undefined) result.maxPositions = Math.max(1, Math.min(50, Math.round(result.maxPositions)));
  if (result.maxPositionPct !== undefined) result.maxPositionPct = clamp(result.maxPositionPct, 0.01, 1);
  if (result.buyScoreThreshold !== undefined) result.buyScoreThreshold = clamp(result.buyScoreThreshold, 0, 100);
  if (result.stopLossPct !== undefined) result.stopLossPct = clamp(result.stopLossPct, -99, -0.1);
  if (result.takeProfitPct !== undefined) result.takeProfitPct = clamp(result.takeProfitPct, 0.1, 300);
  if (result.commissionRate !== undefined) result.commissionRate = clamp(result.commissionRate, 0, 0.05);
  if (result.minCommission !== undefined) result.minCommission = Math.max(0, result.minCommission);
  if (result.transferFeeRate !== undefined) result.transferFeeRate = clamp(result.transferFeeRate, 0, 0.05);
  if (result.stampDutyRate !== undefined) result.stampDutyRate = clamp(result.stampDutyRate, 0, 0.05);
  if (result.slippageRate !== undefined) result.slippageRate = clamp(result.slippageRate, 0, 0.05);
  if (result.lotSize !== undefined) result.lotSize = Math.max(1, Math.round(result.lotSize));
  if (result.pollSeconds !== undefined) result.pollSeconds = clamp(Math.round(result.pollSeconds), 15, 86400);
  if (typeof input.watchlistText === "string") {
    result.watchlistText = input.watchlistText.trim().slice(0, 12000);
  }
  if (typeof input.activeStrategy === "string" && ["momentum-score", "turtle"].includes(input.activeStrategy)) {
    result.activeStrategy = input.activeStrategy;
  }

  return result;
}

function sanitizeAdaptiveRiskConfig(input) {
  const result = {};
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  if (input.enabled !== undefined) result.enabled = Boolean(input.enabled);
  for (const field of ["minStopLossPct", "maxStopLossPct"]) {
    if (input[field] !== undefined && Number.isFinite(Number(input[field]))) {
      result[field] = clamp(Number(input[field]), -30, -0.1);
    }
  }
  for (const field of ["minTakeProfitPct", "maxTakeProfitPct"]) {
    if (input[field] !== undefined && Number.isFinite(Number(input[field]))) {
      result[field] = clamp(Number(input[field]), 0.5, 100);
    }
  }
  if (result.minStopLossPct !== undefined && result.maxStopLossPct !== undefined) {
    const lower = Math.min(result.minStopLossPct, result.maxStopLossPct);
    const upper = Math.max(result.minStopLossPct, result.maxStopLossPct);
    result.minStopLossPct = lower;
    result.maxStopLossPct = upper;
  }
  if (result.minTakeProfitPct !== undefined && result.maxTakeProfitPct !== undefined) {
    const lower = Math.min(result.minTakeProfitPct, result.maxTakeProfitPct);
    const upper = Math.max(result.minTakeProfitPct, result.maxTakeProfitPct);
    result.minTakeProfitPct = lower;
    result.maxTakeProfitPct = upper;
  }
  return result;
}

function sanitizeRiskControlsConfig(input) {
  const result = {};
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  if (input.enabled !== undefined) result.enabled = Boolean(input.enabled);
  const ranges = {
    maxBoardExposurePct: [0.1, 1],
    maxAccountDrawdownPct: [1, 80],
    pauseAfterLossStreak: [1, 20],
    chasePctLimit: [1, 20],
    minAmount: [0, 1e11],
    timeStopDays: [1, 60],
    timeStopMinProfitPct: [-10, 20],
  };
  for (const [field, [min, max]] of Object.entries(ranges)) {
    if (input[field] !== undefined && Number.isFinite(Number(input[field]))) {
      const value = ["pauseAfterLossStreak", "timeStopDays"].includes(field)
        ? Math.round(Number(input[field]))
        : Number(input[field]);
      result[field] = clamp(value, min, max);
    }
  }
  return result;
}

function sanitizeLlmConfig(input) {
  const result = {};
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  if (input.enabled !== undefined) result.enabled = Boolean(input.enabled);
  if (typeof input.decisionMode === "string" && ["advisory", "score", "score_veto"].includes(input.decisionMode)) {
    result.decisionMode = input.decisionMode;
  }
  if (
    typeof input.provider === "string" &&
    ["openai-compatible", "openai-chat", "openai-responses", "anthropic-messages", "z-ai-chat"].includes(input.provider)
  ) {
    result.provider = input.provider;
  }
  if (typeof input.baseUrl === "string") result.baseUrl = input.baseUrl.trim();
  if (typeof input.model === "string") result.model = input.model.trim();
  if (input.maxCandidates !== undefined && Number.isFinite(Number(input.maxCandidates))) {
    result.maxCandidates = clamp(Math.round(Number(input.maxCandidates)), 1, 12);
  }
  if (input.scoreImpact !== undefined && Number.isFinite(Number(input.scoreImpact))) {
    result.scoreImpact = clamp(Number(input.scoreImpact), 0, 20);
  }
  if (input.minConfidence !== undefined && Number.isFinite(Number(input.minConfidence))) {
    result.minConfidence = clamp(Number(input.minConfidence), 0, 100);
  }
  if (input.requireBuyApproval !== undefined) result.requireBuyApproval = Boolean(input.requireBuyApproval);
  if (input.temperature !== undefined && Number.isFinite(Number(input.temperature))) {
    result.temperature = clamp(Number(input.temperature), 0, 1);
  }
  if (input.timeoutMs !== undefined && Number.isFinite(Number(input.timeoutMs))) {
    result.timeoutMs = clamp(Math.round(Number(input.timeoutMs)), 5000, 180000);
  }
  return result;
}

function sanitizeContextConfig(input) {
  const result = {};
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  for (const field of ["enabled", "includeNews", "includeAnnouncements", "includeF10"]) {
    if (input[field] !== undefined) result[field] = Boolean(input[field]);
  }
  if (input.maxNews !== undefined && Number.isFinite(Number(input.maxNews))) {
    result.maxNews = clamp(Math.round(Number(input.maxNews)), 0, 20);
  }
  if (input.maxAnnouncements !== undefined && Number.isFinite(Number(input.maxAnnouncements))) {
    result.maxAnnouncements = clamp(Math.round(Number(input.maxAnnouncements)), 0, 10);
  }
  if (input.timeoutMs !== undefined && Number.isFinite(Number(input.timeoutMs))) {
    result.timeoutMs = clamp(Math.round(Number(input.timeoutMs)), 2000, 30000);
  }
  return result;
}

function sanitizeDataProviderConfig(input) {
  const result = {};
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  for (const field of ["enabled", "useAkshare", "useBaostock", "useTushare"]) {
    if (input[field] !== undefined) result[field] = Boolean(input[field]);
  }
  if (input.maxCandidates !== undefined && Number.isFinite(Number(input.maxCandidates))) {
    result.maxCandidates = clamp(Math.round(Number(input.maxCandidates)), 1, 20);
  }
  if (input.timeoutMs !== undefined && Number.isFinite(Number(input.timeoutMs))) {
    result.timeoutMs = clamp(Math.round(Number(input.timeoutMs)), 3000, 60000);
  }
  if (typeof input.pythonBin === "string") {
    result.pythonBin = input.pythonBin.trim().slice(0, 120) || defaultDataProviderConfig.pythonBin;
  }
  return result;
}

function sanitizeEventSearchConfig(input) {
  const result = {};
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  for (const field of ["enabled", "useBocha", "useTavily", "useSerpApi", "useAnspire"]) {
    if (input[field] !== undefined) result[field] = Boolean(input[field]);
  }
  if (input.maxCandidates !== undefined && Number.isFinite(Number(input.maxCandidates))) {
    result.maxCandidates = clamp(Math.round(Number(input.maxCandidates)), 1, 12);
  }
  if (input.maxQueriesPerStock !== undefined && Number.isFinite(Number(input.maxQueriesPerStock))) {
    result.maxQueriesPerStock = clamp(Math.round(Number(input.maxQueriesPerStock)), 1, 4);
  }
  if (input.resultsPerQuery !== undefined && Number.isFinite(Number(input.resultsPerQuery))) {
    result.resultsPerQuery = clamp(Math.round(Number(input.resultsPerQuery)), 1, 10);
  }
  if (typeof input.freshness === "string" && ["oneDay", "oneWeek", "oneMonth", "oneYear", "noLimit"].includes(input.freshness)) {
    result.freshness = input.freshness;
  }
  if (input.timeoutMs !== undefined && Number.isFinite(Number(input.timeoutMs))) {
    result.timeoutMs = clamp(Math.round(Number(input.timeoutMs)), 3000, 30000);
  }
  if (input.cacheHours !== undefined && Number.isFinite(Number(input.cacheHours))) {
    result.cacheHours = clamp(Number(input.cacheHours), 0, 72);
  }
  return result;
}

async function getConfigPayload(paths = legacyPaths) {
  const runtime = await getLlmRuntime({}, paths);
  const tradingRaw = runtime.tradingRaw;
  const trading = {
    watchlistText: defaultWatchlistText,
    ...tradingRaw,
    llm: {
      ...defaultLlmConfig,
      ...(tradingRaw.llm || {}),
      provider: runtime.provider,
      apiKeyConfigured: Boolean(runtime.apiKey),
      apiKeyPreview: maskSecret(runtime.apiKey),
      apiKeySource: runtime.apiKeySource,
      effectiveModel: runtime.model,
      effectiveBaseUrl: runtime.baseUrl,
    },
    adaptiveRisk: {
      ...defaultAdaptiveRiskConfig,
      ...(tradingRaw.adaptiveRisk || {}),
    },
    riskControls: {
      ...defaultRiskControlsConfig,
      ...(tradingRaw.riskControls || {}),
    },
    context: {
      ...defaultContextConfig,
      ...(tradingRaw.context || {}),
    },
    dataProviders: {
      ...defaultDataProviderConfig,
      ...(tradingRaw.dataProviders || {}),
      tushareTokenConfigured: Boolean(process.env.TUSHARE_TOKEN || runtime.tradingSecrets?.dataProviders?.tushareToken),
      tushareTokenPreview: maskSecret(process.env.TUSHARE_TOKEN || runtime.tradingSecrets?.dataProviders?.tushareToken || ""),
      tushareTokenSource: process.env.TUSHARE_TOKEN ? "env" : runtime.tradingSecrets?.dataProviders?.tushareToken ? "page" : "",
    },
    eventSearch: {
      ...defaultEventSearchConfig,
      ...(tradingRaw.eventSearch || {}),
      keys: eventSearchKeyMeta(runtime.tradingSecrets),
    },
  };
  const notificationDefault = await readJson(notificationExampleFile, { discord: { enabled: false, webhookUrl: "", events: {} } });
  const notification = await readJson(paths.notificationConfigFile, notificationDefault);
  const webhook = notification?.discord?.webhookUrl || "";
  return {
    account: {
      id: paths.accountId || "",
      name: paths.accountName || "系统全局",
      runtimeKey: paths.runtimeKey || "",
    },
    trading,
    notification: {
      discord: {
        enabled: Boolean(notification?.discord?.enabled),
        webhookConfigured: Boolean(webhook),
        webhookPreview: maskSecret(webhook),
        events: notification?.discord?.events || notificationDefault.discord.events,
      },
    },
  };
}

async function saveConfig(input, paths = legacyPaths) {
  const payload = input || {};
  await fs.mkdir(paths.runtimeDir, { recursive: true });
  const existingTrading = await readJson(paths.tradingConfigFile, {});
  const existingSecrets = await readLlmSecrets(paths);
  const existingNotification = await readJson(paths.notificationConfigFile, await readJson(notificationExampleFile, {}));
  const tradingInput = payload.trading || {};
  const trading = {
    ...existingTrading,
    ...sanitizeTradingConfig(tradingInput),
    llm: {
      ...defaultLlmConfig,
      ...(existingTrading.llm || {}),
      ...sanitizeLlmConfig(tradingInput.llm || {}),
    },
    adaptiveRisk: {
      ...defaultAdaptiveRiskConfig,
      ...(existingTrading.adaptiveRisk || {}),
      ...sanitizeAdaptiveRiskConfig(tradingInput.adaptiveRisk || {}),
    },
    riskControls: {
      ...defaultRiskControlsConfig,
      ...(existingTrading.riskControls || {}),
      ...sanitizeRiskControlsConfig(tradingInput.riskControls || {}),
    },
    context: {
      ...defaultContextConfig,
      ...(existingTrading.context || {}),
      ...sanitizeContextConfig(tradingInput.context || {}),
    },
    dataProviders: {
      ...defaultDataProviderConfig,
      ...(existingTrading.dataProviders || {}),
      ...sanitizeDataProviderConfig(tradingInput.dataProviders || {}),
    },
    eventSearch: {
      ...defaultEventSearchConfig,
      ...(existingTrading.eventSearch || {}),
      ...sanitizeEventSearchConfig(tradingInput.eventSearch || {}),
    },
  };
  trading.llm.provider = normalizeLlmProvider(trading.llm.provider, trading.llm.baseUrl, trading.llm.model);

  const discordInput = payload.notification?.discord || {};
  const existingDiscord = existingNotification.discord || {};
  const events = { ...(existingDiscord.events || {}) };
  for (const [key, value] of Object.entries(discordInput.events || {})) {
    events[key] = Boolean(value);
  }
  const discord = {
    ...existingDiscord,
    enabled: discordInput.enabled === undefined ? Boolean(existingDiscord.enabled) : Boolean(discordInput.enabled),
    events,
  };
  if (discordInput.webhookUrl === "__CLEAR__") {
    discord.webhookUrl = "";
  } else if (typeof discordInput.webhookUrl === "string" && discordInput.webhookUrl.trim()) {
    discord.webhookUrl = discordInput.webhookUrl.trim();
  } else {
    discord.webhookUrl = existingDiscord.webhookUrl || "";
  }

  await fs.writeFile(paths.tradingConfigFile, `${JSON.stringify(trading, null, 2)}\n`, "utf8");

  const secretInput = payload.secrets?.llm || {};
  const providerSecretInput = payload.secrets?.dataProviders || {};
  const eventSearchSecretInput = payload.secrets?.eventSearch || {};
  const secrets = { ...existingSecrets, llm: { ...(existingSecrets.llm || {}) } };
  let secretsChanged = false;
  if (secretInput.clearApiKey) {
    secrets.llm.apiKey = "";
    secretsChanged = true;
  } else if (typeof secretInput.apiKey === "string" && secretInput.apiKey.trim()) {
    secrets.llm.apiKey = secretInput.apiKey.trim();
    secretsChanged = true;
  }
  secrets.dataProviders = { ...(existingSecrets.dataProviders || {}) };
  if (providerSecretInput.clearTushareToken) {
    secrets.dataProviders.tushareToken = "";
    secretsChanged = true;
  } else if (typeof providerSecretInput.tushareToken === "string" && providerSecretInput.tushareToken.trim()) {
    secrets.dataProviders.tushareToken = providerSecretInput.tushareToken.trim();
    secretsChanged = true;
  }
  secrets.eventSearch = { ...(existingSecrets.eventSearch || {}) };
  for (const item of [
    ["bochaApiKey", "clearBochaApiKey"],
    ["tavilyApiKey", "clearTavilyApiKey"],
    ["serpApiKey", "clearSerpApiKey"],
    ["anspireApiKey", "clearAnspireApiKey"],
  ]) {
    const [field, clearField] = item;
    if (eventSearchSecretInput[clearField]) {
      secrets.eventSearch[field] = "";
      secretsChanged = true;
    } else if (typeof eventSearchSecretInput[field] === "string" && eventSearchSecretInput[field].trim()) {
      secrets.eventSearch[field] = eventSearchSecretInput[field].trim();
      secretsChanged = true;
    }
  }
  if (secretsChanged) {
    await fs.writeFile(paths.llmSecretConfigFile, `${JSON.stringify(secrets, null, 2)}\n`, "utf8");
  }

  await fs.writeFile(paths.notificationConfigFile, `${JSON.stringify({ discord }, null, 2)}\n`, "utf8");

  return getConfigPayload(paths);
}

async function serveFile(res, file) {
  try {
    const data = await fs.readFile(file);
    send(res, 200, data, mime[path.extname(file)] || "application/octet-stream");
  } catch {
    send(res, 404, "Not found");
  }
}

function updateKey(paths = legacyPaths) {
  return paths.accountId || "legacy";
}

function runUpdate(paths = legacyPaths) {
  const key = updateKey(paths);
  if (updateInFlight.has(key)) return updateInFlight.get(key);
  const task = new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(appRoot, "scripts", "generate-research.mjs")], {
      cwd: appRoot,
      env: { ...process.env, ...scriptEnvForAccount(paths) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  }).finally(() => {
    updateInFlight.delete(key);
  });
  updateInFlight.set(key, task);
  return task;
}

function runBacktest(paths = legacyPaths, input = {}) {
  const key = updateKey(paths);
  if (backtestInFlight.has(key)) return backtestInFlight.get(key);
  const args = [];
  for (const field of [
    "start",
    "end",
    "maxSymbols",
    "provider",
    "strategy",
    "scenario",
    "buyScoreThreshold",
    "stopLossPct",
    "takeProfitPct",
    "chasePctLimit",
    "timeStopDays",
  ]) {
    if (input[field] !== undefined && input[field] !== "") args.push(`--${field}=${String(input[field])}`);
  }
  const task = new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(appRoot, "scripts", "backtest-replay.mjs"), ...args], {
      cwd: appRoot,
      env: { ...process.env, ...scriptEnvForAccount(paths) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  }).finally(() => {
    backtestInFlight.delete(key);
  });
  backtestInFlight.set(key, task);
  return task;
}

function runStrategyOptimizer(paths = legacyPaths, input = {}) {
  const key = updateKey(paths);
  if (optimizerInFlight.has(key)) return optimizerInFlight.get(key);
  const args = input.apply ? ["--apply-bounded"] : [];
  const task = new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(appRoot, "scripts", "strategy-optimizer.mjs"), ...args], {
      cwd: appRoot,
      env: { ...process.env, ...scriptEnvForAccount(paths) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  }).finally(() => {
    optimizerInFlight.delete(key);
  });
  optimizerInFlight.set(key, task);
  return task;
}

function runDecisionAgent(paths = legacyPaths) {
  const key = updateKey(paths);
  if (decisionAgentInFlight.has(key)) return decisionAgentInFlight.get(key);
  const task = new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(appRoot, "scripts", "research-decision-agent.mjs")], {
      cwd: appRoot,
      env: { ...process.env, ...scriptEnvForAccount(paths) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  }).finally(() => {
    decisionAgentInFlight.delete(key);
  });
  decisionAgentInFlight.set(key, task);
  return task;
}

function runParameterSweep(paths = legacyPaths, input = {}) {
  const key = updateKey(paths);
  if (parameterSweepInFlight.has(key)) return parameterSweepInFlight.get(key);
  const args = [];
  for (const field of ["start", "end", "maxSymbols", "provider", "strategy", "topN"]) {
    if (input[field] !== undefined && input[field] !== "") args.push(`--${field}=${String(input[field])}`);
  }
  const task = new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(appRoot, "scripts", "parameter-sweep.mjs"), ...args], {
      cwd: appRoot,
      env: { ...process.env, ...scriptEnvForAccount(paths) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  }).finally(() => {
    parameterSweepInFlight.delete(key);
  });
  parameterSweepInFlight.set(key, task);
  return task;
}

function runStrategyLab(paths = legacyPaths) {
  const key = updateKey(paths);
  if (strategyLabInFlight.has(key)) return strategyLabInFlight.get(key);
  const task = new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(appRoot, "scripts", "strategy-lab.mjs")], {
      cwd: appRoot,
      env: { ...process.env, ...scriptEnvForAccount(paths) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  }).finally(() => {
    strategyLabInFlight.delete(key);
  });
  strategyLabInFlight.set(key, task);
  return task;
}

function cleanLlmTestText(value, max = 180) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

async function readLlmErrorBody(res) {
  const body = await res.text().catch(() => "");
  return cleanLlmTestText(body, 180);
}

async function callChatCompletionTest(runtime) {
  const body = {
    model: runtime.model,
    temperature: 0,
    max_tokens: 16,
    stream: false,
    messages: [
      { role: "system", content: "You are a connectivity test. Reply with OK only." },
      { role: "user", content: "Reply OK." },
    ],
  };
  if (runtime.provider === "z-ai-chat") {
    body.thinking = { type: "disabled" };
  }
  const res = await fetch(`${runtime.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept-Language": "zh-CN,zh",
      Authorization: `Bearer ${runtime.apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await readLlmErrorBody(res)}`);
  const json = await res.json();
  return cleanLlmTestText(json?.choices?.[0]?.message?.content || "", 80);
}

async function callResponsesTest(runtime) {
  const res = await fetch(`${runtime.baseUrl}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${runtime.apiKey}`,
    },
    body: JSON.stringify({
      model: runtime.model,
      temperature: 0,
      max_output_tokens: 16,
      input: "Reply with OK only.",
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await readLlmErrorBody(res)}`);
  const json = await res.json();
  return cleanLlmTestText(json.output_text || "", 80);
}

async function callAnthropicTest(runtime) {
  const res = await fetch(`${runtime.baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": runtime.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: runtime.model,
      max_tokens: 16,
      temperature: 0,
      messages: [{ role: "user", content: "Reply with OK only." }],
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await readLlmErrorBody(res)}`);
  const json = await res.json();
  return cleanLlmTestText((json.content || []).map((part) => part.text || "").join(""), 80);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function testLlmConnectivity(input = {}, paths = legacyPaths) {
  const runtime = await getLlmRuntime(input, paths);
  const startedAt = Date.now();
  const missing = [];
  if (!runtime.apiKey) missing.push("API Key");
  if (!runtime.baseUrl) missing.push("Base URL");
  if (!runtime.model) missing.push("模型名");
  const base = {
    ok: false,
    provider: runtime.provider,
    model: runtime.model || "",
    baseUrl: runtime.baseUrl || "",
    apiKeySource: runtime.apiKeySource || "",
  };
  if (missing.length) {
    return { ...base, status: "not_configured", error: `缺少 ${missing.join(" / ")}` };
  }

  try {
    const reply =
      runtime.provider === "anthropic-messages"
        ? await callAnthropicTest(runtime)
        : runtime.provider === "openai-responses"
          ? await callResponsesTest(runtime)
          : await callChatCompletionTest(runtime);
    return {
      ...base,
      ok: true,
      status: "ok",
      latencyMs: Date.now() - startedAt,
      reply: reply || "OK",
    };
  } catch (error) {
    return {
      ...base,
      status: "error",
      latencyMs: Date.now() - startedAt,
      error: cleanLlmTestText(error.message || "连接失败"),
    };
  }
}

async function getEventSearchRuntime(input = {}, paths = legacyPaths) {
  const tradingRaw = await readJson(paths.tradingConfigFile, {});
  const secrets = await readLlmSecrets(paths);
  const eventSearch = {
    ...defaultEventSearchConfig,
    ...(tradingRaw.eventSearch || {}),
    ...sanitizeEventSearchConfig(input.trading?.eventSearch || {}),
  };
  const secretInput = input.secrets?.eventSearch || {};
  const supportedProviders = new Set(["bocha", "tavily", "serpApi", "anspire"]);
  const provider = supportedProviders.has(input.provider) ? input.provider : "tavily";
  const keyField = eventSearchSecretField(provider);
  const clearField = eventSearchClearField(provider);
  const submittedKey = typeof secretInput[keyField] === "string" ? secretInput[keyField].trim() : "";
  const lookupSecrets = secretInput[clearField] ? { eventSearch: {} } : secrets;
  const resolved = submittedKey ? { value: submittedKey, source: "form" } : resolveEventSearchApiKey(provider, lookupSecrets);
  return {
    provider,
    eventSearch,
    apiKey: resolved.value,
    apiKeySource: resolved.source,
    timeoutMs: eventSearch.timeoutMs || defaultEventSearchConfig.timeoutMs,
    resultsPerQuery: eventSearch.resultsPerQuery || defaultEventSearchConfig.resultsPerQuery,
  };
}

const eventSearchProviderLabels = {
  bocha: "Bocha",
  tavily: "Tavily",
  serpApi: "SerpAPI",
  anspire: "Anspire",
};

async function runEventSearchConnectivityTest(runtime) {
  const query = "A股 市场 热点";
  if (runtime.provider === "bocha") {
    const res = await fetchWithTimeout(
      "https://api.bochaai.com/v1/web-search",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${runtime.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          freshness: runtime.eventSearch.freshness,
          summary: true,
          count: 1,
        }),
      },
      runtime.timeoutMs,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await readLlmErrorBody(res)}`);
    const json = await res.json();
    return Array.isArray(json?.data?.webPages?.value) ? json.data.webPages.value.length : 0;
  }

  if (runtime.provider === "serpApi") {
    const url = new URL("https://serpapi.com/search.json");
    url.searchParams.set("engine", "google_news");
    url.searchParams.set("q", query);
    url.searchParams.set("hl", "zh-CN");
    url.searchParams.set("gl", "CN");
    url.searchParams.set("api_key", runtime.apiKey);
    const res = await fetchWithTimeout(url, {}, runtime.timeoutMs);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await readLlmErrorBody(res)}`);
    const json = await res.json();
    return Array.isArray(json?.news_results) ? json.news_results.length : 0;
  }

  if (runtime.provider === "anspire") {
    const url = new URL("https://plugin.anspire.cn/api/ntsearch/search");
    url.searchParams.set("query", query);
    url.searchParams.set("top_k", "1");
    url.searchParams.set("search_type", "web");
    const res = await fetchWithTimeout(
      url,
      {
        headers: {
          Authorization: `Bearer ${runtime.apiKey}`,
        },
      },
      runtime.timeoutMs,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await readLlmErrorBody(res)}`);
    const json = await res.json();
    const rows = json?.data?.results || json?.data || json?.results || [];
    return Array.isArray(rows) ? rows.length : 0;
  }

  const res = await fetchWithTimeout(
    "https://api.tavily.com/search",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${runtime.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        topic: "news",
        search_depth: "basic",
        max_results: 1,
        include_answer: false,
        include_raw_content: false,
      }),
    },
    runtime.timeoutMs,
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await readLlmErrorBody(res)}`);
  const json = await res.json();
  return Array.isArray(json?.results) ? json.results.length : 0;
}

async function testEventSearchConnectivity(input = {}, paths = legacyPaths) {
  const runtime = await getEventSearchRuntime(input, paths);
  const startedAt = Date.now();
  const label = eventSearchProviderLabels[runtime.provider] || runtime.provider;
  const base = {
    ok: false,
    provider: runtime.provider,
    label,
    apiKeySource: runtime.apiKeySource || "",
  };
  if (!runtime.apiKey) {
    return { ...base, status: "not_configured", error: `缺少 ${label} API Key` };
  }

  try {
    const resultCount = await runEventSearchConnectivityTest(runtime);
    return {
      ...base,
      ok: true,
      status: "ok",
      latencyMs: Date.now() - startedAt,
      resultCount,
    };
  } catch (error) {
    return {
      ...base,
      status: "error",
      latencyMs: Date.now() - startedAt,
      error: cleanLlmTestText(error.message || "连接失败"),
    };
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${port}`);
  const sendJson = (status, payload, headers = {}) =>
    send(res, status, JSON.stringify(payload), "application/json; charset=utf-8", headers);

  if (url.pathname === "/api/auth/status") {
    return sendJson(200, await ensureAuthRuntimePayload(getAuthContext(req)));
  }

  if (url.pathname === "/api/auth/setup" && req.method === "POST") {
    try {
      const payload = await readBodyJson(req);
      const result = setupAdmin(payload, req);
      await ensureAuthRuntimePayload(result.payload);
      return sendJson(200, result.payload, { "Set-Cookie": result.cookies });
    } catch (error) {
      return sendJson(400, { error: error.message });
    }
  }

  if (url.pathname === "/api/auth/login" && req.method === "POST") {
    try {
      const payload = await readBodyJson(req);
      const result = loginUser(payload, req);
      await ensureAuthRuntimePayload(result.payload);
      return sendJson(200, result.payload, { "Set-Cookie": result.cookies });
    } catch (error) {
      return sendJson(401, { error: error.message });
    }
  }

  if (url.pathname === "/api/auth/logout" && req.method === "POST") {
    const result = logoutUser(req);
    return sendJson(200, result.payload, { "Set-Cookie": result.cookies });
  }

  let auth = null;
  let requestPaths = null;
  if (url.pathname.startsWith("/api/")) {
    auth = getAuthContext(req);
    if (!auth.authenticated) {
      return sendJson(401, {
        error: auth.setupRequired ? "请先初始化管理员账号" : "请先登录",
        setupRequired: auth.setupRequired,
      });
    }
    requestPaths = await pathsForAuth(auth);
  }

  if (url.pathname === "/api/accounts" && req.method === "GET") {
    return sendJson(200, auth);
  }

  if (url.pathname === "/api/accounts" && req.method === "POST") {
    try {
      const payload = await readBodyJson(req);
      const result = createPaperAccount(auth.user.id, payload);
      await ensureAuthRuntimePayload(result.payload);
      return sendJson(200, result.payload, { "Set-Cookie": result.cookies });
    } catch (error) {
      return sendJson(400, { error: error.message });
    }
  }

  if (url.pathname === "/api/accounts/select" && req.method === "POST") {
    try {
      const payload = await readBodyJson(req);
      const result = selectPaperAccount(auth.user.id, payload.accountId);
      await ensureAuthRuntimePayload(result.payload);
      return sendJson(200, result.payload, { "Set-Cookie": result.cookies });
    } catch (error) {
      return sendJson(400, { error: error.message });
    }
  }

  if (url.pathname === "/api/dashboard") {
    return serveFile(res, path.join(requestPaths.dataDir, "dashboard.json"));
  }

  if (url.pathname === "/api/live-status") {
    return serveFile(res, path.join(requestPaths.dataDir, "live-status.json"));
  }

  if (url.pathname === "/api/live-checks") {
    return serveFile(res, path.join(requestPaths.dataDir, "live-checks.json"));
  }

  if (url.pathname === "/api/strategy-optimizer" && req.method === "GET") {
    return serveFile(res, path.join(requestPaths.dataDir, "strategy-optimizer.json"));
  }

  if (url.pathname === "/api/strategy-optimizer" && req.method === "POST") {
    try {
      const payload = await readBodyJson(req);
      const result = await runStrategyOptimizer(requestPaths, { apply: Boolean(payload.apply) });
      const agentResult = result.code === 0 ? await runDecisionAgent(requestPaths) : null;
      const report = await readJson(path.join(requestPaths.dataDir, "strategy-optimizer.json"), null);
      const agent = await readJson(path.join(requestPaths.dataDir, "decision-agent.json"), null);
      const labResult = result.code === 0 ? await runStrategyLab(requestPaths) : null;
      const lab = await readJson(path.join(requestPaths.dataDir, "strategy-lab.json"), null);
      return sendJson(result.code === 0 ? 200 : 500, {
        ...result,
        report,
        agent,
        agentResult,
        lab,
        labResult,
        config: payload.apply ? await getConfigPayload(requestPaths) : null,
      });
    } catch (error) {
      return sendJson(500, { error: error.message });
    }
  }

  if (url.pathname === "/api/decision-agent" && req.method === "GET") {
    return serveFile(res, path.join(requestPaths.dataDir, "decision-agent.json"));
  }

  if (url.pathname === "/api/decision-agent" && req.method === "POST") {
    try {
      const result = await runDecisionAgent(requestPaths);
      const report = await readJson(path.join(requestPaths.dataDir, "decision-agent.json"), null);
      const labResult = result.code === 0 ? await runStrategyLab(requestPaths) : null;
      const lab = await readJson(path.join(requestPaths.dataDir, "strategy-lab.json"), null);
      return sendJson(result.code === 0 ? 200 : 500, {
        ...result,
        report,
        lab,
        labResult,
      });
    } catch (error) {
      return sendJson(500, { error: error.message });
    }
  }

  if (url.pathname === "/api/backtest" && req.method === "GET") {
    return serveFile(res, path.join(requestPaths.dataDir, "backtest-report.json"));
  }

  if (url.pathname === "/api/parameter-sweep" && req.method === "GET") {
    return serveFile(res, path.join(requestPaths.dataDir, "parameter-sweep.json"));
  }

  if (url.pathname === "/api/parameter-sweep" && req.method === "POST") {
    try {
      const payload = await readBodyJson(req);
      const result = await runParameterSweep(requestPaths, payload);
      const report = await readJson(path.join(requestPaths.dataDir, "parameter-sweep.json"), null);
      const labResult = result.code === 0 ? await runStrategyLab(requestPaths) : null;
      const lab = await readJson(path.join(requestPaths.dataDir, "strategy-lab.json"), null);
      return sendJson(result.code === 0 ? 200 : 500, {
        ...result,
        report,
        lab,
        labResult,
      });
    } catch (error) {
      return sendJson(500, { error: error.message });
    }
  }

  if (url.pathname === "/api/strategy-lab" && req.method === "GET") {
    return serveFile(res, path.join(requestPaths.dataDir, "strategy-lab.json"));
  }

  if (url.pathname === "/api/strategy-lab" && req.method === "POST") {
    try {
      const result = await runStrategyLab(requestPaths);
      const report = await readJson(path.join(requestPaths.dataDir, "strategy-lab.json"), null);
      return sendJson(result.code === 0 ? 200 : 500, {
        ...result,
        report,
      });
    } catch (error) {
      return sendJson(500, { error: error.message });
    }
  }

  if (url.pathname === "/api/config" && req.method === "GET") {
    return sendJson(200, await getConfigPayload(requestPaths));
  }

  if (url.pathname === "/api/config" && req.method === "POST") {
    try {
      const payload = await readBodyJson(req);
      const saved = await saveConfig(payload, requestPaths);
      return sendJson(200, saved);
    } catch (error) {
      return sendJson(400, { error: error.message });
    }
  }

  if (url.pathname === "/api/llm-test" && req.method === "POST") {
    try {
      const payload = await readBodyJson(req);
      const result = await testLlmConnectivity(payload, requestPaths);
      return sendJson(200, result);
    } catch (error) {
      return sendJson(500, { ok: false, status: "error", error: error.message });
    }
  }

  if (url.pathname === "/api/event-search-test" && req.method === "POST") {
    try {
      const payload = await readBodyJson(req);
      const result = await testEventSearchConnectivity(payload, requestPaths);
      return sendJson(200, result);
    } catch (error) {
      return sendJson(500, { ok: false, status: "error", error: error.message });
    }
  }

  if (url.pathname === "/api/update" && req.method === "POST") {
    const result = await runUpdate(requestPaths);
    let agent = null;
    let agentResult = null;
    if (result.code === 0) {
      agentResult = await runDecisionAgent(requestPaths);
      agent = await readJson(path.join(requestPaths.dataDir, "decision-agent.json"), null);
    }
    return sendJson(result.code === 0 ? 200 : 500, { ...result, agent, agentResult });
  }

  if (url.pathname === "/api/backtest" && req.method === "POST") {
    try {
      const payload = await readBodyJson(req);
      const result = await runBacktest(requestPaths, payload);
      const report = await readJson(path.join(requestPaths.dataDir, "backtest-report.json"), null);
      let optimizer = null;
      let optimizerResult = null;
      let agent = null;
      let agentResult = null;
      let lab = null;
      let labResult = null;
      if (result.code === 0) {
        optimizerResult = await runStrategyOptimizer(requestPaths, { apply: false });
        optimizer = await readJson(path.join(requestPaths.dataDir, "strategy-optimizer.json"), null);
        agentResult = await runDecisionAgent(requestPaths);
        agent = await readJson(path.join(requestPaths.dataDir, "decision-agent.json"), null);
        labResult = await runStrategyLab(requestPaths);
        lab = await readJson(path.join(requestPaths.dataDir, "strategy-lab.json"), null);
      }
      return sendJson(result.code === 0 ? 200 : 500, {
        ...result,
        report,
        optimizer,
        optimizerResult,
        agent,
        agentResult,
        lab,
        labResult,
      });
    } catch (error) {
      return sendJson(500, { error: error.message });
    }
  }

  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = path.normalize(requested).replace(/^(\.\.[/\\])+/, "");
  return serveFile(res, path.join(publicDir, safePath));
});

server.listen(port, host, () => {
  console.log(`A-share learning app: http://${host}:${port}`);
});
