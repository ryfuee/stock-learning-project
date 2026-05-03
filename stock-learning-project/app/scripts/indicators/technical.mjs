export function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function avg(items) {
  const values = items.map((item) => num(item, NaN)).filter(Number.isFinite);
  return values.length ? values.reduce((sum, item) => sum + item, 0) / values.length : 0;
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function sma(values, index, length) {
  if (index + 1 < length) return null;
  return avg(values.slice(index + 1 - length, index + 1));
}

export function ema(values, index, length) {
  if (index + 1 < length) return null;
  const k = 2 / (length + 1);
  let value = avg(values.slice(0, length));
  for (let i = length; i <= index; i += 1) {
    value = values[i] * k + value * (1 - k);
  }
  return value;
}

export function movingAverage(bars, index, length, field = "close") {
  return sma(
    bars.map((bar) => num(bar[field])),
    index,
    length,
  );
}

export function rsi(bars, index, length = 14) {
  if (index < length) return null;
  let gains = 0;
  let losses = 0;
  for (let i = index + 1 - length; i <= index; i += 1) {
    const diff = num(bars[i]?.close) - num(bars[i - 1]?.close);
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }
  if (losses === 0) return gains === 0 ? 50 : 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

export function macd(bars, index, fast = 12, slow = 26, signal = 9) {
  const closes = bars.map((bar) => num(bar.close));
  if (index + 1 < slow + signal) return null;
  const diffs = [];
  for (let i = 0; i <= index; i += 1) {
    const fastEma = ema(closes, i, fast);
    const slowEma = ema(closes, i, slow);
    diffs.push(fastEma === null || slowEma === null ? null : fastEma - slowEma);
  }
  const usableDiffs = diffs.map((item) => (item === null ? 0 : item));
  const dif = diffs[index];
  const dea = ema(usableDiffs, index, signal);
  if (dif === null || dea === null) return null;
  return { dif, dea, histogram: (dif - dea) * 2 };
}

export function trueRange(bars, index) {
  const bar = bars[index];
  const prev = bars[index - 1];
  if (!bar) return 0;
  const high = num(bar.high || bar.close);
  const low = num(bar.low || bar.close);
  const prevClose = prev ? num(prev.close) : num(bar.close);
  return Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
}

export function atr(bars, index, length = 14) {
  if (index < length) return null;
  const values = [];
  for (let i = index + 1 - length; i <= index; i += 1) values.push(trueRange(bars, i));
  return avg(values);
}

export function donchian(bars, index, length = 20, { fieldHigh = "high", fieldLow = "low", offset = 1 } = {}) {
  const end = index - offset;
  const start = end + 1 - length;
  if (start < 0) return null;
  const slice = bars.slice(start, end + 1);
  return {
    high: Math.max(...slice.map((bar) => num(bar[fieldHigh] || bar.close))),
    low: Math.min(...slice.map((bar) => num(bar[fieldLow] || bar.close))),
  };
}

export function bollingerBands(bars, index, length = 20, deviations = 2) {
  if (index + 1 < length) return null;
  const values = bars.slice(index + 1 - length, index + 1).map((bar) => num(bar.close));
  const middle = avg(values);
  const variance = avg(values.map((value) => (value - middle) ** 2));
  const sd = Math.sqrt(variance);
  return { upper: middle + deviations * sd, middle, lower: middle - deviations * sd };
}
