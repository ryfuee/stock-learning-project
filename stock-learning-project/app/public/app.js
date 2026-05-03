const els = {
  refreshBtn: document.querySelector("#refreshBtn"),
  viewEyebrow: document.querySelector("#viewEyebrow"),
  viewTitle: document.querySelector("#viewTitle"),
  viewSubtitle: document.querySelector("#viewSubtitle"),
  statusStrip: document.querySelector("#statusStrip"),
  headerMetrics: document.querySelector("#headerMetrics"),
  dateBadge: document.querySelector("#dateBadge"),
  sourceSummary: document.querySelector("#sourceSummary"),
  marketRegime: document.querySelector("#marketRegime"),
  portfolioCards: document.querySelector("#portfolioCards"),
  workflowGuide: document.querySelector("#workflowGuide"),
  commandSummary: document.querySelector("#commandSummary"),
  signalPipeline: document.querySelector("#signalPipeline"),
  riskTape: document.querySelector("#riskTape"),
  indexGrid: document.querySelector("#indexGrid"),
  systemActions: document.querySelector("#systemActions"),
  liveChecksOverview: document.querySelector("#liveChecksOverview"),
  liveChecksTrading: document.querySelector("#liveChecksTrading"),
  hotBoards: document.querySelector("#hotBoards"),
  researchSearch: document.querySelector("#researchSearch"),
  researchFilter: document.querySelector("#researchFilter"),
  researchSummary: document.querySelector("#researchSummary"),
  researchFocusPanel: document.querySelector("#researchFocusPanel"),
  researchGrid: document.querySelector("#researchGrid"),
  candidateRows: document.querySelector("#candidateRows"),
  tradingSummary: document.querySelector("#tradingSummary"),
  tradingCommand: document.querySelector("#tradingCommand"),
  positions: document.querySelector("#positions"),
  tradeRows: document.querySelector("#tradeRows"),
  dailyReview: document.querySelector("#dailyReview"),
  strategyReview: document.querySelector("#strategyReview"),
  strategyCommand: document.querySelector("#strategyCommand"),
  strategyEvolution: document.querySelector("#strategyEvolution"),
  strategyLabOverview: document.querySelector("#strategyLabOverview"),
  strategyLabDetail: document.querySelector("#strategyLabDetail"),
  learning: document.querySelector("#learning"),
  runOptimizerBtn: document.querySelector("#runOptimizerBtn"),
  applyOptimizerBtn: document.querySelector("#applyOptimizerBtn"),
  optimizerState: document.querySelector("#optimizerState"),
  backtestStart: document.querySelector("#backtestStart"),
  backtestEnd: document.querySelector("#backtestEnd"),
  backtestMaxSymbols: document.querySelector("#backtestMaxSymbols"),
  backtestStrategy: document.querySelector("#backtestStrategy"),
  backtestProvider: document.querySelector("#backtestProvider"),
  runBacktestBtn: document.querySelector("#runBacktestBtn"),
  runSweepBacktestBtn: document.querySelector("#runSweepBacktestBtn"),
  backtestState: document.querySelector("#backtestState"),
  backtestSummary: document.querySelector("#backtestSummary"),
  backtestBenchmarks: document.querySelector("#backtestBenchmarks"),
  backtestTrades: document.querySelector("#backtestTrades"),
  runSweepBtn: document.querySelector("#runSweepBtn"),
  sweepState: document.querySelector("#sweepState"),
  sweepSummary: document.querySelector("#sweepSummary"),
  sweepRankings: document.querySelector("#sweepRankings"),
  sweepWindows: document.querySelector("#sweepWindows"),
  runAgentBtn: document.querySelector("#runAgentBtn"),
  agentState: document.querySelector("#agentState"),
  agentSummary: document.querySelector("#agentSummary"),
  agentPolicy: document.querySelector("#agentPolicy"),
  agentDiagnostics: document.querySelector("#agentDiagnostics"),
  agentQueue: document.querySelector("#agentQueue"),
  agentExecution: document.querySelector("#agentExecution"),
  notificationList: document.querySelector("#notificationList"),
  settingsList: document.querySelector("#settingsList"),
  decisionDashboard: document.querySelector("#decisionDashboard"),
  configForm: document.querySelector("#configForm"),
  configStatus: document.querySelector("#configStatus"),
  configFeedback: document.querySelector("#configFeedback"),
  reloadConfigBtn: document.querySelector("#reloadConfigBtn"),
  webhookState: document.querySelector("#webhookState"),
  llmState: document.querySelector("#llmState"),
  llmApiKeyState: document.querySelector("#llmApiKeyState"),
  llmProviderHint: document.querySelector("#llmProviderHint"),
  testLlmBtn: document.querySelector("#testLlmBtn"),
  llmTestState: document.querySelector("#llmTestState"),
  dataProviderState: document.querySelector("#dataProviderState"),
  eventSearchState: document.querySelector("#eventSearchState"),
  eventSearchKeyGrid: document.querySelector("#eventSearchKeyGrid"),
  eventSearchTestProvider: document.querySelector("#eventSearchTestProvider"),
  testEventSearchBtn: document.querySelector("#testEventSearchBtn"),
  eventSearchTestState: document.querySelector("#eventSearchTestState"),
  authGate: document.querySelector("#authGate"),
  authForm: document.querySelector("#authForm"),
  authTitle: document.querySelector("#authTitle"),
  authSubtitle: document.querySelector("#authSubtitle"),
  authSubmit: document.querySelector("#authSubmit"),
  authFeedback: document.querySelector("#authFeedback"),
  sessionBar: document.querySelector("#sessionBar"),
  userSummary: document.querySelector("#userSummary"),
  accountSelect: document.querySelector("#accountSelect"),
  createAccountBtn: document.querySelector("#createAccountBtn"),
  logoutBtn: document.querySelector("#logoutBtn"),
};

const viewSections = [...document.querySelectorAll(".view-section")];
const navLinks = [...document.querySelectorAll('.nav a[href^="#"]')];
const configTabButtons = [...document.querySelectorAll("[data-config-tab]")];
const configPanels = [...document.querySelectorAll("[data-config-group]")];
const tradingTabButtons = [...document.querySelectorAll("[data-trading-tab]")];
const tradingPanels = [...document.querySelectorAll("[data-trading-panel]")];
let latestConfig = null;
let latestDashboard = null;
let latestOptimizer = null;
let latestBacktest = null;
let latestLiveStatus = null;
let latestAgent = null;
let latestSweep = null;
let latestLiveChecks = null;
let latestStrategyLab = null;
let authState = null;
let selectedResearchCode = "";
let bootstrapped = false;
const llmProviderHints = {
  "openai-responses": "推荐新项目使用。Base URL 通常是 https://api.openai.com/v1，API Key 用 LLM_API_KEY 或 OPENAI_API_KEY。",
  "openai-compatible": "用于 Kimi、GLM、火山方舟、硅基流动等兼容 /chat/completions 的厂商；需要填写对应厂商 Base URL 和模型名。",
  "z-ai-chat": "用于 Z.AI / GLM。Base URL 通常是 https://api.z.ai/api/coding/paas/v4，模型名可先用 glm-5.1，API Key 用 ZAI_API_KEY 或 LLM_API_KEY。",
  "openai-chat": "用于 OpenAI 旧版 Chat Completions 协议；只有兼容旧接口或已有旧配置时才需要选它。",
  "anthropic-messages": "用于 Claude 官方 Messages API；需要在服务器环境变量配置 ANTHROPIC_API_KEY 或 LLM_API_KEY。",
};
const llmProviderDefaults = {
  "openai-responses": { baseUrl: "https://api.openai.com/v1", model: "" },
  "openai-compatible": { baseUrl: "https://api.openai.com/v1", model: "" },
  "z-ai-chat": { baseUrl: "https://api.z.ai/api/coding/paas/v4", model: "glm-5.1" },
  "openai-chat": { baseUrl: "https://api.openai.com/v1", model: "" },
  "anthropic-messages": { baseUrl: "https://api.anthropic.com", model: "" },
};
const eventSearchProviders = [
  { id: "bocha", label: "Bocha", enabledField: "useBocha", hint: "中文优先" },
  { id: "tavily", label: "Tavily", enabledField: "useTavily", hint: "AI 搜索" },
  { id: "serpApi", label: "SerpAPI", enabledField: "useSerpApi", hint: "Google News" },
  { id: "anspire", label: "Anspire", enabledField: "useAnspire", hint: "中文搜索" },
];

async function readJsonSafe(res) {
  const text = await res.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

async function loadAuthStatus() {
  const res = await fetch("/api/auth/status");
  if (!res.ok) throw new Error("认证状态加载失败");
  return res.json();
}

async function handleUnauthorized(res) {
  if (res.status !== 401) return;
  const status = await loadAuthStatus().catch(() => ({ authenticated: false, setupRequired: false }));
  renderAuth(status);
  throw new Error(status.setupRequired ? "请先初始化管理员账号。" : "请先登录。");
}

async function fetchJson(url, options = {}, fallbackError = "请求失败") {
  const res = await fetch(url, options);
  await handleUnauthorized(res);
  const payload = await readJsonSafe(res);
  if (!res.ok) throw new Error(payload.error || fallbackError);
  return payload;
}

async function fetchOptionalJson(url) {
  const res = await fetch(url);
  await handleUnauthorized(res);
  if (!res.ok) return null;
  return res.json();
}

function renderAuth(status) {
  authState = status || { authenticated: false, setupRequired: false };
  const authenticated = Boolean(authState.authenticated);
  document.body.classList.toggle("auth-locked", !authenticated);
  if (els.authGate) els.authGate.hidden = authenticated;
  if (els.sessionBar) els.sessionBar.hidden = !authenticated;
  if (!authenticated) {
    const setup = Boolean(authState.setupRequired);
    if (els.authForm) els.authForm.dataset.mode = setup ? "setup" : "login";
    if (els.authForm?.elements.password) {
      els.authForm.elements.password.autocomplete = setup ? "new-password" : "current-password";
    }
    if (els.authTitle) els.authTitle.textContent = setup ? "初始化管理员账号" : "登录投研平台";
    if (els.authSubtitle) {
      els.authSubtitle.textContent = setup
        ? "首次部署需要创建一个本地管理员账号。密码只保存哈希，不会明文写入数据库。"
        : "使用服务器本地账号进入你的 A 股投研工作台。";
    }
    if (els.authSubmit) els.authSubmit.textContent = setup ? "创建管理员并进入" : "登录";
    if (els.authFeedback) {
      els.authFeedback.textContent = setup ? "建议使用强密码；后续可以再加邀请注册。" : "登录态保存在 HttpOnly Cookie 中。";
      els.authFeedback.classList.remove("good", "warn");
    }
    return;
  }

  const role = authState.user?.role === "admin" ? "管理员" : "用户";
  if (els.userSummary) els.userSummary.textContent = `${authState.user?.username || "已登录"} · ${role}`;
  if (els.accountSelect) {
    els.accountSelect.innerHTML = (authState.accounts || [])
      .map(
        (account) =>
          `<option value="${account.id}" ${account.id === authState.currentAccount?.id ? "selected" : ""}>${account.name}</option>`,
      )
      .join("");
    els.accountSelect.disabled = (authState.accounts || []).length === 0;
  }
}

function renderLlmProviderHint(provider) {
  if (!els.llmProviderHint) return;
  els.llmProviderHint.textContent = llmProviderHints[provider] || llmProviderHints["openai-responses"];
}

function applyLlmProviderDefaults(provider) {
  const defaults = llmProviderDefaults[provider];
  if (!defaults || !els.configForm) return;
  const baseInput = els.configForm.elements.llmBaseUrl;
  const modelInput = els.configForm.elements.llmModel;
  const replaceableBaseUrls = new Set(Object.values(llmProviderDefaults).map((item) => item.baseUrl).filter(Boolean));
  if (baseInput && (!baseInput.value || replaceableBaseUrls.has(baseInput.value))) {
    baseInput.value = defaults.baseUrl || "";
  }
  if (modelInput && defaults.model && !modelInput.value) {
    modelInput.value = defaults.model;
  }
}

function llmApiKeySourceLabel(source) {
  if (source === "env") return "环境变量";
  if (source === "form") return "本次输入";
  if (source === "page") return "页面保存";
  return "未配置";
}

function normalizeProviderFromFields(provider, baseUrl, model) {
  if (String(baseUrl || "").includes("api.z.ai") || /^glm-/i.test(String(model || ""))) return "z-ai-chat";
  return provider;
}

function currentViewId() {
  const id = window.location.hash.replace(/^#/, "") || "overview";
  return viewSections.some((section) => section.id === id) ? id : "overview";
}

function setActiveView(id = currentViewId(), shouldReplace = false) {
  const targetId = viewSections.some((section) => section.id === id) ? id : "overview";
  const active = document.getElementById(targetId);
  for (const section of viewSections) section.hidden = section.id !== targetId;
  for (const link of navLinks) {
    const isActive = link.getAttribute("href") === `#${targetId}`;
    link.classList.toggle("active", isActive);
    if (isActive) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  els.viewEyebrow.textContent = "A股专业投研平台";
  els.viewTitle.textContent = active?.dataset.title || active?.querySelector("h2")?.textContent || "总览";
  els.viewSubtitle.textContent = active?.dataset.subtitle || active?.querySelector(".section-head p")?.textContent || "";
  if (shouldReplace && window.location.hash !== `#${targetId}`) {
    history.replaceState(null, "", `#${targetId}`);
  }
  window.scrollTo({ top: 0, behavior: "auto" });
}

function setConfigGroup(group = "trading") {
  const target = configPanels.some((panel) => panel.dataset.configGroup === group) ? group : "trading";
  for (const button of configTabButtons) {
    const active = button.dataset.configTab === target;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  }
  for (const panel of configPanels) {
    panel.hidden = panel.dataset.configGroup !== target;
  }
}

function setTradingTab(tab = "checks") {
  const target = tradingPanels.some((panel) => panel.dataset.tradingPanel === tab) ? tab : "checks";
  for (const button of tradingTabButtons) {
    const active = button.dataset.tradingTab === target;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  }
  for (const panel of tradingPanels) {
    panel.hidden = panel.dataset.tradingPanel !== target;
  }
}

function signed(value, digits = 2) {
  const n = Number(value || 0);
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}`;
}

function money(value) {
  if (value === null || value === undefined || value === "" || Number.isNaN(Number(value))) {
    return "无数据";
  }
  const n = Number(value || 0);
  if (Math.abs(n) >= 1e8) return `${(n / 1e8).toFixed(2)}亿`;
  if (Math.abs(n) >= 1e4) return `${(n / 1e4).toFixed(2)}万`;
  return `${n.toFixed(2)}`;
}

function dateDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function trendClass(value) {
  return Number(value) >= 0 ? "up" : "down";
}

function actionTag(item) {
  if (item.actionCode === "PAPER_BUY") return "tag tag-buy";
  if (item.actionCode === "FOCUS") return "tag tag-focus";
  if (item.actionCode === "AVOID" || item.actionCode === "LLM_AVOID") return "tag tag-risk";
  return "tag tag-watch";
}

function pill(text, tone = "") {
  return `<span class="pill ${tone}">${text}</span>`;
}

function list(items) {
  return items?.length ? `<ul>${items.map((item) => `<li>${item}</li>`).join("")}</ul>` : "<span>暂无</span>";
}

function compactText(text, max = 96) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

async function loadDashboard() {
  return fetchJson("/api/dashboard", {}, "暂无仪表盘数据，请先刷新生成。");
}

async function loadLiveStatus() {
  return fetchOptionalJson("/api/live-status");
}

async function loadLiveChecks() {
  return fetchOptionalJson("/api/live-checks");
}

async function loadOptimizer() {
  return fetchOptionalJson("/api/strategy-optimizer");
}

async function loadBacktest() {
  return fetchOptionalJson("/api/backtest");
}

async function loadSweep() {
  return fetchOptionalJson("/api/parameter-sweep");
}

async function loadAgent() {
  return fetchOptionalJson("/api/decision-agent");
}

async function loadStrategyLab() {
  return fetchOptionalJson("/api/strategy-lab");
}

async function loadConfig() {
  return fetchJson("/api/config", {}, "配置加载失败");
}

async function saveConfig(payload) {
  return fetchJson("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, "配置保存失败");
}

async function testLlmConnection(payload) {
  return fetchJson("/api/llm-test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, "测试失败");
}

async function testEventSearchConnection(payload) {
  return fetchJson("/api/event-search-test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, "测试失败");
}

function renderLlmTestResult(result) {
  if (!els.llmTestState) return;
  els.llmTestState.classList.toggle("good", Boolean(result.ok));
  els.llmTestState.classList.toggle("warn", !result.ok);
  if (result.ok) {
    els.llmTestState.textContent = `连接成功：${result.provider} / ${result.model}，${result.latencyMs}ms，返回 ${result.reply || "OK"}`;
  } else {
    els.llmTestState.textContent = `连接失败：${result.error || result.status || "未知错误"}`;
  }
}

function renderEventSearchTestResult(result) {
  if (!els.eventSearchTestState) return;
  els.eventSearchTestState.classList.toggle("good", Boolean(result.ok));
  els.eventSearchTestState.classList.toggle("warn", !result.ok);
  const label = result.label || eventSearchProviders.find((item) => item.id === result.provider)?.label || "事件搜索";
  if (result.ok) {
    els.eventSearchTestState.textContent = `${label} 连通成功：${result.latencyMs}ms，返回 ${result.resultCount || 0} 条结果。`;
  } else {
    els.eventSearchTestState.textContent = `${label} 连接失败：${result.error || result.status || "未知错误"}`;
  }
}

function renderEventSearchKeyStatus(eventSearch) {
  const keys = eventSearch.keys || {};
  const rows = eventSearchProviders.map((provider) => {
    const meta = keys[provider.id] || {};
    const enabled = Boolean(eventSearch[provider.enabledField]);
    const configured = Boolean(meta.configured);
    const statusClass = configured ? "good" : enabled ? "warn" : "off";
    const statusText = configured ? "已配置" : enabled ? "缺少 Key" : "未启用";
    const detail = configured
      ? `${llmApiKeySourceLabel(meta.source)} · ${meta.preview || "已隐藏"}`
      : enabled
        ? "启用后需要填写 Key"
        : "未参与本轮事件搜索";
    return `
      <div class="key-status-card ${statusClass}">
        <div>
          <strong>${provider.label}</strong>
          <small>${provider.hint}</small>
        </div>
        <span>${statusText}</span>
        <p>${detail}</p>
      </div>
    `;
  });
  if (els.eventSearchKeyGrid) els.eventSearchKeyGrid.innerHTML = rows.join("");

  const configuredCount = eventSearchProviders.filter((provider) => keys[provider.id]?.configured).length;
  const enabledProviders = eventSearchProviders.filter((provider) => eventSearch[provider.enabledField]);
  const readyProviders = enabledProviders.filter((provider) => keys[provider.id]?.configured);
  if (els.eventSearchState) {
    els.eventSearchState.textContent = eventSearch.enabled
      ? `事件搜索已开启：启用 ${enabledProviders.length} 个源，可用 Key ${readyProviders.length} 个，已保存 Key ${configuredCount} 个。`
      : `事件搜索未开启：已保存 Key ${configuredCount} 个；开启后只会调用启用且已配置 Key 的搜索源。`;
  }
  if (els.eventSearchTestProvider) {
    const preferred = readyProviders[0] || enabledProviders[0] || eventSearchProviders.find((provider) => keys[provider.id]?.configured) || eventSearchProviders[1];
    els.eventSearchTestProvider.value = preferred?.id || "tavily";
  }
}

function renderStatus(data, liveStatus, config = latestConfig) {
  const llm = data.llmDecision || {};
  const configuredLlm = config?.trading?.llm || {};
  const staleLlmDecision =
    configuredLlm.enabled &&
    llm.enabled &&
    configuredLlm.provider &&
    llm.provider &&
    configuredLlm.provider !== llm.provider;
  const llmStatus = staleLlmDecision
    ? pill("大模型 已开启，待刷新", "warn")
    : llm.enabled
    ? llm.status === "ok"
      ? pill("大模型 已参与", "good")
      : pill(`大模型 ${llm.status === "error" ? "调用失败" : llm.status || "等待"}`, "warn")
    : configuredLlm.enabled
      ? pill(`大模型 ${configuredLlm.apiKeyConfigured ? "已开启，待刷新" : "已开启，缺Key"}`, "warn")
      : pill("大模型 关闭");
  const status = [
    pill(`生成 ${new Date(data.generatedAt).toLocaleString()}`),
    pill(`纸面交易 ${data.paperTradingEnabled ? "本轮已执行" : "仅刷新"}`, data.paperTradingEnabled ? "good" : ""),
    pill(`模拟持仓 ${data.paperPositions.length} 个`),
    llmStatus,
    liveStatus
      ? pill(`${liveModeLabel(liveStatus.mode)} · ${new Date(liveStatus.finishedAt).toLocaleTimeString()}`)
      : "",
    ...(data.warnings || []).map((warning) => pill(compactText(warning, 68), "warn")),
  ];
  els.statusStrip.innerHTML = status.join("");
}

function renderHeaderMetrics(data, liveStatus, config = latestConfig) {
  if (!els.headerMetrics) return;
  const llm = data.llmDecision || {};
  const search = data.eventSearch || {};
  const providers = data.dataProviders || {};
  const modelState = llm.status === "ok" ? "模型已审查" : config?.trading?.llm?.enabled ? "模型待刷新" : "模型关闭";
  const liveState = liveStatus ? liveModeShortLabel(liveStatus.mode) : "离线快照";
  const financeState = providers.status === "ok" ? `${providers.resultCount || 0}只` : providers.status === "error" ? "异常" : providers.status || "未知";
  els.headerMetrics.innerHTML = [
    ["市场", data.marketRegime?.label || "未知"],
    ["模型", modelState],
    ["事件", search.enabled ? `${search.resultCount || 0}条` : "关闭"],
    ["财务", financeState],
    ["运行", liveState],
  ]
    .map(([label, value]) => `<span><small>${label}</small><strong>${value}</strong></span>`)
    .join("");
}

function liveModeLabel(mode) {
  const labels = {
    PAPER_TRADE: "盘中交易轮询",
    PRE_MARKET_RESEARCH: "盘前自动调研",
    MIDDAY_RESEARCH: "午间自动调研",
    POST_CLOSE_REVIEW: "盘后复盘优化",
    NIGHTLY_OPTIMIZE: "晚间策略学习",
    WEEKEND_REVIEW: "周末策略复盘",
    WAITING: "非交易时段，等待任务",
    REFRESH_ONLY: "非交易时段，仅刷新",
  };
  return labels[mode] || mode || "离线快照";
}

function liveModeShortLabel(mode) {
  const labels = {
    PAPER_TRADE: "盘中模拟",
    PRE_MARKET_RESEARCH: "盘前调研",
    MIDDAY_RESEARCH: "午间调研",
    POST_CLOSE_REVIEW: "盘后复盘",
    NIGHTLY_OPTIMIZE: "策略学习",
    WEEKEND_REVIEW: "周末复盘",
    WAITING: "等待任务",
    REFRESH_ONLY: "仅刷新",
  };
  return labels[mode] || mode || "离线快照";
}

function renderOverviewCommand(data) {
  const board = data.decisionDashboard || {};
  const posture = board.posture || {};
  const counts = board.counts || {};
  const top = board.topActions?.[0];
  if (els.commandSummary) {
    els.commandSummary.innerHTML = `
      <div class="command-brief ${posture.tone || ""}">
        <span>${posture.label || data.marketRegime?.label || "等待研判"}</span>
        <strong>${board.headline || data.marketRegime?.summary || "暂无市场结论。"}</strong>
        <p>${posture.reason || "系统会把板块、候选、模型和风险事件合并成一条可复盘的行动摘要。"}</p>
      </div>
      ${
        top
          ? `<div class="focus-strip">
              <small>今日焦点</small>
              <strong>${top.name} ${top.code}</strong>
              <span>${top.boardName} · ${top.action} · 评分${top.score}</span>
            </div>`
          : ""
      }
    `;
  }
  if (els.signalPipeline) {
    const pipeline = [
      ["候选", counts.candidates || data.candidates?.length || 0],
      ["买入", counts.paperBuy || 0],
      ["观察", counts.focus || 0],
      ["规避", counts.avoid || 0],
    ];
    els.signalPipeline.innerHTML = pipeline
      .map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`)
      .join("");
  }
  if (els.riskTape) {
    const risks = board.riskAlerts?.slice(0, 6) || data.candidates?.filter((item) => item.riskTags?.length).slice(0, 6).map((item) => `${item.name}：${item.riskTags.join("、")}`) || [];
    els.riskTape.innerHTML = risks.length
      ? risks.map((item) => `<div><span></span><p>${item}</p></div>`).join("")
      : `<div class="empty">当前没有高优先级风险警报。</div>`;
  }
}

function renderWorkflowGuide(data, liveStatus, lab = latestStrategyLab, backtest = latestBacktest, sweep = latestSweep, agent = latestAgent) {
  if (!els.workflowGuide) return;
  const candidates = lab?.status === "ok" ? lab.candidates || [] : [];
  const topCandidate = candidates
    .filter((item) => item.id !== "current")
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))[0];
  const latestCheck = latestLiveChecks?.checks?.[0];
  const marketMode = String(lab?.marketState?.mode || data.marketRegime?.code || "");
  const marketTone = /RISK|DEFENSIVE|CONCENTRATED|WEAK|COLD/i.test(marketMode)
    ? "warn"
    : /HOT|ACTIVE|BULL|ATTACK|STRONG/i.test(marketMode)
      ? "good"
      : "";
  const sweepBest = sweep?.status === "ok" ? sweep.rankings?.[0] : null;
  const agentOk = agent?.status === "ok";
  const backtestOk = backtest?.status === "ok";
  const closedSamples = Number(data.strategyReview?.sampleCount ?? data.strategyReview?.closedTrades?.length ?? 0);
  const cards = [
    {
      step: "01",
      title: "市场状态",
      value: lab?.marketState?.label || data.marketRegime?.label || "等待研判",
      body: compactText(lab?.marketState?.summary || data.marketRegime?.summary || "等待行情和板块数据刷新。", 92),
      href: "#sectors",
      cta: "板块雷达",
      tone: marketTone,
    },
    {
      step: "02",
      title: "策略候选",
      value: topCandidate?.name || "等待候选",
      body: topCandidate
        ? `${topCandidate.statusLabel || "候选"} · 评分 ${Number(topCandidate.score || 0).toFixed(1)} · ${compactText(topCandidate.recommendation || topCandidate.description, 70)}`
        : "多策略实验室会汇总寻优、回测、Agent 和持仓集中度。",
      href: "#strategy",
      cta: "策略池",
      tone: topCandidate?.status === "PROMOTE_CANDIDATE" ? "good" : topCandidate ? "warn" : "",
    },
    {
      step: "03",
      title: "模拟执行",
      value: liveModeShortLabel(liveStatus?.mode),
      body: latestCheck
        ? `${new Date(latestCheck.finishedAt || latestCheck.startedAt).toLocaleTimeString()} · 候选 ${latestCheck.candidates || 0} · 买入 ${latestCheck.paperBuy || 0} · 持仓 ${latestCheck.positions || data.paperPositions?.length || 0}`
        : `持仓 ${data.paperPositions?.length || 0} 个，等待后台轮询记录。`,
      href: "#trading",
      cta: "交易检测",
      tone: latestCheck?.ok === false ? "risk" : latestCheck ? "good" : "",
    },
    {
      step: "04",
      title: "复盘学习",
      value: sweepBest ? "寻优已生成" : backtestOk ? "回测已更新" : "等待验证",
      body: sweepBest
        ? `第一名 ${sweepBest.name || sweepBest.scenario || "候选参数"} · 得分 ${Number(sweepBest.score || 0).toFixed(1)}；Agent ${agentOk ? "已参与" : "待运行"}`
        : `已关闭样本 ${closedSamples}；${backtestOk ? "回测结果已进入策略进化图。" : "回测后再对比候选策略。"}`,
      href: "#backtest",
      cta: "回测验证",
      tone: sweepBest || agentOk ? "good" : backtestOk ? "" : "warn",
    },
  ];
  els.workflowGuide.innerHTML = cards
    .map(
      (item) => `
        <a class="workflow-card ${item.tone || ""}" href="${item.href}">
          <div class="workflow-card-head">
            <span>${item.step}</span>
            <small>${item.title}</small>
          </div>
          <strong>${item.value}</strong>
          <p>${item.body}</p>
          <em>${item.cta}</em>
        </a>
      `,
    )
    .join("");
}

function renderPortfolio(data) {
  const p = data.portfolio || {};
  const cards = [
    ["清算净值", money(p.netLiquidation || p.equity), `${signed(p.returnPct)}%`, p.returnPct >= 0 ? "up" : "down"],
    ["现金", money(p.cash), "可用于新开模拟仓", ""],
    ["持仓市值", money(p.marketValue), `${data.paperPositions.length} 个持仓`, ""],
    ["累计费用", money(p.totalFees), "佣金/过户费/印花税/滑点", "warn-text"],
  ];
  els.portfolioCards.innerHTML = cards
    .map(
      ([label, value, sub, cls]) => `
        <article class="kpi-card">
          <span>${label}</span>
          <strong class="${cls}">${value}</strong>
          <small>${sub}</small>
        </article>
      `,
    )
    .join("");
}

function renderIndexes(data) {
  els.indexGrid.innerHTML = data.indexes
    .map(
      (item) => `
        <div class="metric">
          <span>${item.name}</span>
          <strong>${item.price.toFixed(2)}</strong>
          <small class="${trendClass(item.pct)}">${signed(item.change)} / ${signed(item.pct)}%</small>
        </div>
      `,
    )
    .join("");
}

function renderActions(data) {
  const actions = data.paperDecisions?.length ? data.paperDecisions : [];
  els.systemActions.innerHTML = actions.length
    ? actions
        .slice(-6)
        .map(
          (item) => `
            <div class="action-row">
              <div>
                <strong>${item.name} ${item.code}</strong>
                <small>${item.decision} · ${item.shares || 0}股 · 浮动${signed(item.pnlPct || 0)}%</small>
              </div>
              <span class="mini-score">${item.decisionCode}</span>
            </div>
          `,
        )
        .join("")
    : `<div class="empty">本轮没有新的纸面交易动作。</div>`;
}

function renderLiveChecks(payload = latestLiveChecks) {
  latestLiveChecks = payload;
  const checks = payload?.checks || [];
  const renderItems = (limit, compact = false) =>
    checks.length
      ? checks
          .slice(0, limit)
          .map((item) => {
            const ok = item.ok !== false && Number(item.exitCode || 0) === 0;
            const latestTrade = item.latestTrade
              ? `${item.latestTrade.side || ""} ${item.latestTrade.name || item.latestTrade.code || ""}`.trim()
              : "无新成交";
            return `
              <div class="learning-item">
                <div>
                  <strong>${new Date(item.finishedAt || item.startedAt).toLocaleTimeString()} · ${liveModeLabel(item.mode)} · ${ok ? "ok" : "failed"}</strong>
                  <small>${item.task || ""}；下次 ${item.nextPollSeconds || "-"} 秒；Agent ${item.agentPosture || "未生成"}${item.agentRiskBudget ? ` / ${item.agentRiskBudget}` : ""}</small>
                  <small>候选 ${item.candidates || 0} · 买入 ${item.paperBuy || 0} · 观察 ${item.focus || 0} · 规避 ${item.avoid || 0} · 持仓 ${item.positions || 0} · ${latestTrade}</small>
                  ${compact ? "" : `<small>${compactText(item.marketSummary || "", 140)}</small>`}
                  ${item.stderr?.length ? `<small class="warn-text">${item.stderr.join(" / ")}</small>` : ""}
                </div>
                <span class="mini-score ${ok ? "" : "negative"}">${ok ? "RUN" : "ERR"}</span>
              </div>
            `;
          })
          .join("")
      : `<div class="empty">还没有轮询记录。后台调度启动后，每轮会写入这里。</div>`;
  if (els.liveChecksOverview) els.liveChecksOverview.innerHTML = renderItems(4, true);
  if (els.liveChecksTrading) els.liveChecksTrading.innerHTML = renderItems(10, false);
}

function renderSectors(data) {
  els.hotBoards.innerHTML = data.hotBoards.length
    ? data.hotBoards
        .slice(0, 12)
        .map(
          (item, index) => `
            <article class="sector-card">
              <div class="rank">${String(index + 1).padStart(2, "0")}</div>
              <div>
                <strong>${item.name}</strong>
                <small>${item.source || "行情接口"}</small>
              </div>
              <div class="sector-stats">
                <span class="${trendClass(item.pct)}">${signed(item.pct)}%</span>
                <span>${money(item.amount)}</span>
                <span>评分 ${item.score}</span>
              </div>
              ${item.leader ? `<p>领涨：${item.leader.name} ${signed(item.leader.pct)}%</p>` : ""}
            </article>
          `,
        )
        .join("")
    : `<div class="empty">真实板块数据源暂时不可用，本轮不生成热门板块。</div>`;
}

function renderResearch(data) {
  const rawItems = data.researchItems || [];
  const query = els.researchSearch?.value.trim().toLowerCase() || "";
  const filter = els.researchFilter?.value || "all";
  const filtered = rawItems.filter((item) => {
    const text = `${item.name} ${item.code} ${item.boardName} ${item.business}`.toLowerCase();
    const queryOk = !query || text.includes(query);
    const filterOk =
      filter === "all" ||
      (filter === "buy" && item.actionCode === "PAPER_BUY") ||
      (filter === "focus" && item.actionCode === "FOCUS") ||
      (filter === "avoid" && ["AVOID", "LLM_AVOID"].includes(item.actionCode));
    return queryOk && filterOk;
  });
  if (!selectedResearchCode || !filtered.some((item) => item.code === selectedResearchCode)) {
    selectedResearchCode = filtered[0]?.code || "";
  }
  const selected = filtered.find((item) => item.code === selectedResearchCode) || filtered[0] || null;

  if (els.researchSummary) {
    const averageScore = filtered.length
      ? Math.round(filtered.reduce((sum, item) => sum + Number(item.researchScore || 0), 0) / filtered.length)
      : 0;
    const withFinancials = filtered.filter((item) => item.financials).length;
    const withEvents = filtered.filter((item) => item.eventSignals?.length).length;
    els.researchSummary.innerHTML = `
      <div><strong>${filtered.length}</strong><span>结果</span></div>
      <div><strong>${averageScore}</strong><span>平均调研分</span></div>
      <div><strong>${withFinancials}</strong><span>财务增强</span></div>
      <div><strong>${withEvents}</strong><span>事件增强</span></div>
    `;
  }

  if (els.researchFocusPanel) {
    els.researchFocusPanel.innerHTML = selected
      ? `
          <div class="focus-card">
            <span class="${actionTag(selected)}">${selected.action}</span>
            <strong>${selected.name} ${selected.code}</strong>
            <small>${selected.boardName} · 调研分 ${selected.researchScore}</small>
            <p>${compactText(selected.business, 180)}</p>
          </div>
          <div class="focus-section">
            <b>赚钱驱动</b>
            ${(selected.profitDrivers || []).slice(0, 5).map((item) => `<span>${item}</span>`).join("")}
          </div>
          <div class="focus-section">
            <b>主要风险</b>
            ${(selected.riskDrivers || []).slice(0, 5).map((item) => `<span>${item}</span>`).join("")}
          </div>
          ${
            selected.financials?.summary
              ? `<div class="focus-section"><b>财务摘要</b><p>${selected.financials.summary}</p></div>`
              : ""
          }
          ${
            selected.eventHeat?.summary
              ? `<div class="focus-section"><b>事件热度</b><p>${selected.eventHeat.summary}</p></div>`
              : ""
          }
          <div class="focus-section">
            <b>下一步验证</b>
            ${(selected.openQuestions || []).map((item) => `<p>${item}</p>`).join("")}
          </div>
        `
      : `<div class="empty">没有符合筛选条件的调研对象。</div>`;
  }

  els.researchGrid.innerHTML = filtered
    .slice(0, 18)
    .map(
      (item) => `
        <article class="research-card ${item.code === selectedResearchCode ? "active" : ""}" data-research-code="${item.code}" role="button" tabindex="0">
          <div class="research-head">
            <div>
              <strong>${item.name} ${item.code}</strong>
              <small>${item.boardName} · ${item.researchStatus} · ${item.researchSource || item.source}</small>
            </div>
            <span class="score">${item.researchScore}</span>
          </div>
          <p>${item.business}</p>
          <dl>
            <dt>客户</dt>
            <dd>${item.customers}</dd>
            <dt>赚钱驱动</dt>
            <dd>${item.profitDrivers.slice(0, 4).join(" / ")}</dd>
            <dt>主要风险</dt>
            <dd>${item.riskDrivers.slice(0, 4).join(" / ")}</dd>
            ${
              item.financials
                ? `<dt>财务增强</dt><dd>${item.financials.summary || item.financials.source}</dd>`
                : ""
            }
            ${
              item.eventHeat
                ? `<dt>事件热度</dt><dd>${item.eventHeat.summary}</dd>`
                : ""
            }
          </dl>
          ${
            item.eventSignals?.length
              ? `<div class="signal-list">${item.eventSignals
                  .slice(0, 3)
                  .map((event) => `<span>${event.title}<small>${event.source || event.provider}${event.time ? ` · ${event.time}` : ""}</small></span>`)
                  .join("")}</div>`
              : ""
          }
          <div class="question-box">${item.openQuestions.map((q) => `<span>${q}</span>`).join("")}</div>
        </article>
      `,
    )
    .join("") || `<div class="empty">没有符合筛选条件的调研对象。</div>`;

  els.researchGrid.querySelectorAll("[data-research-code]").forEach((card) => {
    const select = () => {
      selectedResearchCode = card.dataset.researchCode;
      renderResearch(data);
    };
    card.addEventListener("click", select);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        select();
      }
    });
  });
}

function renderCandidates(data) {
  els.candidateRows.innerHTML = data.candidates
    .slice(0, 24)
    .map(
      (item) => `
        <tr>
          <td><strong>${item.name}</strong><br /><small>${item.code}</small></td>
          <td>${item.boardName}</td>
          <td class="${trendClass(item.pct)}">${signed(item.pct)}%</td>
          <td>${money(item.amount)}</td>
          <td>
            <span class="score">${item.score}</span>
            ${item.llmDecision ? `<br /><small>规则 ${item.ruleScore ?? item.score} / 模型 ${signed(item.llmScoreImpact || 0, 1)}</small>` : ""}
          </td>
          <td><span class="${actionTag(item)}">${item.action}</span></td>
          <td>
            ${item.reason}
            <br /><small>来源：${item.source || "行情接口"}</small>
            ${
              item.decisionContext?.news?.length
                ? `<br /><small>新闻：${item.decisionContext.news
                    .slice(0, 2)
                    .map((news) => news.title)
                    .join(" / ")}</small>`
                : ""
            }
            ${
              item.decisionContext?.eventSearch?.length
                ? `<br /><small>事件搜索：${item.decisionContext.eventSearch
                    .slice(0, 2)
                    .map((event) => event.title)
                    .join(" / ")}</small>`
                : ""
            }
            ${
              item.decisionContext?.announcements?.length
                ? `<br /><small>公告：${item.decisionContext.announcements
                    .slice(0, 2)
                    .map((ann) => ann.title)
                    .join(" / ")}</small>`
                : ""
            }
            ${
              item.llmDecision
                ? `<br /><small>模型：${item.llmDecision.verdict}，信心${Math.round(item.llmDecision.confidence)}；验证：${item.llmDecision.researchFocus || "继续观察"}</small>`
                : ""
            }
            ${item.riskTags?.length ? `<br /><small>风险：${item.riskTags.join("、")}</small>` : ""}
            ${item.riskGate?.blocked ? `<br /><small>风控：${(item.riskGate.reasons || []).slice(0, 2).join("；")}</small>` : ""}
          </td>
        </tr>
      `,
    )
    .join("");
}

function renderPositions(data) {
  els.positions.innerHTML = data.paperPositions.length
    ? data.paperPositions
        .map(
          (item) => {
            const exitPlan = item.exitPlan;
            const exitLine = exitPlan
              ? `动态止损 ${signed(exitPlan.stopLossPct)}% · 动态止盈 ${signed(exitPlan.takeProfitPct)}%`
              : "等待生成动态风控阈值";
            return `
            <div class="position-item">
              <div>
                <strong>${item.name} ${item.code}</strong>
                <small>${item.boardName} · ${item.shares || 0}股 · 成本 ${Number(item.costBasis || item.entryPrice || 0).toFixed(2)}</small>
                <small>${exitLine}</small>
              </div>
              <div class="position-pnl ${trendClass(item.unrealizedPnlPct || 0)}">
                ${signed(item.unrealizedPnlPct || 0)}%
                <small>${money(item.unrealizedPnl || 0)}</small>
              </div>
            </div>
          `;
          },
        )
        .join("")
    : `<div class="empty">暂无模拟持仓。</div>`;
}

function renderTradingSummary(data) {
  if (!els.tradingSummary) return;
  const p = data.portfolio || {};
  const initialCash = Number(p.initialCash || 0);
  const netLiquidation = Number(p.netLiquidation || p.equity || 0);
  const returnPct = Number(p.returnPct || 0);
  const unrealized = Number(p.unrealizedPnl || 0);
  const realized = Number(p.realizedPnl || 0);
  const cashRatio = netLiquidation ? (Number(p.cash || 0) / netLiquidation) * 100 : 0;
  const cards = [
    ["账户总收益率", `${signed(returnPct)}%`, `初始资金 ${money(initialCash)}`, returnPct >= 0 ? "up" : "down"],
    ["清算净值", money(netLiquidation), `总资产 ${money(p.equity || netLiquidation)}`, returnPct >= 0 ? "up" : "down"],
    ["浮盈浮亏", money(unrealized), `已实现 ${money(realized)}`, unrealized >= 0 ? "up" : "down"],
    ["现金仓位", `${cashRatio.toFixed(2)}%`, `现金 ${money(p.cash)}`, ""],
    ["累计费用", money(p.totalFees), "佣金/过户费/印花税", "warn-text"],
  ];
  els.tradingSummary.innerHTML = cards
    .map(
      ([label, value, sub, cls]) => `
        <article class="trading-summary-card">
          <span>${label}</span>
          <strong class="${cls}">${value}</strong>
          <small>${sub}</small>
        </article>
      `,
    )
    .join("");
}

function renderTradingCommand(data, liveStatus) {
  if (!els.tradingCommand) return;
  const p = data.portfolio || {};
  const riskControls = data.strategyReview?.riskControls || data.riskControls || {};
  const riskStatus = riskControls.status || {};
  const latestCheck = latestLiveChecks?.checks?.[0];
  const netLiquidation = Number(p.netLiquidation || p.equity || 0);
  const cashRatio = netLiquidation ? (Number(p.cash || 0) / netLiquidation) * 100 : 0;
  const latestTrade = latestCheck?.latestTrade
    ? `${latestCheck.latestTrade.side || ""} ${latestCheck.latestTrade.name || latestCheck.latestTrade.code || ""}`.trim()
    : "无新成交";
  const cards = [
    {
      label: "运行状态",
      value: liveModeShortLabel(liveStatus?.mode),
      body: liveStatus?.message || liveModeLabel(liveStatus?.mode),
      tone: liveStatus?.mode === "PAPER_TRADE" ? "good" : "",
    },
    {
      label: "最近轮询",
      value: latestCheck ? new Date(latestCheck.finishedAt || latestCheck.startedAt).toLocaleTimeString() : "等待记录",
      body: latestCheck
        ? `候选 ${latestCheck.candidates || 0} · 买入 ${latestCheck.paperBuy || 0} · ${latestTrade}`
        : "后台脚本写入后会显示每轮检测。",
      tone: latestCheck?.ok === false ? "risk" : latestCheck ? "good" : "warn",
    },
    {
      label: "风控闸门",
      value: riskControls.enabled === false ? "未启用" : riskStatus.blocked ? "暂停新开仓" : "正常",
      body:
        riskControls.enabled === false
          ? "候选买入未经过集中度、追高和回撤闸门。"
          : riskStatus.blocked
            ? compactText((riskStatus.reasons || []).join("；"), 84)
            : `回撤 ${signed(riskStatus.drawdownPct || 0)}% · 连亏 ${riskStatus.lossStreak || 0}`,
      tone: riskControls.enabled === false || riskStatus.blocked ? "warn" : "good",
    },
    {
      label: "资金暴露",
      value: `${data.paperPositions?.length || 0} 个持仓`,
      body: `现金 ${cashRatio.toFixed(1)}% · 持仓市值 ${money(p.marketValue || 0)}`,
      tone: cashRatio < 12 ? "warn" : "",
    },
  ];
  els.tradingCommand.innerHTML = cards
    .map(
      (item) => `
        <div class="trade-command-card ${item.tone || ""}">
          <span>${item.label}</span>
          <strong>${item.value}</strong>
          <p>${item.body}</p>
        </div>
      `,
    )
    .join("");
}

function renderTrades(data) {
  const feeDetail = (item) => {
    const fees = item.fees || {};
    const parts = [
      `佣${money(fees.commission || 0)}`,
      `过${money(fees.transferFee || 0)}`,
      item.side === "SELL" ? `印${money(fees.stampDuty || 0)}` : "",
      item.slippageCost ? `滑${money(item.slippageCost)}` : "",
    ].filter(Boolean);
    return parts.join(" / ");
  };
  els.tradeRows.innerHTML = data.tradeLog?.length
    ? data.tradeLog
        .slice()
        .reverse()
        .slice(0, 12)
        .map(
          (item) => `
            <tr>
              <td>${item.executedAtLocal || item.date}<br /><small>${item.timeEstimated ? "补记日期，非精确成交时刻" : "模拟执行"}</small></td>
              <td><span class="tag ${item.side === "BUY" ? "tag-buy" : "tag-watch"}">${item.side}</span></td>
              <td>${item.name}<br /><small>${item.code}</small></td>
              <td>${item.shares}</td>
              <td>${Number(item.price || 0).toFixed(2)}<br /><small>行情 ${Number(item.quotePrice || item.price || 0).toFixed(2)}</small></td>
              <td>${money(item.fees?.total)}<br /><small>${feeDetail(item)}</small></td>
            </tr>
          `,
        )
        .join("")
    : `<tr><td colspan="6">暂无交易流水</td></tr>`;
}

function renderReview(data) {
  const regime = data.marketRegime || {};
  const reviewCards = [
    ["市场状态", regime.summary || "暂无", [`评分 ${regime.score || 0}`, `强势板块 ${regime.strongBoards || 0}`]],
    ["今日热点", data.hotBoards.slice(0, 4).map((item) => `${item.name} ${signed(item.pct)}%`).join(" / ") || "暂无", ["验证持续性", "避免一日游"]],
    ["交易动作", data.paperDecisions.slice(-4).map((item) => `${item.name}：${item.decision}`).join(" / ") || "暂无新动作", ["检查T+1", "检查费用"]],
    ["明日问题", "热点是否延续？候选是否来自板块共振？止损条件是否触发？", ["盘后复盘", "样本积累"]],
  ];
  els.dailyReview.innerHTML = reviewCards
    .map(
      ([title, body, tags]) => `
        <article class="review-card">
          <strong>${title}</strong>
          <p>${body}</p>
          <div>${tags.map((tag) => `<span class="mini-tag">${tag}</span>`).join("")}</div>
        </article>
      `,
    )
    .join("");
}

function renderStrategy(data, optimizer = latestOptimizer) {
  const s = data.strategyReview || {};
  const llm = data.llmDecision || {};
  const adaptive = s.adaptiveRisk || data.adaptiveRisk || {};
  const hasAdaptiveRisk = Object.keys(adaptive).length > 0;
  const learning = adaptive.learning || {};
  const examples = adaptive.examples || [];
  const optimizerAdvice = optimizer?.advice || [];
  const optimizerBacktest = optimizer?.backtest || {};
  const proposed = optimizer?.proposed || {};
  const riskControls = s.riskControls || data.riskControls || {};
  const riskStatus = riskControls.status || {};
  const boardLimit = riskControls.maxBoardExposurePct ?? 0.45;
  const chaseLimit = riskControls.chasePctLimit ?? 7.5;
  const minAmount = riskControls.minAmount ?? 500000000;
  const attribution = s.attribution || {};
  const factorText = (items = []) => items.slice(0, 5).map((item) => `${item.name} x${item.count}`);
  const blockedText = (items = []) =>
    items.slice(0, 4).map((item) => `${item.name}：${(item.reasons || []).slice(0, 2).join("；")}`);
  els.strategyReview.innerHTML = `
    <div class="strategy-grid">
      <div><span>样本</span><strong>${s.sampleCount || 0}</strong></div>
      <div><span>胜率</span><strong>${signed(s.winRate || 0)}%</strong></div>
      <div><span>平均收益</span><strong>${signed(s.avgReturn || 0)}%</strong></div>
      <div><span>策略版本</span><strong>${(s.strategyVersion?.id || data.strategyVersion?.id || "未生成").replace("strategy-", "")}</strong></div>
    </div>
    <div class="note-block">
      <strong>下一步</strong>
      <p>${s.nextOptimization || "继续积累样本。"}</p>
      ${list(s.lessons || [])}
    </div>
    <div class="note-block">
      <strong>风控闸门</strong>
      <p>${
        riskControls.enabled === false
          ? "未启用：候选买入不会经过账户回撤、板块集中度、追高和流动性闸门。"
          : riskStatus.blocked
            ? `暂停新开仓：${(riskStatus.reasons || []).join("；")}`
            : `已启用：当前回撤 ${signed(riskStatus.drawdownPct || 0)}%，连续亏损 ${riskStatus.lossStreak || 0} 笔。`
      }</p>
      <p>单板块上限 ${signed(boardLimit * 100)}%；追高阈值 ${signed(chaseLimit)}%；最低成交额 ${money(minAmount)}。</p>
      ${riskStatus.topBoard ? `<p>当前最大板块：${riskStatus.topBoard.name}，占比 ${signed(riskStatus.topBoard.exposurePct || 0)}%。</p>` : ""}
    </div>
    <div class="note-block">
      <strong>动态止盈止损</strong>
      <p>${
        !hasAdaptiveRisk
          ? "等待下一轮刷新生成动态止盈止损计划。"
          : adaptive.enabled === false
          ? "未启用：当前使用固定止盈止损。"
          : `已启用：止损边界 ${signed(adaptive.minStopLossPct)}% 到 ${signed(adaptive.maxStopLossPct)}%，止盈边界 ${signed(adaptive.minTakeProfitPct)}% 到 ${signed(adaptive.maxTakeProfitPct)}%。`
      }</p>
      <p>学习样本 ${learning.sampleCount || 0}；止损修正 ${signed(learning.stopLossNudge || 0, 1)}，止盈修正 ${signed(learning.takeProfitNudge || 0, 1)}。</p>
      ${
        examples.length
          ? `<div class="exit-plan-list">${examples
              .map(
                (item) => `
                  <div>
                    <strong>${item.name}</strong>
                    <span>${signed(item.exitPlan?.stopLossPct || 0)}% / ${signed(item.exitPlan?.takeProfitPct || 0)}%</span>
                    <small>${(item.exitPlan?.reasons || []).slice(0, 2).join("；")}</small>
                  </div>
                `,
              )
              .join("")}</div>`
          : ""
      }
    </div>
    <div class="note-block">
      <strong>交易归因</strong>
      <p>风控拦截 ${attribution.blockedCount || 0} 个候选；每笔买卖会记录策略版本、入场依据、风险标签和退出触发。</p>
      ${list([
        ...factorText(attribution.topEntryFactors).map((item) => `入场因子：${item}`),
        ...factorText(attribution.exitTriggers).map((item) => `退出触发：${item}`),
        ...blockedText(attribution.blockedExamples).map((item) => `拦截：${item}`),
      ].slice(0, 8))}
    </div>
    <div class="note-block">
      <strong>回测证据</strong>
      <p>${
        optimizerBacktest.status === "ok"
          ? `最近回测 ${optimizerBacktest.range?.start || ""} 至 ${optimizerBacktest.range?.end || ""}，策略收益 ${signed(optimizerBacktest.returnPct)}%，超额 ${
              optimizerBacktest.alphaPct === null || optimizerBacktest.alphaPct === undefined ? "无基准" : `${signed(optimizerBacktest.alphaPct)}%`
            }，胜率 ${signed(optimizerBacktest.winRate)}%，交易 ${optimizerBacktest.tradeCount || 0} 笔。`
          : optimizerBacktest.summary || "还没有历史回测证据，运行回测后会自动进入优化器。"
      }</p>
      <div class="strategy-grid">
        <div><span>建议买入阈值</span><strong>${proposed.buyScoreThreshold ?? "-"}</strong></div>
        <div><span>建议止损/止盈</span><strong>${
          proposed.stopLossPct === undefined ? "-" : `${signed(proposed.stopLossPct, 1)}% / ${signed(proposed.takeProfitPct || 0, 1)}%`
        }</strong></div>
        <div><span>建议追高上限</span><strong>${
          proposed.riskControls?.chasePctLimit === undefined ? "-" : `${signed(proposed.riskControls.chasePctLimit, 1)}%`
        }</strong></div>
      </div>
    </div>
    <div class="note-block">
      <strong>定时策略学习</strong>
      <p>${
        optimizer
          ? `最近优化：${new Date(optimizer.generatedAt).toLocaleString()}；样本 ${optimizer.metrics?.sampleCount || 0}，胜率 ${signed(optimizer.metrics?.winRate || 0)}%，盈亏因子 ${Number(optimizer.metrics?.profitFactor || 0).toFixed(2)}。`
          : "还没有定时策略学习结果。晚间或盘后调度运行后会生成。"
      }</p>
      ${list(optimizerAdvice.slice(0, 4).map((item) => `${item.title}：${item.body}`))}
    </div>
    <div class="note-block">
      <strong>大模型决策层</strong>
      <p>${llm.summary || "未开启大模型决策。"}</p>
      ${llm.marketRead ? `<p>${llm.marketRead}</p>` : ""}
      ${list(llm.parameterAdvice || [])}
    </div>
  `;

  const learningItems = Object.entries(data.learning || {});
  els.learning.innerHTML = learningItems.length
    ? learningItems
        .map(
          ([name, item]) => `
            <div class="learning-item">
              <div>
                <strong>${name}</strong>
                <small>样本 ${item.count} · 胜 ${item.wins} · 负 ${item.losses} · 平均 ${signed(item.avgReturn)}%</small>
              </div>
              <span class="mini-score">${signed(item.bias, 1)}</span>
            </div>
          `,
        )
        .join("")
    : `<div class="empty">还没有已关闭的模拟交易，学习偏好暂未形成。</div>`;
}

function renderStrategyCommand(data, optimizer = latestOptimizer) {
  if (!els.strategyCommand) return;
  const s = data.strategyReview || {};
  const trading = latestConfig?.trading || {};
  const proposed = optimizer?.proposed || {};
  const optimizerBacktest = optimizer?.backtest || {};
  const sweepBest = latestSweep?.status === "ok" ? latestSweep.rankings?.[0] : null;
  const agentOk = latestAgent?.status === "ok";
  const cards = [
    {
      label: "样本质量",
      value: `${s.sampleCount || 0} 笔`,
      body: `胜率 ${signed(s.winRate || 0)}% · 平均 ${signed(s.avgReturn || 0)}%`,
      tone: Number(s.sampleCount || 0) >= 20 ? "good" : "warn",
    },
    {
      label: "当前参数",
      value: `买入 >= ${trading.buyScoreThreshold ?? "-"}`,
      body: `止损 ${signed(trading.stopLossPct || 0, 1)}% · 止盈 ${signed(trading.takeProfitPct || 0, 1)}% · 追高 ${signed(trading.riskControls?.chasePctLimit ?? trading.chasePctLimit ?? 0, 1)}%`,
      tone: "",
    },
    {
      label: "优化器",
      value: proposed.buyScoreThreshold === undefined ? "等待建议" : `建议 >= ${proposed.buyScoreThreshold}`,
      body:
        optimizerBacktest.status === "ok"
          ? `回测收益 ${signed(optimizerBacktest.returnPct || 0)}% · 胜率 ${signed(optimizerBacktest.winRate || 0)}%`
          : optimizer?.generatedAt
            ? "已生成建议，等待更多回测证据。"
            : "等待回测或定时任务生成。",
      tone: optimizerBacktest.status === "ok" ? "good" : "warn",
    },
    {
      label: "Agent / 寻优",
      value: sweepBest ? "候选已排队" : agentOk ? "Agent 已参与" : "等待验证",
      body: sweepBest
        ? `${sweepBest.name || sweepBest.scenario || "第一名"} · 得分 ${Number(sweepBest.score || 0).toFixed(1)}`
        : latestAgent?.posture?.label || latestAgent?.posture?.mode || "运行 Agent 后会同步到策略姿态。",
      tone: sweepBest || agentOk ? "good" : "warn",
    },
  ];
  els.strategyCommand.innerHTML = cards
    .map(
      (item) => `
        <div class="strategy-command-card ${item.tone || ""}">
          <span>${item.label}</span>
          <strong>${item.value}</strong>
          <p>${item.body}</p>
        </div>
      `,
    )
    .join("");
}

function renderStrategyEvolution(data, config = latestConfig, optimizer = latestOptimizer, backtest = latestBacktest, sweep = latestSweep, agent = latestAgent) {
  if (!els.strategyEvolution) return;
  const trading = config?.trading || config || {};
  const proposed = optimizer?.proposed || {};
  const agentPolicy = agent?.policy || {};
  const sweepBest = sweep?.rankings?.[0] || null;
  const backtestMetrics = backtest?.status === "ok" ? backtest.metrics || {} : optimizer?.backtest || {};
  const pctValue = (value) => (value === null || value === undefined || value === "" ? null : Number(value));
  const directionClass = (current, next, inverse = false) => {
    if (next === null || current === null || Math.abs(next - current) < 0.0001) return "neutral";
    const upIsTighter = inverse ? next < current : next > current;
    return upIsTighter ? "tighten" : "loosen";
  };
  const directionText = (current, next, inverse = false) => {
    if (next === null || current === null) return "等待建议";
    if (Math.abs(next - current) < 0.0001) return "不变";
    const upIsTighter = inverse ? next < current : next > current;
    return upIsTighter ? "收紧" : "放宽";
  };
  const fmt = (value, suffix = "", digits = 1) =>
    value === null || value === undefined || Number.isNaN(Number(value)) ? "-" : `${Number(value).toFixed(digits)}${suffix}`;
  const rows = [
    {
      label: "买入评分阈值",
      current: pctValue(trading.buyScoreThreshold),
      optimizer: pctValue(proposed.buyScoreThreshold),
      agent: pctValue(agentPolicy.buyScoreThreshold),
      suffix: "",
      digits: 0,
      min: 50,
      max: 90,
      inverse: false,
    },
    {
      label: "止损线",
      current: pctValue(trading.stopLossPct),
      optimizer: pctValue(proposed.stopLossPct),
      agent: pctValue(agentPolicy.stopLossPct),
      suffix: "%",
      digits: 1,
      min: -12,
      max: -2,
      inverse: true,
    },
    {
      label: "止盈线",
      current: pctValue(trading.takeProfitPct),
      optimizer: pctValue(proposed.takeProfitPct),
      agent: pctValue(agentPolicy.takeProfitPct),
      suffix: "%",
      digits: 1,
      min: 4,
      max: 20,
      inverse: false,
    },
    {
      label: "追高上限",
      current: pctValue(trading.riskControls?.chasePctLimit),
      optimizer: pctValue(proposed.riskControls?.chasePctLimit),
      agent: pctValue(agentPolicy.chasePctLimit),
      suffix: "%",
      digits: 1,
      min: 3,
      max: 12,
      inverse: true,
    },
    {
      label: "单板块上限",
      current: pctValue(trading.riskControls?.maxBoardExposurePct) === null ? null : pctValue(trading.riskControls?.maxBoardExposurePct) * 100,
      optimizer: pctValue(proposed.riskControls?.maxBoardExposurePct) === null ? null : pctValue(proposed.riskControls?.maxBoardExposurePct) * 100,
      agent: pctValue(agentPolicy.maxBoardExposurePct) === null ? null : pctValue(agentPolicy.maxBoardExposurePct) * 100,
      suffix: "%",
      digits: 0,
      min: 20,
      max: 80,
      inverse: true,
    },
  ];
  const markerLeft = (row, value) => {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return null;
    return Math.max(0, Math.min(100, ((Number(value) - row.min) / (row.max - row.min)) * 100));
  };
  const evidence = [
    {
      title: "回测证据",
      status: backtest?.status === "ok" || optimizer?.backtest?.status === "ok" ? "可用" : "缺失",
      body:
        backtest?.status === "ok"
          ? `收益 ${signed(backtestMetrics.returnPct || 0)}%，超额 ${backtestMetrics.alphaPct === null || backtestMetrics.alphaPct === undefined ? "无基准" : `${signed(backtestMetrics.alphaPct)}%`}，交易 ${backtestMetrics.tradeCount || 0} 笔。`
          : optimizer?.backtest?.summary || "运行历史回测后会进入进化判断。",
      tone: Number(backtestMetrics.alphaPct || 0) < 0 ? "risk" : "good",
    },
    {
      title: "参数寻优",
      status: sweepBest ? "可用" : "缺失",
      body: sweepBest
        ? `最佳组合：阈值 ${sweepBest.params.buyScoreThreshold}，止损 ${signed(sweepBest.params.stopLossPct, 1)}%，止盈 ${signed(sweepBest.params.takeProfitPct, 1)}%，追高 ${signed(sweepBest.params.chasePctLimit, 1)}%；${sweepBest.summary.positiveWindows}/${sweepBest.summary.windowCount} 个窗口为正。`
        : "运行参数寻优后会展示多窗口稳健性。",
      tone: sweepBest?.summary?.positiveWindows >= 2 ? "good" : "risk",
    },
    {
      title: "Agent裁决",
      status: agent?.status === "ok" ? agent.posture?.label || "已生成" : "缺失",
      body: agent?.status === "ok" ? `${agent.posture?.summary || ""} 新开仓上限 ${agentPolicy.maxNewPositions ?? "-"}；应用模式 ${agentPolicy.applyMode || "suggest_only"}。` : "运行 Agent 后会把建议转成执行姿态。",
      tone: agentPolicy.maxNewPositions > 0 ? "good" : "risk",
    },
  ];
  const version = (data.strategyVersion?.id || data.strategyReview?.strategyVersion?.id || optimizer?.metrics?.strategyVersionId || "未生成").replace("strategy-", "");
  const appliedText = optimizer?.apply?.applied ? "优化器建议已应用到配置" : "当前为建议模式，尚未自动改配置";
  els.strategyEvolution.innerHTML = `
    <div class="evolution-flow">
      <div>
        <span>当前策略</span>
        <strong>${version}</strong>
        <small>页面配置正在生效</small>
      </div>
      <div>
        <span>优化器建议</span>
        <strong>${optimizer?.generatedAt ? new Date(optimizer.generatedAt).toLocaleTimeString() : "等待"}</strong>
        <small>${appliedText}</small>
      </div>
      <div>
        <span>Agent执行策略</span>
        <strong>${agent?.posture?.label || "等待"}</strong>
        <small>风险预算 ${agent?.posture?.riskBudget || "-"}</small>
      </div>
    </div>
    <div class="evolution-params">
      ${rows
        .map((row) => {
          const finalValue = row.agent ?? row.optimizer;
          const cls = directionClass(row.current, finalValue, row.inverse);
          const points = [
            ["current", row.current],
            ["optimizer", row.optimizer],
            ["agent", row.agent],
          ];
          return `
            <div class="evolution-row">
              <div class="evolution-row-head">
                <strong>${row.label}</strong>
                <span class="${cls}">${directionText(row.current, finalValue, row.inverse)}</span>
              </div>
              <div class="evolution-scale">
                ${points
                  .map(([name, value]) => {
                    const left = markerLeft(row, value);
                    return left === null ? "" : `<i class="${name}" style="left:${left}%"></i>`;
                  })
                  .join("")}
              </div>
              <div class="evolution-values">
                <span>当前 ${fmt(row.current, row.suffix, row.digits)}</span>
                <span>优化器 ${fmt(row.optimizer, row.suffix, row.digits)}</span>
                <span>Agent ${fmt(row.agent, row.suffix, row.digits)}</span>
              </div>
            </div>
          `;
        })
        .join("")}
    </div>
    <div class="evidence-grid">
      ${evidence
        .map(
          (item) => `
            <div class="evidence-card ${item.tone}">
              <span>${item.status}</span>
              <strong>${item.title}</strong>
              <p>${item.body}</p>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderStrategyLab(report = latestStrategyLab) {
  latestStrategyLab = report;
  const empty = `<div class="empty">还没有多策略实验室报告。运行寻优、回测或等待定时任务后会生成。</div>`;
  if (els.strategyLabOverview && (!report || report.status !== "ok")) els.strategyLabOverview.innerHTML = empty;
  if (els.strategyLabDetail && (!report || report.status !== "ok")) els.strategyLabDetail.innerHTML = empty;
  if (!report || report.status !== "ok") return;

  const statusClass = (status) => {
    if (status === "PROMOTE_CANDIDATE" || status === "ACTIVE") return "good";
    if (status === "REJECT") return "negative";
    if (status === "DEFENSIVE_ONLY") return "warning";
    return "";
  };
  const paramsText = (item) => {
    const p = item.parameters || {};
    if (item.id === "cash-etf-guard") return `新开仓 ${p.maxNewPositions ?? "-"}；${p.preferred || "观察"}`;
    return `买入>=${p.buyScoreThreshold ?? "-"} / 止损${p.stopLossPct === undefined ? "-" : `${signed(p.stopLossPct, 1)}%`} / 止盈${
      p.takeProfitPct === undefined ? "-" : `${signed(p.takeProfitPct, 1)}%`
    } / 追高${p.chasePctLimit === undefined ? "-" : `${signed(p.chasePctLimit, 1)}%`} / 时间${p.timeStopDays ?? "-"}天`;
  };
  const candidates = report.candidates || [];
  const top = candidates.slice().sort((a, b) => Number(b.score || 0) - Number(a.score || 0)).slice(0, 4);
  if (els.strategyLabOverview) {
    els.strategyLabOverview.innerHTML = `
      <div class="strategy-lab-hero">
        <div>
          <span>市场状态</span>
          <strong>${report.marketState?.label || "未知"}</strong>
          <p>${report.marketState?.summary || ""}</p>
        </div>
        <div>
          <span>数据质量</span>
          <strong>${report.dataQuality?.score ?? "-"} / 100</strong>
          <p>${report.dataQuality?.recommendation || ""}</p>
        </div>
      </div>
      <div class="strategy-candidate-grid">
        ${top
          .map(
            (item) => `
              <div class="strategy-candidate ${item.style || ""}">
                <div class="strategy-candidate-head">
                  <div>
                    <strong>${item.name}</strong>
                    <small>${item.role}</small>
                  </div>
                  <span class="mini-score ${statusClass(item.status)}">${item.statusLabel}</span>
                </div>
                <p>${item.description}</p>
                <small>${paramsText(item)}</small>
              </div>
            `,
          )
          .join("")}
      </div>
    `;
  }
  if (els.strategyLabDetail) {
    els.strategyLabDetail.innerHTML = `
      <div class="strategy-lab-hero">
        <div>
          <span>当前判断</span>
          <strong>${report.marketState?.label || "未知"}</strong>
          ${list(report.marketState?.reasons || [])}
        </div>
        <div>
          <span>晋级规则</span>
          <strong>先观察再应用</strong>
          ${list(report.promotionRules || [])}
        </div>
      </div>
      <div class="strategy-candidate-grid detail">
        ${candidates
          .map(
            (item) => `
              <div class="strategy-candidate ${item.style || ""}">
                <div class="strategy-candidate-head">
                  <div>
                    <strong>${item.name}</strong>
                    <small>${item.role} · 评分 ${Number(item.score || 0).toFixed(1)}</small>
                  </div>
                  <span class="mini-score ${statusClass(item.status)}">${item.statusLabel}</span>
                </div>
                <p>${item.recommendation}</p>
                <small>${paramsText(item)}</small>
                ${list(item.evidence || [])}
              </div>
            `,
          )
          .join("")}
      </div>
      <div class="note-block">
        <strong>下一步</strong>
        ${list(report.nextActions || [])}
      </div>
    `;
  }
}

function renderBacktest(report = latestBacktest) {
  if (!els.backtestSummary || !els.backtestBenchmarks || !els.backtestTrades) return;
  latestBacktest = report;
  if (!report) {
    els.backtestSummary.innerHTML = `<div class="empty">还没有历史回测结果。</div>`;
    els.backtestBenchmarks.innerHTML = `<div class="empty">运行回测后展示基准对比。</div>`;
    els.backtestTrades.innerHTML = `<div class="empty">暂无回放交易。</div>`;
    return;
  }
  if (report.status === "error") {
    els.backtestSummary.innerHTML = `<div class="empty">回测失败：${report.error || report.warnings?.[0] || "未知错误"}</div>`;
    els.backtestBenchmarks.innerHTML = `<div class="empty">没有可用基准。</div>`;
    els.backtestTrades.innerHTML = `<div class="empty">暂无回放交易。</div>`;
    return;
  }
  const m = report.metrics || {};
  els.backtestSummary.innerHTML = `
    <div class="strategy-grid">
      <div><span>策略收益</span><strong class="${trendClass(m.returnPct)}">${signed(m.returnPct)}%</strong></div>
      <div><span>最大回撤</span><strong class="warn-text">${signed(m.maxDrawdownPct)}%</strong></div>
      <div><span>胜率</span><strong>${signed(m.winRate)}%</strong></div>
      <div><span>盈亏因子</span><strong>${Number(m.profitFactor || 0).toFixed(2)}</strong></div>
    </div>
    <div class="note-block">
      <strong>${report.range?.start || ""} 至 ${report.range?.end || ""}</strong>
      <p>策略 ${report.strategy?.name || report.strategy?.id || "动量评分策略"}；场景 ${report.scenario === "sweep-best" ? "寻优第一名候选参数" : "当前生效策略"}；数据源 ${report.source || "unknown"}；股票 ${report.universe?.count || 0} 只；交易日 ${
        report.range?.tradingDays || 0
      } 天；策略版本 ${report.strategyVersion || "未生成"}。</p>
      ${
        report.testedParameters
          ? `<p>测试参数：买入>=${report.testedParameters.buyScoreThreshold}；止损${signed(report.testedParameters.stopLossPct, 1)}%；止盈${signed(
              report.testedParameters.takeProfitPct,
              1,
            )}%；追高${signed(report.testedParameters.chasePctLimit, 1)}%；时间止损${report.testedParameters.timeStopDays}天。</p>`
          : ""
      }
      ${list(report.assumptions || [])}
      ${report.warnings?.length ? list(report.warnings.slice(0, 4).map((item) => `数据警告：${item}`)) : ""}
    </div>
  `;

  const benchmarkLabels = {
    "sh.000300": "沪深300",
    "sh.000001": "上证指数",
    "sz.399006": "创业板指",
  };
  els.backtestBenchmarks.innerHTML = `
    <div class="strategy-grid">
      <div><span>基准收益</span><strong>${m.benchmarkReturnPct === null ? "无数据" : `${signed(m.benchmarkReturnPct)}%`}</strong></div>
      <div><span>超额收益</span><strong class="${trendClass(m.alphaPct || 0)}">${m.alphaPct === null ? "无数据" : `${signed(m.alphaPct)}%`}</strong></div>
      <div><span>已关闭交易</span><strong>${m.tradeCount || 0}</strong></div>
    </div>
    <div class="note-block">
      <strong>指数</strong>
      ${list(Object.entries(report.benchmarks || {}).map(([code, item]) => `${benchmarkLabels[code] || code}：${item.returnPct === null ? "无数据" : `${signed(item.returnPct)}%`}`))}
    </div>
  `;

  const trades = report.tradeLog || [];
  els.backtestTrades.innerHTML = trades.length
    ? trades
        .slice()
        .reverse()
        .slice(0, 16)
        .map(
          (trade) => `
            <div class="learning-item">
              <div>
                <strong>${trade.date} · ${trade.side} ${trade.code}</strong>
                <small>${trade.shares || 0}股 · 价格 ${Number(trade.price || 0).toFixed(2)} · ${trade.reason || ""}</small>
              </div>
              <span class="mini-score ${trendClass(trade.pnlPct || 0)}">${trade.side === "SELL" ? `${signed(trade.pnlPct || 0)}%` : "BUY"}</span>
            </div>
          `,
        )
        .join("")
    : `<div class="empty">没有触发回放交易。</div>`;
}

function renderSweep(report = latestSweep) {
  if (!els.sweepSummary || !els.sweepRankings || !els.sweepWindows) return;
  latestSweep = report;
  if (!report) {
    els.sweepSummary.innerHTML = `<div class="empty">还没有参数寻优结果。</div>`;
    els.sweepRankings.innerHTML = `<div class="empty">运行寻优后展示稳健参数组合。</div>`;
    els.sweepWindows.innerHTML = `<div class="empty">暂无窗口表现。</div>`;
    return;
  }
  if (report.status === "error") {
    els.sweepSummary.innerHTML = `<div class="empty">寻优失败：${report.error || report.warnings?.[0] || "未知错误"}</div>`;
    els.sweepRankings.innerHTML = `<div class="empty">暂无排名。</div>`;
    els.sweepWindows.innerHTML = `<div class="empty">暂无窗口表现。</div>`;
    return;
  }
  const best = report.best || report.rankings?.[0] || {};
  const p = best.params || {};
  const s = best.summary || {};
  els.sweepSummary.innerHTML = `
    <div class="strategy-grid">
      <div><span>测试组合</span><strong>${report.grid?.combinations || 0}</strong></div>
      <div><span>回测次数</span><strong>${report.grid?.testedRuns || 0}</strong></div>
      <div><span>最优评分</span><strong>${Number(best.score || 0).toFixed(2)}</strong></div>
      <div><span>平均超额</span><strong class="${trendClass(s.avgAlphaPct || 0)}">${signed(s.avgAlphaPct || 0)}%</strong></div>
      <div><span>平均收益</span><strong class="${trendClass(s.avgReturnPct || 0)}">${signed(s.avgReturnPct || 0)}%</strong></div>
      <div><span>平均回撤</span><strong class="warn-text">${signed(s.avgDrawdownPct || 0)}%</strong></div>
    </div>
    <div class="note-block">
      <strong>推荐候选参数</strong>
      <p>策略 ${report.strategy?.name || report.strategy?.id || "动量评分策略"}；买入阈值 ${p.buyScoreThreshold ?? "-"}；止损 ${signed(p.stopLossPct || 0, 1)}%；止盈 ${signed(p.takeProfitPct || 0, 1)}%；追高上限 ${signed(p.chasePctLimit || 0, 1)}%；时间止损 ${p.timeStopDay ?? "-"} 天。</p>
      ${list(report.notes || [])}
    </div>
  `;
  els.sweepRankings.innerHTML = (report.rankings || []).length
    ? report.rankings
        .slice(0, 10)
        .map((item) => {
          const params = item.params || {};
          const summary = item.summary || {};
          return `
            <div class="learning-item">
              <div>
                <strong>#${item.rank} · score ${Number(item.score || 0).toFixed(2)}</strong>
                <small>买入>=${params.buyScoreThreshold} / 止损${signed(params.stopLossPct || 0, 1)}% / 止盈${signed(params.takeProfitPct || 0, 1)}% / 追高${signed(params.chasePctLimit || 0, 1)}% / 时间${params.timeStopDay}天</small>
                <small>平均超额 ${signed(summary.avgAlphaPct || 0)}%，平均收益 ${signed(summary.avgReturnPct || 0)}%，回撤 ${signed(summary.avgDrawdownPct || 0)}%，交易 ${summary.totalTrades || 0} 笔</small>
              </div>
              <span class="mini-score ${trendClass(summary.avgAlphaPct || 0)}">${summary.positiveWindows || 0}/${summary.windowCount || 0}</span>
            </div>
          `;
        })
        .join("")
    : `<div class="empty">暂无排名。</div>`;
  els.sweepWindows.innerHTML = (best.windows || []).length
    ? best.windows
        .map(
          (item) => `
            <div class="learning-item">
              <div>
                <strong>${item.label} · ${item.start} 至 ${item.end}</strong>
                <small>收益 ${signed(item.returnPct || 0)}%，基准 ${item.benchmarkReturnPct === null ? "无数据" : `${signed(item.benchmarkReturnPct || 0)}%`}，超额 ${item.alphaPct === null ? "无数据" : `${signed(item.alphaPct || 0)}%`}</small>
                <small>胜率 ${signed(item.winRate || 0)}%，盈亏因子 ${Number(item.profitFactor || 0).toFixed(2)}，交易 ${item.tradeCount || 0} 笔</small>
              </div>
              <span class="mini-score ${trendClass(item.alphaPct || 0)}">${signed(item.maxDrawdownPct || 0)}%</span>
            </div>
          `,
        )
        .join("")
    : `<div class="empty">暂无窗口表现。</div>`;
}

function renderAgent(report = latestAgent) {
  if (!els.agentSummary || !els.agentPolicy || !els.agentDiagnostics || !els.agentQueue || !els.agentExecution) return;
  latestAgent = report;
  if (!report) {
    els.agentSummary.innerHTML = `<div class="empty">还没有 Agent 报告。点击“运行Agent”生成。</div>`;
    els.agentPolicy.innerHTML = `<div class="empty">等待 Agent 生成自适应策略。</div>`;
    els.agentDiagnostics.innerHTML = `<div class="empty">暂无诊断。</div>`;
    els.agentQueue.innerHTML = `<div class="empty">暂无研究队列。</div>`;
    els.agentExecution.innerHTML = `<div class="empty">暂无执行计划。</div>`;
    return;
  }
  const posture = report.posture || {};
  const policy = report.policy || {};
  const market = report.market || {};
  const backtest = report.backtest || {};
  const concentration = report.concentration || {};
  const heroClass = posture.mode === "SELECTIVE_ATTACK" ? "attack" : posture.riskBudget === "LOW" ? "defense" : "balanced";
  els.agentSummary.innerHTML = `
    <div class="decision-hero ${heroClass}">
      <div>
        <span>${posture.label || "等待判断"} · ${posture.tradePermission || "paper_only"}</span>
        <strong>${posture.summary || "Agent 正在等待更多证据。"}</strong>
        <small>市场 ${market.score || 0} 分；风险预算 ${posture.riskBudget || "NORMAL"}；信心 ${posture.confidence || 0}。</small>
      </div>
      <div class="decision-counts">
        <div><span>候选</span><strong>${report.candidates?.count || 0}</strong></div>
        <div><span>买入</span><strong>${report.candidates?.buyLike || 0}</strong></div>
        <div><span>观察</span><strong>${report.candidates?.focus || 0}</strong></div>
        <div><span>规避</span><strong>${report.candidates?.avoid || 0}</strong></div>
      </div>
    </div>
    <div class="note-block">
      <strong>为什么是这个姿态</strong>
      ${list(posture.reasons || [])}
      <p>输入：行情 ${report.inputs?.dashboard ? "可用" : "缺失"}；回测 ${report.inputs?.backtest || "unknown"}；优化器 ${report.inputs?.optimizer || "unknown"}；模型 ${report.inputs?.llmDecision || "unknown"}。</p>
    </div>
  `;
  els.agentPolicy.innerHTML = `
    <div class="strategy-grid">
      <div><span>买入阈值</span><strong>${policy.buyScoreThreshold ?? "-"}</strong></div>
      <div><span>止损/止盈</span><strong>${
        policy.stopLossPct === undefined ? "-" : `${signed(policy.stopLossPct, 1)}% / ${signed(policy.takeProfitPct || 0, 1)}%`
      }</strong></div>
      <div><span>追高上限</span><strong>${policy.chasePctLimit === undefined ? "-" : `${signed(policy.chasePctLimit, 1)}%`}</strong></div>
      <div><span>单板块上限</span><strong>${
        policy.maxBoardExposurePct === undefined ? "-" : `${signed(policy.maxBoardExposurePct * 100, 1)}%`
      }</strong></div>
      <div><span>新增仓位</span><strong>${policy.maxNewPositions ?? 0}</strong></div>
      <div><span>应用方式</span><strong>${policy.applyMode || "suggest_only"}</strong></div>
    </div>
    <div class="note-block">
      <strong>策略依据</strong>
      ${list(policy.reasoning || [])}
      <p>最近回测：${backtest.summary || "暂无"}${concentration?.name ? `；持仓集中：${concentration.name} ${signed(concentration.exposurePct)}%。` : ""}</p>
    </div>
  `;
  els.agentDiagnostics.innerHTML = (report.diagnostics || []).length
    ? report.diagnostics
        .map(
          (item) => `
            <div class="learning-item">
              <div>
                <strong>${item.title}</strong>
                <small>${item.action}</small>
                <small>${(item.evidence || []).join(" / ")}</small>
              </div>
              <span class="mini-score ${item.severity === "high" ? "negative" : item.severity === "medium" ? "warning" : ""}">${item.severity}</span>
            </div>
          `,
        )
        .join("")
    : `<div class="empty">暂无诊断。</div>`;
  els.agentQueue.innerHTML = (report.researchQueue || []).length
    ? report.researchQueue
        .map(
          (item) => `
            <div class="learning-item">
              <div>
                <strong>${item.topic}</strong>
                <small>${item.why}</small>
                <small>${(item.checks || []).join(" / ")}</small>
              </div>
              <span class="mini-score">${item.priority}</span>
            </div>
          `,
        )
        .join("")
    : `<div class="empty">暂无研究队列。</div>`;
  els.agentExecution.innerHTML = (report.executionPlan || []).length
    ? report.executionPlan
        .map(
          (item) => `
            <div class="learning-item">
              <div>
                <strong>${item.window} · ${item.action}</strong>
                <small>${item.trigger}</small>
              </div>
              <span class="mini-score">PLAN</span>
            </div>
          `,
        )
        .join("")
    : `<div class="empty">暂无执行计划。</div>`;
}

function renderDecisionDashboard(data) {
  if (!els.decisionDashboard) return;
  const board = data.decisionDashboard || {};
  const counts = board.counts || {};
  const posture = board.posture || {};
  const actions = board.topActions || [];
  els.decisionDashboard.innerHTML = `
    <div class="decision-hero ${posture.tone || ""}">
      <div>
        <span>${posture.label || "等待刷新"}</span>
        <strong>${board.headline || data.marketRegime?.summary || "暂无决策摘要。"}</strong>
        <small>${posture.reason || "刷新后生成市场姿态、风险和检查清单。"}</small>
      </div>
      <div class="decision-counts">
        <div><span>候选</span><strong>${counts.candidates || 0}</strong></div>
        <div><span>买入</span><strong>${counts.paperBuy || 0}</strong></div>
        <div><span>观察</span><strong>${counts.focus || 0}</strong></div>
        <div><span>规避</span><strong>${counts.avoid || 0}</strong></div>
      </div>
    </div>
    <div class="decision-card-grid">
      ${actions
        .slice(0, 6)
        .map(
          (item) => `
            <article class="decision-card">
              <div class="decision-card-head">
                <div>
                  <strong>${item.name} ${item.code}</strong>
                  <small>${item.boardName} · ${item.verdict}${item.confidence ? ` · 信心${Math.round(item.confidence)}` : ""}</small>
                </div>
                <span class="${actionTag(item)}">${item.action}</span>
              </div>
              <div class="decision-scoreline">
                <span>规则 ${item.ruleScore ?? item.score}</span>
                <span>最终 ${item.finalScore ?? item.score}</span>
              </div>
              ${item.catalysts?.length ? `<p><b>催化：</b>${item.catalysts.join(" / ")}</p>` : ""}
              ${item.risk ? `<p><b>风险：</b>${item.risk}</p>` : ""}
              <p><b>验证：</b>${item.researchFocus || "继续观察量价与板块持续性。"}</p>
            </article>
          `,
        )
        .join("") || `<div class="empty">暂无候选动作。</div>`}
    </div>
    <div class="decision-columns">
      <div class="note-block">
        <strong>风险警报</strong>
        ${list(board.riskAlerts || [])}
      </div>
      <div class="note-block">
        <strong>利好催化</strong>
        ${list(board.catalysts || [])}
      </div>
      <div class="note-block">
        <strong>操作检查清单</strong>
        ${list(board.checklist || [])}
      </div>
    </div>
  `;
}

function renderNotifications(data) {
  const plan = data.notifications || {};
  const alerts = plan.pendingAlerts || [];
  const providerStatus = data.dataProviders || {};
  const eventSearchStatus = data.eventSearch || {};
  els.notificationList.innerHTML = alerts.length
    ? alerts
        .map(
          (item) => `
            <div class="alert-item">
              <strong>${item.type} · ${item.title}</strong>
              <small>${item.body}</small>
            </div>
          `,
        )
        .join("")
    : `<div class="empty">暂无待提醒事件。</div>`;

  const discord = plan.discord || {};
  els.settingsList.innerHTML = `
    <div class="setting-row">
      <strong>Discord</strong>
      <span>${discord.status || "未配置"}</span>
    </div>
    <div class="note-block">
      <p>${discord.delivery || "默认不发送外部消息。"}</p>
      <small>事件：${(discord.eventTypes || []).join(" / ")}</small>
    </div>
    ${
      plan.dailyDigest
        ? `<div class="note-block">
            <strong>${plan.dailyDigest.title}</strong>
            <p>${plan.dailyDigest.body}</p>
            <small>${plan.dailyDigest.posture?.label || ""} · 买入${plan.dailyDigest.counts?.paperBuy || 0} / 观察${plan.dailyDigest.counts?.focus || 0} / 规避${plan.dailyDigest.counts?.avoid || 0}</small>
          </div>`
        : ""
    }
    <div class="note-block">
      <strong>费用参数</strong>
      <p>佣金 ${((data.feeConfig?.commissionRate || 0) * 100).toFixed(3)}%，最低 ${money(data.feeConfig?.minCommission)}；印花税 ${((data.feeConfig?.stampDutyRate || 0) * 100).toFixed(3)}%。</p>
    </div>
    <div class="note-block">
      <strong>增强数据源</strong>
      <p>状态 ${providerStatus.status || "unknown"}，覆盖 ${providerStatus.resultCount || 0} 只候选。</p>
      ${providerStatus.error ? `<p>最近错误：${providerStatus.error}</p>` : ""}
      <small>${Object.entries(providerStatus.providers || {})
        .map(([name, provider]) => `${name}: ${provider.enabled ? "开" : "关"}/${provider.available ? "可用" : "不可用"}`)
        .join(" / ") || "未启用"}</small>
    </div>
    <div class="note-block">
      <strong>事件搜索</strong>
      <p>状态 ${eventSearchStatus.status || "unknown"}，结果 ${eventSearchStatus.resultCount || 0} 条，真实请求 ${eventSearchStatus.queryCount || 0} 次。</p>
      <small>${Object.entries(eventSearchStatus.providers || {})
        .map(([name, provider]) => `${name}: ${provider.enabled ? "开" : "关"}/${provider.configured ? "有Key" : "无Key"}/${provider.available ? "可用" : "不可用"}`)
        .join(" / ") || "未启用"}</small>
    </div>
  `;
}

function fillConfigForm(config) {
  if (!els.configForm || !config) return;
  latestConfig = config;
  const trading = config.trading || {};
  const llm = trading.llm || {};
  const adaptiveRisk = trading.adaptiveRisk || {};
  const riskControls = trading.riskControls || {};
  const context = trading.context || {};
  const providers = trading.dataProviders || {};
  const eventSearch = trading.eventSearch || {};
  const discord = config.notification?.discord || {};
  for (const [key, value] of Object.entries(trading)) {
    const input = els.configForm.elements[key];
    if (input) input.value = value;
  }
  els.configForm.elements.watchlistText.value = trading.watchlistText || "";
  els.configForm.elements.adaptiveRiskEnabled.checked = adaptiveRisk.enabled !== false;
  els.configForm.elements.adaptiveMinStopLossPct.value = adaptiveRisk.minStopLossPct ?? -9;
  els.configForm.elements.adaptiveMaxStopLossPct.value = adaptiveRisk.maxStopLossPct ?? -2.5;
  els.configForm.elements.adaptiveMinTakeProfitPct.value = adaptiveRisk.minTakeProfitPct ?? 4;
  els.configForm.elements.adaptiveMaxTakeProfitPct.value = adaptiveRisk.maxTakeProfitPct ?? 18;
  els.configForm.elements.riskControlsEnabled.checked = riskControls.enabled !== false;
  els.configForm.elements.maxBoardExposurePct.value = riskControls.maxBoardExposurePct ?? 0.45;
  els.configForm.elements.maxAccountDrawdownPct.value = riskControls.maxAccountDrawdownPct ?? 6;
  els.configForm.elements.pauseAfterLossStreak.value = riskControls.pauseAfterLossStreak ?? 3;
  els.configForm.elements.chasePctLimit.value = riskControls.chasePctLimit ?? 7.5;
  els.configForm.elements.minAmount.value = riskControls.minAmount ?? 500000000;
  els.configForm.elements.timeStopDays.value = riskControls.timeStopDays ?? 7;
  els.configForm.elements.timeStopMinProfitPct.value = riskControls.timeStopMinProfitPct ?? 1;

  els.configForm.elements.llmEnabled.checked = Boolean(llm.enabled);
  els.configForm.elements.llmProvider.value = llm.provider || "openai-responses";
  renderLlmProviderHint(els.configForm.elements.llmProvider.value);
  els.configForm.elements.llmDecisionMode.value = llm.decisionMode || "score_veto";
  els.configForm.elements.llmBaseUrl.value = llm.baseUrl || "";
  els.configForm.elements.llmModel.value = llm.model || "";
  els.configForm.elements.llmMaxCandidates.value = llm.maxCandidates ?? 6;
  els.configForm.elements.llmScoreImpact.value = llm.scoreImpact ?? 12;
  els.configForm.elements.llmMinConfidence.value = llm.minConfidence ?? 60;
  els.configForm.elements.llmRequireBuyApproval.checked = Boolean(llm.requireBuyApproval);
  els.configForm.elements.llmTemperature.value = llm.temperature ?? 0.2;
  els.configForm.elements.llmTimeoutMs.value = llm.timeoutMs ?? 60000;
  els.configForm.elements.llmApiKey.value = "";
  els.configForm.elements.clearLlmApiKey.checked = false;
  els.llmTestState.textContent = "尚未测试。本测试只发送一条最小文本请求。";
  els.llmTestState.classList.remove("good", "warn");
  els.llmApiKeyState.textContent = llm.apiKeyConfigured
    ? `API Key 已配置（${llmApiKeySourceLabel(llm.apiKeySource)}：${llm.apiKeyPreview || "已隐藏"}）。页面不会回显完整 Key。`
    : "API Key 未配置。可以在上方输入并保存到本机密钥文件。";
  els.llmState.textContent = llm.apiKeyConfigured
    ? `生效模型：${llm.effectiveModel || llm.model || "未指定"}；Base URL：${llm.effectiveBaseUrl || llm.baseUrl || "未指定"}。`
    : "大模型未就绪：请配置 API Key，并确认模型名和 Base URL。";

  els.configForm.elements.contextEnabled.checked = Boolean(context.enabled);
  els.configForm.elements.contextIncludeNews.checked = Boolean(context.includeNews);
  els.configForm.elements.contextIncludeAnnouncements.checked = Boolean(context.includeAnnouncements);
  els.configForm.elements.contextIncludeF10.checked = Boolean(context.includeF10);
  els.configForm.elements.contextMaxNews.value = context.maxNews ?? 6;
  els.configForm.elements.contextMaxAnnouncements.value = context.maxAnnouncements ?? 4;
  els.configForm.elements.contextTimeoutMs.value = context.timeoutMs ?? 8000;

  els.configForm.elements.dataProviderEnabled.checked = Boolean(providers.enabled);
  els.configForm.elements.useAkshare.checked = Boolean(providers.useAkshare);
  els.configForm.elements.useBaostock.checked = Boolean(providers.useBaostock);
  els.configForm.elements.useTushare.checked = Boolean(providers.useTushare);
  els.configForm.elements.dataProviderMaxCandidates.value = providers.maxCandidates ?? 8;
  els.configForm.elements.dataProviderTimeoutMs.value = providers.timeoutMs ?? 30000;
  els.configForm.elements.dataProviderPythonBin.value = providers.pythonBin || "python3";
  els.configForm.elements.tushareToken.value = "";
  els.configForm.elements.clearTushareToken.checked = false;
  els.dataProviderState.textContent = providers.tushareTokenConfigured
    ? `Tushare Token 已配置（${llmApiKeySourceLabel(providers.tushareTokenSource)}：${providers.tushareTokenPreview || "已隐藏"}）。AKShare/Baostock 不需要 Key。`
    : "AKShare/Baostock 不需要 Key；Tushare 可留空，后续有 Token 再配置。";

  els.configForm.elements.eventSearchEnabled.checked = Boolean(eventSearch.enabled);
  els.configForm.elements.searchUseBocha.checked = Boolean(eventSearch.useBocha);
  els.configForm.elements.searchUseTavily.checked = Boolean(eventSearch.useTavily);
  els.configForm.elements.searchUseSerpApi.checked = Boolean(eventSearch.useSerpApi);
  els.configForm.elements.searchUseAnspire.checked = Boolean(eventSearch.useAnspire);
  els.configForm.elements.searchMaxCandidates.value = eventSearch.maxCandidates ?? 6;
  els.configForm.elements.searchMaxQueriesPerStock.value = eventSearch.maxQueriesPerStock ?? 2;
  els.configForm.elements.searchResultsPerQuery.value = eventSearch.resultsPerQuery ?? 5;
  els.configForm.elements.searchFreshness.value = eventSearch.freshness || "oneWeek";
  els.configForm.elements.searchTimeoutMs.value = eventSearch.timeoutMs ?? 12000;
  els.configForm.elements.searchCacheHours.value = eventSearch.cacheHours ?? 6;
  for (const [inputName, clearName] of [
    ["bochaApiKey", "clearBochaApiKey"],
    ["tavilyApiKey", "clearTavilyApiKey"],
    ["serpApiKey", "clearSerpApiKey"],
    ["anspireApiKey", "clearAnspireApiKey"],
  ]) {
    if (els.configForm.elements[inputName]) els.configForm.elements[inputName].value = "";
    if (els.configForm.elements[clearName]) els.configForm.elements[clearName].checked = false;
  }
  renderEventSearchKeyStatus(eventSearch);
  if (els.eventSearchTestState) {
    els.eventSearchTestState.textContent = "选择搜索源后可测试连通性。";
    els.eventSearchTestState.classList.remove("good", "warn");
  }

  els.configForm.elements.discordEnabled.checked = Boolean(discord.enabled);
  els.configForm.elements.discordWebhookUrl.value = "";
  els.configForm.elements.clearWebhook.checked = false;
  const events = discord.events || {};
  for (const key of ["paperBuy", "takeProfit", "stopLoss", "dailyReview", "learningNote"]) {
    if (els.configForm.elements[key]) els.configForm.elements[key].checked = Boolean(events[key]);
  }
  els.webhookState.textContent = discord.webhookConfigured
    ? `Webhook 已配置：${discord.webhookPreview}。页面不会回显完整 webhook。`
    : "Webhook 未配置。保存 webhook 只写入本地配置，不会提交到 GitHub。";
  els.configStatus.textContent = "已加载";
  if (els.configFeedback) {
    els.configFeedback.textContent = "配置已加载。修改后点击保存配置。";
    els.configFeedback.classList.remove("good", "warn");
  }
}

function readConfigForm() {
  const form = els.configForm;
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
  const trading = {};
  for (const field of numberFields) {
    const value = form.elements[field]?.value;
    if (value !== "") trading[field] = Number(value);
  }
  trading.watchlistText = form.elements.watchlistText?.value.trim() || "";
  trading.llm = {
    enabled: form.elements.llmEnabled.checked,
    decisionMode: form.elements.llmDecisionMode.value,
    provider: normalizeProviderFromFields(
      form.elements.llmProvider.value,
      form.elements.llmBaseUrl.value,
      form.elements.llmModel.value,
    ),
    baseUrl: form.elements.llmBaseUrl.value.trim(),
    model: form.elements.llmModel.value.trim(),
    maxCandidates: Number(form.elements.llmMaxCandidates.value || 6),
    scoreImpact: Number(form.elements.llmScoreImpact.value || 12),
    minConfidence: Number(form.elements.llmMinConfidence.value || 60),
    requireBuyApproval: form.elements.llmRequireBuyApproval.checked,
    temperature: Number(form.elements.llmTemperature.value || 0.2),
    timeoutMs: Number(form.elements.llmTimeoutMs.value || 60000),
  };
  trading.adaptiveRisk = {
    enabled: form.elements.adaptiveRiskEnabled.checked,
    minStopLossPct: Number(form.elements.adaptiveMinStopLossPct.value || -9),
    maxStopLossPct: Number(form.elements.adaptiveMaxStopLossPct.value || -2.5),
    minTakeProfitPct: Number(form.elements.adaptiveMinTakeProfitPct.value || 4),
    maxTakeProfitPct: Number(form.elements.adaptiveMaxTakeProfitPct.value || 18),
  };
  trading.riskControls = {
    enabled: form.elements.riskControlsEnabled.checked,
    maxBoardExposurePct: Number(form.elements.maxBoardExposurePct.value || 0.45),
    maxAccountDrawdownPct: Number(form.elements.maxAccountDrawdownPct.value || 6),
    pauseAfterLossStreak: Number(form.elements.pauseAfterLossStreak.value || 3),
    chasePctLimit: Number(form.elements.chasePctLimit.value || 7.5),
    minAmount: Number(form.elements.minAmount.value || 500000000),
    timeStopDays: Number(form.elements.timeStopDays.value || 7),
    timeStopMinProfitPct: Number(form.elements.timeStopMinProfitPct.value || 1),
  };
  trading.context = {
    enabled: form.elements.contextEnabled.checked,
    includeNews: form.elements.contextIncludeNews.checked,
    includeAnnouncements: form.elements.contextIncludeAnnouncements.checked,
    includeF10: form.elements.contextIncludeF10.checked,
    maxNews: Number(form.elements.contextMaxNews.value || 6),
    maxAnnouncements: Number(form.elements.contextMaxAnnouncements.value || 4),
    timeoutMs: Number(form.elements.contextTimeoutMs.value || 8000),
  };
  trading.dataProviders = {
    enabled: form.elements.dataProviderEnabled.checked,
    useAkshare: form.elements.useAkshare.checked,
    useBaostock: form.elements.useBaostock.checked,
    useTushare: form.elements.useTushare.checked,
    maxCandidates: Number(form.elements.dataProviderMaxCandidates.value || 8),
    timeoutMs: Number(form.elements.dataProviderTimeoutMs.value || 30000),
    pythonBin: form.elements.dataProviderPythonBin.value.trim() || "python3",
  };
  trading.eventSearch = {
    enabled: form.elements.eventSearchEnabled.checked,
    useBocha: form.elements.searchUseBocha.checked,
    useTavily: form.elements.searchUseTavily.checked,
    useSerpApi: form.elements.searchUseSerpApi.checked,
    useAnspire: form.elements.searchUseAnspire.checked,
    maxCandidates: Number(form.elements.searchMaxCandidates.value || 6),
    maxQueriesPerStock: Number(form.elements.searchMaxQueriesPerStock.value || 2),
    resultsPerQuery: Number(form.elements.searchResultsPerQuery.value || 5),
    freshness: form.elements.searchFreshness.value,
    timeoutMs: Number(form.elements.searchTimeoutMs.value || 12000),
    cacheHours: Number(form.elements.searchCacheHours.value || 6),
  };

  const webhookUrl = form.elements.clearWebhook.checked
    ? "__CLEAR__"
    : form.elements.discordWebhookUrl.value.trim();
  return {
    trading,
    secrets: {
      llm: {
        apiKey: form.elements.llmApiKey.value.trim(),
        clearApiKey: form.elements.clearLlmApiKey.checked,
      },
      dataProviders: {
        tushareToken: form.elements.tushareToken.value.trim(),
        clearTushareToken: form.elements.clearTushareToken.checked,
      },
      eventSearch: {
        bochaApiKey: form.elements.bochaApiKey.value.trim(),
        clearBochaApiKey: form.elements.clearBochaApiKey.checked,
        tavilyApiKey: form.elements.tavilyApiKey.value.trim(),
        clearTavilyApiKey: form.elements.clearTavilyApiKey.checked,
        serpApiKey: form.elements.serpApiKey.value.trim(),
        clearSerpApiKey: form.elements.clearSerpApiKey.checked,
        anspireApiKey: form.elements.anspireApiKey.value.trim(),
        clearAnspireApiKey: form.elements.clearAnspireApiKey.checked,
      },
    },
    notification: {
      discord: {
        enabled: form.elements.discordEnabled.checked,
        webhookUrl,
        events: {
          paperBuy: form.elements.paperBuy.checked,
          takeProfit: form.elements.takeProfit.checked,
          stopLoss: form.elements.stopLoss.checked,
          dailyReview: form.elements.dailyReview.checked,
          learningNote: form.elements.learningNote.checked,
        },
      },
    },
  };
}

function render(data, liveStatus, config = latestConfig, optimizer = latestOptimizer) {
  latestDashboard = data;
  latestConfig = config;
  latestOptimizer = optimizer;
  latestLiveStatus = liveStatus;
  els.dateBadge.textContent = data.date;
  els.marketRegime.textContent = data.marketRegime?.summary || "";
  els.sourceSummary.textContent = [...new Set((data.hotBoards || []).map((item) => item.source))].join(" / ") || "行情接口";
  renderStatus(data, liveStatus, config);
  renderHeaderMetrics(data, liveStatus, config);
  renderPortfolio(data);
  renderOverviewCommand(data);
  renderWorkflowGuide(data, liveStatus);
  renderIndexes(data);
  renderActions(data);
  renderSectors(data);
  renderResearch(data);
  renderCandidates(data);
  renderTradingSummary(data);
  renderTradingCommand(data, liveStatus);
  renderPositions(data);
  renderTrades(data);
  renderReview(data);
  renderStrategyCommand(data, optimizer);
  renderStrategy(data, optimizer);
  renderStrategyEvolution(data, config, optimizer, latestBacktest, latestSweep, latestAgent);
  renderStrategyLab(latestStrategyLab);
  renderBacktest(latestBacktest);
  renderSweep(latestSweep);
  renderAgent(latestAgent);
  renderLiveChecks(latestLiveChecks);
  renderDecisionDashboard(data);
  renderNotifications(data);
}

async function start({ initial = false } = {}) {
  try {
    const auth = await loadAuthStatus();
    renderAuth(auth);
    if (!auth.authenticated) {
      bootstrapped = false;
      return;
    }
    const [dashboard, liveStatus, liveChecks, config, optimizer, backtest, sweep, agent, strategyLab] = await Promise.all([
      loadDashboard(),
      loadLiveStatus(),
      loadLiveChecks(),
      loadConfig(),
      loadOptimizer(),
      loadBacktest(),
      loadSweep(),
      loadAgent(),
      loadStrategyLab(),
    ]);
    latestConfig = config;
    latestLiveChecks = liveChecks;
    latestBacktest = backtest;
    latestSweep = sweep;
    latestAgent = agent;
    latestStrategyLab = strategyLab;
    render(dashboard, liveStatus, config, optimizer);
    if (initial || !bootstrapped) {
      fillConfigForm(config);
      if (els.backtestStart && !els.backtestStart.value) els.backtestStart.value = dateDaysAgo(365);
      if (els.backtestEnd && !els.backtestEnd.value) els.backtestEnd.value = new Date().toISOString().slice(0, 10);
      setConfigGroup("trading");
      setActiveView(currentViewId(), true);
      bootstrapped = true;
    }
  } catch (error) {
    els.statusStrip.innerHTML = pill(error.message, "warn");
  }
}

window.addEventListener("hashchange", () => {
  setActiveView(currentViewId());
});

navLinks.forEach((link) => {
  link.addEventListener("click", (event) => {
    const id = link.getAttribute("href").replace(/^#/, "");
    if (id === currentViewId()) {
      event.preventDefault();
      setActiveView(id);
    }
  });
});

tradingTabButtons.forEach((button) => {
  button.addEventListener("click", () => setTradingTab(button.dataset.tradingTab));
});

configTabButtons.forEach((button) => {
  button.addEventListener("click", () => setConfigGroup(button.dataset.configTab));
});

els.researchSearch?.addEventListener("input", () => {
  if (latestDashboard) renderResearch(latestDashboard);
});

els.researchFilter?.addEventListener("change", () => {
  if (latestDashboard) renderResearch(latestDashboard);
});

async function runStrategyOptimizerFromUi({ apply = false } = {}) {
  if (els.runOptimizerBtn) els.runOptimizerBtn.disabled = true;
  if (els.applyOptimizerBtn) els.applyOptimizerBtn.disabled = true;
  if (els.optimizerState) {
    els.optimizerState.textContent = apply ? "正在应用有界建议..." : "正在生成优化建议...";
    els.optimizerState.classList.remove("good", "warn");
  }
  try {
    const result = await fetchJson(
      "/api/strategy-optimizer",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply }),
      },
      apply ? "应用优化建议失败" : "生成优化建议失败",
    );
    latestOptimizer = result.report || (await loadOptimizer());
    latestAgent = result.agent || (await loadAgent()) || latestAgent;
    latestStrategyLab = result.lab || (await loadStrategyLab()) || latestStrategyLab;
    if (result.config) fillConfigForm(result.config);
    if (latestDashboard) render(latestDashboard, latestLiveStatus, latestConfig, latestOptimizer);
    if (els.optimizerState) {
      els.optimizerState.textContent = apply ? "已应用有界建议。" : "优化建议已生成。";
      els.optimizerState.classList.add("good");
    }
  } catch (error) {
    if (els.optimizerState) {
      els.optimizerState.textContent = error.message || "优化失败";
      els.optimizerState.classList.add("warn");
    }
  } finally {
    if (els.runOptimizerBtn) els.runOptimizerBtn.disabled = false;
    if (els.applyOptimizerBtn) els.applyOptimizerBtn.disabled = false;
  }
}

async function runDecisionAgentFromUi() {
  if (els.runAgentBtn) {
    els.runAgentBtn.disabled = true;
    els.runAgentBtn.textContent = "运行中";
  }
  if (els.agentState) {
    els.agentState.textContent = "Agent 正在读取行情、模型、回测和优化器结果...";
    els.agentState.classList.remove("good", "warn");
  }
  try {
    const result = await fetchJson("/api/decision-agent", { method: "POST" }, "运行 Agent 失败");
    latestAgent = result.report || (await loadAgent());
    latestStrategyLab = result.lab || (await loadStrategyLab());
    renderAgent(latestAgent);
    renderStrategyLab(latestStrategyLab);
    if (els.agentState) {
      els.agentState.textContent = "Agent 报告已生成。";
      els.agentState.classList.add("good");
    }
  } catch (error) {
    if (els.agentState) {
      els.agentState.textContent = error.message || "Agent 运行失败";
      els.agentState.classList.add("warn");
    }
  } finally {
    if (els.runAgentBtn) {
      els.runAgentBtn.disabled = false;
      els.runAgentBtn.textContent = "运行Agent";
    }
  }
}

async function runParameterSweepFromUi() {
  if (els.runSweepBtn) {
    els.runSweepBtn.disabled = true;
    els.runSweepBtn.textContent = "寻优中";
  }
  if (els.sweepState) {
    els.sweepState.textContent = "正在抓取真实历史行情并批量回测参数...";
    els.sweepState.classList.remove("good", "warn");
  }
  try {
    const payload = {
      start: els.backtestStart?.value || dateDaysAgo(730),
      end: els.backtestEnd?.value || new Date().toISOString().slice(0, 10),
      maxSymbols: Number(els.backtestMaxSymbols?.value || 12),
      strategy: els.backtestStrategy?.value || "momentum-score",
      provider: els.backtestProvider?.value || "auto",
      topN: 12,
    };
    const result = await fetchJson(
      "/api/parameter-sweep",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      "参数寻优失败",
    );
    latestSweep = result.report || (await loadSweep());
    latestStrategyLab = result.lab || (await loadStrategyLab()) || latestStrategyLab;
    renderSweep(latestSweep);
    renderStrategyLab(latestStrategyLab);
    if (els.sweepState) {
      els.sweepState.textContent = latestSweep?.status === "ok" ? "参数寻优完成。" : `参数寻优失败：${latestSweep?.error || "未知错误"}`;
      els.sweepState.classList.toggle("good", latestSweep?.status === "ok");
      els.sweepState.classList.toggle("warn", latestSweep?.status !== "ok");
    }
  } catch (error) {
    if (els.sweepState) {
      els.sweepState.textContent = error.message || "参数寻优失败";
      els.sweepState.classList.add("warn");
    }
  } finally {
    if (els.runSweepBtn) {
      els.runSweepBtn.disabled = false;
      els.runSweepBtn.textContent = "运行寻优";
    }
  }
}

els.refreshBtn.addEventListener("click", async () => {
  els.refreshBtn.disabled = true;
  els.refreshBtn.textContent = "刷新中";
  try {
    const updateResult = await fetchJson("/api/update", { method: "POST" }, "刷新失败");
    latestAgent = updateResult.agent || latestAgent;
    const [dashboard, liveStatus, liveChecks, optimizer, agent, strategyLab] = await Promise.all([
      loadDashboard(),
      loadLiveStatus(),
      loadLiveChecks(),
      loadOptimizer(),
      loadAgent(),
      loadStrategyLab(),
    ]);
    latestLiveChecks = liveChecks;
    latestAgent = agent || latestAgent;
    latestStrategyLab = strategyLab || latestStrategyLab;
    render(dashboard, liveStatus, latestConfig, optimizer);
  } catch (error) {
    els.statusStrip.innerHTML = pill(error.message, "warn");
  } finally {
    els.refreshBtn.disabled = false;
    els.refreshBtn.textContent = "刷新";
  }
});

els.runOptimizerBtn?.addEventListener("click", () => {
  runStrategyOptimizerFromUi({ apply: false });
});

els.applyOptimizerBtn?.addEventListener("click", () => {
  runStrategyOptimizerFromUi({ apply: true });
});

els.runAgentBtn?.addEventListener("click", () => {
  runDecisionAgentFromUi();
});

els.runSweepBtn?.addEventListener("click", () => {
  runParameterSweepFromUi();
});

els.reloadConfigBtn?.addEventListener("click", async () => {
  els.configStatus.textContent = "加载中";
  if (els.configFeedback) {
    els.configFeedback.textContent = "正在重新加载配置...";
    els.configFeedback.classList.remove("good", "warn");
  }
  try {
    fillConfigForm(await loadConfig());
  } catch (error) {
    els.configStatus.textContent = "加载失败";
    if (els.configFeedback) {
      els.configFeedback.textContent = error.message || "配置加载失败";
      els.configFeedback.classList.add("warn");
      els.configFeedback.classList.remove("good");
    }
  }
});

els.configForm?.elements.llmProvider?.addEventListener("change", (event) => {
  renderLlmProviderHint(event.target.value);
  applyLlmProviderDefaults(event.target.value);
});

els.testLlmBtn?.addEventListener("click", async () => {
  const ok = window.confirm("测试连接会使用当前 API Key 向所选模型服务商发送一条最小文本请求，不包含股票、持仓或复盘数据。继续吗？");
  if (!ok) return;
  els.testLlmBtn.disabled = true;
  els.testLlmBtn.textContent = "测试中";
  els.llmTestState.textContent = "正在测试连接...";
  els.llmTestState.classList.remove("good", "warn");
  try {
    renderLlmTestResult(await testLlmConnection(readConfigForm()));
  } catch (error) {
    renderLlmTestResult({ ok: false, error: error.message });
  } finally {
    els.testLlmBtn.disabled = false;
    els.testLlmBtn.textContent = "测试连接";
  }
});

els.testEventSearchBtn?.addEventListener("click", async () => {
  const provider = els.eventSearchTestProvider?.value || "tavily";
  const label = eventSearchProviders.find((item) => item.id === provider)?.label || "事件搜索";
  const ok = window.confirm(`测试会使用当前 ${label} API Key 发送一条最小搜索请求，查询词为“A股 市场 热点”，不包含你的持仓或个人数据。继续吗？`);
  if (!ok) return;
  els.testEventSearchBtn.disabled = true;
  els.testEventSearchBtn.textContent = "测试中";
  els.eventSearchTestState.textContent = `正在测试 ${label}...`;
  els.eventSearchTestState.classList.remove("good", "warn");
  try {
    renderEventSearchTestResult(await testEventSearchConnection({ ...readConfigForm(), provider }));
  } catch (error) {
    renderEventSearchTestResult({ ok: false, provider, label, error: error.message });
  } finally {
    els.testEventSearchBtn.disabled = false;
    els.testEventSearchBtn.textContent = "测试搜索";
  }
});

els.configForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.configStatus.textContent = "保存中";
  if (els.configFeedback) {
    els.configFeedback.textContent = "正在保存到本地配置...";
    els.configFeedback.classList.remove("good", "warn");
  }
  try {
    const saved = await saveConfig(readConfigForm());
    const [dashboard, liveStatus, liveChecks] = await Promise.all([loadDashboard(), loadLiveStatus(), loadLiveChecks()]);
    latestConfig = saved;
    latestLiveChecks = liveChecks;
    render(dashboard, liveStatus, saved);
    fillConfigForm(saved);
    const savedAt = new Date().toLocaleTimeString();
    els.configStatus.textContent = `已保存 ${savedAt}`;
    if (els.configFeedback) {
      els.configFeedback.textContent = `配置已保存到本机，敏感 Key 不会回显。${savedAt}`;
      els.configFeedback.classList.add("good");
      els.configFeedback.classList.remove("warn");
    }
  } catch (error) {
    els.configStatus.textContent = "保存失败";
    els.webhookState.textContent = error.message;
    if (els.configFeedback) {
      els.configFeedback.textContent = error.message || "配置保存失败";
      els.configFeedback.classList.add("warn");
      els.configFeedback.classList.remove("good");
    }
  }
});

els.authForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const mode = els.authForm.dataset.mode === "setup" ? "setup" : "login";
  const payload = {
    username: els.authForm.elements.username.value.trim(),
    password: els.authForm.elements.password.value,
  };
  els.authSubmit.disabled = true;
  els.authSubmit.textContent = mode === "setup" ? "创建中" : "登录中";
  els.authFeedback.textContent = mode === "setup" ? "正在初始化管理员账号..." : "正在登录...";
  els.authFeedback.classList.remove("good", "warn");
  try {
    const res = await fetch(`/api/auth/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await readJsonSafe(res);
    if (!res.ok) throw new Error(result.error || "登录失败");
    els.authForm.reset();
    renderAuth(result);
    els.authFeedback.textContent = "登录成功，正在加载投研工作台...";
    els.authFeedback.classList.add("good");
    await start({ initial: true });
  } catch (error) {
    els.authFeedback.textContent = error.message || "登录失败";
    els.authFeedback.classList.add("warn");
  } finally {
    els.authSubmit.disabled = false;
    els.authSubmit.textContent = mode === "setup" ? "创建管理员并进入" : "登录";
  }
});

els.logoutBtn?.addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
  latestConfig = null;
  latestDashboard = null;
  latestOptimizer = null;
  bootstrapped = false;
  renderAuth(await loadAuthStatus().catch(() => ({ authenticated: false, setupRequired: false })));
});

els.accountSelect?.addEventListener("change", async () => {
  const accountId = els.accountSelect.value;
  try {
    const result = await fetchJson(
      "/api/accounts/select",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId }),
      },
      "账户切换失败",
    );
    renderAuth(result);
    els.statusStrip.innerHTML = pill(`已切换到 ${result.currentAccount?.name || "模拟账户"}`, "good");
    await start({ initial: true });
  } catch (error) {
    els.statusStrip.innerHTML = pill(error.message, "warn");
    renderAuth(authState);
  }
});

els.createAccountBtn?.addEventListener("click", async () => {
  const name = window.prompt("新模拟账户名称", `模拟账户 ${(authState?.accounts?.length || 0) + 1}`);
  if (!name) return;
  try {
    const result = await fetchJson(
      "/api/accounts",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      },
      "新建账户失败",
    );
    renderAuth(result);
    els.statusStrip.innerHTML = pill(`已创建 ${result.currentAccount?.name || name}`, "good");
    await start({ initial: true });
  } catch (error) {
    els.statusStrip.innerHTML = pill(error.message, "warn");
  }
});

async function runBacktestFromUi({ useSweepBest = false } = {}) {
  const trigger = useSweepBest ? els.runSweepBacktestBtn : els.runBacktestBtn;
  const sweepBest = latestSweep?.rankings?.[0];
  if (useSweepBest && !sweepBest) {
    els.backtestState.textContent = "还没有寻优结果。请先运行寻优。";
    els.backtestState.classList.add("warn");
    els.backtestState.classList.remove("good");
    return;
  }
  if (els.runBacktestBtn) els.runBacktestBtn.disabled = true;
  if (els.runSweepBacktestBtn) els.runSweepBacktestBtn.disabled = true;
  if (trigger) trigger.textContent = useSweepBest ? "候选回测中" : "回测中";
  els.backtestState.textContent = useSweepBest ? "正在用寻优第一名参数回放真实历史行情..." : "正在抓取真实历史行情并回放当前生效策略...";
  els.backtestState.classList.remove("good", "warn");
  try {
    const payload = {
      start: els.backtestStart?.value || dateDaysAgo(365),
      end: els.backtestEnd?.value || new Date().toISOString().slice(0, 10),
      maxSymbols: Number(els.backtestMaxSymbols?.value || 12),
      strategy: els.backtestStrategy?.value || "momentum-score",
      provider: els.backtestProvider?.value || "auto",
      scenario: useSweepBest ? "sweep-best" : "current",
    };
    if (useSweepBest) {
      payload.buyScoreThreshold = sweepBest.params.buyScoreThreshold;
      payload.stopLossPct = sweepBest.params.stopLossPct;
      payload.takeProfitPct = sweepBest.params.takeProfitPct;
      payload.chasePctLimit = sweepBest.params.chasePctLimit;
      payload.timeStopDays = sweepBest.params.timeStopDay;
    }
    const result = await fetchJson(
      "/api/backtest",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      "回测失败",
    );
    latestBacktest = result.report || (await loadBacktest());
    latestOptimizer = result.optimizer || (await loadOptimizer()) || latestOptimizer;
    latestAgent = result.agent || (await loadAgent()) || latestAgent;
    latestStrategyLab = result.lab || (await loadStrategyLab()) || latestStrategyLab;
    if (latestDashboard) render(latestDashboard, latestLiveStatus, latestConfig, latestOptimizer);
    else renderBacktest(latestBacktest);
    if (result.optimizer && els.optimizerState) {
      els.optimizerState.textContent = "回测证据已接入策略优化器。";
      els.optimizerState.classList.add("good");
      els.optimizerState.classList.remove("warn");
    }
    if (result.agent && els.agentState) {
      els.agentState.textContent = "Agent 已吸收回测和优化器结果。";
      els.agentState.classList.add("good");
      els.agentState.classList.remove("warn");
    }
    els.backtestState.textContent =
      latestBacktest?.status === "ok"
        ? useSweepBest
          ? "寻优第一名候选参数回测完成。"
          : "当前生效策略回测完成。"
        : `回测失败：${latestBacktest?.error || "未知错误"}`;
    els.backtestState.classList.toggle("good", latestBacktest?.status === "ok");
    els.backtestState.classList.toggle("warn", latestBacktest?.status !== "ok");
  } catch (error) {
    els.backtestState.textContent = error.message || "回测失败";
    els.backtestState.classList.add("warn");
  } finally {
    if (els.runBacktestBtn) {
      els.runBacktestBtn.disabled = false;
      els.runBacktestBtn.textContent = "运行回测";
    }
    if (els.runSweepBacktestBtn) {
      els.runSweepBacktestBtn.disabled = false;
      els.runSweepBacktestBtn.textContent = "回测寻优第一名";
    }
  }
}

els.runBacktestBtn?.addEventListener("click", () => runBacktestFromUi({ useSweepBest: false }));

els.runSweepBacktestBtn?.addEventListener("click", () => runBacktestFromUi({ useSweepBest: true }));

setActiveView(currentViewId(), true);
start({ initial: true });
setInterval(() => start(), 60000);
