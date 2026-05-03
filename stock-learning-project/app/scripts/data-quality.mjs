import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

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
const outputFile = path.join(dataDir, "data-quality.json");
const historyProviderScript = path.join(__dirname, "provider-history.py");
const notesDir = process.env.MARKET_NOTES_DIR || path.join(projectRoot, "02-market-notes");
const qualityNotesDir = process.env.A_SHARE_ACCOUNT_ID
  ? path.join(notesDir, "accounts", process.env.A_SHARE_ACCOUNT_ID, "data-quality")
  : path.join(notesDir, "data-quality");

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
  return {
    start: args.start || addDays(end, -365),
    end,
    provider: args.provider || "auto",
    maxSymbols: clamp(Math.round(num(args.maxSymbols, 20)), 3, 100),
    codes: parseCodes(args.codes),
  };
}

function parseCodes(value) {
  return [...String(value || "").matchAll(/\b(00\d{4}|30\d{4}|60\d{4}|68\d{4})\b/g)].map((match) => match[1]);
}

async function readJson(file, fallback = {}) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
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

function chooseUniverse(config, dashboard, args) {
  return uniqueCodes([
    ...args.codes,
    ...parseCodes(config.watchlistText),
    ...(dashboard.paperPositions || []).map((item) => item.code),
    ...(dashboard.candidates || []).map((item) => item.code),
    ...(dashboard.universe?.items || []).map((item) => item.code),
    ...fallbackUniverse,
  ]).slice(0, args.maxSymbols);
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

function analyzeSeries(code, bars, calendar) {
  const usable = (bars || []).filter((bar) => bar.date).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const byDate = new Set(usable.map((bar) => bar.date));
  const missingDates = calendar.filter((date) => !byDate.has(date));
  const missingPrice = usable.filter((bar) => !num(bar.open) || !num(bar.close)).length;
  const noAmount = usable.filter((bar) => num(bar.amount) <= 0).length;
  const largeJumps = usable.filter((bar) => Math.abs(num(bar.pctChg)) > 11);
  const extremeJumps = usable.filter((bar) => Math.abs(num(bar.pctChg)) > 21);
  const flatBars = usable.filter((bar) => num(bar.high || bar.close) === num(bar.low || bar.close)).length;
  const missingRate = calendar.length ? missingDates.length / calendar.length : 0;
  const noAmountRate = usable.length ? noAmount / usable.length : 0;
  const issues = [];
  if (usable.length < 60) issues.push("样本少于60个交易日");
  if (missingRate > 0.15) issues.push(`相对样本日历缺失率 ${round(missingRate * 100)}%`);
  if (missingPrice) issues.push(`价格字段缺失 ${missingPrice} 条`);
  if (noAmountRate > 0.2) issues.push(`成交额缺失/为0 ${round(noAmountRate * 100)}%`);
  if (extremeJumps.length) issues.push(`疑似异常涨跌 ${extremeJumps.length} 条`);
  const status = issues.length >= 2 || missingRate > 0.3 ? "risk" : issues.length ? "warn" : "ok";
  return {
    code,
    status,
    firstDate: usable[0]?.date || null,
    lastDate: usable.at(-1)?.date || null,
    bars: usable.length,
    calendarDays: calendar.length,
    missingDays: missingDates.length,
    missingRatePct: round(missingRate * 100),
    noAmountDays: noAmount,
    noAmountRatePct: round(noAmountRate * 100),
    flatBars,
    largeJumpDays: largeJumps.length,
    extremeJumpDays: extremeJumps.length,
    sampleLargeJumps: largeJumps.slice(-5).map((bar) => ({ date: bar.date, pctChg: round(bar.pctChg), close: bar.close })),
    issues,
  };
}

function buildMarkdown(report) {
  const lines = [];
  lines.push(`# 数据质量报告 ${report.range.start} 到 ${report.range.end}`);
  lines.push("");
  lines.push("说明：本报告用于检查回测和 Agent 决策的行情输入质量，不构成投资建议。");
  lines.push(`数据源：${report.source}`);
  lines.push(`股票数：${report.summary.total}；OK ${report.summary.ok}，警告 ${report.summary.warn}，风险 ${report.summary.risk}`);
  lines.push("");
  lines.push("## 问题最多的样本");
  for (const item of report.items.filter((row) => row.status !== "ok").slice(0, 12)) {
    lines.push(
      `- ${item.code}：${item.status}，${item.bars} 条，缺失 ${signed(item.missingRatePct)}%，成交额缺失 ${signed(item.noAmountRatePct)}%，${item.issues.join("；") || "无明显问题"}`,
    );
  }
  if (report.items.every((row) => row.status === "ok")) lines.push("- 暂无明显数据质量问题。");
  if (report.warnings?.length) {
    lines.push("");
    lines.push("## 数据源警告");
    for (const item of report.warnings.slice(0, 8)) lines.push(`- ${item}`);
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs();
  const config = await readJson(configFile, {});
  const dashboard = await readJson(dashboardFile, {});
  const codes = chooseUniverse(config, dashboard, args);
  const history = await fetchHistory({ codes, start: args.start, end: args.end, provider: args.provider, config });
  if (!history.ok && !Object.keys(history.series || {}).length) {
    throw new Error(`历史行情获取失败：${(history.warnings || []).join("; ") || "unknown"}`);
  }
  const calendar = [
    ...new Set(
      Object.values(history.series || {})
        .flat()
        .map((bar) => bar.date)
        .filter(Boolean),
    ),
  ].sort();
  const items = codes.map((code) => analyzeSeries(code, history.series?.[code] || [], calendar));
  const summary = {
    total: items.length,
    ok: items.filter((item) => item.status === "ok").length,
    warn: items.filter((item) => item.status === "warn").length,
    risk: items.filter((item) => item.status === "risk").length,
  };
  const report = {
    date: todayShanghai(),
    generatedAt: new Date().toISOString(),
    account: {
      id: process.env.A_SHARE_ACCOUNT_ID || "legacy",
      name: process.env.A_SHARE_ACCOUNT_NAME || "系统全局",
    },
    status: "ok",
    source: history.source || "unknown",
    range: { start: args.start, end: args.end, calendarDays: calendar.length },
    universe: { count: codes.length, codes },
    summary,
    items,
    warnings: history.warnings || [],
  };
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.mkdir(qualityNotesDir, { recursive: true });
  await fs.writeFile(path.join(qualityNotesDir, `${args.start}_${args.end}.md`), buildMarkdown(report), "utf8");
  console.log(JSON.stringify({ ok: true, outputFile, summary, warnings: report.warnings }, null, 2));
}

main().catch(async (error) => {
  const report = {
    date: todayShanghai(),
    generatedAt: new Date().toISOString(),
    status: "error",
    error: error.message,
    warnings: [error.message],
  };
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`, "utf8").catch(() => null);
  console.error(error);
  process.exitCode = 1;
});
