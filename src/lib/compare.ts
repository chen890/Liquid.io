import type { Candle } from './indicators';

export interface CompareInput {
  ticker: string;
  candles: Candle[];
}
export interface ComparePoint { time: number; pct: number }
export interface CompareSeries {
  ticker: string;
  points: ComparePoint[];
  /** Percent change from the shared base date to this series' last close. */
  lastPct: number | null;
  /** Date (unix seconds) of this series' last candle, so a stale series is visible. */
  lastTime: number | null;
}
export interface CompareResult {
  /** Shared base date (unix seconds): the first day on which every included series has data. */
  baseTime: number | null;
  series: CompareSeries[];
  /** Tickers left out because they have no candles. */
  missing: string[];
}

/**
 * Normalises each series to percent change from one shared base date, so stocks with very different
 * prices are comparable. The base is the latest first-candle date among the series with data, which
 * means nobody is compared against a date before their own data starts. Each series is rebased to its
 * first close on or after that date.
 */
export function computeComparison(inputs: CompareInput[]): CompareResult {
  const usable = inputs.filter((i) => i.candles.length > 0);
  const missing = inputs.filter((i) => i.candles.length === 0).map((i) => i.ticker);
  if (usable.length === 0) return { baseTime: null, series: [], missing };
  const baseTime = Math.max(...usable.map((i) => Math.min(...i.candles.map((c) => c.time))));
  const series: CompareSeries[] = usable.map((i) => {
    const sorted = [...i.candles].sort((a, b) => a.time - b.time).filter((c) => c.time >= baseTime && c.close > 0);
    const base = sorted[0]?.close;
    if (!base) return { ticker: i.ticker, points: [], lastPct: null, lastTime: null };
    const points = sorted.map((c) => ({ time: c.time, pct: (c.close / base - 1) * 100 }));
    const last = points[points.length - 1];
    return { ticker: i.ticker, points, lastPct: last.pct, lastTime: last.time };
  });
  return { baseTime, series, missing };
}
