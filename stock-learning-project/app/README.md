# A股学习投研台

一个本地运行的学习应用，用来自动观察 A股赚钱效应、热门板块、候选股、模拟买卖信号和每日复盘。

## 功能

- 自动抓取三大指数。
- 自动识别当日强弱行业板块。
- 从热门板块里筛选代表个股。
- 生成透明的评分和模拟买入/观察信号。
- 维护模拟持仓，不连接真实账户。
- 生成每日复盘 Markdown。

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

## 实时纸面交易

```bash
cd stock-learning-project/app
node scripts/live-paper-trader.mjs
```

实时脚本会在 A股交易时间内按 `trading-config.json` 的间隔刷新行情并执行模拟买卖；盘外只刷新数据，不开新仓、不平仓。

默认费用：

- 佣金：0.03%，最低 5 元，买卖双边收取。
- 过户费：0.001%，买卖双边收取。
- 印花税：0.05%，仅卖出收取。
- 滑点：0.02%，买入略高、卖出略低。

这些参数都在 `trading-config.json` 里可调整。

## 边界

本应用只用于学习和模拟交易，不构成投资建议，不自动下真实订单。

## 数据源策略

- 优先使用东方财富实时行情接口。
- 行业板块榜接口失败时，自动切换到新浪财经行业板块实时接口。
- 所有数据都来自真实公开行情源；如果真实数据源都不可用，应用会显示失败或降级提示，不会生成 mock 数据。

## Discord 提醒

`notification-config.example.json` 提供了配置结构。默认不发送任何外部消息，只在页面里预览提醒队列。

启用真实 Discord webhook 前，需要明确确认，因为这会把本地生成的交易提醒和复盘内容发送到第三方服务。

## GitHub Actions

项目包含两个工作流：

- `CI`：语法检查和 Docker build。
- `Daily A-share Review`：工作日收盘后生成一次复盘。

盘中实时模拟交易请部署在服务器上，不建议放在 GitHub Actions 常驻运行。
