# A股学习投研台

一个本地运行的学习应用，用来自动观察 A股赚钱效应、热门板块、候选股、模拟买卖信号和每日复盘。

## 功能

- 自动抓取三大指数。
- 自动识别当日强弱行业板块。
- 从热门板块里筛选代表个股。
- 生成透明的评分和模拟买入/观察信号。
- 可选接入 OpenAI-compatible 大模型，参与候选股调分、买入确认和风险否决。
- 维护模拟持仓，不连接真实账户。
- 生成每日复盘 Markdown。
- 内置 SQLite 登录、Session Cookie 和模拟账户骨架，适合部署到个人服务器。

## 运行

本地直接运行：

```bash
cd stock-learning-project/app
node scripts/generate-research.mjs
node server/server.mjs
```

打开：

```text
http://localhost:4173
```

Docker 运行：

```bash
cd stock-learning-project/app
docker compose up -d --build
```

服务器部署见 [DEPLOYMENT.md](./DEPLOYMENT.md)。

## 登录和账号

首次打开页面时，如果数据库里还没有用户，系统会引导你创建管理员账号。密码会以 PBKDF2 哈希写入本地 SQLite 数据库，不会明文保存。

SQLite 数据库默认写入 `A_SHARE_RUNTIME_DIR/a-share-platform.sqlite`；Docker Compose 已配置到共享的 `./data` 卷。你也可以通过环境变量预置管理员账号：

```bash
A_SHARE_ADMIN_USER=admin
A_SHARE_ADMIN_PASSWORD=请换成强密码
A_SHARE_SESSION_DAYS=14
```

页面顶部可以创建和切换模拟账户。每个模拟账户都会有独立运行目录：

```text
A_SHARE_RUNTIME_DIR/accounts/<runtimeKey>/
  trading-config.json
  llm-secrets.json
  notification-config.json
  data/dashboard.json
  data/state.json
  data/live-status.json
  data/strategy-optimizer.json
```

首次创建管理员后，系统会把旧的全局配置和运行数据复制到第一个「主模拟账户」下；旧文件保留作备份，不会直接删除。

## 实时纸面交易

```bash
cd stock-learning-project/app
node scripts/live-paper-trader.mjs
```

实时脚本会在 A股交易时间内按 `trading-config.json` 的间隔刷新行情并执行模拟买卖；盘外只刷新数据，不开新仓、不平仓。

盘外调度也会自动做慢任务：

- 08:45-09:20：盘前自动调研，刷新候选、公告、事件和模型观点。
- 12:05-12:45：午间调研，不交易，只更新上下文。
- 15:05-16:20：盘后复盘，生成日报并运行策略优化建议。
- 20:00-22:30：晚间策略学习，汇总样本、风险和参数建议。
- 周末 10:00-11:30：周度复盘和策略学习。

策略优化脚本会生成 `data/strategy-optimizer.json` 和 `02-market-notes/strategy-optimizer/YYYY-MM-DD.md`。它会同时读取纸面交易样本和最近一次 `data/backtest-report.json`，把回测收益、超额收益、胜率、盈亏因子、最大回撤纳入参数建议。默认只给建议，不自动大幅改参数；动态止盈止损和板块学习会在有边界的范围内自动生效。

Docker 部署时，`A_SHARE_RUNTIME_DIR=/app/data` 会让 Web 页面保存的账号配置和 trader 调度进程读取同一套账号目录；裸机本地运行时默认使用 app 目录作为运行根目录。

手动运行一次策略优化：

```bash
node scripts/strategy-optimizer.mjs
```

如果确认只在模拟盘内应用有界建议，可以显式运行：

```bash
node scripts/strategy-optimizer.mjs --apply-bounded
```

## 投研决策 Agent

页面的「决策Agent」会调用 `scripts/research-decision-agent.mjs`，读取当前账号下的行情仪表盘、持仓、模型审查、事件搜索、历史回测和策略优化结果，生成 `data/decision-agent.json`：

```bash
node scripts/research-decision-agent.mjs
```

Agent 输出的是“观察 -> 诊断 -> 决策姿态 -> 自适应策略 -> 研究队列 -> 执行计划”。它不会直接实盘下单，只会影响纸面交易建议和后续参数复核。调度进程会在盘中刷新、盘前/午间/盘后/晚间任务后自动重跑 Agent，让策略姿态随市场和回测反馈变化。

默认费用：

- 佣金：0.03%，最低 5 元，买卖双边收取。
- 过户费：0.001%，买卖双边收取。
- 印花税：0.05%，仅卖出收取。
- 滑点：0.02%，买入略高、卖出略低。

这些参数都在 `trading-config.json` 里可调整。

风控闸门默认开启，用来提升纸面交易质量：

- 账户回撤超过阈值时暂停新开仓。
- 连续亏损达到阈值时暂停新开仓。
- 同一板块预计仓位超过上限时拦截买入。
- 涨幅超过追高阈值或成交额不足时降级为观察。
- 持仓超过设定天数且收益没有兑现时触发时间止损。

每笔模拟买卖会记录策略版本、入场归因、风险标签和退出触发，方便盘后复盘到底是选股、追高、板块拥挤还是退出纪律的问题。

## 历史回测

页面的「历史回测」会调用 `scripts/backtest-replay.mjs`，通过 Baostock 或 AKShare 抓取真实历史日线，然后按“收盘产生信号、下一交易日开盘成交”回放策略：

```bash
node scripts/backtest-replay.mjs --start=2025-01-01 --end=2026-04-29 --maxSymbols=12
```

回测会写入当前模拟账户目录下的 `data/backtest-report.json`，并生成 Markdown 到 `02-market-notes/backtests/` 或账号专属目录。当前回测只使用真实价格/成交额数据，不会模拟历史新闻、公告或舆情。页面点击「运行回测」后会自动重跑策略优化器，策略页会展示“回测证据”和建议的买入阈值、止损止盈、追高上限。

## 参数寻优

页面的「历史回测」里有「参数寻优」模块，会调用 `scripts/parameter-sweep.mjs`。它会批量测试多组买入阈值、止损、止盈、追高上限和时间止损，并在全区间、近一年、近半年等窗口里对比稳定性：

```bash
node scripts/parameter-sweep.mjs --start=2025-01-01 --end=2026-04-29 --maxSymbols=12 --topN=12
```

寻优会写入当前模拟账户目录下的 `data/parameter-sweep.json`，并生成 Markdown 到 `02-market-notes/parameter-sweep/` 或账号专属目录。排序分数偏向多窗口稳定性，不按单段最高收益排序；交易次数过少会被惩罚，避免“没怎么交易所以回撤很低”的假稳健。

## 大模型决策层

配置中心可以开启大模型参与决策。模型会审查候选股并输出 `BUY/HOLD/AVOID`、信心、调分、理由和风险。系统会把模型结果限制在可配置的调分范围内，并可要求“规则信号 + 模型确认”同时成立才允许纸面买入。

模型审查会读取事件上下文：

- 东方财富财经新闻流。
- 东方财富/巨潮资讯公司公告。
- 东方财富 F10 公司概况。
- 可选增强数据源：AKShare、Baostock、Tushare，用于补充主营业务、ROE、毛利率、净利率、营收同比、净利润同比等财务字段。
- 可选事件搜索源：Bocha、Tavily、SerpAPI、Anspire，用于补充公司实时新闻、舆情热度和重大事件线索。

数据源失败时只记录 warning，不生成虚假新闻或公告。

API Key 可以在配置页直接填写，也可以从服务器环境变量读取。页面保存的 Key 会写入本机 `llm-secrets.json`，该文件已被 Git 忽略，页面不会回显完整 Key：

```bash
LLM_API_KEY=
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=
```

OpenAI、Kimi、GLM、火山方舟等 OpenAI-compatible 服务可走 `openai-compatible`；Z.AI/GLM 可选择 `z-ai-chat`；Claude 建议选择 `anthropic-messages` 并配置 `ANTHROPIC_API_KEY`。

不要把真实 API Key 写入仓库。如果使用页面保存密钥，也不要提交 `llm-secrets.json`。

## 边界

本应用只用于学习和模拟交易，不构成投资建议，不自动下真实订单。

## 数据源策略

- 优先使用东方财富实时行情接口。
- 行业板块榜接口失败时，自动切换到新浪财经行业板块实时接口。
- 财务和主营业务增强默认优先使用 AKShare；Baostock 作为无 Key 平替；Tushare 只在配置页开启并填入 Token 后使用。
- 实时事件搜索默认关闭；在配置页填入 Bocha/Tavily/SerpAPI/Anspire 的 Key 后才会调用对应 API。没有 Key 时只显示未配置，不生成模拟舆情。
- 所有数据都来自真实公开行情源；如果真实数据源都不可用，应用会显示失败或降级提示，不会生成 mock 数据。

事件搜索可通过页面保存 Key，也可以用服务器环境变量：

```bash
BOCHA_API_KEY=
TAVILY_API_KEY=
SERPAPI_API_KEY=
ANSPIRE_API_KEY=
```

Docker 镜像会安装 `requirements-data.txt` 中的 Python 数据源包；本地裸机运行时可自行安装：

```bash
python3 -m pip install akshare baostock tushare
```

## Discord 提醒

`notification-config.example.json` 提供了配置结构。默认不发送任何外部消息，只在页面里预览提醒队列。

启用真实 Discord webhook 前，需要明确确认，因为这会把本地生成的交易提醒和复盘内容发送到第三方服务。

## GitHub Actions

项目包含两个工作流：

- `CI`：语法检查和 Docker build。
- `Daily A-share Review`：工作日收盘后生成一次复盘。

盘中实时模拟交易请部署在服务器上，不建议放在 GitHub Actions 常驻运行。
