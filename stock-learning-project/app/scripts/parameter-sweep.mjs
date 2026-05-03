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
const outputFile = path.join(dataDir, "parameter-sweep.json");
const historyProviderScript = path.join(__dirname, "provider-history.py");
const notesDir = process.env.MARKET_NOTES_DIR || path.join(projectRoot, "02-market-notes");
const sweepNotesDir = process.env.A_SHARE_ACCOUNT_ID
  ? path.join(notesDir, "accounts", process.env.A_SHARE_ACCOUNT_ID, "parameter-sweep")
  : path.join(notesDir, "parameter-sweep");

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

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(num(value) * factor) / factor;
}

function signed(value, digits = 2) {
  const n = num(value);
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}`;
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

function parseNumberList(value, fallback) {
  const parsed = String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => Number(item.trim()))
    .filter(Number.isFinite);
  return parsed.length ? parsed : fallback;
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
  const start = args.start || addDays(end, -730);
  return {
    start,
    end,
    maxSymbols: clamp(Math.round(num(args.maxSymbols, 12)), 3, 50),
    provider: args.provider || "auto",
    topN: clamp(Math.round(num(args.topN, 12)), 3, 50),
    buyScoreThresholds: parseNumberList(args.buyScoreThresholds, [72, 75, 78]),
    stopLosses: parseNumberList(args.stopLosses, [-6, -5, -4]),
    takeProfits: parseNumberList(args.takeProfits, [8, 10, 12]),
    chaseLimits: parseNumberList(args.chaseLimits, [5.5, 6.5, 7.5]),
    timeStopDays: parseNumberList(args.timeStopDays, [5, 7, 10]),
  };
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
    { cwd: appRoot, timeout: 180000, maxBuffer: 60 * 1024 * 1024 },
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
  return commission + transferFee;
}

function sellFees(price, shares, config) {
  const gross = price * shares;
  const commission = calcCommission(gross, config);
  const transferFee = gross * num(config.transferFeeRate);
  const stampDuty = gross * num(config.stampDutyRate);
  return commission + transferFee + stampDuty;
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
  const failed =
    !(ma5 && ma20 && bar.close > ma20 && ma5 > ma20) ||
    ret5 < 2.5 ||
    ret5 > num(controls.chasePctLimit, 7.5) ||
    num(bar.pctChg) > num(controls.chasePctLimit, 7.5) ||
    num(bar.amount) < num(controls.minAmount, 0) ||
    score < num(config.buyScoreThreshold, 72);
  return failed ? null : { code, score, thesis: `评分${score}，5日动量${signed(ret5)}%，20日趋势${signed(ret20)}%。` };
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

function filterHistory(history, start, end) {
  const inRange = (bar) => bar.date >= start && bar.date <= end;
  return {
    ...history,
    series: Object.fromEntries(Object.entries(history.series || {}).map(([code, bars]) => [code, (bars || []).filter(inRange)])),
    indexes: Object.fromEntries(Object.entries(history.indexes || {}).map(([code, bars]) => [code, (bars || []).filter(inRange)])),
  };
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
      const price = openBar.open * (1 - num(config.slippageRate));
      const fees = sellFees(price, position.shares, config);
      const proceeds = price * position.shares - fees;
      const pnl = proceeds - position.totalCost;
      const pnlPct = position.totalCost > 0 ? (pnl / position.totalCost) * 100 : 0;
      cash += proceeds;
      positions.delete(order.code);
      lossStreak = pnlPct <= 0 ? lossStreak + 1 : 0;
      tradeLog.push({ date, code: order.code, side: "SELL", pnl, pnlPct, reason: order.reason });
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
        const price = openBar.open * (1 + num(config.slippageRate));
        let shares = Math.floor(budget / price / num(config.lotSize, 100)) * num(config.lotSize, 100);
        while (shares > 0) {
          const fees = buyFees(price, shares, config);
          if (price * shares + fees <= cash) break;
          shares -= num(config.lotSize, 100);
        }
        if (shares <= 0) continue;
        const fees = buyFees(price, shares, config);
        const totalCost = price * shares + fees;
        cash -= totalCost;
        positions.set(order.code, {
          code: order.code,
          shares,
          entryIndex: dateIndex,
          totalCost,
          highestClose: openBar.close,
          lastBar: openBar,
        });
        tradeLog.push({ date, code: order.code, side: "BUY", score: order.score, reason: order.thesis });
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
        if (pnlPct <= num(config.stopLossPct, -5)) reason = `止损 ${signed(pnlPct)}%`;
        else if (pnlPct >= num(config.takeProfitPct, 10)) reason = `止盈 ${signed(pnlPct)}%`;
        else if (heldDays >= num(controls.timeStopDays, 7) && pnlPct < num(controls.timeStopMinProfitPct, 1)) reason = "时间止损";
        else if (ma20 && current.close < ma20 && pnlPct < 2) reason = "跌破20日均线";
        if (reason) pendingSells.push({ code, reason });
        continue;
      }
      const signal = buildSignal(code, source.bars, current.index, config);
      if (signal) signals.push(signal);
    }
    pendingBuys = signals.sort((a, b) => b.score - a.score).slice(0, Math.max(0, num(config.maxPositions, 5) - positions.size));
    const equity = markToMarket(cash, positions, seriesByCode, date);
    equityCurve.push({ date, equity, returnPct: ((equity - initialCash) / initialCash) * 100 });
  }

  const finalDate = dates.at(-1) || end;
  const finalEquity = markToMarket(cash, positions, seriesByCode, finalDate);
  const closed = tradeLog.filter((trade) => trade.side === "SELL");
  const winners = closed.filter((trade) => num(trade.pnlPct) > 0);
  const losers = closed.filter((trade) => num(trade.pnlPct) <= 0);
  const grossWin = winners.reduce((sum, trade) => sum + num(trade.pnl), 0);
  const grossLoss = Math.abs(losers.reduce((sum, trade) => sum + num(trade.pnl), 0));
  const benchmark = benchmarkReturn(history.indexes?.["sh.000300"]) ?? benchmarkReturn(history.indexes?.["sh.000001"]);
  const returnPct = ((finalEquity - initialCash) / initialCash) * 100;
  return {
    start,
    end,
    tradingDays: dates.length,
    returnPct,
    benchmarkReturnPct: benchmark,
    alphaPct: benchmark === null ? null : returnPct - benchmark,
    maxDrawdownPct: maxDrawdown(equityCurve),
    tradeCount: closed.length,
    buyCount: tradeLog.filter((trade) => trade.side === "BUY").length,
    winRate: closed.length ? (winners.length / closed.length) * 100 : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 99 : 0,
    avgWinPct: winners.length ? avg(winners.map((trade) => num(trade.pnlPct))) : 0,
    avgLossPct: losers.length ? avg(losers.map((trade) => num(trade.pnlPct))) : 0,
  };
}

function buildWindows(start, end) {
  const mid = addDays(end, -365);
  const recent = addDays(end, -180);
  const windows = [{ id: "full", label: "全区间", start, end }];
  if (mid > start) windows.push({ id: "last_year", label: "近一年", start: mid, end });
  if (recent > start) windows.push({ id: "recent", label: "近半年", start: recent, end });
  return windows;
}

function buildGrid(args) {
  const combos = [];
  for (const buyScoreThreshold of args.buyScoreThresholds) {
    for (const stopLossPct of args.stopLosses) {
      for (const takeProfitPct of args.takeProfits) {
        for (const chasePctLimit of args.chaseLimits) {
          for (const timeStopDay of args.timeStopDays) {
            combos.push({ buyScoreThreshold, stopLossPct, takeProfitPct, chasePctLimit, timeStopDay });
          }
        }
      }
    }
  }
  return combos;
}

function scoreCombo(results) {
  const usable = results.filter((item) => item.tradeCount >= 2);
  if (!usable.length) return -999;
  const avgAlpha = avg(usable.map((item) => num(item.alphaPct)));
  const avgReturn = avg(usable.map((item) => num(item.returnPct)));
  const avgDrawdown = avg(usable.map((item) => num(item.maxDrawdownPct)));
  const avgProfitFactor = avg(usable.map((item) => Math.min(3, num(item.profitFactor))));
  const minAlpha = Math.min(...usable.map((item) => num(item.alphaPct)));
  const consistency = usable.filter((item) => num(item.alphaPct) > 0).length / usable.length;
  const tradePenalty = usable.some((item) => item.tradeCount < 4) ? 4 : 0;
  return round(avgAlpha * 1.2 + avgReturn * 0.3 + avgProfitFactor * 3 + consistency * 8 + Math.min(0, minAlpha) * 0.4 - avgDrawdown * 0.8 - tradePenalty, 3);
}

function summarizeResult(results) {
  const usable = results.filter((item) => item.tradeCount >= 2);
  return {
    avgReturnPct: round(avg(usable.map((item) => item.returnPct))),
    avgAlphaPct: round(avg(usable.map((item) => num(item.alphaPct)))),
    minAlphaPct: usable.length ? round(Math.min(...usable.map((item) => num(item.alphaPct)))) : 0,
    avgDrawdownPct: round(avg(usable.map((item) => item.maxDrawdownPct))),
    avgWinRate: round(avg(usable.map((item) => item.winRate))),
    avgProfitFactor: round(avg(usable.map((item) => item.profitFactor))),
    totalTrades: usable.reduce((sum, item) => sum + item.tradeCount, 0),
    positiveWindows: usable.filter((item) => num(item.alphaPct) > 0).length,
    windowCount: usable.length,
  };
}

function comboId(params) {
  return crypto.createHash("sha256").update(JSON.stringify(params)).digest("hex").slice(0, 10);
}

function buildMarkdown(report) {
  const lines = [];
  lines.push(`# 参数寻优 ${report.range.start} 到 ${report.range.end}`);
  lines.push("");
  lines.push("说明：本报告只用于纸面交易策略研究，不构成投资建议。");
  lines.push(`账户：${report.account.name}`);
  lines.push(`数据源：${report.source}`);
  lines.push("");
  lines.push("## 最优候选");
  for (const item of report.rankings.slice(0, 8)) {
    lines.push(
      `- #${item.rank} score=${item.score} buy>=${item.params.buyScoreThreshold} stop=${item.params.stopLossPct}% take=${item.params.takeProfitPct}% chase=${item.params.chasePctLimit}%：平均超额${signed(item.summary.avgAlphaPct)}%，平均收益${signed(item.summary.avgReturnPct)}%，回撤${signed(item.summary.avgDrawdownPct)}%，交易${item.summary.totalTrades}笔`,
    );
  }
  lines.push("");
  lines.push("## 选择原则");
  for (const item of report.notes) lines.push(`- ${item}`);
  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs();
  const storedConfig = await readJson(configFile, {});
  const config = {
    ...defaultConfig,
    ...storedConfig,
    dataProviders: { ...defaultConfig.dataProviders, ...(storedConfig.dataProviders || {}) },
    riskControls: { ...defaultConfig.riskControls, ...(storedConfig.riskControls || {}) },
  };
  const dashboard = await readJson(dashboardFile, {});
  const codes = chooseUniverse(config, dashboard, args.maxSymbols);
  const history = await fetchHistory({ codes, start: args.start, end: args.end, provider: args.provider, config });
  if (!history.ok && !Object.keys(history.series || {}).length) {
    throw new Error(`真实历史行情获取失败：${(history.warnings || []).join("; ") || "unknown"}`);
  }

  const windows = buildWindows(args.start, args.end);
  const grid = buildGrid(args);
  const rankings = grid.map((params) => {
    const nextConfig = {
      ...config,
      buyScoreThreshold: params.buyScoreThreshold,
      stopLossPct: params.stopLossPct,
      takeProfitPct: params.takeProfitPct,
      riskControls: {
        ...config.riskControls,
        chasePctLimit: params.chasePctLimit,
        timeStopDays: params.timeStopDay,
      },
    };
    const windowResults = windows.map((window) => {
      const sliced = filterHistory(history, window.start, window.end);
      return { ...window, ...runBacktest({ history: sliced, codes, config: nextConfig, start: window.start, end: window.end }) };
    });
    return {
      id: comboId(params),
      params,
      score: scoreCombo(windowResults),
      summary: summarizeResult(windowResults),
      windows: windowResults,
    };
  });
  rankings.sort((a, b) => b.score - a.score);
  rankings.forEach((item, index) => {
    item.rank = index + 1;
  });

  const report = {
    date: todayShanghai(),
    generatedAt: new Date().toISOString(),
    account: {
      id: process.env.A_SHARE_ACCOUNT_ID || "legacy",
      name: process.env.A_SHARE_ACCOUNT_NAME || "系统全局",
    },
    status: "ok",
    source: history.source || "unknown",
    range: { start: args.start, end: args.end },
    universe: { count: codes.length, codes },
    grid: {
      combinations: grid.length,
      windows: windows.map(({ id, label, start, end }) => ({ id, label, start, end })),
      testedRuns: grid.length * windows.length,
    },
    rankings: rankings.slice(0, args.topN),
    best: rankings[0] || null,
    notes: [
      "排序分数偏向多窗口稳定性，不按单段最高收益排序。",
      "交易次数过少会被惩罚，避免参数碰巧没有交易而看似回撤很低。",
      "只有真实历史价格和成交额参与寻优，不模拟历史新闻或舆情。",
      "寻优结果只能作为模拟盘参数候选，仍需纸面交易和盘后复盘验证。",
    ],
    warnings: history.warnings || [],
  };

  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.mkdir(sweepNotesDir, { recursive: true });
  await fs.writeFile(path.join(sweepNotesDir, `${args.start}_${args.end}.md`), buildMarkdown(report), "utf8");
  console.log(JSON.stringify({ ok: true, outputFile, best: report.best, grid: report.grid, warnings: report.warnings }, null, 2));
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
