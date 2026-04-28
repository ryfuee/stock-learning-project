import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");
const projectRoot = path.resolve(appRoot, "..");
const dataDir = path.join(appRoot, "data");
const marketNotesDir = process.env.MARKET_NOTES_DIR || path.join(projectRoot, "02-market-notes");
const reportDir = path.join(marketNotesDir, "daily-research");
const configFile = path.join(appRoot, "trading-config.json");
const paperTradingEnabled = process.argv.includes("--paper-trade");

const today =
  process.argv.find((arg) => arg.startsWith("--date="))?.slice("--date=".length) ||
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

const fields = "f12,f14,f2,f3,f4,f6,f62,f297";
const indexes = [
  { name: "上证指数", secid: "1.000001" },
  { name: "深证成指", secid: "0.399001" },
  { name: "创业板指", secid: "0.399006" },
];
const coreUniverse = [
  { code: "600938", name: "中国海油", boardName: "油气开采" },
  { code: "600150", name: "中国船舶", boardName: "航海装备" },
  { code: "002463", name: "沪电股份", boardName: "PCB/算力硬件" },
  { code: "603259", name: "药明康德", boardName: "医药/CRO" },
  { code: "601898", name: "中煤能源", boardName: "煤炭" },
  { code: "601088", name: "中国神华", boardName: "煤炭" },
  { code: "300308", name: "中际旭创", boardName: "CPO/光模块" },
  { code: "300502", name: "新易盛", boardName: "CPO/光模块" },
];

const companyProfiles = {
  "600938": {
    business: "海上原油和天然气勘探、开发、生产和销售。",
    customers: "炼化企业、天然气下游用户、能源贸易和能源消费客户。",
    profitDrivers: ["国际油价", "油气产量", "桶油成本", "新油气田投产", "分红预期"],
    riskDrivers: ["油价下跌", "项目投产不及预期", "资本开支过高", "地缘政治", "安全环保事故"],
    researchStatus: "已建立基础研究卡",
  },
  "600150": {
    business: "造船、修船、海洋工程装备和船用机电设备。",
    customers: "航运公司、能源运输公司、海工企业、国内外船东和军民用船舶需求方。",
    profitDrivers: ["新船订单", "高端船型占比", "船价", "钢材成本", "交付效率"],
    riskDrivers: ["航运周期下行", "船价下降", "原材料上涨", "交付延期", "周期预期回落"],
    researchStatus: "已建立基础研究卡",
  },
  "002463": {
    business: "印制电路板 PCB，重点服务 AI服务器、高速网络设备、通信设备和汽车电子。",
    customers: "数据中心、通信设备、服务器、高速网络设备、汽车电子和工业控制客户。",
    profitDrivers: ["AI服务器需求", "高端PCB占比", "产能利用率", "产品结构升级", "毛利率"],
    riskDrivers: ["AI需求放缓", "价格竞争", "原材料上涨", "产能爬坡不顺", "客户砍单"],
    researchStatus: "已建立基础研究卡",
  },
  "603259": {
    business: "新药研发和生产外包服务，覆盖 CRO/CDMO/CRDMO 等环节。",
    customers: "全球制药公司、生物科技公司和创新药企业。",
    profitDrivers: ["药企研发投入", "在手订单", "高附加值项目", "产能利用率", "海外需求"],
    riskDrivers: ["海外监管", "地缘政治", "订单延期", "行业竞争", "研发预算收缩"],
    researchStatus: "已建立基础研究卡",
  },
  "601898": {
    business: "煤炭生产销售、煤化工、煤矿装备、电力和相关能源业务。",
    customers: "电厂、钢铁、水泥、化工等用煤企业，以及煤化工产业链客户。",
    profitDrivers: ["煤价", "自产煤销量", "采矿成本", "长协比例", "煤化工价格"],
    riskDrivers: ["煤价下跌", "需求走弱", "安全环保限制", "成本上升", "煤化工景气回落"],
    researchStatus: "已建立基础研究卡",
  },
  "601088": {
    business: "煤炭、电力、铁路、港口、航运和煤化工一体化能源业务。",
    customers: "电力、化工、冶金等能源用户，以及电力和运输服务客户。",
    profitDrivers: ["煤价", "自产煤产量", "一体化运输效率", "电力业务", "分红预期"],
    riskDrivers: ["煤价下跌", "政策限价", "需求回落", "安全生产", "资本开支变化"],
    researchStatus: "已建立基础研究卡",
  },
  "300308": {
    business: "高速光模块，用于数据中心、AI集群和通信网络的数据传输。",
    customers: "云厂商、AI数据中心、通信设备商和海外科技链客户。",
    profitDrivers: ["AI资本开支", "800G/1.6T出货", "大客户订单", "良率", "技术迭代"],
    riskDrivers: ["客户资本开支放缓", "价格竞争", "技术替代", "客户集中", "估值回落"],
    researchStatus: "已建立基础研究卡",
  },
  "300502": {
    business: "高速光模块和光器件，用于 AI集群、云数据中心、数据通信和5G网络。",
    customers: "云厂商、AI数据中心、通信设备商和海外客户。",
    profitDrivers: ["AI算力投资", "高速率产品放量", "境外订单", "毛利率", "交付能力"],
    riskDrivers: ["AI资本开支低于预期", "产品迭代风险", "汇率波动", "客户集中", "增速放缓"],
    researchStatus: "已建立基础研究卡",
  },
};

const defaultTradingConfig = {
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
  lotSize: 100
};

async function readTradingConfig() {
  try {
    return { ...defaultTradingConfig, ...JSON.parse(await fs.readFile(configFile, "utf8")) };
  } catch {
    return defaultTradingConfig;
  }
}

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
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!text.trim()) throw new Error("empty response");
      return JSON.parse(text);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 350 * attempt));
    }
  }
  throw new Error(`Fetch failed after retries: ${url}`, { cause: lastError });
}

async function fetchText(url, encoding = "utf-8") {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 Chrome Safari",
          Referer: "https://finance.sina.com.cn/",
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = await res.arrayBuffer();
      const text = new TextDecoder(encoding).decode(buffer);
      if (!text.trim()) throw new Error("empty response");
      return text;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 350 * attempt));
    }
  }
  throw new Error(`Fetch failed after retries: ${url}`, { cause: lastError });
}

async function getQuotes(secids) {
  const url = `http://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=${secids}&fields=${fields}`;
  const json = await fetchJson(url);
  return json?.data?.diff || [];
}

async function getEastmoneyBoards(order = 1, size = 30) {
  const url = `http://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=${size}&po=${order}&np=1&fltt=2&invt=2&fid=f3&fs=m:90+t:2&fields=${fields}`;
  const json = await fetchJson(url);
  const rows = json?.data?.diff || [];
  return dedupeBoards(rows)
    .filter((row) => Number.isFinite(Number(row.f3)))
    .sort((a, b) => (order === 1 ? Number(b.f3) - Number(a.f3) : Number(a.f3) - Number(b.f3)))
    .map((row) => ({ ...row, provider: "东方财富行业板块" }));
}

async function getSinaIndustryBoards(order = 1, size = 30) {
  const text = await fetchText("http://vip.stock.finance.sina.com.cn/q/view/newSinaHy.php", "gbk");
  const match = text.match(/\{.*\}/s);
  if (!match) throw new Error("Sina industry payload not found");
  const payload = JSON.parse(match[0]);
  const rows = Object.values(payload)
    .map((line) => {
      const parts = String(line).split(",");
      const leaderRaw = parts[8] || "";
      return {
        f12: `sina:${parts[0]}`,
        f14: parts[1],
        f2: num(parts[3]),
        f3: num(parts[5]),
        f4: num(parts[4]),
        f6: num(parts[7]),
        f62: null,
        provider: "新浪财经行业板块",
        leader: {
          code: leaderRaw.replace(/^(sh|sz)/, ""),
          marketCode: leaderRaw,
          name: parts[12],
          pct: num(parts[9]),
          price: num(parts[10]),
          change: num(parts[11]),
        },
      };
    })
    .filter((row) => row.f14 && Number.isFinite(row.f3));

  return dedupeBoards(rows)
    .sort((a, b) => (order === 1 ? Number(b.f3) - Number(a.f3) : Number(a.f3) - Number(b.f3)))
    .slice(0, size);
}

async function getBoards(order = 1, size = 30, warnings = []) {
  try {
    return await getEastmoneyBoards(order, size);
  } catch (error) {
    warnings.push(`东方财富行业板块接口失败，已切换新浪财经真实行业板块数据：${error.message}`);
    return getSinaIndustryBoards(order, size);
  }
}

async function getBoardStocks(boardCode, size = 12) {
  if (String(boardCode).startsWith("sina:")) {
    return [];
  }
  const url = `http://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=${size}&po=1&np=1&fltt=2&invt=2&fid=f3&fs=b:${boardCode}&fields=${fields}`;
  const json = await fetchJson(url);
  return json?.data?.diff || [];
}

function f10Code(code) {
  return `${String(code).startsWith("6") ? "SH" : "SZ"}${code}`;
}

async function getCompanySurvey(code) {
  const url = `https://emweb.securities.eastmoney.com/PC_HSF10/CompanySurvey/PageAjax?code=${f10Code(code)}`;
  const json = await fetchJson(url);
  const base = json?.jbzl?.[0] || null;
  if (!base) return null;
  return {
    industry: base.EM2016 || base.INDUSTRYCSRC1 || "",
    profile: base.ORG_PROFILE || "",
    businessScope: base.BUSINESS_SCOPE || "",
    website: base.ORG_WEB || "",
    employeeCount: base.EMP_NUM || null,
    source: "东方财富F10公司概况",
  };
}

function getSinaLeaderStock(board) {
  if (!board?.leader?.code || !board?.leader?.name) return null;
  return {
    f12: board.leader.code,
    f14: board.leader.name,
    f2: board.leader.price,
    f3: board.leader.pct,
    f4: board.leader.change,
    f6: null,
    f62: null,
    source: "新浪行业领涨股",
    amountKnown: false,
  };
}

function dedupeBoards(rows) {
  const seen = new Set();
  const result = [];
  for (const row of rows) {
    const name = String(row.f14 || "");
    const normalized = name.replace(/[ⅠⅡⅢIV]+$/g, "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(row);
  }
  return result;
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function hasNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function signed(value, digits = 2) {
  const n = num(value);
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}`;
}

function compactDate(dateText) {
  return Number(String(dateText).replaceAll("-", ""));
}

function money(value) {
  if (!hasNumber(value)) return "无数据";
  const n = num(value);
  if (Math.abs(n) >= 1e8) return `${(n / 1e8).toFixed(2)}亿`;
  if (Math.abs(n) >= 1e4) return `${(n / 1e4).toFixed(2)}万`;
  return `${n.toFixed(0)}`;
}

function scoreBoard(row) {
  const pct = num(row.f3);
  const amount = Math.max(num(row.f6), 1);
  const main = num(row.f62);
  return Math.round(
    Math.max(0, pct * 12) +
      Math.min(25, Math.log10(amount / 1e8 + 1) * 10) +
      Math.max(-10, Math.min(18, main / 1e8)),
  );
}

function scoreStock(stock, board, learningBias, config = defaultTradingConfig) {
  const pct = num(stock.f3);
  const amount = num(stock.f6);
  const main = num(stock.f62);
  const amountKnown = hasNumber(stock.f6) && amount > 0;
  const mainKnown = hasNumber(stock.f62);
  const riskTags = [];
  let riskPenalty = 0;

  if (String(stock.f14).includes("ST")) {
    riskTags.push("ST/风险警示");
    riskPenalty += 100;
  }
  if (pct >= 9.5) {
    riskTags.push("接近涨停，追高风险");
    riskPenalty += 12;
  }
  if (pct <= -4) {
    riskTags.push("当日明显走弱");
    riskPenalty += 8;
  }
  if (!amountKnown) {
    riskTags.push("个股成交额源未返回");
  } else if (amount < 1e8) {
    riskTags.push("成交额偏低");
    riskPenalty += 6;
  }

  const raw =
    scoreBoard(board) * 0.45 +
    pct * 5 +
    (amountKnown ? Math.min(18, Math.log10(amount / 1e8 + 1) * 8) : 8) +
    (mainKnown ? Math.max(-12, Math.min(16, main / 1e8)) : 0) +
    learningBias -
    riskPenalty;
  const score = Math.max(0, Math.min(100, Math.round(raw)));

  let action = "观察";
  let actionCode = "WATCH";
  if (riskPenalty >= 100) {
    action = "剔除";
    actionCode = "AVOID";
  } else if (score >= config.buyScoreThreshold && pct > 0.8 && pct < 8.5 && main > 0) {
    action = "模拟买入";
    actionCode = "PAPER_BUY";
  } else if (score >= 58) {
    action = "重点观察";
    actionCode = "FOCUS";
  }

  return {
    code: stock.f12,
    name: stock.f14,
    price: num(stock.f2),
    pct,
    change: num(stock.f4),
    amount: amountKnown ? amount : null,
    mainNet: mainKnown ? main : null,
    boardCode: board.f12,
    boardName: board.f14,
    source: stock.source || board.provider || "行情接口",
    score,
    action,
    actionCode,
    riskTags,
    reason: explainStock(stock, board, score, action),
  };
}

function boardForUniverseStock(stockConfig, hotBoards) {
  const direct = hotBoards.find((board) => stockConfig.boardName.includes(board.name) || board.name.includes(stockConfig.boardName));
  const keywordGroups = [
    ["煤", ["煤", "动力煤", "煤炭"]],
    ["油气", ["油气", "炼油", "燃气"]],
    ["航海", ["船", "航海", "海工"]],
    ["PCB", ["PCB", "电子元件", "印制电路"]],
    ["CPO", ["CPO", "光模块", "光通信", "通信设备"]],
    ["医药", ["医药", "CRO", "创新药"]],
  ];
  const group = keywordGroups.find(([key]) => stockConfig.boardName.includes(key));
  const matched = group
    ? hotBoards.find((board) => group[1].some((keyword) => board.name.includes(keyword)))
    : null;
  const board = direct || matched;
  return board
    ? {
        f12: board.code,
        f14: board.name,
        f3: board.pct,
        f6: board.amount,
        f62: board.mainNet,
        provider: board.source,
      }
    : {
        f12: "CORE",
        f14: stockConfig.boardName,
        f3: 0,
        f6: 0,
        f62: 0,
      };
}

function explainStock(stock, board, score, action) {
  const parts = [
    `${board.f14}板块涨幅${signed(board.f3)}%`,
    `个股涨幅${signed(stock.f3)}%`,
    `成交额${money(stock.f6)}`,
  ];
  if (hasNumber(stock.f62) && num(stock.f62) > 0) parts.push(`主力净流入${money(stock.f62)}`);
  if (hasNumber(stock.f62) && num(stock.f62) < 0) parts.push(`主力净流出${money(Math.abs(stock.f62))}`);
  if (stock.source) parts.push(`来源${stock.source}`);
  return `${action}：评分${score}，${parts.join("，")}。`;
}

function secidFromCode(code) {
  return String(code).startsWith("6") ? `1.${code}` : `0.${code}`;
}

async function readState() {
  const file = path.join(dataDir, "state.json");
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return { positions: [], closedTrades: [], tradeLog: [], learning: {} };
  }
}

async function writeState(state) {
  await fs.writeFile(path.join(dataDir, "state.json"), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function ensureState(state, config) {
  state.positions ||= [];
  state.closedTrades ||= [];
  state.tradeLog ||= [];
  state.learning ||= {};
  state.portfolio ||= {
    initialCash: config.initialCash,
    cash: config.initialCash,
    realizedPnl: 0,
    totalFees: 0,
  };

  if (!state.portfolio.migratedLegacyPositions) {
    for (const position of state.positions.filter((item) => item.status === "OPEN")) {
      if (position.shares) continue;
      const fillPrice = position.entryPrice || position.latestPrice;
      const targetCash = config.initialCash * config.maxPositionPct;
      const shares = Math.floor(targetCash / fillPrice / config.lotSize) * config.lotSize;
      if (shares <= 0) continue;
      const fees = calcBuyFees(fillPrice, shares, config);
      const totalCost = fillPrice * shares + fees.total;
      position.shares = shares;
      position.entryFillPrice = fillPrice;
      position.buyFees = fees;
      position.totalCost = totalCost;
      position.costBasis = totalCost / shares;
      position.unrealizedPnl = 0;
      position.unrealizedPnlPct = 0;
      state.portfolio.cash -= totalCost;
      state.portfolio.totalFees += fees.total;
      state.tradeLog.push({
        date: position.entryDate || today,
        code: position.code,
        name: position.name,
        side: "BUY",
        shares,
        price: fillPrice,
        gross: fillPrice * shares,
        fees,
        netCash: -totalCost,
        reason: "迁移旧模拟持仓并补记费用",
      });
    }
    state.portfolio.migratedLegacyPositions = true;
  }

  return state;
}

function calcCommission(gross, config) {
  return Math.max(gross * config.commissionRate, config.minCommission);
}

function calcBuyFees(price, shares, config) {
  const gross = price * shares;
  const commission = calcCommission(gross, config);
  const transferFee = gross * config.transferFeeRate;
  return {
    commission,
    transferFee,
    stampDuty: 0,
    total: commission + transferFee,
  };
}

function calcSellFees(price, shares, config) {
  const gross = price * shares;
  const commission = calcCommission(gross, config);
  const transferFee = gross * config.transferFeeRate;
  const stampDuty = gross * config.stampDutyRate;
  return {
    commission,
    transferFee,
    stampDuty,
    total: commission + transferFee + stampDuty,
  };
}

function buyFillPrice(price, config) {
  return price * (1 + config.slippageRate);
}

function sellFillPrice(price, config) {
  return price * (1 - config.slippageRate);
}

function estimateEquity(state) {
  const openValue = state.positions
    .filter((position) => position.status === "OPEN")
    .reduce((sum, position) => sum + (position.latestPrice || position.entryPrice || 0) * (position.shares || 0), 0);
  return state.portfolio.cash + openValue;
}

function canSellToday(position) {
  return position.entryDate && position.entryDate < today;
}

async function updatePaperBook(state, candidates, config, tradeEnabled) {
  const openCodes = new Set(state.positions.filter((p) => p.status === "OPEN").map((p) => p.code));
  const openPositions = state.positions.filter((p) => p.status === "OPEN");
  const decisions = [];

  if (openPositions.length) {
    const quotes = await getQuotes(openPositions.map((p) => secidFromCode(p.code)).join(","));
    const quoteMap = new Map(quotes.map((row) => [String(row.f12), row]));

    for (const position of openPositions) {
      const quote = quoteMap.get(position.code);
      if (!quote) continue;
      const price = num(quote.f2, position.latestPrice);
      const markSellPrice = sellFillPrice(price, config);
      const estimateSellFees = calcSellFees(markSellPrice, position.shares || 0, config);
      const estimateProceeds = markSellPrice * (position.shares || 0) - estimateSellFees.total;
      const totalCost = position.totalCost || (position.entryPrice || 0) * (position.shares || 0);
      const pnl = estimateProceeds - totalCost;
      const pnlPct = totalCost > 0 ? (pnl / totalCost) * 100 : 0;

      position.latestPrice = price;
      position.latestDate = today;
      position.unrealizedPnl = pnl;
      position.unrealizedPnlPct = pnlPct;

      let decision = "继续持有";
      let decisionCode = "HOLD";
      if (!canSellToday(position)) {
        decision = "T+1限制，继续持有";
        decisionCode = "T1_HOLD";
      } else if (pnlPct <= config.stopLossPct) {
        decision = "模拟止损";
        decisionCode = "STOP_LOSS";
      } else if (pnlPct >= config.takeProfitPct) {
        decision = "模拟止盈";
        decisionCode = "TAKE_PROFIT";
      } else if (num(quote.f3) <= -4) {
        decision = "转弱观察";
        decisionCode = "WEAK_HOLD";
      }

      if (tradeEnabled && (decisionCode === "STOP_LOSS" || decisionCode === "TAKE_PROFIT")) {
        const exitPrice = sellFillPrice(price, config);
        const sellFees = calcSellFees(exitPrice, position.shares || 0, config);
        const gross = exitPrice * (position.shares || 0);
        const proceeds = gross - sellFees.total;
        const realizedPnl = proceeds - totalCost;
        const realizedPnlPct = totalCost > 0 ? (realizedPnl / totalCost) * 100 : 0;

        position.status = "CLOSED";
        position.exitDate = today;
        position.exitPrice = exitPrice;
        position.exitReason = decision;
        position.sellFees = sellFees;
        position.realizedPnl = realizedPnl;
        position.realizedPnlPct = realizedPnlPct;
        state.portfolio.cash += proceeds;
        state.portfolio.realizedPnl += realizedPnl;
        state.portfolio.totalFees += sellFees.total;
        state.closedTrades.push({ ...position });
        state.tradeLog.push({
          date: today,
          code: position.code,
          name: position.name,
          side: "SELL",
          shares: position.shares,
          price: exitPrice,
          gross,
          fees: sellFees,
          netCash: proceeds,
          realizedPnl,
          realizedPnlPct,
          reason: decision,
        });
        updateLearning(state, position.boardName, realizedPnlPct);
      }

      decisions.push({
        code: position.code,
        name: position.name,
        boardName: position.boardName,
        entryDate: position.entryDate,
        entryPrice: position.entryPrice,
        shares: position.shares || 0,
        latestPrice: price,
        pnlPct,
        pnl,
        decision,
        decisionCode,
      });
    }
  }

  if (tradeEnabled) {
    const activePositions = state.positions.filter((p) => p.status === "OPEN");
    const activeCodes = new Set(activePositions.map((p) => p.code));
    const slots = Math.max(0, config.maxPositions - activePositions.length);
    const buyList = candidates
      .filter((item) => item.actionCode === "PAPER_BUY" && !activeCodes.has(item.code))
      .slice(0, slots);

    for (const item of buyList) {
      const equity = estimateEquity(state);
      const budget = Math.min(equity * config.maxPositionPct, state.portfolio.cash);
      const fillPrice = buyFillPrice(item.price, config);
      let shares = Math.floor(budget / fillPrice / config.lotSize) * config.lotSize;
      while (shares > 0) {
        const fees = calcBuyFees(fillPrice, shares, config);
        const totalCost = fillPrice * shares + fees.total;
        if (totalCost <= state.portfolio.cash) break;
        shares -= config.lotSize;
      }
      if (shares <= 0) continue;
      const fees = calcBuyFees(fillPrice, shares, config);
      const gross = fillPrice * shares;
      const totalCost = gross + fees.total;

      const position = {
        id: `${today}-${item.code}`,
        code: item.code,
        name: item.name,
        boardName: item.boardName,
        entryDate: today,
        entryPrice: fillPrice,
        latestPrice: item.price,
        latestDate: today,
        shares,
        status: "OPEN",
        signal: "模拟买入",
        reason: item.reason,
        buyFees: fees,
        totalCost,
        costBasis: totalCost / shares,
        unrealizedPnl: -fees.total,
        unrealizedPnlPct: totalCost > 0 ? (-fees.total / totalCost) * 100 : 0,
      };
      state.positions.push(position);
      state.portfolio.cash -= totalCost;
      state.portfolio.totalFees += fees.total;
      state.tradeLog.push({
        date: today,
        code: item.code,
        name: item.name,
        side: "BUY",
        shares,
        price: fillPrice,
        gross,
        fees,
        netCash: -totalCost,
        reason: item.reason,
      });
      decisions.push({
        code: item.code,
        name: item.name,
        boardName: item.boardName,
        entryDate: today,
        entryPrice: fillPrice,
        shares,
        latestPrice: item.price,
        pnlPct: position.unrealizedPnlPct,
        pnl: position.unrealizedPnl,
        decision: "新开模拟仓",
        decisionCode: "PAPER_BUY",
      });
    }
  }

  return decisions;
}

function updateLearning(state, boardName, pnlPct) {
  state.learning[boardName] ||= { wins: 0, losses: 0, avgReturn: 0, count: 0, bias: 0 };
  const item = state.learning[boardName];
  item.count += 1;
  item.wins += pnlPct > 0 ? 1 : 0;
  item.losses += pnlPct <= 0 ? 1 : 0;
  item.avgReturn = ((item.avgReturn * (item.count - 1)) + pnlPct) / item.count;
  item.bias = Math.max(-8, Math.min(8, item.avgReturn * 0.5));
}

function learningBiasFor(state, boardName) {
  return num(state.learning?.[boardName]?.bias);
}

function buildMarketRegime(indexRows, hotBoards, candidates) {
  const indexAvg = indexRows.length
    ? indexRows.reduce((sum, row) => sum + num(row.f3), 0) / indexRows.length
    : 0;
  const strongBoards = hotBoards.filter((board) => board.pct >= 2).length;
  const buySignals = candidates.filter((item) => item.actionCode === "PAPER_BUY").length;
  const focusSignals = candidates.filter((item) => item.actionCode === "FOCUS").length;
  const topBoardScore = hotBoards[0]?.score || 0;
  let label = "震荡观察";
  let tone = "neutral";
  let score = Math.round(50 + indexAvg * 8 + strongBoards * 6 + buySignals * 4 + Math.min(15, topBoardScore / 6));

  if (score >= 75) {
    label = "赚钱效应较强";
    tone = "hot";
  } else if (score >= 60) {
    label = "局部赚钱效应";
    tone = "warm";
  } else if (score <= 38) {
    label = "防守优先";
    tone = "cold";
  }

  score = Math.max(0, Math.min(100, score));
  return {
    label,
    tone,
    score,
    indexAvg,
    strongBoards,
    buySignals,
    focusSignals,
    summary: `${label}：指数平均涨跌${signed(indexAvg)}%，强势板块${strongBoards}个，模拟买入信号${buySignals}个。`,
  };
}

function cleanText(text, max = 180) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

async function buildResearchItems(candidates) {
  const items = [];
  for (const item of candidates.slice(0, 18)) {
    const profile = companyProfiles[item.code] || null;
    const survey = profile ? null : await getCompanySurvey(item.code).catch(() => null);
    const researchScore = Math.round(
      item.score * 0.42 +
        (profile ? 28 : survey ? 22 : 8) +
        (item.amount ? Math.min(12, Math.log10(item.amount / 1e8 + 1) * 5) : 0) +
        (item.riskTags?.length ? -item.riskTags.length * 3 : 0),
    );

    const openQuestions = profile
      ? [
          `今天股价变化能否由${profile.profitDrivers.slice(0, 2).join("、")}解释？`,
          `当前风险里最需要验证的是：${profile.riskDrivers[0]}。`,
        ]
      : survey
        ? [
            `已抓取F10概况，但仍需拆主营收入和利润结构。`,
            `今天上涨是否与${survey.industry || item.boardName}板块共振？`,
          ]
      : [
          "公司主营业务尚未进入本地研究库，先不要把它当成可交易标的。",
          "需要补充公告、财报和主营业务后，才允许升级为模拟交易候选。",
        ];

    items.push({
      code: item.code,
      name: item.name,
      boardName: item.boardName,
      action: item.action,
      actionCode: item.actionCode,
      score: item.score,
      researchScore: Math.max(0, Math.min(100, researchScore)),
      price: item.price,
      pct: item.pct,
      amount: item.amount,
      source: item.source,
      profileKnown: Boolean(profile),
      researchStatus: profile?.researchStatus || (survey ? "已抓取东方财富F10公司概况" : "待自动补充公司基本面"),
      business:
        profile?.business ||
        cleanText(survey?.profile || survey?.businessScope) ||
        "待调研：当前只确认了行情、板块和领涨关系，尚未确认主营业务。",
      customers: profile?.customers || (survey ? "待从年报主营构成继续提取" : "待调研"),
      profitDrivers: profile?.profitDrivers || [survey?.industry || item.boardName, "板块热度", "个股涨幅", "成交活跃度"].filter(Boolean),
      riskDrivers: profile?.riskDrivers || ["主营结构待拆解", "可能是一日游热点", "无法解释上涨原因"],
      researchSource: profile ? "本地研究卡" : survey?.source || "行情源",
      openQuestions,
    });
  }
  return items;
}

function buildStrategyReview(state, candidates, hotBoards, portfolio) {
  const closed = state.closedTrades || [];
  const wins = closed.filter((trade) => num(trade.realizedPnlPct) > 0).length;
  const losses = closed.filter((trade) => num(trade.realizedPnlPct) <= 0).length;
  const winRate = closed.length ? (wins / closed.length) * 100 : 0;
  const avgReturn = closed.length
    ? closed.reduce((sum, trade) => sum + num(trade.realizedPnlPct), 0) / closed.length
    : 0;
  const topSignals = candidates.slice(0, 5).map((item) => `${item.name}(${item.action})`);
  const lessons = [];

  if (!closed.length) {
    lessons.push("样本不足：先累计至少20笔模拟交易，再判断策略有效性。");
  }
  if (hotBoards[0]) {
    lessons.push(`当前最强板块是${hotBoards[0].name}，需要连续性验证，避免一日游。`);
  }
  if ((portfolio?.returnPct || 0) < 0) {
    lessons.push("清算净值为负收益，先检查手续费、滑点和追高成本。");
  }
  if (candidates.some((item) => item.riskTags?.includes("接近涨停，追高风险"))) {
    lessons.push("存在接近涨停的候选，实盘学习时要把追高风险单独复盘。");
  }

  return {
    sampleCount: closed.length,
    wins,
    losses,
    winRate,
    avgReturn,
    topSignals,
    lessons,
    nextOptimization: closed.length < 20 ? "继续收集样本，不调整核心参数。" : "按胜率、盈亏比和回撤重新评估阈值。",
  };
}

function buildNotificationPlan(payloadLike) {
  return {
    discord: {
      enabled: false,
      status: "未配置",
      delivery: "不会发送任何外部消息，配置 webhook 并获得确认后才会启用。",
      eventTypes: ["模拟买入", "模拟止盈", "模拟止损", "盘后复盘", "每日学习点"],
    },
    pendingAlerts: [
      ...(payloadLike.candidates || [])
        .filter((item) => ["PAPER_BUY", "FOCUS"].includes(item.actionCode))
        .slice(0, 5)
        .map((item) => ({
          type: item.action,
          title: `${item.name} ${item.code}`,
          body: `${item.boardName}，评分${item.score}，${item.reason}`,
        })),
    ],
  };
}

async function writeDashboard(payload) {
  await fs.writeFile(path.join(dataDir, "dashboard.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function writeReport(payload) {
  await fs.mkdir(reportDir, { recursive: true });
  const lines = [];
  lines.push(`# A股赚钱效应自动复盘：${today}`);
  lines.push("");
  lines.push("说明：本报告用于学习和模拟交易，不构成投资建议。");
  lines.push("");
  lines.push("## 市场状态");
  lines.push(`- ${payload.marketRegime.summary}`);
  lines.push(`- 清算净值：${money(payload.portfolio.netLiquidation)}，收益率${signed(payload.portfolio.returnPct)}%，累计费用${money(payload.portfolio.totalFees)}。`);
  lines.push("");
  lines.push("## 市场温度");
  for (const index of payload.indexes) {
    lines.push(`- ${index.name}：${index.price.toFixed(2)}，${signed(index.change)}，${signed(index.pct)}%`);
  }
  lines.push("");
  lines.push("## 热门板块");
  for (const board of payload.hotBoards.slice(0, 5)) {
    lines.push(`- ${board.name}：${signed(board.pct)}%，成交额${money(board.amount)}，评分${board.score}，来源${board.source}`);
  }
  if (!payload.hotBoards.length) {
    lines.push("- 真实行业板块数据源暂时不可用，本次不生成热门板块结论。");
  }
  lines.push("");
  lines.push("## 今日候选");
  for (const stock of payload.candidates.slice(0, 10)) {
    lines.push(`- ${stock.name} ${stock.code}：${stock.action}，评分${stock.score}，${stock.reason}`);
  }
  lines.push("");
  lines.push("## 模拟持仓复盘");
  if (!payload.paperDecisions.length) {
    lines.push("- 暂无模拟持仓。");
  } else {
    for (const item of payload.paperDecisions) {
      lines.push(
        `- ${item.name} ${item.code}：${item.decision}，入场${item.entryPrice.toFixed(2)}，最新${item.latestPrice.toFixed(2)}，模拟收益${signed(item.pnlPct)}%`,
      );
    }
  }
  lines.push("");
  lines.push("## 自动调研重点");
  for (const item of payload.researchItems.slice(0, 6)) {
    lines.push(`- ${item.name} ${item.code}：${item.researchStatus}；业务：${item.business}`);
  }
  lines.push("");
  lines.push("## 策略学习");
  lines.push(`- 已关闭样本：${payload.strategyReview.sampleCount}，胜率${signed(payload.strategyReview.winRate)}%，平均收益${signed(payload.strategyReview.avgReturn)}%。`);
  for (const lesson of payload.strategyReview.lessons) {
    lines.push(`- ${lesson}`);
  }
  lines.push("");
  lines.push("## 明日问题");
  lines.push("1. 热门板块是否继续强，还是一日游？");
  lines.push("2. 模拟买入信号是否来自板块共振，而不是单只票孤立上涨？");
  lines.push("3. 如果出现亏损，失效条件是否触发？");
  await fs.writeFile(path.join(reportDir, `${today}.md`), `${lines.join("\n")}\n`, "utf8");
}

async function main() {
  await fs.mkdir(dataDir, { recursive: true });
  const config = await readTradingConfig();
  const state = ensureState(await readState(), config);
  const warnings = [];
  const indexRows = await getQuotes(indexes.map((item) => item.secid).join(","));
  const marketDataFresh = indexRows.some((row) => num(row.f297) === compactDate(today));
  const effectivePaperTradingEnabled = paperTradingEnabled && marketDataFresh;
  if (paperTradingEnabled && !marketDataFresh) {
    warnings.push("行情日期不是今天，已禁止本轮纸面买卖，避免使用旧行情。");
  }
  const boards = await getBoards(1, 30, warnings).catch((error) => {
    warnings.push(`全部真实行业板块数据源失败：${error.message}`);
    return [];
  });
  const weakBoards = await getBoards(0, 10, warnings).catch(() => []);

  const hotBoards = boards.slice(0, 8).map((row) => ({
    code: row.f12,
    name: row.f14,
    pct: num(row.f3),
    price: num(row.f2),
    amount: num(row.f6),
    mainNet: hasNumber(row.f62) ? num(row.f62) : null,
    score: scoreBoard(row),
    source: row.provider || "行情接口",
    leader: row.leader || null,
  }));

  const stockGroups = [];
  for (const board of boards.slice(0, 6)) {
    const leader = getSinaLeaderStock(board);
    if (leader) {
      stockGroups.push(scoreStock(leader, board, learningBiasFor(state, board.f14), config));
      continue;
    }
    try {
      const rows = await getBoardStocks(board.f12, 12);
      stockGroups.push(...rows.map((stock) => scoreStock(stock, board, learningBiasFor(state, board.f14), config)));
    } catch {
      // Ignore a single board failure; the dashboard should still be usable.
    }
  }

  const universeQuotes = await getQuotes(coreUniverse.map((item) => secidFromCode(item.code)).join(",")).catch(() => []);
  const universeConfig = new Map(coreUniverse.map((item) => [item.code, item]));
  for (const quote of universeQuotes) {
    const stockConfig = universeConfig.get(String(quote.f12));
    if (!stockConfig) continue;
    const board = boardForUniverseStock(stockConfig, hotBoards);
    stockGroups.push(scoreStock(quote, board, learningBiasFor(state, board.f14), config));
  }

  const unique = new Map();
  for (const stock of stockGroups) {
    if (!unique.has(stock.code) || unique.get(stock.code).score < stock.score) {
      unique.set(stock.code, stock);
    }
  }
  const candidates = [...unique.values()]
    .filter((item) => item.actionCode !== "AVOID")
    .sort((a, b) => b.score - a.score)
    .slice(0, 30);

  const paperDecisions = await updatePaperBook(state, candidates, config, effectivePaperTradingEnabled);
  await writeState(state);
  const openPositions = state.positions.filter((p) => p.status === "OPEN");
  const marketValue = openPositions.reduce((sum, position) => sum + (position.latestPrice || position.entryPrice || 0) * (position.shares || 0), 0);
  const estimatedExitValue = openPositions.reduce((sum, position) => {
    const price = sellFillPrice(position.latestPrice || position.entryPrice || 0, config);
    const fees = calcSellFees(price, position.shares || 0, config);
    return sum + price * (position.shares || 0) - fees.total;
  }, 0);
  const unrealizedPnl = openPositions.reduce((sum, position) => sum + (position.unrealizedPnl || 0), 0);
  const equity = state.portfolio.cash + marketValue;
  const netLiquidation = state.portfolio.cash + estimatedExitValue;
  const portfolioSummary = {
    initialCash: state.portfolio.initialCash,
    cash: state.portfolio.cash,
    marketValue,
    equity,
    netLiquidation,
    realizedPnl: state.portfolio.realizedPnl,
    unrealizedPnl,
    totalFees: state.portfolio.totalFees,
    returnPct: state.portfolio.initialCash ? ((netLiquidation - state.portfolio.initialCash) / state.portfolio.initialCash) * 100 : 0,
  };
  const researchItems = await buildResearchItems(candidates);
  const marketRegime = buildMarketRegime(indexRows, hotBoards, candidates);
  const strategyReview = buildStrategyReview(state, candidates, hotBoards, portfolioSummary);

  const payload = {
    date: today,
    generatedAt: new Date().toISOString(),
    disclaimer: "学习与模拟交易工具，不构成投资建议，不自动下单。",
    paperTradingEnabled: effectivePaperTradingEnabled,
    warnings,
    marketRegime,
    feeConfig: {
      commissionRate: config.commissionRate,
      minCommission: config.minCommission,
      transferFeeRate: config.transferFeeRate,
      stampDutyRate: config.stampDutyRate,
      slippageRate: config.slippageRate,
    },
    indexes: indexRows.map((row) => ({
      code: row.f12,
      name: row.f14,
      price: num(row.f2),
      change: num(row.f4),
      pct: num(row.f3),
      amount: num(row.f6),
      tradeDate: row.f297 || null,
      source: row.provider || "行情接口",
    })),
    hotBoards,
    weakBoards: weakBoards.slice(0, 5).map((row) => ({
      code: row.f12,
      name: row.f14,
      pct: num(row.f3),
      amount: num(row.f6),
    })),
    candidates,
    researchItems,
    portfolio: portfolioSummary,
    paperPositions: openPositions,
    paperDecisions,
    tradeLog: state.tradeLog.slice(-50),
    strategyReview,
    learning: state.learning,
  };
  payload.notifications = buildNotificationPlan(payload);

  await writeDashboard(payload);
  await writeReport(payload);
  console.log(`Generated A-share research dashboard for ${today}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
