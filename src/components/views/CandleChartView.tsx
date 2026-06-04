/**
 * CandleChartView — TradingView Lightweight Charts candlestick + volume
 * with pre-market and after-hours price overlays.
 *
 * Uses lightweight-charts v5 (createChart API).
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  createChart,
  ColorType,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  PriceScaleMode,
} from 'lightweight-charts';
import { RefreshCw, Moon, Sunrise } from 'lucide-react';
import { usePortfolioStore } from '../../store/portfolioStore';
import { Card } from '../ui/Card';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Candle {
  time: number;
  open: number; high: number; low: number; close: number;
  volume: number;
}
interface ExtHours {
  price: number;
  change: number;
  changePct: number;
}
interface CandleData {
  ok: boolean;
  candles: Candle[];
  preMarket: ExtHours | null;
  postMarket: ExtHours | null;
  meta: {
    symbol: string;
    shortName: string;
    currency: string;
    regularMarketPrice: number | null;
    previousClose: number | null;
    regularMarketVolume: number | null;
    fiftyTwoWeekHigh: number | null;
    fiftyTwoWeekLow: number | null;
  };
}

const RANGES = [
  { label: '1W',  range: '5d',   interval: '15m' },
  { label: '1M',  range: '1mo',  interval: '1d'  },
  { label: '3M',  range: '3mo',  interval: '1d'  },
  { label: '6M',  range: '6mo',  interval: '1d'  },
  { label: '1Y',  range: '1y',   interval: '1d'  },
  { label: '2Y',  range: '2y',   interval: '1wk' },
];

function fmtNum(n: number | null, dec = 2) { return n != null ? `$${n.toFixed(dec)}` : '—'; }
function fmtVol(n: number | null) {
  if (!n) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

// ── Component ─────────────────────────────────────────────────────────────────
export function CandleChartView() {
  const { portfolio } = usePortfolioStore();
  const tickers = [...new Set(
    portfolio.grants.map((g) => g.tickerSymbol?.value).filter(Boolean) as string[]
  )];

  const [ticker, setTicker]       = useState(tickers[0] ?? 'MBLY');
  const [rangeIdx, setRangeIdx]   = useState(2); // default 3M
  const [data, setData]           = useState<CandleData | null>(null);
  const [loading, setLoading]     = useState(false);
  const [crosshair, setCrosshair] = useState<{ open: number; high: number; low: number; close: number; volume: number; time: string } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<ReturnType<typeof createChart> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const _candleRef   = useRef<any>(null); void _candleRef;

  const { range, interval } = RANGES[rangeIdx];

  const fetchData = useCallback(async () => {
    if (!ticker) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/candles/${encodeURIComponent(ticker)}?interval=${interval}&range_=${range}`);
      const d = await r.json() as CandleData;
      setData(d.ok ? d : null);
    } catch { setData(null); }
    finally { setLoading(false); }
  }, [ticker, range, interval]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Build/rebuild chart whenever data changes
  useEffect(() => {
    if (!containerRef.current || !data?.candles.length) return;

    // Destroy previous chart
    if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; }

    const chart = createChart(containerRef.current, {
      layout: {
        background:  { type: ColorType.Solid, color: '#0f1117' },
        textColor:   '#64748b',
        fontSize:    11,
      },
      grid: {
        vertLines:   { color: '#1e293b' },
        horzLines:   { color: '#1e293b' },
      },
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor: '#1e293b', mode: PriceScaleMode.Normal },
      timeScale: { borderColor: '#1e293b', timeVisible: true, secondsVisible: false },
      width:  containerRef.current.clientWidth,
      height: 440,
    });
    chartRef.current = chart;

    // ── Candlestick series ────────────────────────────────────────────────────
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor:          '#10b981',
      downColor:        '#ef4444',
      borderUpColor:    '#10b981',
      borderDownColor:  '#ef4444',
      wickUpColor:      '#10b981',
      wickDownColor:    '#ef4444',
      priceScaleId:     'right',
    });

    // ── Volume histogram (secondary scale) ───────────────────────────────────
    const volSeries = chart.addSeries(HistogramSeries, {
      color:        '#6366f180',
      priceFormat:  { type: 'volume' },
      priceScaleId: 'volume',
    });
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
      visible: false,
    });

    const candleData = data.candles.map((c) => ({ time: c.time as unknown as import('lightweight-charts').Time, open: c.open, high: c.high, low: c.low, close: c.close }));
    const volData    = data.candles.map((c) => ({
      time:  c.time as unknown as import('lightweight-charts').Time,
      value: c.volume,
      color: c.close >= c.open ? '#10b98140' : '#ef444440',
    }));

    candleSeries.setData(candleData);
    volSeries.setData(volData);

    // ── Pre-market line ───────────────────────────────────────────────────────
    if (data.preMarket) {
      const preLine = chart.addSeries(LineSeries, {
        color:       '#f59e0b',
        lineWidth:   1,
        lineStyle:   2, // dashed
        priceScaleId: 'right',
        title:       `Pre-mkt $${data.preMarket.price.toFixed(2)}`,
      });
      const lastTime = data.candles[data.candles.length - 1].time;
      preLine.setData([
        { time: data.candles[0].time as unknown as import('lightweight-charts').Time, value: data.preMarket.price },
        { time: lastTime as unknown as import('lightweight-charts').Time, value: data.preMarket.price },
      ]);
    }

    // ── After-hours line ──────────────────────────────────────────────────────
    if (data.postMarket) {
      const postLine = chart.addSeries(LineSeries, {
        color:       '#8b5cf6',
        lineWidth:   1,
        lineStyle:   2,
        priceScaleId: 'right',
        title:       `AH $${data.postMarket.price.toFixed(2)}`,
      });
      const lastTime = data.candles[data.candles.length - 1].time;
      postLine.setData([
        { time: data.candles[0].time as unknown as import('lightweight-charts').Time, value: data.postMarket.price },
        { time: lastTime as unknown as import('lightweight-charts').Time, value: data.postMarket.price },
      ]);
    }

    // ── Crosshair tooltip ─────────────────────────────────────────────────────
    chart.subscribeCrosshairMove((param) => {
      if (!param.time) { setCrosshair(null); return; }
      const cp = param.seriesData.get(candleSeries) as { open: number; high: number; low: number; close: number } | undefined;
      const vp = param.seriesData.get(volSeries)    as { value: number } | undefined;
      if (cp) {
        const ts = typeof param.time === 'number' ? param.time : 0;
        setCrosshair({
          ...cp,
          volume: vp?.value ?? 0,
          time:   new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        });
      }
    });

    chart.timeScale().fitContent();

    // Resize observer
    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: containerRef.current?.clientWidth ?? 800 });
    });
    if (containerRef.current) ro.observe(containerRef.current);

    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; };
  }, [data]);

  const reg  = data?.meta.regularMarketPrice ?? null;
  const prev = data?.meta.previousClose ?? null;
  const dayChange    = reg && prev ? reg - prev : null;
  const dayChangePct = reg && prev && prev > 0 ? ((reg - prev) / prev) * 100 : null;

  return (
    <div className="flex-1 overflow-auto p-6 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Ticker selector */}
          {tickers.length > 1 ? (
            <select value={ticker} onChange={(e) => setTicker(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm font-mono text-white focus:outline-none">
              {tickers.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          ) : (
            <span className="text-xl font-mono font-semibold text-white">{ticker}</span>
          )}

          {/* Price display */}
          {data?.meta && (
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-mono font-semibold text-white">
                {fmtNum(reg)}
              </span>
              {dayChange !== null && (
                <span className={`text-sm font-mono ${dayChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {dayChange >= 0 ? '+' : ''}{dayChange.toFixed(2)} ({dayChangePct?.toFixed(2)}%)
                </span>
              )}
              <span className="text-xs text-slate-600">{data.meta.currency}</span>
            </div>
          )}
        </div>

        {/* Range selector */}
        <div className="flex items-center gap-1">
          {RANGES.map(({ label }, i) => (
            <button key={label} onClick={() => setRangeIdx(i)}
              className={`text-xs px-2.5 py-1.5 rounded transition-colors ${i === rangeIdx ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
              {label}
            </button>
          ))}
          <button onClick={fetchData} disabled={loading}
            className="ml-1 p-1.5 rounded bg-slate-800 border border-slate-700 text-slate-400 hover:text-white transition-colors">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Pre/after market banners */}
      <div className="flex gap-3 flex-wrap">
        {data?.preMarket && (
          <div className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg bg-amber-950/30 border border-amber-800/50">
            <Sunrise className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-amber-300 font-medium">Pre-market</span>
            <span className="font-mono text-white">{fmtNum(data.preMarket.price)}</span>
            <span className={`font-mono ${data.preMarket.change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {data.preMarket.change >= 0 ? '+' : ''}{data.preMarket.change.toFixed(2)} ({data.preMarket.changePct.toFixed(2)}%)
            </span>
          </div>
        )}
        {data?.postMarket && (
          <div className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg bg-purple-950/30 border border-purple-800/50">
            <Moon className="w-3.5 h-3.5 text-purple-400" />
            <span className="text-purple-300 font-medium">After-hours</span>
            <span className="font-mono text-white">{fmtNum(data.postMarket.price)}</span>
            <span className={`font-mono ${data.postMarket.change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {data.postMarket.change >= 0 ? '+' : ''}{data.postMarket.change.toFixed(2)} ({data.postMarket.changePct.toFixed(2)}%)
            </span>
          </div>
        )}
      </div>

      {/* Crosshair OHLCV tooltip */}
      {crosshair && (
        <div className="flex items-center gap-4 text-xs font-mono bg-slate-900 border border-slate-800 rounded-xl px-4 py-2">
          <span className="text-slate-500">{crosshair.time}</span>
          <span className="text-slate-400">O <span className="text-white">{crosshair.open.toFixed(2)}</span></span>
          <span className="text-slate-400">H <span className="text-emerald-400">{crosshair.high.toFixed(2)}</span></span>
          <span className="text-slate-400">L <span className="text-red-400">{crosshair.low.toFixed(2)}</span></span>
          <span className="text-slate-400">C <span className={crosshair.close >= crosshair.open ? 'text-emerald-400' : 'text-red-400'}>{crosshair.close.toFixed(2)}</span></span>
          <span className="text-slate-400">Vol <span className="text-slate-300">{fmtVol(crosshair.volume)}</span></span>
        </div>
      )}

      {/* Chart */}
      <Card padding="none" className="overflow-hidden">
        <div ref={containerRef} className="w-full" style={{ minHeight: 440, background: '#0f1117' }}>
          {loading && !data && (
            <div className="flex items-center justify-center h-96 text-slate-500 text-sm gap-2">
              <RefreshCw className="w-4 h-4 animate-spin" />
              Loading {ticker} chart…
            </div>
          )}
          {!loading && !data && (
            <div className="flex items-center justify-center h-96 text-slate-600 text-sm">
              No data — start the server with <code className="font-mono ml-1">npm start</code>
            </div>
          )}
        </div>
      </Card>

      {/* 52-week range + meta */}
      {data?.meta && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          {[
            { label: 'Prev Close', value: fmtNum(data.meta.previousClose) },
            { label: '52w High',   value: fmtNum(data.meta.fiftyTwoWeekHigh) },
            { label: '52w Low',    value: fmtNum(data.meta.fiftyTwoWeekLow)  },
            { label: 'Volume',     value: fmtVol(data.meta.regularMarketVolume ?? null) },
          ].map(({ label, value }) => (
            <div key={label} className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2">
              <div className="text-slate-500 mb-0.5">{label}</div>
              <div className="font-mono text-white">{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Legend */}
      <div className="flex gap-4 text-xs text-slate-600 flex-wrap">
        <span className="flex items-center gap-1.5"><span className="w-3 h-1.5 rounded bg-emerald-500 inline-block" /> Up candle</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-1.5 rounded bg-red-500 inline-block" /> Down candle</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-amber-400 border-dashed inline-block" style={{ borderTop: '1px dashed #f59e0b' }} /> Pre-market level</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-purple-400 border-dashed inline-block" style={{ borderTop: '1px dashed #8b5cf6' }} /> After-hours level</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-1.5 rounded bg-indigo-500/40 inline-block" /> Volume bars</span>
        <span className="ml-auto text-slate-700">Data: Yahoo Finance · Drag to pan · Scroll to zoom</span>
      </div>
    </div>
  );
}
