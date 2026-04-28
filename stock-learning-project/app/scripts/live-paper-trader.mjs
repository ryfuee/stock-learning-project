import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");
const configFile = path.join(appRoot, "trading-config.json");
const statusFile = path.join(appRoot, "data", "live-status.json");

const defaultConfig = {
  pollSeconds: 60,
};

async function readConfig() {
  try {
    return { ...defaultConfig, ...JSON.parse(await fs.readFile(configFile, "utf8")) };
  } catch {
    return defaultConfig;
  }
}

function shanghaiParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function isTradingTime(date = new Date()) {
  const parts = shanghaiParts(date);
  if (["Sat", "Sun"].includes(parts.weekday)) return false;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const morning = minutes >= 9 * 60 + 30 && minutes <= 11 * 60 + 30;
  const afternoon = minutes >= 13 * 60 && minutes <= 15 * 60;
  return morning || afternoon;
}

function runGenerator({ trade }) {
  return new Promise((resolve) => {
    const args = [path.join(appRoot, "scripts", "generate-research.mjs")];
    if (trade) args.push("--paper-trade");
    const child = spawn(process.execPath, args, {
      cwd: appRoot,
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
  });
}

async function writeStatus(status) {
  await fs.mkdir(path.dirname(statusFile), { recursive: true });
  await fs.writeFile(statusFile, `${JSON.stringify(status, null, 2)}\n`, "utf8");
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const config = await readConfig();
  const pollMs = Math.max(15, Number(config.pollSeconds || 60)) * 1000;
  console.log(`Live paper trader started. Poll interval: ${pollMs / 1000}s`);

  while (true) {
    const trade = isTradingTime();
    const startedAt = new Date().toISOString();
    const result = await runGenerator({ trade });
    const status = {
      startedAt,
      finishedAt: new Date().toISOString(),
      mode: trade ? "PAPER_TRADE" : "REFRESH_ONLY",
      exitCode: result.code,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
      nextPollSeconds: pollMs / 1000,
    };
    await writeStatus(status);
    console.log(`[${status.finishedAt}] ${status.mode}: ${result.code === 0 ? "ok" : "failed"}`);
    if (result.stderr.trim()) console.error(result.stderr.trim());
    await sleep(trade ? pollMs : Math.max(pollMs, 5 * 60 * 1000));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
