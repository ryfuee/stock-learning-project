# 火山引擎服务器部署

目标：GitHub 托管代码，火山引擎服务器常驻运行 Web 平台和实时纸面交易。

## 推荐架构

- GitHub：代码、CI、每日收盘复盘短任务。
- 火山引擎 ECS：常驻 Web 服务和 `live-paper-trader`。
- Docker Compose：启动两个容器。
  - `web`：投研平台页面和 API。
  - `trader`：盘中纸面交易循环 + 盘外自动投研/策略优化调度。

## 1. 服务器准备

以 Ubuntu/Debian 为例：

```bash
sudo apt update
sudo apt install -y git ca-certificates curl
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
```

重新登录一次，让 docker 用户组生效。

## 2. 拉取项目

```bash
sudo mkdir -p /opt/a-share-research
sudo chown -R $USER:$USER /opt/a-share-research
cd /opt/a-share-research
git clone <YOUR_GITHUB_REPO_URL> .
cd stock-learning-project/app
```

如果你的仓库根目录就是 `stock-learning-project`，路径按实际调整。

## 3. 启动

如需让大模型参与纸面交易决策，先在服务器创建 `.env`：

```bash
cp .env.example .env
vim .env
```

填写：

```text
A_SHARE_ADMIN_USER=admin
A_SHARE_ADMIN_PASSWORD=<首次管理员强密码；也可以留空，在页面初始化>
A_SHARE_SESSION_DAYS=14
LLM_API_KEY=<你的大模型 API Key>
LLM_BASE_URL=<OpenAI-compatible endpoint，例如 https://api.openai.com/v1>
LLM_MODEL=<模型名或火山方舟 endpoint/model id>
PYTHON_BIN=python3
TUSHARE_TOKEN=<可选；不用 Tushare 就留空>
BOCHA_API_KEY=<可选；中文事件搜索>
TAVILY_API_KEY=<可选；AI 搜索>
SERPAPI_API_KEY=<可选；Google News>
ANSPIRE_API_KEY=<可选；中文搜索>
```

登录数据库会写到共享运行目录的 `a-share-platform.sqlite`。Docker Compose 默认使用 `A_SHARE_RUNTIME_DIR=/app/data`，所以重启容器不会丢失管理员账号、Session、模拟账户表和各账户运行目录。

也可以在配置页直接保存 API Key；它会写入服务器本机 `llm-secrets.json`，不会回显完整 Key，也不应提交到 GitHub。生产部署更推荐用环境变量。

也可以使用 provider-specific key，例如 `ZAI_API_KEY`、`ANTHROPIC_API_KEY`、`MOONSHOT_API_KEY`、`ZHIPUAI_API_KEY`、`ARK_API_KEY`。页面配置里选择：

- `OpenAI-compatible`：OpenAI、Kimi、GLM、火山方舟兼容接口。
- `OpenAI Responses`：OpenAI Responses API。
- `Z.AI / GLM`：Z.AI Chat Completions，默认 Base URL `https://api.z.ai/api/coding/paas/v4`。
- `Claude Messages`：Anthropic Claude 原生 Messages API。

API Key 只放在服务器环境变量里，不要提交到 GitHub。

增强财务数据默认使用 AKShare 和 Baostock，它们不需要 API Key。Tushare 是可选补充源：在配置页打开 Tushare 并填入 Token，或在 `.env` 里配置 `TUSHARE_TOKEN`。Docker 镜像会自动安装 `akshare`、`baostock`、`tushare`；裸机部署时需要手动执行：

```bash
python3 -m pip install akshare baostock tushare
```

事件搜索默认关闭。开启后会按候选股把查询词、API Key 发送给你启用的搜索服务；建议先只开 Bocha 或 Tavily，并保留 6 小时缓存，避免把免费额度很快用完。

```bash
docker compose up -d --build
```

检查：

```bash
docker compose ps
docker compose logs -f trader
```

`trader` 容器内置调度：

- 盘中每 `pollSeconds` 秒执行一次纸面买卖检查。
- 08:45 盘前调研。
- 12:05 午间调研。
- 15:05 盘后复盘和策略优化。
- 20:00 晚间策略学习。
- 周末 10:00 周度复盘。

策略优化结果会写入 `app/data/strategy-optimizer.json` 和 `02-market-notes/strategy-optimizer/`。优化器会读取最近一次真实历史回测 `backtest-report.json`，把回测收益、超额收益、胜率、盈亏因子和最大回撤纳入下一轮买入阈值、止盈止损、追高上限建议。默认只生成建议，不自动改配置；如需允许有界自动应用，可在服务器环境变量中显式设置 `A_SHARE_AUTO_APPLY_OPTIMIZER=1`，或在页面点击「应用有界建议」。

投研决策 Agent 会写入 `app/data/decision-agent.json` 和 `02-market-notes/decision-agent/`。它会在盘中轮询、盘前、午间、盘后、晚间策略学习后自动运行，综合行情、候选股、大模型审查、事件搜索、持仓、回测和优化器结果，输出当前策略姿态、风险预算、自适应参数建议和研究队列。Agent 只用于投研和模拟盘，不会直接执行实盘交易。

参数寻优结果会写入 `app/data/parameter-sweep.json` 和 `02-market-notes/parameter-sweep/`。它会用真实历史日线批量测试多组买入阈值、止损、止盈、追高上限和时间止损，并按多窗口稳定性排序。这个任务可能比单次回测更耗时，建议盘后或晚间手动运行。

Docker Compose 已设置 `A_SHARE_RUNTIME_DIR=/app/data`，所以页面保存的 `trading-config.json`、`llm-secrets.json`、通知配置、持仓状态和策略学习结果会落在共享的 `./data/accounts/<runtimeKey>/` 目录里，`web` 和 `trader` 两个容器都会按模拟账户读取。裸机部署时不设置该变量也可以，默认在 app 目录下创建账号运行目录。

访问：

```text
http://<你的服务器公网IP>:4173
```

请在火山引擎安全组放行 TCP `4173`。更推荐后续加 Nginx + HTTPS + 访问密码。

## 4. systemd 保活

复制服务文件：

```bash
sudo cp deploy/a-share-research.service /etc/systemd/system/a-share-research.service
sudo systemctl daemon-reload
sudo systemctl enable a-share-research
sudo systemctl start a-share-research
sudo systemctl status a-share-research
```

## 5. 更新部署

```bash
cd /opt/a-share-research/stock-learning-project/app
git pull
docker compose up -d --build
```

## 6. 数据持久化

以下路径会保留运行状态：

- `app/data/state.json`：纸面账户、持仓、交易流水。
- `app/data/dashboard.json`：当前仪表盘数据。
- `app/data/live-status.json`：实时循环状态。
- `02-market-notes/daily-research/`：每日复盘报告。

不要把真实运行状态或 webhook 提交到公开仓库。

## 7. GitHub Actions 的角色

GitHub Actions 适合：

- 语法检查。
- Docker build 检查。
- 每日收盘后生成一次复盘。

GitHub Actions 不适合：

- 盘中实时模拟交易。
- 长期守护进程。
- 秒级/分钟级稳定提醒。

盘中实时模拟交易请放在服务器上跑。

## 8. 安全建议

- 不要在仓库提交 Discord webhook、SSH key、服务器密码。
- 服务器安全组只放行必要端口。
- 后续建议使用 Nginx 反代并开启 HTTPS。
- 页面现在已有本地登录保护；公网部署仍建议加 Nginx + HTTPS。启用 HTTPS 后可设置 `A_SHARE_COOKIE_SECURE=1`。
