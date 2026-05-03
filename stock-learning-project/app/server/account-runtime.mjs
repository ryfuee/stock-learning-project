import fs from "node:fs/promises";
import path from "node:path";

const RUNTIME_FILES = ["trading-config.json", "llm-secrets.json", "notification-config.json"];
const DATA_FILES = [
  "dashboard.json",
  "state.json",
  "live-status.json",
  "live-checks.json",
  "strategy-optimizer.json",
  "event-search-cache.json",
  "backtest-report.json",
  "decision-agent.json",
  "parameter-sweep.json",
  "strategy-lab.json",
];

function safeRuntimeKey(value) {
  const key = String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  return key || "default";
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function copyIfMissing(source, target) {
  if (!(await exists(source)) || (await exists(target))) return false;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, target);
  return true;
}

export function legacyRuntimePaths({ appRoot, runtimeDir }) {
  const dataDir = path.join(appRoot, "data");
  return {
    runtimeDir,
    dataDir,
    tradingConfigFile: path.join(runtimeDir, "trading-config.json"),
    llmSecretConfigFile: path.join(runtimeDir, "llm-secrets.json"),
    notificationConfigFile: path.join(runtimeDir, "notification-config.json"),
  };
}

export function accountRuntimePaths({ runtimeDir, account }) {
  const runtimeKey = safeRuntimeKey(account?.runtimeKey || account?.id || "default");
  const accountDir = path.join(runtimeDir, "accounts", runtimeKey);
  const dataDir = path.join(accountDir, "data");
  return {
    accountId: account?.id || "",
    accountName: account?.name || "默认模拟账户",
    runtimeKey,
    runtimeDir: accountDir,
    dataDir,
    tradingConfigFile: path.join(accountDir, "trading-config.json"),
    llmSecretConfigFile: path.join(accountDir, "llm-secrets.json"),
    notificationConfigFile: path.join(accountDir, "notification-config.json"),
  };
}

export function scriptEnvForAccount(paths) {
  return {
    A_SHARE_ACCOUNT_ID: paths.accountId || "",
    A_SHARE_ACCOUNT_NAME: paths.accountName || "",
    A_SHARE_ACCOUNT_RUNTIME_DIR: paths.runtimeDir,
    A_SHARE_DATA_DIR: paths.dataDir,
  };
}

export async function ensureAccountRuntime(paths, legacyPaths, { seedLegacy = false } = {}) {
  await fs.mkdir(paths.runtimeDir, { recursive: true });
  await fs.mkdir(paths.dataDir, { recursive: true });

  if (seedLegacy) {
    for (const file of RUNTIME_FILES) {
      await copyIfMissing(path.join(legacyPaths.runtimeDir, file), path.join(paths.runtimeDir, file));
    }
    for (const file of DATA_FILES) {
      await copyIfMissing(path.join(legacyPaths.dataDir, file), path.join(paths.dataDir, file));
    }
  }

  await fs.writeFile(
    path.join(paths.runtimeDir, "account-runtime.json"),
    `${JSON.stringify(
      {
        accountId: paths.accountId,
        accountName: paths.accountName,
        runtimeKey: paths.runtimeKey,
        seededFromLegacy: Boolean(seedLegacy),
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}
