import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const SESSION_COOKIE = "ashare_session";
const ACCOUNT_COOKIE = "ashare_account";
const PASSWORD_ALGO = "pbkdf2_sha256";
const PASSWORD_ITERATIONS = 210000;
const PASSWORD_KEYLEN = 32;
const PASSWORD_DIGEST = "sha256";

let db = null;

function nowIso() {
  return new Date().toISOString();
}

function randomId(prefix) {
  return `${prefix}_${crypto.randomBytes(12).toString("hex")}`;
}

function sessionDays() {
  const value = Number(process.env.A_SHARE_SESSION_DAYS || 14);
  return Number.isFinite(value) ? Math.max(1, Math.min(90, Math.round(value))) : 14;
}

function sessionExpiresAt() {
  return new Date(Date.now() + sessionDays() * 24 * 60 * 60 * 1000).toISOString();
}

function ensureDb() {
  if (!db) throw new Error("认证数据库尚未初始化");
  return db;
}

function normalizeUsername(value) {
  const username = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_.@-]{2,63}$/.test(username)) {
    throw new Error("用户名需为 3-64 位，可使用字母、数字、下划线、点、@ 或连字符");
  }
  return username;
}

function normalizePassword(value) {
  const password = String(value || "");
  if (password.length < 8) throw new Error("密码至少需要 8 位");
  if (password.length > 200) throw new Error("密码过长");
  return password;
}

function normalizeAccountName(value) {
  const name = String(value || "").trim().replace(/\s+/g, " ").slice(0, 40);
  if (name.length < 2) throw new Error("账户名称至少需要 2 个字符");
  return name;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const key = crypto.pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, PASSWORD_KEYLEN, PASSWORD_DIGEST).toString("hex");
  return `${PASSWORD_ALGO}$${PASSWORD_ITERATIONS}$${salt}$${key}`;
}

function verifyPassword(password, encoded) {
  const [algo, iterationsText, salt, key] = String(encoded || "").split("$");
  if (algo !== PASSWORD_ALGO || !iterationsText || !salt || !key) return false;
  const iterations = Number(iterationsText);
  if (!Number.isFinite(iterations) || iterations < 100000) return false;
  const derived = crypto.pbkdf2Sync(password, salt, iterations, PASSWORD_KEYLEN, PASSWORD_DIGEST);
  const expected = Buffer.from(key, "hex");
  return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function parseJson(text, fallback = {}) {
  try {
    return JSON.parse(text || "{}");
  } catch {
    return fallback;
  }
}

export function parseCookies(req) {
  const header = req.headers.cookie || "";
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        const key = index >= 0 ? part.slice(0, index) : part;
        const value = index >= 0 ? part.slice(index + 1) : "";
        try {
          return [key, decodeURIComponent(value)];
        } catch {
          return [key, value];
        }
      }),
  );
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "SameSite=Lax"];
  if (options.httpOnly !== false) parts.push("HttpOnly");
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.max(0, Math.round(options.maxAge))}`);
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  if (process.env.A_SHARE_COOKIE_SECURE === "1") parts.push("Secure");
  return parts.join("; ");
}

function clearCookie(name) {
  return serializeCookie(name, "", { maxAge: 0, expires: new Date(0) });
}

function countUsers() {
  return Number(ensureDb().prepare("SELECT COUNT(*) AS count FROM users").get()?.count || 0);
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at || "",
  };
}

function accountFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    status: row.status,
    runtimeKey: row.runtime_key,
    settings: parseJson(row.settings_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function listAccountsForUser(userId) {
  const database = ensureDb();
  const rows = database
    .prepare("SELECT * FROM accounts WHERE user_id = ? AND status != 'deleted' ORDER BY created_at ASC")
    .all(userId);
  if (rows.length) return rows.map(accountFromRow);
  const account = createAccountForUser(userId, "默认模拟账户");
  return [account];
}

function createAccountForUser(userId, rawName) {
  const database = ensureDb();
  const name = normalizeAccountName(rawName);
  const id = randomId("acct");
  const runtimeKey = id.replace(/^acct_/, "");
  const createdAt = nowIso();
  database
    .prepare(
      "INSERT INTO accounts (id, user_id, name, kind, status, runtime_key, settings_json, created_at, updated_at) VALUES (?, ?, ?, 'paper', 'active', ?, '{}', ?, ?)",
    )
    .run(id, userId, name, runtimeKey, createdAt, createdAt);
  return accountFromRow(database.prepare("SELECT * FROM accounts WHERE id = ?").get(id));
}

function authPayloadForUser(user, preferredAccountId = "") {
  const accounts = listAccountsForUser(user.id);
  const currentAccount = accounts.find((account) => account.id === preferredAccountId) || accounts[0] || null;
  return {
    authenticated: true,
    setupRequired: false,
    user: publicUser(user),
    accounts,
    currentAccount,
  };
}

function createUser(rawInput) {
  const input = rawInput || {};
  const username = normalizeUsername(input.username);
  const password = normalizePassword(input.password);
  const role = input.role === "admin" ? "admin" : "user";
  const id = randomId("usr");
  const createdAt = nowIso();
  const database = ensureDb();
  database
    .prepare("INSERT INTO users (id, username, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, username, hashPassword(password), role, createdAt, createdAt);
  createAccountForUser(id, input.accountName || "默认模拟账户");
  return database.prepare("SELECT * FROM users WHERE id = ?").get(id);
}

function createSession(user, req) {
  const database = ensureDb();
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = sessionExpiresAt();
  const createdAt = nowIso();
  database
    .prepare(
      "INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, user_agent, ip) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      randomId("ses"),
      user.id,
      hashToken(token),
      createdAt,
      expiresAt,
      String(req.headers["user-agent"] || "").slice(0, 300),
      String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim().slice(0, 80),
    );
  database.prepare("UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?").run(createdAt, createdAt, user.id);
  const payload = authPayloadForUser({ ...user, last_login_at: createdAt });
  const accountId = payload.currentAccount?.id || "";
  return {
    payload,
    cookies: [
      serializeCookie(SESSION_COOKIE, token, { maxAge: sessionDays() * 24 * 60 * 60 }),
      accountId ? serializeCookie(ACCOUNT_COOKIE, accountId, { maxAge: sessionDays() * 24 * 60 * 60 }) : clearCookie(ACCOUNT_COOKIE),
    ],
  };
}

async function bootstrapAdminFromEnv() {
  if (countUsers() > 0) return;
  const username = process.env.A_SHARE_ADMIN_USER || "";
  const password = process.env.A_SHARE_ADMIN_PASSWORD || "";
  if (!username && !password) return;
  if (!username || !password) throw new Error("A_SHARE_ADMIN_USER 和 A_SHARE_ADMIN_PASSWORD 需要同时配置");
  createUser({ username, password, role: "admin", accountName: "主模拟账户" });
  console.log(`A-share auth: created admin user ${normalizeUsername(username)}`);
}

export async function initAuthStore({ runtimeDir }) {
  await fs.mkdir(runtimeDir, { recursive: true });
  const dbFile = path.join(runtimeDir, "a-share-platform.sqlite");
  db = new DatabaseSync(dbFile);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      user_agent TEXT,
      ip TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'paper',
      status TEXT NOT NULL DEFAULT 'active',
      runtime_key TEXT NOT NULL,
      settings_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, name),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id);
  `);
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(nowIso());
  await bootstrapAdminFromEnv();
}

export function setupRequired() {
  return countUsers() === 0;
}

export function getAuthContext(req) {
  const database = ensureDb();
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE] || "";
  const base = {
    authenticated: false,
    setupRequired: setupRequired(),
    user: null,
    accounts: [],
    currentAccount: null,
  };
  if (!token) return base;
  const row = database
    .prepare(
      `SELECT
        sessions.id AS session_id,
        sessions.expires_at AS session_expires_at,
        users.id,
        users.username,
        users.role,
        users.created_at,
        users.last_login_at
      FROM sessions
      JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
    )
    .get(hashToken(token), nowIso());
  if (!row) return base;
  const accounts = listAccountsForUser(row.id);
  const currentAccount = accounts.find((account) => account.id === cookies[ACCOUNT_COOKIE]) || accounts[0] || null;
  return {
    authenticated: true,
    setupRequired: false,
    user: publicUser(row),
    accounts,
    currentAccount,
  };
}

export function setupAdmin(input, req) {
  if (!setupRequired()) throw new Error("管理员已初始化，请直接登录");
  const user = createUser({ ...input, role: "admin", accountName: "主模拟账户" });
  return createSession(user, req);
}

export function loginUser(input, req) {
  if (setupRequired()) throw new Error("请先初始化管理员账号");
  const username = normalizeUsername(input?.username);
  const password = normalizePassword(input?.password);
  const user = ensureDb().prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user || !verifyPassword(password, user.password_hash)) throw new Error("用户名或密码不正确");
  return createSession(user, req);
}

export function logoutUser(req) {
  const token = parseCookies(req)[SESSION_COOKIE] || "";
  if (token) ensureDb().prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
  return {
    payload: { authenticated: false, setupRequired: setupRequired(), user: null, accounts: [], currentAccount: null },
    cookies: [clearCookie(SESSION_COOKIE), clearCookie(ACCOUNT_COOKIE)],
  };
}

export function createPaperAccount(userId, input) {
  const account = createAccountForUser(userId, input?.name || "");
  return {
    payload: authPayloadForUser(ensureDb().prepare("SELECT * FROM users WHERE id = ?").get(userId), account.id),
    cookies: [serializeCookie(ACCOUNT_COOKIE, account.id, { maxAge: sessionDays() * 24 * 60 * 60 })],
  };
}

export function selectPaperAccount(userId, accountId) {
  const account = ensureDb()
    .prepare("SELECT * FROM accounts WHERE id = ? AND user_id = ? AND status != 'deleted'")
    .get(String(accountId || ""), userId);
  if (!account) throw new Error("模拟账户不存在或无权限");
  return {
    payload: authPayloadForUser(ensureDb().prepare("SELECT * FROM users WHERE id = ?").get(userId), account.id),
    cookies: [serializeCookie(ACCOUNT_COOKIE, account.id, { maxAge: sessionDays() * 24 * 60 * 60 })],
  };
}

export function listAllActiveAccounts() {
  const rows = ensureDb()
    .prepare(
      `SELECT
        accounts.*,
        users.username AS owner_username,
        users.role AS owner_role
      FROM accounts
      JOIN users ON users.id = accounts.user_id
      WHERE accounts.status = 'active'
      ORDER BY accounts.created_at ASC`,
    )
    .all();
  return rows.map((row) => ({
    ...accountFromRow(row),
    userId: row.user_id,
    ownerUsername: row.owner_username,
    ownerRole: row.owner_role,
  }));
}
