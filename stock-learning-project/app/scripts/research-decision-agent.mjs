import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");
const projectRoot = path.resolve(appRoot, "..");
const baseRuntimeDir = process.env.A_SHARE_RUNTIME_DIR || appRoot;
const runtimeDir = process.env.A_SHARE_ACCOUNT_RUNTIME_DIR || baseRuntimeDir;
const dataDir =
  process.env.A_SHARE_DATA_DIR || (process.env.A_SHARE_ACCOUNT_RUNTIME_DIR ? path.join(runtimeDir, "data") : path.join(appRoot, "data"));
const notesDir = process.env.MARKET_NOTES_DIR || path.join(projectRoot, "02-market-notes");
const agentFile = path.join(dataDir, "decision-agent.json");
const dashboardFile = path.join(dataDir, "dashboard.json");
const stateFile = path.join(dataDir, "state.json");
const optimizerFile = path.join(dataDir, "strategy-optimizer.json");
const backtestFile = path.join(dataDir, "backtest-report.json");
const configFile = path.join(runtimeDir, "trading-config.json");
const agentNotesDir = process.env.A_SHARE_ACCOUNT_ID
  ? path.join(notesDir, "accounts", process.env.A_SHARE_ACCOUNT_ID, "decision-agent")
  : path.join(notesDir, "decision-agent");

const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function signed(value, digits = 2) {
  const n = num(value);
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}`;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(num(value) * factor) / factor;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function cleanText(value, max = 160) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

async function readJson(file, fallback = {}) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

function topBoardExposure(positions = []) {
  const open = positions.filter((item) => item.status === "OPEN" || !item.status);
  const counts = new Map();
  for (const item of open) {
    const key = item.boardName || "UNKNOWN";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!top || !open.length) return null;
  return {
    name: top[0],
    count: top[1],
    total: open.length,
    exposurePct: round((top[1] / open.length) * 100),
  };
}

function marketSnapshot(dashboard) {
  const indexes = dashboard.indexes || [];
  const indexAvg = indexes.length ? indexes.reduce((sum, item) => sum + num(item.pct), 0) / indexes.length : 0;
  const hotBoards = dashboard.hotBoards || [];
  const strongBoards = hotBoards.filter((item) => num(item.pct) > 1.5).length;
  return {
    score: num(dashboard.marketRegime?.score),
    summary: dashboard.marketRegime?.summary || "暂无市场状态",
    indexAvgPct: round(indexAvg),
    strongBoards,
    topBoard: hotBoards[0]
      ? {
          name: hotBoards[0].name,
          pct: round(hotBoards[0].pct),
          amount: num(hotBoards[0].amount),
          score: num(hotBoards[0].score),
        }
      : null,
  };
}

function candidateSnapshot(dashboard) {
  const candidates = dashboard.candidates || [];
  const buyLike = candidates.filter((item) => ["BUY", "PAPER_BUY"].includes(item.actionCode)).length;
  const focus = candidates.filter((item) => item.actionCode === "FOCUS").length;
  const avoid = candidates.filter((item) => String(item.actionCode || "").includes("AVOID")).length;
  const missingAmount = candidates.filter((item) => item.amount === null || item.amount === undefined).length;
  const limitLike = candidates.filter((item) => Math.abs(num(item.pct)) >= 9.5).length;
  return {
    count: candidates.length,
    buyLike,
    focus,
    avoid,
    missingAmount,
    limitLike,
    top: candidates.slice(0, 6).map((item) => ({
      code: item.code,
      name: item.name,
      boardName: item.boardName,
      pct: round(item.pct),
      score: num(item.score),
      action: item.action,
      actionCode: item.actionCode,
      llmVerdict: item.llmDecision?.verdict || "",
      llmConfidence: num(item.llmDecision?.confidence),
      risk: cleanText(item.llmDecision?.risk || item.riskTags?.join("、") || "", 120),
      researchFocus: cleanText(item.llmDecision?.researchFocus || item.openQuestions?.[0] || "", 120),
    })),
  };
}

function backtestSnapshot(backtest) {
  if (!backtest || !Object.keys(backtest).length) return { status: "missing", summary: "还没有历史回测证据。" };
  if (backtest.status !== "ok") return { status: "error", summary: `回测失败：${backtest.error || backtest.warnings?.[0] || "unknown"}` };
  const m = backtest.metrics || {};
  return {
    status: "ok",
    range: backtest.range || {},
    tradeCount: num(m.tradeCount),
    returnPct: round(m.returnPct),
    benchmarkReturnPct: m.benchmarkReturnPct === null || m.benchmarkReturnPct === undefined ? null : round(m.benchmarkReturnPct),
    alphaPct: m.alphaPct === null || m.alphaPct === undefined ? null : round(m.alphaPct),
    winRate: round(m.winRate),
    profitFactor: round(m.profitFactor),
    maxDrawdownPct: round(m.maxDrawdownPct),
    avgWinPct: round(m.avgWinPct),
    avgLossPct: round(m.avgLossPct),
    summary: `回测收益 ${signed(m.returnPct)}%，超额 ${
      m.alphaPct === null || m.alphaPct === undefined ? "无基准" : `${signed(m.alphaPct)}%`
    }，胜率 ${signed(m.winRate)}%，盈亏因子 ${num(m.profitFactor).toFixed(2)}。`,
  };
}

function optimizerSnapshot(optimizer, config) {
  const proposed = optimizer?.proposed || {};
  return {
    status: optimizer?.generatedAt ? "ok" : "missing",
    generatedAt: optimizer?.generatedAt || "",
    proposed: {
      buyScoreThreshold: num(proposed.buyScoreThreshold, num(config.buyScoreThreshold, 72)),
      stopLossPct: num(proposed.stopLossPct, num(config.stopLossPct, -5)),
      takeProfitPct: num(proposed.takeProfitPct, num(config.takeProfitPct, 10)),
      chasePctLimit: num(proposed.riskControls?.chasePctLimit, num(config.riskControls?.chasePctLimit, 7.5)),
      maxBoardExposurePct: num(proposed.riskControls?.maxBoardExposurePct, num(config.riskControls?.maxBoardExposurePct, 0.45)),
    },
    advice: (optimizer?.advice || []).slice(0, 6).map((item) => ({
      level: item.level || "info",
      title: item.title || "建议",
      body: cleanText(item.body, 220),
    })),
  };
}

function decidePosture({ market, candidates, portfolio, backtest, optimizer, concentration }) {
  const reasons = [];
  let mode = "OBSERVE";
  let riskBudget = "NORMAL";
  let confidence = 55;

  const alphaWeak = backtest.status === "ok" && backtest.alphaPct !== null && backtest.alphaPct <= -5;
  const backtestWeak = backtest.status === "ok" && (backtest.returnPct < 0 || backtest.winRate < 45 || backtest.profitFactor < 1);
  const hotButUnsafe = market.score >= 70 && (candidates.limitLike >= Math.max(2, Math.floor(candidates.count * 0.25)) || candidates.missingAmount >= 3);
  const concentrated = concentration && concentration.exposurePct >= 50;

  if (alphaWeak) reasons.push(`回测超额 ${signed(backtest.alphaPct)}%，说明当前规则没有跟上行情结构。`);
  if (backtestWeak) reasons.push(`回测胜率 ${signed(backtest.winRate)}%、盈亏因子 ${backtest.profitFactor.toFixed(2)}，先提高交易质量。`);
  if (hotButUnsafe) reasons.push("市场热但候选中涨停/缺成交额较多，追高信号需要降权。");
  if (concentrated) reasons.push(`${concentration.name} 持仓集中度 ${signed(concentration.exposurePct)}%，需要控制同质化风险。`);

  if (market.score < 40) {
    mode = "DEFENSIVE";
    riskBudget = "LOW";
    confidence = 72;
    reasons.unshift(`市场评分 ${market.score} 偏弱。`);
  } else if (market.score >= 70 && alphaWeak) {
    mode = "RESEARCH_FIRST";
    riskBudget = "LOW";
    confidence = 78;
  } else if (market.score >= 70 && !backtestWeak && candidates.buyLike > 0) {
    mode = "SELECTIVE_ATTACK";
    riskBudget = "NORMAL";
    confidence = 68;
    reasons.push("市场较强且回测未发出负反馈，可允许小仓位试错。");
  } else if (concentrated || hotButUnsafe || backtestWeak) {
    mode = "RISK_CONTROL";
    riskBudget = "LOW";
    confidence = 70;
  } else {
    reasons.push("证据没有给出明确进攻或撤退信号，保持观察。");
  }

  const labels = {
    DEFENSIVE: "防守复盘",
    RESEARCH_FIRST: "先研究后交易",
    RISK_CONTROL: "风控优先",
    SELECTIVE_ATTACK: "选择性进攻",
    OBSERVE: "观察等待",
  };

  return {
    mode,
    label: labels[mode] || mode,
    riskBudget,
    confidence,
    summary:
      mode === "SELECTIVE_ATTACK"
        ? "允许模拟盘小仓位试错，但必须经过板块持续性、量能和模型确认。"
        : "不把市场热度直接等同于买点，先用回测和持仓风险约束交易冲动。",
    reasons,
    tradePermission: "paper_only",
  };
}

function buildAdaptivePolicy({ config, optimizer, posture, backtest, market, concentration }) {
  const proposed = optimizer.proposed || {};
  let buyScoreThreshold = num(proposed.buyScoreThreshold, num(config.buyScoreThreshold, 72));
  let chasePctLimit = num(proposed.chasePctLimit, num(config.riskControls?.chasePctLimit, 7.5));
  let stopLossPct = num(proposed.stopLossPct, num(config.stopLossPct, -5));
  let takeProfitPct = num(proposed.takeProfitPct, num(config.takeProfitPct, 10));
  let maxBoardExposurePct = num(proposed.maxBoardExposurePct, num(config.riskControls?.maxBoardExposurePct, 0.45));
  const reasoning = [];

  if (posture.mode === "RESEARCH_FIRST" || posture.mode === "RISK_CONTROL") {
    buyScoreThreshold = clamp(buyScoreThreshold + 1, 50, 90);
    chasePctLimit = round(clamp(chasePctLimit - 0.5, 3, 20), 1);
    reasoning.push("Agent 处于风控/研究优先模式，买入阈值上调、追高阈值下调。");
  }
  if (posture.mode === "DEFENSIVE") {
    buyScoreThreshold = clamp(buyScoreThreshold + 2, 50, 90);
    chasePctLimit = round(clamp(chasePctLimit - 1, 3, 20), 1);
    stopLossPct = round(clamp(stopLossPct + 0.5, -30, -0.3), 1);
    reasoning.push("市场偏弱，模拟新开仓要更少，亏损要更快退出。");
  }
  if (posture.mode === "SELECTIVE_ATTACK") {
    takeProfitPct = round(clamp(takeProfitPct + 1, 1, 100), 1);
    reasoning.push("市场强且回测没有负反馈，趋势票止盈空间小幅上移。");
  }
  if (backtest.status === "ok" && backtest.alphaPct !== null && backtest.alphaPct <= -10) {
    buyScoreThreshold = clamp(buyScoreThreshold + 1, 50, 90);
    reasoning.push("回测显著跑输基准，新增信号必须更严格。");
  }
  if (concentration?.exposurePct >= 50) {
    maxBoardExposurePct = round(clamp(Math.min(maxBoardExposurePct, 0.4), 0.1, 1), 2);
    reasoning.push(`${concentration.name} 持仓过于集中，单板块上限建议压到 ${signed(maxBoardExposurePct * 100)}%。`);
  }
  if (market.score >= 80 && backtest.status === "ok" && backtest.alphaPct !== null && backtest.alphaPct < 0) {
    reasoning.push("市场很强但策略跑输，说明核心问题是选股/时点，不是仓位不够。");
  }

  return {
    buyScoreThreshold,
    stopLossPct,
    takeProfitPct,
    chasePctLimit,
    maxBoardExposurePct,
    maxNewPositions: posture.riskBudget === "LOW" ? 0 : posture.mode === "SELECTIVE_ATTACK" ? 1 : 0,
    applyMode: "suggest_only",
    reasoning,
  };
}

function buildDiagnostics({ market, candidates, portfolio, backtest, optimizer, concentration }) {
  const items = [];
  if (backtest.status === "ok" && backtest.alphaPct !== null && backtest.alphaPct <= -10) {
    items.push({
      severity: "high",
      title: "市场涨、策略没吃到",
      evidence: [`策略 ${signed(backtest.returnPct)}%`, `基准 ${signed(backtest.benchmarkReturnPct)}%`, `超额 ${signed(backtest.alphaPct)}%`],
      action: "优先优化入场质量和板块持续性过滤，而不是提高仓位。",
    });
  }
  if (backtest.status === "ok" && backtest.winRate < 45) {
    items.push({
      severity: "high",
      title: "胜率不足",
      evidence: [`胜率 ${signed(backtest.winRate)}%`, `盈亏因子 ${backtest.profitFactor.toFixed(2)}`],
      action: "提高买入阈值，要求成交额/主力资金/模型确认至少两项成立。",
    });
  }
  if (candidates.limitLike > 0 || candidates.missingAmount > 0) {
    items.push({
      severity: "medium",
      title: "候选质量不稳定",
      evidence: [`涨停/接近涨停 ${candidates.limitLike} 个`, `缺成交额 ${candidates.missingAmount} 个`],
      action: "缺成交额或涨幅过高的候选降级为观察，不参与自动模拟买入。",
    });
  }
  if (concentration?.exposurePct >= 50) {
    items.push({
      severity: "medium",
      title: "板块集中",
      evidence: [`${concentration.name} ${concentration.count}/${concentration.total}`, `集中度 ${signed(concentration.exposurePct)}%`],
      action: "暂停同板块新增仓位，优先观察现有持仓卖点。",
    });
  }
  if (!items.length) {
    items.push({
      severity: "info",
      title: "证据中性",
      evidence: ["没有明显风险聚集"],
      action: "继续等待更明确的市场和回测证据。",
    });
  }
  return items;
}

function buildResearchQueue({ dashboard, candidates, market, backtest, concentration }) {
  const queue = [];
  if (market.topBoard) {
    queue.push({
      priority: "high",
      topic: `${market.topBoard.name} 持续性验证`,
      why: `板块涨幅 ${signed(market.topBoard.pct)}%，但需要确认不是一日情绪。`,
      checks: ["成交额是否连续放大", "板块内是否扩散到多只非涨停股", "龙头回落时跟随股是否抗跌"],
      relatedCodes: candidates.top.filter((item) => item.boardName === market.topBoard.name).map((item) => item.code).slice(0, 5),
    });
  }
  const riskyTop = candidates.top.find((item) => item.risk || item.llmVerdict === "AVOID");
  if (riskyTop) {
    queue.push({
      priority: "high",
      topic: `${riskyTop.name} 风险复核`,
      why: riskyTop.risk || "模型或规则给出风险信号。",
      checks: ["是否涨幅过高", "是否缺成交额/资金数据", "公告或财务是否有硬伤"],
      relatedCodes: [riskyTop.code],
    });
  }
  if (backtest.status === "ok" && backtest.alphaPct !== null && backtest.alphaPct < 0) {
    queue.push({
      priority: "medium",
      topic: "跑输基准归因",
      why: `最近回测超额 ${signed(backtest.alphaPct)}%，需要拆分是入场、退出还是标的池问题。`,
      checks: ["统计买入后3日最大回撤", "统计卖出后5日是否反弹", "按板块拆分胜率"],
      relatedCodes: [],
    });
  }
  if (concentration?.exposurePct >= 50) {
    queue.push({
      priority: "medium",
      topic: `${concentration.name} 同质化风险`,
      why: `当前持仓 ${concentration.count}/${concentration.total} 来自同一板块。`,
      checks: ["是否同一个宏观变量驱动", "是否需要减少同板块新仓", "是否已有清晰退出触发"],
      relatedCodes: [],
    });
  }
  return queue.slice(0, 6);
}

function buildExecutionPlan({ posture, policy, candidates, dashboard }) {
  const plan = [
    {
      window: "盘中",
      action: posture.riskBudget === "LOW" ? "只监控持仓卖点，不自动新增模拟仓" : "最多允许 1 笔小仓位模拟试错",
      trigger:
        posture.riskBudget === "LOW"
          ? "回测跑输、胜率低、板块集中或候选追高时触发"
          : `候选分数 >= ${policy.buyScoreThreshold} 且模型 BUY/高信心确认`,
    },
    {
      window: "盘后",
      action: "复盘所有买入/卖出触发和未买候选",
      trigger: "比较次日走势、成交额、板块持续性和模型判断是否一致",
    },
    {
      window: "晚间",
      action: "跑回测与策略优化，更新 Agent 策略姿态",
      trigger: "回测收益、超额收益、胜率或最大回撤出现显著变化",
    },
  ];
  const firstBuy = candidates.top.find((item) => ["BUY", "PAPER_BUY"].includes(item.actionCode));
  if (firstBuy) {
    plan.unshift({
      window: "下一候选",
      action: `只把 ${firstBuy.name} 纳入模拟候选，不当作实盘指令`,
      trigger: `需要确认 ${dashboard.marketRegime?.summary || "市场环境"} 与成交额/公告/舆情一致`,
    });
  }
  return plan;
}

function buildMarkdown(report) {
  const lines = [];
  lines.push(`# 投研决策 Agent ${report.date}`);
  lines.push("");
  lines.push("说明：本报告只用于投研学习和纸面交易，不构成实盘投资建议。");
  lines.push(`账户：${report.account.name}`);
  lines.push("");
  lines.push("## 决策姿态");
  lines.push(`- ${report.posture.label}：${report.posture.summary}`);
  lines.push(`- 风险预算：${report.posture.riskBudget}；信心：${report.posture.confidence}`);
  for (const reason of report.posture.reasons) lines.push(`- 原因：${reason}`);
  lines.push("");
  lines.push("## 自适应策略");
  lines.push(`- 买入阈值：${report.policy.buyScoreThreshold}`);
  lines.push(`- 止损/止盈：${signed(report.policy.stopLossPct)}% / ${signed(report.policy.takeProfitPct)}%`);
  lines.push(`- 追高上限：${signed(report.policy.chasePctLimit)}%；单板块上限：${signed(report.policy.maxBoardExposurePct * 100)}%`);
  for (const reason of report.policy.reasoning) lines.push(`- 调整依据：${reason}`);
  lines.push("");
  lines.push("## 诊断");
  for (const item of report.diagnostics) lines.push(`- ${item.title}：${item.action}（${item.evidence.join("；")}）`);
  lines.push("");
  lines.push("## 研究队列");
  for (const item of report.researchQueue) lines.push(`- ${item.topic}：${item.why}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const [dashboard, state, optimizerRaw, backtestRaw, config] = await Promise.all([
    readJson(dashboardFile, {}),
    readJson(stateFile, {}),
    readJson(optimizerFile, {}),
    readJson(backtestFile, {}),
    readJson(configFile, {}),
  ]);

  const market = marketSnapshot(dashboard);
  const candidates = candidateSnapshot(dashboard);
  const backtest = backtestSnapshot(backtestRaw);
  const optimizer = optimizerSnapshot(optimizerRaw, config);
  const portfolio = {
    ...(dashboard.portfolio || {}),
    openCount: (state.positions || dashboard.paperPositions || []).filter((item) => item.status === "OPEN" || !item.status).length,
  };
  const concentration = topBoardExposure(state.positions || dashboard.paperPositions || []);
  const posture = decidePosture({ market, candidates, portfolio, backtest, optimizer, concentration });
  const policy = buildAdaptivePolicy({ config, optimizer, posture, backtest, market, concentration });
  const diagnostics = buildDiagnostics({ market, candidates, portfolio, backtest, optimizer, concentration });
  const researchQueue = buildResearchQueue({ dashboard, candidates, market, backtest, concentration });
  const executionPlan = buildExecutionPlan({ posture, policy, candidates, dashboard });

  const report = {
    date: today,
    generatedAt: new Date().toISOString(),
    account: {
      id: process.env.A_SHARE_ACCOUNT_ID || "legacy",
      name: process.env.A_SHARE_ACCOUNT_NAME || "系统全局",
    },
    status: "ok",
    inputs: {
      dashboard: Boolean(dashboard.generatedAt),
      optimizer: optimizer.status,
      backtest: backtest.status,
      llmDecision: dashboard.llmDecision?.status || "unknown",
      eventSearch: dashboard.eventSearch?.status || "unknown",
      dataProviders: dashboard.dataProviders?.status || "unknown",
    },
    market,
    candidates,
    portfolio,
    concentration,
    backtest,
    optimizer,
    posture,
    policy,
    diagnostics,
    researchQueue,
    executionPlan,
    guardrails: [
      "Agent 只影响投研建议、模拟盘和参数建议，不直接执行实盘交易。",
      "所有参数调整必须通过回测、纸面交易和人工复核逐步验证。",
      "市场热度不是买入理由，必须和成交额、板块持续性、公司事件、风险标签共同确认。",
    ],
  };

  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(agentFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.mkdir(agentNotesDir, { recursive: true });
  await fs.writeFile(path.join(agentNotesDir, `${today}.md`), buildMarkdown(report), "utf8");
  console.log(`Generated research decision agent report for ${today}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
