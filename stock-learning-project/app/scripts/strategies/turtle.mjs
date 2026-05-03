import { atr, clamp, donchian, num } from "../indicators/technical.mjs";

function signed(value, digits = 2) {
  const n = num(value);
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}`;
}

export const turtleStrategy = {
  id: "turtle",
  name: "海龟趋势突破策略",
  description: "使用唐奇安通道突破入场、ATR 衡量波动，并用通道跌破或通用止损止盈退出。",
  minHistory: 55,

  buildEntrySignal({ code, bars, index, config, defaultRiskControls }) {
    if (index < this.minHistory) return null;
    const bar = bars[index];
    const channel = donchian(bars, index, 20, { offset: 1 });
    const longChannel = donchian(bars, index, 55, { offset: 1 });
    const volatility = atr(bars, index, 20);
    if (!channel || !longChannel || !volatility || volatility <= 0) return null;
    const controls = { ...defaultRiskControls, ...(config.riskControls || {}) };
    const breakoutPct = channel.high ? (num(bar.close) / channel.high - 1) * 100 : 0;
    const volatilityPct = num(bar.close) ? (volatility / num(bar.close)) * 100 : 0;
    const score = clamp(Math.round(62 + breakoutPct * 10 + Math.min(18, volatilityPct * 2)), 0, 100);
    if (num(bar.close) <= channel.high) return null;
    if (num(bar.amount) < num(controls.minAmount, 0)) return null;
    if (num(bar.pctChg) > num(controls.chasePctLimit, 7.5)) return null;
    if (score < num(config.buyScoreThreshold, 72)) return null;
    return {
      code,
      date: bar.date,
      score,
      close: bar.close,
      amount: bar.amount,
      passed: true,
      thesis: `突破20日唐奇安上轨，ATR波动率${signed(volatilityPct)}%，上轨突破${signed(breakoutPct)}%。`,
      attribution: {
        type: "ENTRY",
        factors: ["唐奇安突破", "ATR波动确认", "成交额过滤"],
        risks: volatilityPct > 5 ? ["高波动"] : [],
      },
      metadata: {
        channelHigh: channel.high,
        longChannelHigh: longChannel.high,
        atr: volatility,
        atrPct: volatilityPct,
      },
    };
  },

  buildExitSignal({ bars, current, index, config, controls, pnlPct, heldDays }) {
    const exitChannel = donchian(bars, index, 10, { offset: 1 });
    if (pnlPct <= num(config.stopLossPct, -5)) return { reason: `止损触发 ${signed(pnlPct)}%` };
    if (pnlPct >= num(config.takeProfitPct, 10)) return { reason: `止盈触发 ${signed(pnlPct)}%` };
    if (exitChannel && num(current.close) < exitChannel.low) return { reason: "跌破10日唐奇安下轨" };
    if (heldDays >= num(controls.timeStopDays, 7) && pnlPct < num(controls.timeStopMinProfitPct, 1)) {
      return { reason: `时间止损：持有${heldDays}日收益${signed(pnlPct)}%` };
    }
    return null;
  },
};
