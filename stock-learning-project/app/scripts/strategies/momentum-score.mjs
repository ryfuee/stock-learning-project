import { avg, clamp, movingAverage, num } from "../indicators/technical.mjs";

function signed(value, digits = 2) {
  const n = num(value);
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}`;
}

function money(value) {
  const n = num(value);
  if (Math.abs(n) >= 1e8) return `${(n / 1e8).toFixed(2)}亿`;
  if (Math.abs(n) >= 1e4) return `${(n / 1e4).toFixed(2)}万`;
  return n.toFixed(2);
}

export const momentumScoreStrategy = {
  id: "momentum-score",
  name: "动量评分策略",
  description: "使用均线趋势、5日/20日动量和成交额过滤生成纸面买入信号。",
  minHistory: 25,

  buildEntrySignal({ code, bars, index, config, defaultRiskControls }) {
    if (index < this.minHistory) return null;
    const bar = bars[index];
    const prev5 = bars[index - 5];
    const prev20 = bars[index - 20];
    const ma5 = movingAverage(bars, index, 5);
    const ma20 = movingAverage(bars, index, 20);
    const recentAmounts = bars
      .slice(Math.max(0, index - 20), index)
      .map((item) => num(item.amount))
      .filter(Boolean);
    const amountRatio = avg(recentAmounts) ? num(bar.amount) / avg(recentAmounts) : 1;
    const ret5 = prev5?.close ? (num(bar.close) / num(prev5.close) - 1) * 100 : 0;
    const ret20 = prev20?.close ? (num(bar.close) / num(prev20.close) - 1) * 100 : 0;
    const trend = ma20 ? (num(bar.close) / ma20 - 1) * 100 : 0;
    const score = clamp(Math.round(48 + ret5 * 3 + ret20 * 0.7 + trend * 2 + Math.min(12, amountRatio * 4)), 0, 100);
    const controls = { ...defaultRiskControls, ...(config.riskControls || {}) };
    const reasons = [];
    if (!(ma5 && ma20 && num(bar.close) > ma20 && ma5 > ma20)) reasons.push("均线趋势未确认");
    if (ret5 < 2.5) reasons.push(`5日动量不足：${signed(ret5)}%`);
    if (ret5 > num(controls.chasePctLimit, 7.5)) reasons.push(`5日涨幅过高：${signed(ret5)}%`);
    if (num(bar.pctChg) > num(controls.chasePctLimit, 7.5)) reasons.push(`单日追高风险：${signed(bar.pctChg)}%`);
    if (num(bar.amount) < num(controls.minAmount, 0)) reasons.push(`成交额不足：${money(bar.amount)}`);
    if (score < num(config.buyScoreThreshold, 72)) reasons.push(`评分不足：${score}`);
    if (reasons.length) return null;
    return {
      code,
      date: bar.date,
      score,
      ret5,
      ret20,
      amount: bar.amount,
      close: bar.close,
      passed: true,
      reasons,
      thesis: `价格在20日线上方，5日动量${signed(ret5)}%，20日趋势${signed(ret20)}%。`,
      attribution: { type: "ENTRY", factors: ["趋势突破", "价格动量", "成交额过滤"], risks: [] },
    };
  },

  buildExitSignal({ bars, current, position, index, config, controls, pnlPct, heldDays }) {
    const ma20 = movingAverage(bars, index, 20);
    if (pnlPct <= num(config.stopLossPct, -5)) return { reason: `止损触发 ${signed(pnlPct)}%` };
    if (pnlPct >= num(config.takeProfitPct, 10)) return { reason: `止盈触发 ${signed(pnlPct)}%` };
    if (heldDays >= num(controls.timeStopDays, 7) && pnlPct < num(controls.timeStopMinProfitPct, 1)) {
      return { reason: `时间止损：持有${heldDays}日收益${signed(pnlPct)}%` };
    }
    if (ma20 && num(current.close) < ma20 && pnlPct < 2) return { reason: "跌破20日均线且利润不足" };
    if (position.highestClose && num(current.close) < position.highestClose * 0.92 && pnlPct > 0) {
      return { reason: `回撤保护：从高点回落${signed((num(current.close) / position.highestClose - 1) * 100)}%` };
    }
    return null;
  },
};
