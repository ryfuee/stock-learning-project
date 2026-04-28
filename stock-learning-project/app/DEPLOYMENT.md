# 火山引擎服务器部署

目标：GitHub 托管代码，火山引擎服务器常驻运行 Web 平台和实时纸面交易。

## 推荐架构

- GitHub：代码、CI、每日收盘复盘短任务。
- 火山引擎 ECS：常驻 Web 服务和 `live-paper-trader`。
- Docker Compose：启动两个容器。
  - `web`：投研平台页面和 API。
  - `trader`：实时纸面交易循环。

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

```bash
docker compose up -d --build
```

检查：

```bash
docker compose ps
docker compose logs -f trader
```

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
- 如果页面暴露公网，建议加 Basic Auth 或登录保护。
