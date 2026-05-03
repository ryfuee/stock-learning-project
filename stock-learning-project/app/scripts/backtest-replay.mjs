import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const execFileAsync = promisify(execFile);
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
const outputFile = path.join(dataDir, "backtest-report.json");
const notesDir = process.env.MARKET_NOTES_DIR || path.join(projectRoot, "02-market-notes");
const backtestNotesDir = process.env.A_SHARE_ACCOUNT_ID
  ? path.join(notesDir, "accounts", process.env.A_SHARE_ACCOUNT_ID, "backtests")
  : path.join(notesDir, "backtests");
const historyProviderScript = path.join(__dirname, "provider-history.py");

const defaultConfig = {
  initialCash: 100000,
  maxPositions: 5,
  maxPositionPct: 0.2,
  buyScoreThreshold: 72,
  stopLossPct: -5,
  takeProfitPct: 10,
  commissionRate: 0.0003,
  minCommission: 5,
  transferFeeRate: 0.00001,
  stampDutyRate: 0.0005,
  slippageRate: 0.0002,
  lotSize: 100,
  dataProviders: { pythonBin: "python3" },
  riskControls: {
    enabled: true,
    maxAccountDrawdownPct: 6,
    pauseAfterLossStreak: 3,
    chasePctLimit: 7.5,
    minAmount: 500000000,
    timeStopDays: 7,
    timeStopMinProfitPct: 1,
  },
};

const fallbackUniverse = ["600519", "300750", "002475", "601318", "600030", "000651", "002594", "300760"];

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function signed(value, digits = 2) {
  const n = num(value);
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}`;
}

function money(value) {
  const n = num(value);
  if (Math.abs(n) >= 1e8) return `${(n / 1e8).toFixed(2)}亿`;
  if (Math.abs(n) >= 1e4) return `${(n / 1e4).toFixed(2)}万`;
  return n.toFixed(2);
}

function todayShanghai() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00+08:00`);
  date.setDate(date.getDate() + days);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function parseArgs() {
  const args = Object.fromEntries(
    process.argv
      .slice(2)
      .filter((arg) => arg.startsWith("--") && arg.includes("="))
      .map((arg) => {
        const index = arg.indexOf("=");
        return [arg.slice(2, index), arg.slice(index + 1)];
      }),
  );
  const end = args.end || todayShanghai();
  const start = args.start || addDays(end, -365);
  return {
    start,
    end,
    maxSymbols: clamp(Math.round(num(args.maxSymbols, 12)), 3, 50),
    provider: args.provider || "auto",
    scenario: args.scenario || "current",
    overrides: {
      buyScoreThreshold: args.buyScoreThreshold === undefined ? undefined : num(args.buyScoreThreshold),
      stopLossPct: args.stopLossPct === undefined ? undefined : num(args.stopLossPct),
      takeProfitPct: args.takeProfitPct === undefined ? undefined : num(args.takeProfitPct),
      chasePctLimit: args.chasePctLimit === undefined ? undefined : num(args.chasePctLimit),
      timeStopDays: args.timeStopDays === undefined ? undefined : Math.round(num(args.timeStopDays)),
    },
  };
}

function applyBacktestOverrides(config, overrides = {}) {
  const next = {
    ...config,
    riskControls: { ...defaultConfig.riskControls, ...(config.riskControls || {}) },
  };
  if (overrides.buyScoreThreshold !== undefined) next.buyScoreThreshold = clamp(overrides.buyScoreThreshold, 0, 100);
  if (overrides.stopLossPct !== undefined) next.stopLossPct = clamp(overrides.stopLossPct, -30, -0.3);
  if (overrides.takeProfitPct !== undefined) next.takeProfitPct = clamp(overrides.takeProfitPct, 1, 100);
  if (overrides.chasePctLimit !== undefined) next.riskControls.chasePctLimit = clamp(overrides.chasePctLimit, 1, 20);
  if (overrides.timeStopDays !== undefined) next.riskControls.timeStopDays = clamp(overrides.timeStopDays, 2, 60);
  return next;
}

async function readJson(file, fallback = {}) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

function parseWatchlistText(value) {
  return [...String(value || "").matchAll(/\b(00\d{4}|30\d{4}|60\d{4}|68\d{4})\b/g)].map((match) => match[1]);
}

function uniqueCodes(items) {
  const seen = new Set();
  return items
    .map((item) => String(item || "").trim())
    .filter((code) => /^(00|30|60|68)\d{4}$/.test(code))
    .filter((code) => {
      if (seen.has(code)) return false;
      seen.add(code);
      return true;
    });
}

function chooseUniverse(config, dashboard, maxSymbols) {
  return uniqueCodes([
    ...parseWatchlistText(config.watchlistText),
    ...(dashboard.paperPositions || []).map((item) => item.code),
    ...(dashboard.candidates || []).map((item) => item.code),
    ...(dashboard.universe?.items || []).map((item) => item.code),
    ...fallbackUniverse,
  ]).slice(0, maxSymbols);
}

function strategyVersion(config) {
  const snapshot = {
    buyScoreThreshold: config.buyScoreThreshold,
    maxPositions: config.maxPositions,
    maxPositionPct: config.maxPositionPct,
    stopLossPct: config.stopLossPct,
    takeProfitPct: config.takeProfitPct,
    riskControls: config.riskControls,
  };
  return `backtest-${crypto.createHash("sha256").update(JSON.stringify(snapshot)).digest("hex").slice(0, 10)}`;
}

function extractJsonObject(text) {
  const value = String(text || "").trim();
  if (!value) return {};
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end < start) return {};
  return JSON.parse(value.slice(start, end + 1));
}

async function fetchHistory({ codes, start, end, provider, config }) {
  const pythonBin = process.env.PYTHON_BIN || config.dataProviders?.pythonBin || "python3";
  const { stdout, stderr } = await execFileAsync(
    pythonBin,
    [
      historyProviderScript,
      "--codes",
      codes.join(","),
      "--indexes",
      "sh.000300,sh.000001,sz.399006",
      "--start",
      start,
      "--end",
      end,
      "--provider",
      provider,
    ],
    { cwd: appRoot, timeout: 180000, maxBuffer: 40 * 1024 * 1024 },
  );
  const payload = extractJsonObject(stdout);
  if (stderr?.trim()) payload.stderr = stderr.trim().slice(-2000);
  return payload;
}

function avg(items) {
  return items.length ? items.reduce((sum, item) => sum + item, 0) / items.length : 0;
}

function movingAverage(bars, index, length) {
  if (index + 1 < length) return null;
  return avg(bars.slice(index + 1 - length, index + 1).map((bar) => num(bar.close)));
}

function calcCommission(gross, config) {
  return Math.max(gross * num(config.commissionRate), num(config.minCommission));
}

function buyFees(price, shares, config) {
  const gross = price * shares;
  const commission = calcCommission(gross, config);
  const transferFee = gross * num(config.transferFeeRate);
  return { commission, transferFee, stampDuty: 0, total: commission + transferFee };
}

function sellFees(price, shares, config) {
  const gross = price * shares;
  const commission = calcCommission(gross, config);
  const transferFee = gross * num(config.transferFeeRate);
  const stampDuty = gross * num(config.stampDutyRate);
  return { commission, transferFee, stampDuty, total: commission + transferFee + stampDuty };
}

function buyFill(price, config) {
  return price * (1 + num(config.slippageRate));
}

function sellFill(price, config) {
  return price * (1 - num(config.slippageRate));
}

function buildSignal(code, bars, index, config) {
  if (index < 25) return null;
  const bar = bars[index];
  const prev5 = bars[index - 5];
  const prev20 = bars[index - 20];
  const ma5 = movingAverage(bars, index, 5);
  const ma20 = movingAverage(bars, index, 20);
  const recentAmounts = bars.slice(Math.max(0, index - 20), index).map((item) => num(item.amount)).filter(Boolean);
  const amountRatio = avg(recentAmounts) ? num(bar.amount) / avg(recentAmounts) : 1;
  const ret5 = prev5?.close ? (bar.close / prev5.close - 1) * 100 : 0;
  const ret20 = prev20?.close ? (bar.close / prev20.close - 1) * 100 : 0;
  const trend = ma20 ? (bar.close / ma20 - 1) * 100 : 0;
  const score = clamp(Math.round(48 + ret5 * 3 + ret20 * 0.7 + trend * 2 + Math.min(12, amountRatio * 4)), 0, 100);
  const controls = { ...defaultConfig.riskControls, ...(config.riskControls || {}) };
  const reasons = [];
  if (!(ma5 && ma20 && bar.close > ma20 && ma5 > ma20)) reasons.push("均线趋势未确认");
  if (ret5 < 2.5) reasons.push(`5日动量不足：${signed(ret5)}%`);
  if (ret5 > num(controls.chasePctLimit, 7.5)) reasons.push(`5日涨幅过高：${signed(ret5)}%`);
  if (num(bar.pctChg) > num(controls.chasePctLimit, 7.5)) reasons.push(`单日追高风险：${signed(bar.pctChg)}%`);
  if (num(bar.amount) < num(controls.minAmount, 0)) reasons.push(`成交额不足：${money(bar.amount)}`);
  if (score < num(config.buyScoreThreshold, 72)) reasons.push(`评分不足：${score}`);
  return {
    code,
    date: bar.date,
    score,
    ret5,
    ret20,
    amount: bar.amount,
    close: bar.close,
    passed: reasons.length === 0,
    reasons,
    thesis: `价格在20日线上方，5日动量${signed(ret5)}%，20日趋势${signed(ret20)}%。`,
  };
}

function markToMarket(cash, positions, seriesByCode, date) {
  let value = cash;
  for (const position of positions.values()) {
    const bar = seriesByCode.get(position.code)?.byDate.get(date) || position.lastBar;
    if (bar) value += num(bar.close) * position.shares;
  }
  return value;
}

function maxDrawdown(curve) {
  let peak = curve[0]?.equity || 0;
  let maxDd = 0;
  for (const item of curve) {
    peak = Math.max(peak, item.equity);
    if (peak > 0) maxDd = Math.max(maxDd, ((peak - item.equity) / peak) * 100);
  }
  return maxDd;
}

function benchmarkReturn(bars) {
  const usable = (bars || []).filter((bar) => bar.close);
  if (usable.length < 2) return null;
  return ((usable.at(-1).close - usable[0].close) / usable[0].close) * 100;
}

function runBacktest({ history, codes, config, start, end }) {
  const seriesByCode = new Map();
  const calendar = new Set();
  for (const code of codes) {
    const bars = (history.series?.[code] || []).filter((bar) => bar.date && bar.open && bar.close);
    const byDate = new Map(bars.map((bar, index) => [bar.date, { ...bar, index }]));
    for (const bar of bars) calendar.add(bar.date);
    seriesByCode.set(code, { bars, byDate });
  }
  const dates = [...calendar].sort();
  let cash = num(config.initialCash, 100000);
  const initialCash = cash;
  const positions = new Map();
  const tradeLog = [];
  const equityCurve = [];
  let pendingBuys = [];
  let pendingSells = [];
  let lossStreak = 0;
  let peakEquity = initialCash;

  for (let dateIndex = 25; dateIndex < dates.length; dateIndex++) {
    const date = dates[dateIndex];

    for (const order of pendingSells) {
      const position = positions.get(order.code);
      const openBar = seriesByCode.get(order.code)?.byDate.get(date);
      if (!position || !openBar?.open) continue;
      const price = sellFill(openBar.open, config);
      const fees = sellFees(price, position.shares, config);
      const proceeds = price * position.shares - fees.total;
      const pnl = proceeds - position.totalCost;
      const pnlPct = position.totalCost > 0 ? (pnl / position.totalCost) * 100 : 0;
      cash += proceeds;
      positions.delete(order.code);
      lossStreak = pnlPct <= 0 ? lossStreak + 1 : 0;
      tradeLog.push({
        date,
        code: order.code,
        side: "SELL",
        shares: position.shares,
        price,
        fees,
        pnl,
        pnlPct,
        reason: order.reason,
        heldDays: dateIndex - position.entryIndex,
        entryDate: position.entryDate,
        attribution: order.attribution,
      });
    }
    pendingSells = [];

    const equityBeforeBuys = markToMarket(cash, positions, seriesByCode, date);
    peakEquity = Math.max(peakEquity, equityBeforeBuys);
    const drawdownPct = peakEquity > 0 ? ((peakEquity - equityBeforeBuys) / peakEquity) * 100 : 0;
    const controls = { ...defaultConfig.riskControls, ...(config.riskControls || {}) };
    const riskPaused =
      controls.enabled !== false &&
      (drawdownPct >= num(controls.maxAccountDrawdownPct, 6) || lossStreak >= num(controls.pauseAfterLossStreak, 3));

    if (!riskPaused) {
      for (const order of pendingBuys) {
        if (positions.size >= num(config.maxPositions, 5)) break;
        if (positions.has(order.code)) continue;
        const openBar = seriesByCode.get(order.code)?.byDate.get(date);
        if (!openBar?.open) continue;
        const budget = Math.min(equityBeforeBuys * num(config.maxPositionPct, 0.2), cash);
        const price = buyFill(openBar.open, config);
        let shares = Math.floor(budget / price / num(config.lotSize, 100)) * num(config.lotSize, 100);
        while (shares > 0) {
          const fees = buyFees(price, shares, config);
          if (price * shares + fees.total <= cash) break;
          shares -= num(config.lotSize, 100);
        }
        if (shares <= 0) continue;
        const fees = buyFees(price, shares, config);
        const totalCost = price * shares + fees.total;
        cash -= totalCost;
        positions.set(order.code, {
          code: order.code,
          shares,
          entryDate: date,
          entryIndex: dateIndex,
          entryPrice: price,
          totalCost,
          highestClose: openBar.close,
          lastBar: openBar,
          thesis: order.thesis,
        });
        tradeLog.push({
          date,
          code: order.code,
          side: "BUY",
          shares,
          price,
          fees,
          reason: order.thesis,
          score: order.score,
          attribution: { type: "ENTRY", factors: ["趋势突破", "价格动量", "成交额过滤"], risks: order.risks || [] },
        });
      }
    }
    pendingBuys = [];

    const signals = [];
    for (const code of codes) {
      const source = seriesByCode.get(code);
      const current = source?.byDate.get(date);
      if (!current) continue;
      const position = positions.get(code);
      if (position) {
        position.highestClose = Math.max(position.highestClose || 0, num(current.close));
        position.lastBar = current;
        const pnlPct = position.totalCost > 0 ? ((num(current.close) * position.shares - position.totalCost) / position.totalCost) * 100 : 0;
        const ma20 = movingAverage(source.bars, current.index, 20);
        const heldDays = dateIndex - position.entryIndex;
        let reason = "";
        if (pnlPct <= num(config.stopLossPct, -5)) reason = `止损触发 ${signed(pnlPct)}%`;
        else if (pnlPct >= num(config.takeProfitPct, 10)) reason = `止盈触发 ${signed(pnlPct)}%`;
        else if (heldDays >= num(controls.timeStopDays, 7) && pnlPct < num(controls.timeStopMinProfitPct, 1)) {
          reason = `时间止损：持有${heldDays}日收益${signed(pnlPct)}%`;
        } else if (ma20 && current.close < ma20 && pnlPct < 2) {
          reason = "跌破20日均线且利润不足";
        }
        if (reason) {
          pendingSells.push({
            code,
            reason,
            attribution: { type: "EXIT", trigger: reason, pnlPct, heldDays },
          });
        }
        continue;
      }
      const signal = buildSignal(code, source.bars, current.index, config);
      if (signal?.passed) signals.push(signal);
    }
    pendingBuys = signals.sort((a, b) => b.score - a.score).slice(0, Math.max(0, num(config.maxPositions, 5) - positions.size));

    const equity = markToMarket(cash, positions, seriesByCode, date);
    equityCurve.push({ date, equity, cash, positions: positions.size, returnPct: ((equity - initialCash) / initialCash) * 100 });
  }

  const finalDate = dates.at(-1) || end;
  const finalEquity = markToMarket(cash, positions, seriesByCode, finalDate);
  const closed = tradeLog.filter((trade) => trade.side === "SELL");
  const winners = closed.filter((trade) => num(trade.pnlPct) > 0);
  const losers = closed.filter((trade) => num(trade.pnlPct) <= 0);
  const grossWin = winners.reduce((sum, trade) => sum + num(trade.pnl), 0);
  const grossLoss = Math.abs(losers.reduce((sum, trade) => sum + num(trade.pnl), 0));
  const benchmarks = Object.fromEntries(
    Object.entries(history.indexes || {}).map(([key, bars]) => [key, { returnPct: benchmarkReturn(bars) }]),
  );
  const mainBenchmark = benchmarks["sh.000300"]?.returnPct ?? benchmarks["sh.000001"]?.returnPct ?? null;
  const returnPct = ((finalEquity - initialCash) / initialCash) * 100;

  return {
    date: todayShanghai(),
    generatedAt: new Date().toISOString(),
    account: {
      id: process.env.A_SHARE_ACCOUNT_ID || "legacy",
      name: process.env.A_SHARE_ACCOUNT_NAME || "系统全局",
    },
    status: "ok",
    source: history.source || "unknown",
    range: { start, end, tradingDays: dates.length },
    strategyVersion: strategyVersion(config),
    scenario: config.backtestScenario || "current",
    testedParameters: {
      buyScoreThreshold: config.buyScoreThreshold,
      stopLossPct: config.stopLossPct,
      takeProfitPct: config.takeProfitPct,
      chasePctLimit: config.riskControls?.chasePctLimit,
      timeStopDays: config.riskControls?.timeStopDays,
    },
    universe: { count: codes.length, codes },
    assumptions: ["日线回放", "信号在收盘后产生", "下一交易日开盘价成交", "包含佣金、过户费、印花税和滑点", "不使用历史新闻/舆情模拟数据"],
    metrics: {
      initialCash,
      finalEquity,
      returnPct,
      benchmarkReturnPct: mainBenchmark,
      alphaPct: mainBenchmark === null ? null : returnPct - mainBenchmark,
      maxDrawdownPct: maxDrawdown(equityCurve),
      tradeCount: closed.length,
      buyCount: tradeLog.filter((trade) => trade.side === "BUY").length,
      winRate: closed.length ? (winners.length / closed.length) * 100 : 0,
      avgWinPct: winners.length ? avg(winners.map((trade) => num(trade.pnlPct))) : 0,
      avgLossPct: losers.length ? avg(losers.map((trade) => num(trade.pnlPct))) : 0,
      profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 99 : 0,
      openPositions: positions.size,
    },
    benchmarks,
    equityCurve: equityCurve.slice(-260),
    tradeLog: tradeLog.slice(-120),
    warnings: history.warnings || [],
  };
}

function buildMarkdown(report) {
  const lines = [];
  lines.push(`# 历史回测 ${report.range.start} 到 ${report.range.end}`);
  lines.push("");
  lines.push("说明：本报告只用于纸面交易策略学习，不构成投资建议。");
  lines.push(`账户：${report.account.name}`);
  lines.push(`数据源：${report.source}`);
  lines.push(`场景：${report.scenario || "current"}`);
  lines.push("");
  if (report.testedParameters) {
    lines.push("## 参数");
    lines.push(`- 买入阈值：${report.testedParameters.buyScoreThreshold}`);
    lines.push(`- 止损/止盈：${signed(report.testedParameters.stopLossPct, 1)}% / ${signed(report.testedParameters.takeProfitPct, 1)}%`);
    lines.push(`- 追高上限：${signed(report.testedParameters.chasePctLimit, 1)}%`);
    lines.push(`- 时间止损：${report.testedParameters.timeStopDays} 天`);
    lines.push("");
  }
  lines.push("## 结果");
  lines.push(`- 策略收益：${signed(report.metrics.returnPct)}%`);
  lines.push(`- 基准收益：${report.metrics.benchmarkReturnPct === null ? "无数据" : `${signed(report.metrics.benchmarkReturnPct)}%`}`);
  lines.push(`- 超额收益：${report.metrics.alphaPct === null ? "无数据" : `${signed(report.metrics.alphaPct)}%`}`);
  lines.push(`- 最大回撤：${signed(report.metrics.maxDrawdownPct)}%`);
  lines.push(`- 已关闭交易：${report.metrics.tradeCount}，胜率 ${signed(report.metrics.winRate)}%，盈亏因子 ${report.metrics.profitFactor.toFixed(2)}`);
  lines.push("");
  lines.push("## 假设");
  for (const item of report.assumptions) lines.push(`- ${item}`);
  if (report.warnings?.length) {
    lines.push("");
    lines.push("## 数据警告");
    for (const item of report.warnings.slice(0, 8)) lines.push(`- ${item}`);
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs();
  const storedConfig = await readJson(configFile, {});
  const baseConfig = {
    ...defaultConfig,
    ...storedConfig,
    dataProviders: { ...defaultConfig.dataProviders, ...(storedConfig.dataProviders || {}) },
    riskControls: { ...defaultConfig.riskControls, ...(storedConfig.riskControls || {}) },
  };
  const config = {
    ...applyBacktestOverrides(baseConfig, args.overrides),
    backtestScenario: args.scenario,
  };
  const dashboard = await readJson(dashboardFile, {});
  const codes = chooseUniverse(config, dashboard, args.maxSymbols);
  const history = await fetchHistory({ codes, start: args.start, end: args.end, provider: args.provider, config });
  if (!history.ok && !Object.keys(history.series || {}).length) {
    throw new Error(`真实历史行情获取失败：${(history.warnings || []).join("; ") || "unknown"}`);
  }
  const report = runBacktest({ history, codes, config, start: args.start, end: args.end });
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.mkdir(backtestNotesDir, { recursive: true });
  await fs.writeFile(path.join(backtestNotesDir, `${args.start}_${args.end}.md`), buildMarkdown(report), "utf8");
  console.log(JSON.stringify({ ok: true, outputFile, metrics: report.metrics, warnings: report.warnings }, null, 2));
}

main().catch(async (error) => {
  const report = {
    date: todayShanghai(),
    generatedAt: new Date().toISOString(),
    account: {
      id: process.env.A_SHARE_ACCOUNT_ID || "legacy",
      name: process.env.A_SHARE_ACCOUNT_NAME || "系统全局",
    },
    status: "error",
    error: error.message,
    warnings: [error.message],
  };
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`, "utf8").catch(() => null);
  console.error(error);
  process.exitCode = 1;
});
