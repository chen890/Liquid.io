export interface Candle {
  time: number;
  open: number; high: number; low: number; close: number;
  volume: number;
}

/** Simple moving average aligned to input; leading values are null. */
export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}

/** Exponential moving average seeded with the SMA of the first `period` values. */
export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  if (values.length < period) return values.map(() => null);
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) out.push(null);
    else if (i === period - 1) out.push(prev);
    else {
      prev = values[i] * k + prev * (1 - k);
      out.push(prev);
    }
  }
  return out;
}

export interface Snapshot {
  last: number;
  prevClose: number | null;
  dayChange: number | null;
  dayChangePct: number | null;
  sma20: number | null;
  sma50: number | null;
  ema20: number | null;
  /** % change over the last 20 candles. */
  momentum20Pct: number | null;
  high: number;
  low: number;
  /** 0 = at period low, 1 = at period high. */
  rangePosition: number;
  avgVolume20: number | null;
  lastVolume: number | null;
  asOf: number;
}

export function snapshot(candles: Candle[], previousClose?: number | null): Snapshot | null {
  if (candles.length < 2) return null;
  const closes = candles.map((c) => c.close);
  const last = closes[closes.length - 1];
  const prevClose = previousClose ?? closes[closes.length - 2];
  const high = Math.max(...candles.map((c) => c.high));
  const low = Math.min(...candles.map((c) => c.low));
  const s20 = sma(closes, 20);
  const s50 = sma(closes, 50);
  const e20 = ema(closes, 20);
  const vols = candles.map((c) => c.volume);
  const v20 = sma(vols, 20);
  const m20 = closes.length > 20 ? ((last / closes[closes.length - 21]) - 1) * 100 : null;
  return {
    last,
    prevClose: prevClose ?? null,
    dayChange: prevClose != null ? last - prevClose : null,
    dayChangePct: prevClose ? ((last / prevClose) - 1) * 100 : null,
    sma20: s20[s20.length - 1],
    sma50: s50[s50.length - 1],
    ema20: e20[e20.length - 1],
    momentum20Pct: m20,
    high,
    low,
    rangePosition: high > low ? (last - low) / (high - low) : 0.5,
    avgVolume20: v20[v20.length - 1],
    lastVolume: vols[vols.length - 1] ?? null,
    asOf: candles[candles.length - 1].time,
  };
  }
