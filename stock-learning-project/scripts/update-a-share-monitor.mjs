import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const today =
  process.argv.find((arg) => arg.startsWith("--date="))?.slice("--date=".length) ||
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

const indexSecids = "1.000001,0.399001,0.399006";
const focusStocks = [
  { name: "中国海油", code: "600938", secid: "1.600938" },
  { name: "中国船舶", code: "600150", secid: "1.600150" },
  { name: "沪电股份", code: "002463", secid: "0.002463" },
];

const fields = "f12,f14,f2,f3,f4,f6,f62";

async function fetchJson(url) {
  let lastError;

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 Chrome Safari",
          Referer: "https://quote.eastmoney.com/",
        },
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} for ${url}`);
      }

      const text = await res.text();
      if (!text.trim()) {
        throw new Error(`Empty response for ${url}`);
      }

      return JSON.parse(text);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
    }
  }

  throw lastError;
}

async function getQuotes(secids) {
  const url = `http://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=${secids}&fields=${fields}`;
  const json = await fetchJson(url);
  const rows = json?.data?.diff || [];

  if (!rows.length) {
    throw new Error("No quote data returned");
  }

  return rows;
}

async function getBoards(order) {
  const url = `http://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=30&po=${order}&np=1&fltt=2&invt=2&fid=f3&fs=m:90+t:2&fields=${fields}`;
  const json = await fetchJson(url);
  const rows = json?.data?.diff || [];

  return dedupeBoards(rows)
    .filter((row) => row.f3 !== "-")
    .sort((a, b) => (order === 1 ? Number(b.f3) - Number(a.f3) : Number(a.f3) - Number(b.f3)))
    .slice(0, 3);
}

function dedupeBoards(rows) {
  const seen = new Set();
  const result = [];

  for (const row of rows) {
    const normalized = String(row.f14 || "")
      .replace(/[ⅠⅡⅢIV]+$/g, "")
      .replace(/[一二三四五六七八九十]+$/g, "")
      .trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(row);
  }

  return result;
}

function fmt(num, digits = 2) {
  if (num === "-" || num === null || num === undefined || Number.isNaN(Number(num))) {
    return "无数据";
  }
  return Number(num).toFixed(digits);
}

function signed(num) {
  if (num === "-" || num === null || num === undefined || Number.isNaN(Number(num))) {
    return "无数据";
  }
  const value = Number(num);
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
}

function quoteCell(row) {
  return `${fmt(row.f2)}，${signed(row.f4)}，${signed(row.f3)}%`;
}

function boardText(rows) {
  if (!rows.length) return "待补充";
  return rows.map((row) => `${row.f14} ${signed(row.f3)}%`).join("、");
}

function tableRowDatePattern(date) {
  return new RegExp(`^\\| ${date.replaceAll("-", "\\-")} \\|`);
}

function upsertMarkdownTableRow(markdown, date, rowText, tableTitle) {
  const lines = markdown.split("\n");
  const existingIndex = lines.findIndex((line) => tableRowDatePattern(date).test(line));

  if (existingIndex >= 0) {
    lines[existingIndex] = rowText;
    return lines.join("\n");
  }

  const titleIndex = lines.findIndex((line) => line.trim() === tableTitle);
  if (titleIndex < 0) {
    throw new Error(`Cannot find table title: ${tableTitle}`);
  }

  let insertAt = -1;
  for (let i = titleIndex + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith("| ---")) {
      insertAt = i + 1;
      continue;
    }
    if (insertAt > 0 && !lines[i].startsWith("|")) {
      break;
    }
    if (insertAt > 0 && lines[i].startsWith("|")) {
      insertAt = i + 1;
    }
  }

  if (insertAt < 0) {
    throw new Error(`Cannot locate insertion point for: ${tableTitle}`);
  }

  lines.splice(insertAt, 0, rowText);
  return lines.join("\n");
}

async function updateAshareWatchlist(indexRows, strongest, weakest) {
  const file = path.join(projectRoot, "02-market-notes", "a-share-watchlist.md");
  let markdown = await fs.readFile(file, "utf8");
  const byCode = new Map(indexRows.map((row) => [String(row.f12), row]));
  const row = [
    today,
    quoteCell(byCode.get("000001")),
    quoteCell(byCode.get("399001")),
    quoteCell(byCode.get("399006")),
    boardText(strongest),
    boardText(weakest),
    "自动记录：三大指数和行业强弱已更新，具体原因留待人工复盘。",
  ];

  markdown = markdown.replace(/^更新时间：.*$/m, `更新时间：${today}`);
  markdown = upsertMarkdownTableRow(
    markdown,
    today,
    `| ${row.join(" | ")} |`,
    "## 指数观察",
  );
  await fs.writeFile(file, markdown, "utf8");
}

async function updateFocusCompanies(stockRows, strongest, weakest) {
  const file = path.join(projectRoot, "02-market-notes", "focus-companies.md");
  let markdown = await fs.readFile(file, "utf8");
  const byCode = new Map(stockRows.map((row) => [String(row.f12), row]));
  const cells = focusStocks.map((stock) => {
    const row = byCode.get(stock.code);
    return `${quoteCell(row)}`;
  });
  const best = stockRows
    .filter((row) => row.f3 !== "-")
    .sort((a, b) => Number(b.f3) - Number(a.f3))[0];
  const worst = stockRows
    .filter((row) => row.f3 !== "-")
    .sort((a, b) => Number(a.f3) - Number(b.f3))[0];
  const change =
    best && worst
      ? `${best.f14}相对最强 ${signed(best.f3)}%，${worst.f14}相对最弱 ${signed(worst.f3)}%；强行业：${boardText(strongest)}；弱行业：${boardText(weakest)}。`
      : `强行业：${boardText(strongest)}；弱行业：${boardText(weakest)}。`;
  const row = [today, ...cells, change, "待复盘"];

  markdown = markdown.replace(/^更新时间：.*$/m, `更新时间：${today}`);
  markdown = upsertMarkdownTableRow(
    markdown,
    today,
    `| ${row.join(" | ")} |`,
    "## 每日观察表",
  );
  await fs.writeFile(file, markdown, "utf8");
}

async function writeDailyNote(indexRows, stockRows, strongest, weakest) {
  const dir = path.join(projectRoot, "02-market-notes", "daily");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${today}.md`);
  const indexTable = indexRows
    .map((row) => `| ${row.f14} | ${quoteCell(row)} |`)
    .join("\n");
  const stockTable = stockRows
    .map((row) => `| ${row.f14} | ${quoteCell(row)} |`)
    .join("\n");
  const note = `# A股每日自动观察：${today}

说明：自动抓取行情，只记录事实，不构成投资建议。

## 三大指数

| 指数 | 收盘/涨跌/涨跌幅 |
| --- | --- |
${indexTable}

## 重点公司

| 公司 | 收盘/涨跌/涨跌幅 |
| --- | --- |
${stockTable}

## 行业强弱

- 强行业：${boardText(strongest)}
- 弱行业：${boardText(weakest)}

## 留给人工复盘的问题

1. 今天 3 家重点公司谁最强，谁最弱？
2. 它们是跟随板块，还是独立表现？
3. 今天的变化能否用“油价/订单/AI需求”解释？
`;

  await fs.writeFile(file, note, "utf8");
}

async function main() {
  const indexRows = await getQuotes(indexSecids);
  const stockRows = await getQuotes(focusStocks.map((stock) => stock.secid).join(","));
  const strongest = await getBoards(1).catch(() => []);
  const weakest = await getBoards(0).catch(() => []);

  await updateAshareWatchlist(indexRows, strongest, weakest);
  await updateFocusCompanies(stockRows, strongest, weakest);
  await writeDailyNote(indexRows, stockRows, strongest, weakest);

  console.log(`Updated A-share monitor for ${today}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
