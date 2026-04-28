const els = {
  refreshBtn: document.querySelector("#refreshBtn"),
  statusStrip: document.querySelector("#statusStrip"),
  dateBadge: document.querySelector("#dateBadge"),
  sourceSummary: document.querySelector("#sourceSummary"),
  marketRegime: document.querySelector("#marketRegime"),
  portfolioCards: document.querySelector("#portfolioCards"),
  indexGrid: document.querySelector("#indexGrid"),
  systemActions: document.querySelector("#systemActions"),
  hotBoards: document.querySelector("#hotBoards"),
  researchGrid: document.querySelector("#researchGrid"),
  candidateRows: document.querySelector("#candidateRows"),
  positions: document.querySelector("#positions"),
  tradeRows: document.querySelector("#tradeRows"),
  dailyReview: document.querySelector("#dailyReview"),
  strategyReview: document.querySelector("#strategyReview"),
  learning: document.querySelector("#learning"),
  notificationList: document.querySelector("#notificationList"),
  settingsList: document.querySelector("#settingsList"),
};

function signed(value, digits = 2) {
  const n = Number(value || 0);
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}`;
}

function money(value) {
  if (value === null || value === undefined || value === "" || Number.isNaN(Number(value))) {
    return "无数据";
  }
  const n = Number(value || 0);
  if (Math.abs(n) >= 1e8) return `${(n / 1e8).toFixed(2)}亿`;
  if (Math.abs(n) >= 1e4) return `${(n / 1e4).toFixed(2)}万`;
  return `${n.toFixed(2)}`;
}

function trendClass(value) {
  return Number(value) >= 0 ? "up" : "down";
}

function actionTag(item) {
  if (item.actionCode === "PAPER_BUY") return "tag tag-buy";
  if (item.actionCode === "FOCUS") return "tag tag-focus";
  if (item.actionCode === "AVOID") return "tag tag-risk";
  return "tag tag-watch";
}

function pill(text, tone = "") {
  return `<span class="pill ${tone}">${text}</span>`;
}

function list(items) {
  return items?.length ? `<ul>${items.map((item) => `<li>${item}</li>`).join("")}</ul>` : "<span>暂无</span>";
}

async function loadDashboard() {
  const res = await fetch("/api/dashboard");
  if (!res.ok) throw new Error("暂无仪表盘数据，请先刷新生成。");
  return res.json();
}

async function loadLiveStatus() {
  const res = await fetch("/api/live-status");
  if (!res.ok) return null;
  return res.json();
}

function renderStatus(data, liveStatus) {
  const status = [
    pill(`生成 ${new Date(data.generatedAt).toLocaleString()}`),
    pill(`纸面交易 ${data.paperTradingEnabled ? "本轮已执行" : "仅刷新"}`, data.paperTradingEnabled ? "good" : ""),
    pill(`模拟持仓 ${data.paperPositions.length} 个`),
    liveStatus
      ? pill(`实时模拟 ${liveStatus.mode === "PAPER_TRADE" ? "交易中" : "等待交易时段"} · ${new Date(liveStatus.finishedAt).toLocaleTimeString()}`)
      : "",
    ...(data.warnings || []).map((warning) => pill(warning, "warn")),
  ];
  els.statusStrip.innerHTML = status.join("");
}

function renderPortfolio(data) {
  const p = data.portfolio || {};
  const cards = [
    ["清算净值", money(p.netLiquidation || p.equity), `${signed(p.returnPct)}%`, p.returnPct >= 0 ? "up" : "down"],
    ["现金", money(p.cash), "可用于新开模拟仓", ""],
    ["持仓市值", money(p.marketValue), `${data.paperPositions.length} 个持仓`, ""],
    ["累计费用", money(p.totalFees), "佣金/过户费/印花税/滑点", "warn-text"],
  ];
  els.portfolioCards.innerHTML = cards
    .map(
      ([label, value, sub, cls]) => `
        <article class="kpi-card">
          <span>${label}</span>
          <strong class="${cls}">${value}</strong>
          <small>${sub}</small>
        </article>
      `,
    )
    .join("");
}

function renderIndexes(data) {
  els.indexGrid.innerHTML = data.indexes
    .map(
      (item) => `
        <div class="metric">
          <span>${item.name}</span>
          <strong>${item.price.toFixed(2)}</strong>
          <small class="${trendClass(item.pct)}">${signed(item.change)} / ${signed(item.pct)}%</small>
        </div>
      `,
    )
    .join("");
}

function renderActions(data) {
  const actions = data.paperDecisions?.length ? data.paperDecisions : [];
  els.systemActions.innerHTML = actions.length
    ? actions
        .slice(-6)
        .map(
          (item) => `
            <div class="action-row">
              <div>
                <strong>${item.name} ${item.code}</strong>
                <small>${item.decision} · ${item.shares || 0}股 · 浮动${signed(item.pnlPct || 0)}%</small>
              </div>
              <span class="mini-score">${item.decisionCode}</span>
            </div>
          `,
        )
        .join("")
    : `<div class="empty">本轮没有新的纸面交易动作。</div>`;
}

function renderSectors(data) {
  els.hotBoards.innerHTML = data.hotBoards.length
    ? data.hotBoards
        .slice(0, 12)
        .map(
          (item, index) => `
            <article class="sector-card">
              <div class="rank">${String(index + 1).padStart(2, "0")}</div>
              <div>
                <strong>${item.name}</strong>
                <small>${item.source || "行情接口"}</small>
              </div>
              <div class="sector-stats">
                <span class="${trendClass(item.pct)}">${signed(item.pct)}%</span>
                <span>${money(item.amount)}</span>
                <span>评分 ${item.score}</span>
              </div>
              ${item.leader ? `<p>领涨：${item.leader.name} ${signed(item.leader.pct)}%</p>` : ""}
            </article>
          `,
        )
        .join("")
    : `<div class="empty">真实板块数据源暂时不可用，本轮不生成热门板块。</div>`;
}

function renderResearch(data) {
  els.researchGrid.innerHTML = (data.researchItems || [])
    .slice(0, 12)
    .map(
      (item) => `
        <article class="research-card">
          <div class="research-head">
            <div>
              <strong>${item.name} ${item.code}</strong>
              <small>${item.boardName} · ${item.researchStatus} · ${item.researchSource || item.source}</small>
            </div>
            <span class="score">${item.researchScore}</span>
          </div>
          <p>${item.business}</p>
          <dl>
            <dt>客户</dt>
            <dd>${item.customers}</dd>
            <dt>赚钱驱动</dt>
            <dd>${item.profitDrivers.slice(0, 4).join(" / ")}</dd>
            <dt>主要风险</dt>
            <dd>${item.riskDrivers.slice(0, 4).join(" / ")}</dd>
          </dl>
          <div class="question-box">${item.openQuestions.map((q) => `<span>${q}</span>`).join("")}</div>
        </article>
      `,
    )
    .join("");
}

function renderCandidates(data) {
  els.candidateRows.innerHTML = data.candidates
    .slice(0, 24)
    .map(
      (item) => `
        <tr>
          <td><strong>${item.name}</strong><br /><small>${item.code}</small></td>
          <td>${item.boardName}</td>
          <td class="${trendClass(item.pct)}">${signed(item.pct)}%</td>
          <td>${money(item.amount)}</td>
          <td><span class="score">${item.score}</span></td>
          <td><span class="${actionTag(item)}">${item.action}</span></td>
          <td>
            ${item.reason}
            <br /><small>来源：${item.source || "行情接口"}</small>
            ${item.riskTags?.length ? `<br /><small>风险：${item.riskTags.join("、")}</small>` : ""}
          </td>
        </tr>
      `,
    )
    .join("");
}

function renderPositions(data) {
  els.positions.innerHTML = data.paperPositions.length
    ? data.paperPositions
        .map(
          (item) => `
            <div class="position-item">
              <div>
                <strong>${item.name} ${item.code}</strong>
                <small>${item.boardName} · ${item.shares || 0}股 · 成本 ${Number(item.costBasis || item.entryPrice || 0).toFixed(2)}</small>
              </div>
              <div class="position-pnl ${trendClass(item.unrealizedPnlPct || 0)}">
                ${signed(item.unrealizedPnlPct || 0)}%
                <small>${money(item.unrealizedPnl || 0)}</small>
              </div>
            </div>
          `,
        )
        .join("")
    : `<div class="empty">暂无模拟持仓。</div>`;
}

function renderTrades(data) {
  els.tradeRows.innerHTML = data.tradeLog?.length
    ? data.tradeLog
        .slice()
        .reverse()
        .slice(0, 12)
        .map(
          (item) => `
            <tr>
              <td>${item.date}</td>
              <td><span class="tag ${item.side === "BUY" ? "tag-buy" : "tag-watch"}">${item.side}</span></td>
              <td>${item.name}<br /><small>${item.code}</small></td>
              <td>${item.shares}</td>
              <td>${Number(item.price || 0).toFixed(2)}</td>
              <td>${money(item.fees?.total)}</td>
            </tr>
          `,
        )
        .join("")
    : `<tr><td colspan="6">暂无交易流水</td></tr>`;
}

function renderReview(data) {
  const regime = data.marketRegime || {};
  const reviewCards = [
    ["市场状态", regime.summary || "暂无", [`评分 ${regime.score || 0}`, `强势板块 ${regime.strongBoards || 0}`]],
    ["今日热点", data.hotBoards.slice(0, 4).map((item) => `${item.name} ${signed(item.pct)}%`).join(" / ") || "暂无", ["验证持续性", "避免一日游"]],
    ["交易动作", data.paperDecisions.slice(-4).map((item) => `${item.name}：${item.decision}`).join(" / ") || "暂无新动作", ["检查T+1", "检查费用"]],
    ["明日问题", "热点是否延续？候选是否来自板块共振？止损条件是否触发？", ["盘后复盘", "样本积累"]],
  ];
  els.dailyReview.innerHTML = reviewCards
    .map(
      ([title, body, tags]) => `
        <article class="review-card">
          <strong>${title}</strong>
          <p>${body}</p>
          <div>${tags.map((tag) => `<span class="mini-tag">${tag}</span>`).join("")}</div>
        </article>
      `,
    )
    .join("");
}

function renderStrategy(data) {
  const s = data.strategyReview || {};
  els.strategyReview.innerHTML = `
    <div class="strategy-grid">
      <div><span>样本</span><strong>${s.sampleCount || 0}</strong></div>
      <div><span>胜率</span><strong>${signed(s.winRate || 0)}%</strong></div>
      <div><span>平均收益</span><strong>${signed(s.avgReturn || 0)}%</strong></div>
    </div>
    <div class="note-block">
      <strong>下一步</strong>
      <p>${s.nextOptimization || "继续积累样本。"}</p>
      ${list(s.lessons || [])}
    </div>
  `;

  const learningItems = Object.entries(data.learning || {});
  els.learning.innerHTML = learningItems.length
    ? learningItems
        .map(
          ([name, item]) => `
            <div class="learning-item">
              <div>
                <strong>${name}</strong>
                <small>样本 ${item.count} · 胜 ${item.wins} · 负 ${item.losses} · 平均 ${signed(item.avgReturn)}%</small>
              </div>
              <span class="mini-score">${signed(item.bias, 1)}</span>
            </div>
          `,
        )
        .join("")
    : `<div class="empty">还没有已关闭的模拟交易，学习偏好暂未形成。</div>`;
}

function renderNotifications(data) {
  const plan = data.notifications || {};
  const alerts = plan.pendingAlerts || [];
  els.notificationList.innerHTML = alerts.length
    ? alerts
        .map(
          (item) => `
            <div class="alert-item">
              <strong>${item.type} · ${item.title}</strong>
              <small>${item.body}</small>
            </div>
          `,
        )
        .join("")
    : `<div class="empty">暂无待提醒事件。</div>`;

  const discord = plan.discord || {};
  els.settingsList.innerHTML = `
    <div class="setting-row">
      <strong>Discord</strong>
      <span>${discord.status || "未配置"}</span>
    </div>
    <div class="note-block">
      <p>${discord.delivery || "默认不发送外部消息。"}</p>
      <small>事件：${(discord.eventTypes || []).join(" / ")}</small>
    </div>
    <div class="note-block">
      <strong>费用参数</strong>
      <p>佣金 ${((data.feeConfig?.commissionRate || 0) * 100).toFixed(3)}%，最低 ${money(data.feeConfig?.minCommission)}；印花税 ${((data.feeConfig?.stampDutyRate || 0) * 100).toFixed(3)}%。</p>
    </div>
  `;
}

function render(data, liveStatus) {
  els.dateBadge.textContent = data.date;
  els.marketRegime.textContent = data.marketRegime?.summary || "";
  els.sourceSummary.textContent = [...new Set((data.hotBoards || []).map((item) => item.source))].join(" / ") || "行情接口";
  renderStatus(data, liveStatus);
  renderPortfolio(data);
  renderIndexes(data);
  renderActions(data);
  renderSectors(data);
  renderResearch(data);
  renderCandidates(data);
  renderPositions(data);
  renderTrades(data);
  renderReview(data);
  renderStrategy(data);
  renderNotifications(data);
}

async function start() {
  try {
    const [dashboard, liveStatus] = await Promise.all([loadDashboard(), loadLiveStatus()]);
    render(dashboard, liveStatus);
  } catch (error) {
    els.statusStrip.innerHTML = pill(error.message, "warn");
  }
}

els.refreshBtn.addEventListener("click", async () => {
  els.refreshBtn.disabled = true;
  els.refreshBtn.textContent = "刷新中";
  try {
    const res = await fetch("/api/update", { method: "POST" });
    if (!res.ok) throw new Error("刷新失败");
    const [dashboard, liveStatus] = await Promise.all([loadDashboard(), loadLiveStatus()]);
    render(dashboard, liveStatus);
  } catch (error) {
    els.statusStrip.innerHTML = pill(error.message, "warn");
  } finally {
    els.refreshBtn.disabled = false;
    els.refreshBtn.textContent = "刷新";
  }
});

start();
setInterval(start, 60000);
