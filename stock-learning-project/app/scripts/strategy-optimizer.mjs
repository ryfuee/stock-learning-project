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
const configFile = path.join(runtimeDir, "trading-config.json");
const dashboardFile = path.join(dataDir, "dashboard.json");
const stateFile = path.join(dataDir, "state.json");
const optimizerFile = path.join(dataDir, "strategy-optimizer.json");
const backtestFile = path.join(dataDir, "backtest-report.json");
const notesDir = process.env.MARKET_NOTES_DIR || path.join(projectRoot, "02-market-notes");
const optimizerNotesDir = process.env.A_SHARE_ACCOUNT_ID
  ? path.join(notesDir, "accounts", process.env.A_SHARE_ACCOUNT_ID, "strategy-optimizer")
  : path.join(notesDir, "strategy-optimizer");
const defaultAdaptiveRisk = {
  enabled: true,
  minStopLossPct: -9,
  maxStopLossPct: -2.5,
  minTakeProfitPct: 4,
  maxTakeProfitPct: 18,
};
const defaultRiskControls = {
  enabled: true,
  maxBoardExposurePct: 0.45,
  maxAccountDrawdownPct: 6,
  pauseAfterLossStreak: 3,
  chasePctLimit: 7.5,
  minAmount: 500000000,
  timeStopDays: 7,
  timeStopMinProfitPct: 1,
};

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

async function readJson(file, fallback = {}) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

function avg(items, getValue) {
  return items.length ? items.reduce((sum, item) => sum + num(getValue(item)), 0) / items.length : 0;
}

function countBy(items, getKey) {
  return items.reduce((acc, item) => {
    const key = getKey(item) || "UNKNOWN";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(num(value) * factor) / factor;
}

function pctOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function currentLossStreak(closed) {
  let streak = 0;
  for (const trade of [...closed].reverse()) {
    if (num(trade.realizedPnlPct) <= 0) streak += 1;
    else break;
  }
  return streak;
}

function buildMetrics(state, dashboard) {
  const closed = state.closedTrades || [];
  const winners = closed.filter((item) => num(item.realizedPnlPct) > 0);
  const losers = closed.filter((item) => num(item.realizedPnlPct) <= 0);
  const grossWin = winners.reduce((sum, item) => sum + num(item.realizedPnl), 0);
  const grossLoss = Math.abs(losers.reduce((sum, item) => sum + num(item.realizedPnl), 0));
  const openPositions = (state.positions || []).filter((item) => item.status === "OPEN");
  const boardCounts = countBy(openPositions, (item) => item.boardName);
  const largestBoard = Object.entries(boardCounts).sort((a, b) => b[1] - a[1])[0] || null;

  return {
    sampleCount: closed.length,
    winRate: closed.length ? (winners.length / closed.length) * 100 : 0,
    avgReturn: avg(closed, (item) => item.realizedPnlPct),
    avgWin: avg(winners, (item) => item.realizedPnlPct),
    avgLoss: avg(losers, (item) => item.realizedPnlPct),
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 99 : 0,
    openCount: openPositions.length,
    openUnrealizedPct: avg(openPositions, (item) => item.unrealizedPnlPct),
    largestBoard: largestBoard ? { name: largestBoard[0], count: largestBoard[1] } : null,
    currentDrawdownPct: num(state.portfolio?.currentDrawdownPct || dashboard.riskControls?.status?.drawdownPct),
    lossStreak: currentLossStreak(closed),
    strategyVersionId: dashboard.strategyVersion?.id || dashboard.strategyReview?.strategyVersion?.id || "",
    riskBlockedCount: num(dashboard.strategyReview?.attribution?.blockedCount),
    marketScore: num(dashboard.marketRegime?.score),
    modelStatus: dashboard.llmDecision?.status || "unknown",
    eventSearchStatus: dashboard.eventSearch?.status || "unknown",
    financeStatus: dashboard.dataProviders?.status || "unknown",
  };
}

function buildBacktestEvidence(report) {
  if (!report || !Object.keys(report).length) {
    return {
      status: "missing",
      usable: false,
      summary: "还没有历史回测结果，优化器暂时只使用纸面交易样本。",
    };
  }
  if (report.status !== "ok") {
    return {
      status: "error",
      usable: false,
      summary: `最近回测失败：${report.error || report.warnings?.[0] || "未知错误"}`,
      warnings: report.warnings || [],
    };
  }
  const m = report.metrics || {};
  const tradeCount = num(m.tradeCount);
  const alphaPct = pctOrNull(m.alphaPct);
  const benchmarkReturnPct = pctOrNull(m.benchmarkReturnPct);
  const sampleQuality = tradeCount >= 12 ? "adequate" : tradeCount >= 4 ? "thin" : "very_thin";
  return {
    status: "ok",
    usable: true,
    source: report.source || "unknown",
    range: report.range || {},
    strategyVersion: report.strategyVersion || "",
    universeCount: num(report.universe?.count),
    tradeCount,
    sampleQuality,
    returnPct: round(m.returnPct),
    benchmarkReturnPct: benchmarkReturnPct === null ? null : round(benchmarkReturnPct),
    alphaPct: alphaPct === null ? null : round(alphaPct),
    maxDrawdownPct: round(m.maxDrawdownPct),
    winRate: round(m.winRate),
    profitFactor: round(m.profitFactor),
    avgWinPct: round(m.avgWinPct),
    avgLossPct: round(m.avgLossPct),
    openPositions: num(m.openPositions),
    warnings: report.warnings || [],
    summary: `最近回测 ${report.range?.start || ""} 至 ${report.range?.end || ""}，策略收益 ${signed(m.returnPct)}%，超额 ${
      alphaPct === null ? "无基准" : `${signed(alphaPct)}%`
    }，交易 ${tradeCount} 笔。`,
  };
}

function adjustBuyScore(proposed, delta) {
  proposed.buyScoreThreshold = clamp(Math.round(num(proposed.buyScoreThreshold, 72) + delta), 50, 90);
}

function tightenStopLoss(proposed, delta = 0.3) {
  proposed.stopLossPct = round(clamp(num(proposed.stopLossPct, -5) + delta, -30, -0.3), 1);
  proposed.adaptiveRisk.maxStopLossPct = round(clamp(num(proposed.adaptiveRisk.maxStopLossPct, -2.5) + delta, -9, -1.5), 1);
}

function loosenTakeProfit(proposed, delta = 1) {
  proposed.takeProfitPct = round(clamp(num(proposed.takeProfitPct, 10) + delta, 1, 100), 1);
  proposed.adaptiveRisk.maxTakeProfitPct = round(clamp(num(proposed.adaptiveRisk.maxTakeProfitPct, 18) + delta, 6, 30), 1);
}

function applyBacktestRecommendations(advice, proposed, backtest) {
  if (backtest.status === "missing") {
    advice.push({
      level: "info",
      title: "等待回测证据",
      body: "还没有历史回测报告，晚间优化会先依据纸面交易样本生成建议。",
    });
    return;
  }
  if (backtest.status === "error") {
    advice.push({
      level: "risk",
      title: "回测不可用",
      body: backtest.summary,
    });
    return;
  }
  if (!backtest.usable) return;

  if (backtest.sampleQuality !== "adequate") {
    advice.push({
      level: "info",
      title: "回测样本偏少",
      body: `最近回测只有 ${backtest.tradeCount} 笔关闭交易，参数只允许小步移动，避免被少数样本带偏。`,
    });
  }

  const alphaWeak = backtest.alphaPct !== null && backtest.alphaPct <= -2;
  const absoluteWeak = backtest.returnPct <= -1;
  if (backtest.tradeCount >= 2 && (alphaWeak || absoluteWeak)) {
    adjustBuyScore(proposed, backtest.alphaPct !== null && backtest.alphaPct <= -5 && backtest.tradeCount >= 6 ? 2 : 1);
    proposed.riskControls.chasePctLimit = round(clamp(num(proposed.riskControls.chasePctLimit, 7.5) - 0.3, 3, 20), 1);
    advice.push({
      level: "risk",
      title: "回测跑输基准",
      body: `策略收益 ${signed(backtest.returnPct)}%，超额 ${backtest.alphaPct === null ? "无基准" : `${signed(backtest.alphaPct)}%`}，建议把买入评分阈值调到 ${proposed.buyScoreThreshold}，追高上限降到 ${signed(proposed.riskControls.chasePctLimit, 1)}%。`,
    });
  }

  if (backtest.tradeCount >= 4 && (backtest.winRate < 45 || backtest.profitFactor < 1)) {
    adjustBuyScore(proposed, 1);
    tightenStopLoss(proposed, 0.3);
    advice.push({
      level: "risk",
      title: "回测胜率不足",
      body: `回测胜率 ${signed(backtest.winRate)}%、盈亏因子 ${backtest.profitFactor.toFixed(2)}，建议提高买入门槛并把基准止损收紧到 ${signed(proposed.stopLossPct, 1)}%。`,
    });
  }

  if (backtest.tradeCount >= 4 && Math.abs(backtest.avgLossPct) > Math.max(4, backtest.avgWinPct * 1.2)) {
    tightenStopLoss(proposed, 0.4);
    proposed.riskControls.timeStopDays = clamp(Math.round(num(proposed.riskControls.timeStopDays, 7) - 1), 2, 60);
    advice.push({
      level: "risk",
      title: "亏损单拖尾",
      body: `回测平均亏损 ${signed(backtest.avgLossPct)}% 明显偏大，建议收紧止损并把时间止损观察期调到 ${proposed.riskControls.timeStopDays} 天。`,
    });
  }

  if (
    backtest.tradeCount >= 8 &&
    backtest.alphaPct !== null &&
    backtest.alphaPct >= 2 &&
    backtest.winRate >= 52 &&
    backtest.profitFactor >= 1.25
  ) {
    adjustBuyScore(proposed, -1);
    loosenTakeProfit(proposed, 1);
    advice.push({
      level: "opportunity",
      title: "回测具备超额",
      body: `回测超额 ${signed(backtest.alphaPct)}%、盈亏因子 ${backtest.profitFactor.toFixed(2)}，可小幅降低买入阈值并提高趋势票止盈上限。`,
    });
  }
}

function buildRecommendations(metrics, dashboard, config, backtest) {
  const advice = [];
  const proposed = {
    buyScoreThreshold: num(config.buyScoreThreshold, 72),
    stopLossPct: num(config.stopLossPct, -5),
    takeProfitPct: num(config.takeProfitPct, 10),
    adaptiveRisk: { ...defaultAdaptiveRisk, ...(config.adaptiveRisk || {}) },
    riskControls: { ...defaultRiskControls, ...(config.riskControls || {}) },
  };

  if (metrics.sampleCount < 20) {
    advice.push({
      level: "info",
      title: "样本不足",
      body: `已关闭模拟交易只有 ${metrics.sampleCount} 笔，暂不建议大幅修改买入阈值；继续积累至少 20 笔样本。`,
    });
  } else if (metrics.winRate < 45 || metrics.profitFactor < 1) {
    proposed.buyScoreThreshold = clamp(proposed.buyScoreThreshold + 1, 50, 90);
    advice.push({
      level: "risk",
      title: "提高买入门槛",
      body: `胜率 ${signed(metrics.winRate)}%、盈亏因子 ${metrics.profitFactor.toFixed(2)}，建议下一阶段把买入评分阈值小幅上调到 ${proposed.buyScoreThreshold}。`,
    });
  } else if (metrics.winRate > 58 && metrics.profitFactor > 1.3) {
    proposed.buyScoreThreshold = clamp(proposed.buyScoreThreshold - 1, 50, 90);
    advice.push({
      level: "opportunity",
      title: "放宽试错",
      body: `胜率和盈亏因子暂时占优，可小幅降低买入阈值到 ${proposed.buyScoreThreshold}，但只应用于纸面交易。`,
    });
  }

  const avgLossAbs = Math.abs(metrics.avgLoss);
  if (metrics.sampleCount >= 5 && avgLossAbs > Math.max(3, metrics.avgWin * 1.15)) {
    proposed.adaptiveRisk.maxStopLossPct = clamp(num(proposed.adaptiveRisk.maxStopLossPct, -2.5) + 0.3, -9, -1.5);
    advice.push({
      level: "risk",
      title: "收紧动态止损",
      body: `平均亏损 ${signed(metrics.avgLoss)}% 偏大，建议把最紧止损试探性收紧到 ${signed(proposed.adaptiveRisk.maxStopLossPct)}%。`,
    });
  }

  if (metrics.sampleCount >= 5 && metrics.avgWin > avgLossAbs * 1.25 && metrics.winRate > 50) {
    proposed.adaptiveRisk.maxTakeProfitPct = clamp(num(proposed.adaptiveRisk.maxTakeProfitPct, 18) + 1, 6, 30);
    advice.push({
      level: "opportunity",
      title: "提高趋势票止盈上限",
      body: `平均盈利 ${signed(metrics.avgWin)}% 优于平均亏损，可把动态止盈上限提高到 ${signed(proposed.adaptiveRisk.maxTakeProfitPct)}%。`,
    });
  }

  if (metrics.largestBoard && metrics.openCount >= 3 && metrics.largestBoard.count / metrics.openCount >= 0.6) {
    advice.push({
      level: "risk",
      title: "持仓板块集中",
      body: `${metrics.largestBoard.name} 占当前持仓 ${metrics.largestBoard.count}/${metrics.openCount}，盘后复盘需要检查是否只是单一热点拥挤交易。`,
    });
  }

  if (metrics.currentDrawdownPct >= 4) {
    advice.push({
      level: "risk",
      title: "回撤接近风控线",
      body: `当前回撤 ${signed(metrics.currentDrawdownPct)}%，建议盘后复查是否需要降低单票仓位或提高买入阈值。`,
    });
  }

  if (metrics.lossStreak >= 2) {
    advice.push({
      level: "risk",
      title: "连续亏损预警",
      body: `最近连续亏损 ${metrics.lossStreak} 笔，下一轮新开仓应优先检查是否追高、热点衰退或模型确认不足。`,
    });
  }

  if (dashboard.llmDecision?.parameterAdvice?.length) {
    advice.push({
      level: "model",
      title: "模型参数建议",
      body: dashboard.llmDecision.parameterAdvice.slice(0, 3).join("；"),
    });
  }

  applyBacktestRecommendations(advice, proposed, backtest);

  if (!advice.length) {
    advice.push({
      level: "info",
      title: "保持策略",
      body: "当前没有足够证据修改参数，继续用动态止盈止损和纸面交易积累样本。",
    });
  }

  return { advice, proposed };
}

async function maybeApplyConfig(config, proposed, shouldApply) {
  if (!shouldApply) return { applied: false, reason: "默认只生成建议，不自动改配置。" };
  const next = {
    ...config,
    buyScoreThreshold: proposed.buyScoreThreshold,
    stopLossPct: proposed.stopLossPct,
    takeProfitPct: proposed.takeProfitPct,
    adaptiveRisk: {
      ...(config.adaptiveRisk || {}),
      ...(proposed.adaptiveRisk || {}),
    },
    riskControls: {
      ...(config.riskControls || {}),
      ...(proposed.riskControls || {}),
    },
  };
  await fs.writeFile(configFile, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return { applied: true, reason: "已按有界建议更新纸面交易配置。" };
}

function buildMarkdown(report) {
  const lines = [];
  lines.push(`# 策略优化建议 ${report.date}`);
  lines.push("");
  lines.push("说明：本文件用于纸面交易学习，不构成实盘投资建议。");
  lines.push(`账户：${report.account?.name || "系统全局"}`);
  lines.push("");
  lines.push("## 样本状态");
  lines.push(`- 已关闭样本：${report.metrics.sampleCount}`);
  lines.push(`- 胜率：${signed(report.metrics.winRate)}%`);
  lines.push(`- 平均收益：${signed(report.metrics.avgReturn)}%`);
  lines.push(`- 盈亏因子：${report.metrics.profitFactor.toFixed(2)}`);
  lines.push(`- 当前持仓：${report.metrics.openCount} 只，平均浮动 ${signed(report.metrics.openUnrealizedPct)}%`);
  lines.push(`- 当前回撤：${signed(report.metrics.currentDrawdownPct)}%；连续亏损：${report.metrics.lossStreak} 笔`);
  if (report.metrics.strategyVersionId) lines.push(`- 策略版本：${report.metrics.strategyVersionId}`);
  lines.push(`- 风控拦截候选：${report.metrics.riskBlockedCount || 0} 个`);
  lines.push("");
  lines.push("## 回测证据");
  lines.push(`- 状态：${report.backtest.status}`);
  lines.push(`- ${report.backtest.summary}`);
  if (report.backtest.status === "ok") {
    lines.push(`- 回测胜率：${signed(report.backtest.winRate)}%；盈亏因子：${report.backtest.profitFactor.toFixed(2)}；最大回撤：${signed(report.backtest.maxDrawdownPct)}%`);
  }
  lines.push("");
  lines.push("## 优化建议");
  for (const item of report.advice) {
    lines.push(`- ${item.title}：${item.body}`);
  }
  lines.push("");
  lines.push("## 建议参数");
  lines.push(`- 买入评分阈值：${report.proposed.buyScoreThreshold}`);
  lines.push(`- 基准止损/止盈：${signed(report.proposed.stopLossPct)}% / ${signed(report.proposed.takeProfitPct)}%`);
  if (report.proposed.adaptiveRisk) {
    lines.push(`- 动态止损边界：${signed(report.proposed.adaptiveRisk.minStopLossPct)}% 到 ${signed(report.proposed.adaptiveRisk.maxStopLossPct)}%`);
    lines.push(`- 动态止盈边界：${signed(report.proposed.adaptiveRisk.minTakeProfitPct)}% 到 ${signed(report.proposed.adaptiveRisk.maxTakeProfitPct)}%`);
  }
  if (report.proposed.riskControls) {
    lines.push(`- 追高上限：${signed(report.proposed.riskControls.chasePctLimit)}%；时间止损：${report.proposed.riskControls.timeStopDays} 天`);
  }
  lines.push("");
  lines.push(`## 应用状态`);
  lines.push(`- ${report.apply.applied ? "已应用" : "未应用"}：${report.apply.reason}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const config = await readJson(configFile, {});
  const dashboard = await readJson(dashboardFile, {});
  const state = await readJson(stateFile, {});
  const backtestReport = await readJson(backtestFile, null);
  const metrics = buildMetrics(state, dashboard);
  const backtest = buildBacktestEvidence(backtestReport);
  const { advice, proposed } = buildRecommendations(metrics, dashboard, config, backtest);
  const apply = await maybeApplyConfig(config, proposed, process.argv.includes("--apply-bounded") || process.env.A_SHARE_AUTO_APPLY_OPTIMIZER === "1");
  const report = {
    date: today,
    generatedAt: new Date().toISOString(),
    account: {
      id: process.env.A_SHARE_ACCOUNT_ID || "legacy",
      name: process.env.A_SHARE_ACCOUNT_NAME || "系统全局",
    },
    metrics,
    backtest,
    advice,
    proposed,
    apply,
  };

  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(optimizerFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.mkdir(optimizerNotesDir, { recursive: true });
  await fs.writeFile(path.join(optimizerNotesDir, `${today}.md`), buildMarkdown(report), "utf8");
  console.log(`Generated strategy optimizer report for ${today}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
