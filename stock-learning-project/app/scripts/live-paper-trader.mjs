import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { initAuthStore, listAllActiveAccounts } from "../server/auth-store.mjs";
import {
  accountRuntimePaths,
  ensureAccountRuntime,
  legacyRuntimePaths,
  scriptEnvForAccount,
} from "../server/account-runtime.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");
const runtimeDir = process.env.A_SHARE_RUNTIME_DIR || appRoot;
const legacyPaths = legacyRuntimePaths({ appRoot, runtimeDir });

const defaultConfig = {
  pollSeconds: 60,
};

const scheduledTasks = [
  { mode: "PRE_MARKET_RESEARCH", start: "08:45", end: "09:20", generator: true, optimizer: false, agent: true, lab: true },
  { mode: "MIDDAY_RESEARCH", start: "12:05", end: "12:45", generator: true, optimizer: false, agent: true, lab: true },
  { mode: "POST_CLOSE_REVIEW", start: "15:05", end: "16:20", generator: true, optimizer: true, agent: true, lab: true },
  { mode: "NIGHTLY_OPTIMIZE", start: "20:00", end: "22:30", generator: true, optimizer: true, agent: true, lab: true },
];

async function readConfig(paths = legacyPaths) {
  try {
    return { ...defaultConfig, ...JSON.parse(await fs.readFile(paths.tradingConfigFile, "utf8")) };
  } catch {
    return defaultConfig;
  }
}

function shanghaiParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function shanghaiDateKey(parts = shanghaiParts()) {
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function minutesFromClock(value) {
  const [hour, minute] = String(value).split(":").map(Number);
  return hour * 60 + minute;
}

function currentMinutes(parts = shanghaiParts()) {
  return Number(parts.hour) * 60 + Number(parts.minute);
}

function isTradingDay(parts = shanghaiParts()) {
  return !["Sat", "Sun"].includes(parts.weekday);
}

function isTradingTime(date = new Date()) {
  const parts = shanghaiParts(date);
  if (!isTradingDay(parts)) return false;
  const minutes = currentMinutes(parts);
  const morning = minutes >= 9 * 60 + 30 && minutes <= 11 * 60 + 30;
  const afternoon = minutes >= 13 * 60 && minutes <= 15 * 60;
  return morning || afternoon;
}

function dueScheduledTask(parts = shanghaiParts(), completedTasks = new Set(), scopeKey = "legacy") {
  if (!isTradingDay(parts)) {
    const minutes = currentMinutes(parts);
    const weekend = { mode: "WEEKEND_REVIEW", start: "10:00", end: "11:30", generator: true, optimizer: true, agent: true, lab: true };
    const key = `${scopeKey}:${shanghaiDateKey(parts)}:${weekend.mode}`;
    return minutes >= minutesFromClock(weekend.start) && minutes <= minutesFromClock(weekend.end) && !completedTasks.has(key)
      ? { ...weekend, key }
      : null;
  }

  const minutes = currentMinutes(parts);
  for (const task of scheduledTasks) {
    const key = `${scopeKey}:${shanghaiDateKey(parts)}:${task.mode}`;
    if (completedTasks.has(key)) continue;
    if (minutes >= minutesFromClock(task.start) && minutes <= minutesFromClock(task.end)) return { ...task, key };
  }
  return null;
}

function runNodeScript(paths, scriptName, args = []) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(appRoot, "scripts", scriptName), ...args], {
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
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

async function runGenerator(paths, { trade }) {
  return runNodeScript(paths, "generate-research.mjs", trade ? ["--paper-trade"] : []);
}

async function runOptimizer(paths) {
  return runNodeScript(paths, "strategy-optimizer.mjs");
}

async function runDecisionAgent(paths) {
  return runNodeScript(paths, "research-decision-agent.mjs");
}

async function runStrategyLab(paths) {
  return runNodeScript(paths, "strategy-lab.mjs");
}

async function writeStatus(paths, status) {
  const statusFile = path.join(paths.dataDir, "live-status.json");
  await fs.mkdir(path.dirname(statusFile), { recursive: true });
  await fs.writeFile(statusFile, `${JSON.stringify(status, null, 2)}\n`, "utf8");
}

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function appendCheckLog(paths, status) {
  const logFile = path.join(paths.dataDir, "live-checks.json");
  const dashboard = await readJson(path.join(paths.dataDir, "dashboard.json"), {});
  const agent = await readJson(path.join(paths.dataDir, "decision-agent.json"), {});
  const previous = await readJson(logFile, { checks: [] });
  const checks = Array.isArray(previous?.checks) ? previous.checks : [];
  const counts = dashboard.decisionDashboard?.counts || {};
  const tradeLog = dashboard.tradeLog || [];
  const latestTrade = tradeLog.at(-1) || null;
  const record = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    account: status.account,
    startedAt: status.startedAt,
    finishedAt: status.finishedAt,
    mode: status.mode,
    task: status.task,
    exitCode: Number.isFinite(Number(status.exitCode)) ? Number(status.exitCode) : 0,
    ok: Number(status.exitCode || 0) === 0,
    nextPollSeconds: status.nextPollSeconds,
    nextTask: status.nextTask || "",
    dashboardDate: dashboard.date || "",
    dashboardGeneratedAt: dashboard.generatedAt || "",
    marketSummary: dashboard.marketRegime?.summary || "",
    paperTradingEnabled: Boolean(dashboard.paperTradingEnabled),
    candidates: counts.candidates ?? dashboard.candidates?.length ?? 0,
    paperBuy: counts.paperBuy ?? 0,
    focus: counts.focus ?? 0,
    avoid: counts.avoid ?? 0,
    positions: dashboard.paperPositions?.length ?? 0,
    tradeCount: tradeLog.length,
    latestTrade: latestTrade
      ? {
          time: latestTrade.time || latestTrade.date || "",
          side: latestTrade.side || "",
          code: latestTrade.code || "",
          name: latestTrade.name || "",
          shares: latestTrade.shares || 0,
          price: latestTrade.price || 0,
        }
      : null,
    agentPosture: agent.posture?.label || "",
    agentRiskBudget: agent.posture?.riskBudget || "",
    agentMaxNewPositions: agent.policy?.maxNewPositions ?? null,
    stdout: String(status.stdout || "").split("\n").slice(-3),
    stderr: String(status.stderr || "").split("\n").filter(Boolean).slice(-3),
  };
  const ordered = [...checks, record].sort((a, b) => {
    const left = new Date(a.finishedAt || a.startedAt || 0).getTime();
    const right = new Date(b.finishedAt || b.startedAt || 0).getTime();
    return left - right;
  });
  const payload = {
    account: status.account,
    updatedAt: new Date().toISOString(),
    checks: ordered.slice(-120).reverse(),
  };
  await fs.mkdir(path.dirname(logFile), { recursive: true });
  await fs.writeFile(logFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function mergeResults(results) {
  const exitCodeFor = (item) => (Number.isFinite(Number(item.exitCode)) ? Number(item.exitCode) : Number(item.code || 0));
  return {
    exitCode: results.some((item) => exitCodeFor(item) !== 0) ? 1 : 0,
    stdout: results.map((item) => item.stdout).filter(Boolean).join("\n"),
    stderr: results.map((item) => item.stderr).filter(Boolean).join("\n"),
  };
}

function nextTaskHint(parts = shanghaiParts()) {
  if (!isTradingDay(parts)) return "周末 10:00 周度复盘";
  const minutes = currentMinutes(parts);
  const future = scheduledTasks.find((task) => minutes < minutesFromClock(task.start));
  if (future) return `${future.start} ${future.mode}`;
  return "下一交易日 08:45 PRE_MARKET_RESEARCH";
}

async function runCycle(paths, completedTasks) {
  const parts = shanghaiParts();
  const trade = isTradingTime();
  const startedAt = new Date().toISOString();
  const account = {
    id: paths.accountId || "legacy",
    name: paths.accountName || "系统全局",
    runtimeKey: paths.runtimeKey || "legacy",
  };

  if (trade) {
    const result = mergeResults([await runGenerator(paths, { trade: true }), await runDecisionAgent(paths)]);
    return {
      status: {
        account,
        startedAt,
        finishedAt: new Date().toISOString(),
        mode: "PAPER_TRADE",
        task: "盘中买卖点轮询",
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        nextPollSeconds: null,
      },
      shouldSleepTrading: true,
    };
  }

  const task = dueScheduledTask(parts, completedTasks, account.id);
  if (!task) {
    return {
      status: {
        account,
        startedAt,
        finishedAt: new Date().toISOString(),
        mode: "WAITING",
        task: "非交易时段等待下一项定时任务",
        nextTask: nextTaskHint(parts),
        exitCode: 0,
        stdout: "",
        stderr: "",
        nextPollSeconds: null,
      },
      shouldSleepTrading: false,
    };
  }

  const results = [];
  if (task.generator) results.push(await runGenerator(paths, { trade: false }));
  if (task.optimizer) results.push(await runOptimizer(paths));
  if (task.agent) results.push(await runDecisionAgent(paths));
  if (task.lab) results.push(await runStrategyLab(paths));
  completedTasks.add(task.key);
  const result = mergeResults(results);
  return {
    status: {
      account,
      startedAt,
      finishedAt: new Date().toISOString(),
      mode: task.mode,
      task: "非交易时段自动投研与策略学习",
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      nextTask: nextTaskHint(parts),
      nextPollSeconds: null,
    },
    shouldSleepTrading: false,
  };
}

async function runnableScopes() {
  const accounts = listAllActiveAccounts();
  if (!accounts.length) {
    await fs.mkdir(legacyPaths.dataDir, { recursive: true });
    return [{ account: null, paths: { ...legacyPaths, accountId: "legacy", accountName: "系统全局", runtimeKey: "legacy" } }];
  }
  const scopes = [];
  for (const [index, account] of accounts.entries()) {
    const paths = accountRuntimePaths({ runtimeDir, account });
    await ensureAccountRuntime(paths, legacyPaths, { seedLegacy: index === 0 });
    scopes.push({ account, paths });
  }
  return scopes;
}

async function main() {
  await initAuthStore({ runtimeDir });
  const completedTasks = new Set();
  console.log("Live paper trader and research scheduler started.");

  while (true) {
    const scopes = await runnableScopes();
    const sleepOptions = [];
    for (const scope of scopes) {
      const config = await readConfig(scope.paths);
      const pollMs = Math.max(15, Number(config.pollSeconds || 60)) * 1000;
      const { status, shouldSleepTrading } = await runCycle(scope.paths, completedTasks);
      status.nextPollSeconds = shouldSleepTrading ? pollMs / 1000 : Math.min(300, Math.max(60, pollMs / 1000));
      await writeStatus(scope.paths, status);
      await appendCheckLog(scope.paths, status);
      sleepOptions.push(shouldSleepTrading ? pollMs : status.nextPollSeconds * 1000);
      console.log(
        `[${status.finishedAt}] ${status.account?.name || "系统全局"} ${status.mode}: ${status.exitCode === 0 ? "ok" : "failed"}`,
      );
      if (status.stderr) console.error(status.stderr);
    }
    await sleep(Math.min(...sleepOptions, 300000));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
