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
const labNotesDir = process.env.A_SHARE_ACCOUNT_ID
  ? path.join(notesDir, "accounts", process.env.A_SHARE_ACCOUNT_ID, "strategy-lab")
  : path.join(notesDir, "strategy-lab");
const outputFile = path.join(dataDir, "strategy-lab.json");

function todayShanghai() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

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

async function readJson(file, fallback = {}) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

function statusFromSummary(summary = {}) {
  const positive = num(summary.positiveWindows);
  const windows = Math.max(1, num(summary.windowCount, 1));
  const avgAlpha = num(summary.avgAlphaPct);
  const minAlpha = num(summary.minAlphaPct);
  const trades = num(summary.totalTrades);
  const drawdown = num(summary.avgDrawdownPct);
  if (positive === windows && avgAlpha > 2 && minAlpha > -8 && trades >= 20 && drawdown <= 8) return "PROMOTE_CANDIDATE";
  if (positive >= Math.ceil(windows / 2) && trades >= 12 && drawdown <= 10) return "PAPER_OBSERVE";
  if (minAlpha <= -20 || positive === 0) return "REJECT";
  return "NEEDS_MORE_EVIDENCE";
}

function statusLabel(status) {
  return {
    ACTIVE: "当前生效",
    PROMOTE_CANDIDATE: "可进入观察晋级",
    PAPER_OBSERVE: "纸面观察",
    NEEDS_MORE_EVIDENCE: "证据不足",
    DEFENSIVE_ONLY: "防守兜底",
    REJECT: "暂不采用",
  }[status] || status;
}

function scoreFromSummary(summary = {}) {
  const positiveRatio = num(summary.positiveWindows) / Math.max(1, num(summary.windowCount, 1));
  return round(
    45 +
      positiveRatio * 24 +
      Math.max(-20, Math.min(20, num(summary.avgAlphaPct))) * 0.8 -
      Math.max(0, num(summary.avgDrawdownPct) - 5) * 1.4 +
      Math.min(18, num(summary.totalTrades) / 4),
    1,
  );
}

function pickRanking(rankings, predicate, fallbackIndex = 0) {
  return rankings.find(predicate) || rankings[fallbackIndex] || null;
}

function candidateFromRanking({ ranking, id, name, role, description, style }) {
  if (!ranking) {
    return {
      id,
      name,
      role,
      status: "NEEDS_MORE_EVIDENCE",
      statusLabel: statusLabel("NEEDS_MORE_EVIDENCE"),
      score: 0,
      description,
      parameters: {},
      evidence: ["没有可用寻优排名，需要先运行参数寻优。"],
      recommendation: "先运行寻优和候选回测，再纳入比较。",
      style,
    };
  }
  const status = statusFromSummary(ranking.summary);
  const p = ranking.params || {};
  return {
    id,
    name,
    role,
    status,
    statusLabel: statusLabel(status),
    score: scoreFromSummary(ranking.summary),
    description,
    parameters: {
      buyScoreThreshold: p.buyScoreThreshold,
      stopLossPct: p.stopLossPct,
      takeProfitPct: p.takeProfitPct,
      chasePctLimit: p.chasePctLimit,
      timeStopDays: p.timeStopDay,
    },
    evidence: [
      `寻优排名 #${ranking.rank || "-"}`,
      `平均收益 ${signed(ranking.summary?.avgReturnPct)}%，平均超额 ${signed(ranking.summary?.avgAlphaPct)}%`,
      `最差窗口超额 ${signed(ranking.summary?.minAlphaPct)}%，平均回撤 ${signed(ranking.summary?.avgDrawdownPct)}%`,
      `${ranking.summary?.positiveWindows || 0}/${ranking.summary?.windowCount || 0} 个窗口为正，交易 ${ranking.summary?.totalTrades || 0} 笔`,
    ],
    recommendation:
      status === "PROMOTE_CANDIDATE"
        ? "可进入候选策略池，先纸面观察，再考虑小步应用。"
        : status === "PAPER_OBSERVE"
          ? "只做纸面观察，暂不直接替换当前策略。"
          : status === "REJECT"
            ? "最差窗口太弱，暂不采用。"
            : "证据不足，继续积累样本。",
    style,
  };
}

function buildMarketState({ dashboard, agent, backtest }) {
  const score = num(dashboard.marketRegime?.score);
  const strongBoards = (dashboard.hotBoards || []).filter((item) => num(item.pct) > 1.5).length;
  const alpha = backtest.status === "ok" ? num(backtest.metrics?.alphaPct) : null;
  const concentration = agent.concentration || null;
  let mode = "BALANCED";
  const reasons = [];
  if (score >= 70 && strongBoards >= 3) {
    mode = "HOT";
    reasons.push(`市场评分 ${score}，强势板块 ${strongBoards} 个。`);
  }
  if (score < 45) {
    mode = "DEFENSIVE";
    reasons.push(`市场评分 ${score} 偏弱。`);
  }
  if (alpha !== null && alpha < -8) {
    mode = mode === "HOT" ? "HOT_BUT_STRATEGY_WEAK" : "DEFENSIVE";
    reasons.push(`当前策略回测超额 ${signed(alpha)}%，不能只因市场热就加仓。`);
  }
  if (concentration?.exposurePct >= 50) {
    mode = "CONCENTRATED";
    reasons.push(`${concentration.name} 持仓集中度 ${signed(concentration.exposurePct)}%。`);
  }
  if (!reasons.length) reasons.push("市场没有给出极端进攻或防守信号。");
  const labels = {
    HOT: "热点活跃",
    HOT_BUT_STRATEGY_WEAK: "市场热但策略弱",
    BALANCED: "平衡观察",
    DEFENSIVE: "防守",
    CONCENTRATED: "持仓集中",
  };
  return {
    mode,
    label: labels[mode] || mode,
    score,
    strongBoards,
    summary: dashboard.marketRegime?.summary || "暂无市场状态",
    reasons,
  };
}

function buildCurrentCandidate(config, backtest, dashboard) {
  const m = backtest.status === "ok" ? backtest.metrics || {} : {};
  const status = backtest.status === "ok" ? "ACTIVE" : "NEEDS_MORE_EVIDENCE";
  return {
    id: "current",
    name: "当前生效策略",
    role: "现任策略",
    status,
    statusLabel: statusLabel(status),
    score: backtest.status === "ok" ? round(50 + num(m.alphaPct) * 0.7 + num(m.winRate) * 0.2 - num(m.maxDrawdownPct) * 1.2, 1) : 0,
    description: "当前配置中心正在用于模拟交易的策略。",
    parameters: {
      buyScoreThreshold: config.buyScoreThreshold,
      stopLossPct: config.stopLossPct,
      takeProfitPct: config.takeProfitPct,
      chasePctLimit: config.riskControls?.chasePctLimit,
      timeStopDays: config.riskControls?.timeStopDays,
    },
    evidence:
      backtest.status === "ok"
        ? [
            `回测收益 ${signed(m.returnPct)}%，超额 ${m.alphaPct === null || m.alphaPct === undefined ? "无基准" : `${signed(m.alphaPct)}%`}`,
            `胜率 ${signed(m.winRate)}%，交易 ${m.tradeCount || 0} 笔，最大回撤 ${signed(m.maxDrawdownPct)}%`,
            `当前市场：${dashboard.marketRegime?.summary || "暂无"}`,
          ]
        : ["还没有可用回测结果。"],
    recommendation:
      backtest.status === "ok" && num(m.alphaPct) < -8
        ? "当前策略跑输明显，应降低新开仓并等待候选策略验证。"
        : "继续作为基准策略，和候选策略并行比较。",
    style: "current",
  };
}

function buildGuardCandidate({ marketState, agent }) {
  const defensive = ["DEFENSIVE", "CONCENTRATED", "HOT_BUT_STRATEGY_WEAK"].includes(marketState.mode);
  return {
    id: "cash-etf-guard",
    name: "ETF/空仓兜底",
    role: "防守策略",
    status: "DEFENSIVE_ONLY",
    statusLabel: statusLabel("DEFENSIVE_ONLY"),
    score: defensive ? 78 : 54,
    description: "当个股策略证据不足或持仓过于集中时，优先保护账户，不强行选股。",
    parameters: {
      maxNewPositions: defensive ? 0 : agent.policy?.maxNewPositions ?? 0,
      preferred: defensive ? "空仓/降低个股风险" : "观察为主",
    },
    evidence: [...marketState.reasons, ...(agent.posture?.reasons || []).slice(0, 2)],
    recommendation: defensive ? "当前应作为主防守闸门，限制新增个股仓位。" : "保留为弱市兜底，不参与进攻。",
    style: "guard",
  };
}

function buildDataQuality(dashboard) {
  const candidates = dashboard.candidates || [];
  const missingAmount = candidates.filter((item) => item.amount === null || item.amount === undefined).length;
  const llmAvoid = candidates.filter((item) => String(item.actionCode || "").includes("AVOID")).length;
  const providerStatus = dashboard.dataProviders?.status || "unknown";
  const eventStatus = dashboard.eventSearch?.status || "unknown";
  const score = Math.max(0, 100 - missingAmount * 8 - (providerStatus === "ok" ? 0 : 18) - (eventStatus === "ok" ? 0 : 12));
  return {
    score,
    status: score >= 80 ? "GOOD" : score >= 60 ? "WATCH" : "RISK",
    checks: [
      `候选 ${candidates.length} 个，成交额缺失 ${missingAmount} 个`,
      `模型/规则规避 ${llmAvoid} 个`,
      `财务数据 ${providerStatus}，事件搜索 ${eventStatus}`,
    ],
    recommendation: score >= 80 ? "数据质量可用于候选比较。" : "数据质量不足的股票应降权或剔除。",
  };
}

function buildPromotionRules() {
  return [
    "至少 2/3 个窗口为正，且最差窗口不能大幅跑输。",
    "交易次数不足 20 笔时，只能纸面观察，不能直接晋级。",
    "候选策略最大回撤不能明显高于当前策略。",
    "Agent 处于防守或持仓集中时，候选策略只能进入观察池。",
    "任何候选策略先跑 3-10 个交易日纸面验证，再考虑小步应用。",
  ];
}

function buildMarkdown(report) {
  const lines = [];
  lines.push(`# 多策略实验室 ${report.date}`);
  lines.push("");
  lines.push(`市场状态：${report.marketState.label}`);
  lines.push("");
  lines.push("## 候选策略");
  for (const item of report.candidates) {
    lines.push(`- ${item.name}：${item.statusLabel}，评分 ${item.score}，${item.recommendation}`);
  }
  lines.push("");
  lines.push("## 晋级规则");
  for (const rule of report.promotionRules) lines.push(`- ${rule}`);
  return `${lines.join("\n")}\n`;
}

async function main() {
  const [config, dashboard, backtest, sweep, agent] = await Promise.all([
    readJson(path.join(runtimeDir, "trading-config.json"), {}),
    readJson(path.join(dataDir, "dashboard.json"), {}),
    readJson(path.join(dataDir, "backtest-report.json"), {}),
    readJson(path.join(dataDir, "parameter-sweep.json"), {}),
    readJson(path.join(dataDir, "decision-agent.json"), {}),
  ]);
  const rankings = sweep.status === "ok" ? sweep.rankings || [] : [];
  const marketState = buildMarketState({ dashboard, agent, backtest });
  const best = rankings[0] || null;
  const defensive = pickRanking(rankings, (item) => num(item.params?.chasePctLimit) <= 5.5 || num(item.params?.stopLossPct) >= -5, 1);
  const quality = pickRanking(rankings, (item) => num(item.params?.buyScoreThreshold) >= 75 && num(item.summary?.totalTrades) >= 12, 2);
  const momentum = pickRanking(rankings, (item) => num(item.params?.takeProfitPct) >= 12 && num(item.params?.chasePctLimit) <= 7, 0);
  const candidates = [
    buildCurrentCandidate(config, backtest, dashboard),
    candidateFromRanking({
      ranking: best,
      id: "hot-rotation",
      name: "热点板块轮动",
      role: "主进攻候选",
      description: "优先跟随赚钱效应板块，但必须通过成交额和追高过滤。",
      style: "attack",
    }),
    candidateFromRanking({
      ranking: momentum,
      id: "short-momentum",
      name: "短周期动量",
      role: "强势延续候选",
      description: "利用 2-4 周强势、1-3 周验证的短周期趋势。",
      style: "momentum",
    }),
    candidateFromRanking({
      ranking: defensive,
      id: "reversal-guard",
      name: "高波动反转过滤",
      role: "追高防守候选",
      description: "降低高振幅、涨停附近和成交额缺失股票的买入概率。",
      style: "defense",
    }),
    candidateFromRanking({
      ranking: quality,
      id: "quality-trend",
      name: "质量趋势",
      role: "稳健候选",
      description: "提高买入门槛，偏向流动性和趋势更稳定的公司。",
      style: "quality",
    }),
    buildGuardCandidate({ marketState, agent }),
  ];
  const report = {
    date: todayShanghai(),
    generatedAt: new Date().toISOString(),
    account: {
      id: process.env.A_SHARE_ACCOUNT_ID || "legacy",
      name: process.env.A_SHARE_ACCOUNT_NAME || "系统全局",
    },
    status: "ok",
    marketState,
    dataQuality: buildDataQuality(dashboard),
    candidates,
    promotionRules: buildPromotionRules(),
    nextActions: [
      "先用“回测寻优第一名”验证主候选。",
      "候选策略不要直接替换当前策略，至少纸面观察 3-10 个交易日。",
      "如果当前策略超额持续为负，新增买入应由 Agent 限制。",
    ],
  };
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.mkdir(labNotesDir, { recursive: true });
  await fs.writeFile(path.join(labNotesDir, `${report.date}.md`), buildMarkdown(report), "utf8");
  console.log(`Generated strategy lab report: ${outputFile}`);
}

main().catch(async (error) => {
  const report = {
    date: todayShanghai(),
    generatedAt: new Date().toISOString(),
    status: "error",
    error: error.message,
  };
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.error(error);
  process.exitCode = 1;
});
