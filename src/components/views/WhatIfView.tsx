/**
 * What-If / Price Scenario Calculator
 *
 * Shows RSU portfolio value, capital gains and estimated taxes
 * across a range of target prices.
 *
 * Tax reference (Israeli capital gains):
 *  https://www.meitav.co.il/trade/capital_market_guide/capital_market_tax/
 *  - Foreign stocks (e.g. MBLY listed on NASDAQ): 25% on real gain
 *  - RSU income at vesting = ordinary income (taxed separately at marginal rate)
 *  - Post-vesting appreciation = capital gains at 25%
 *  - Losses can offset gains within the same calendar year
 */

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell,
  ComposedChart, Line, Area,
} from 'recharts';
import { Calculator, AlertTriangle, Info, TrendingUp, ArrowUpDown, Zap, RefreshCw } from 'lucide-react';
import { getAllVestingEvents } from '../../lib/vestingSchedule';
import { usePortfolioStore } from '../../store/portfolioStore';
import type { GrantRecord } from '../../types';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';

// ── Tax constants ─────────────────────────────────────────────────────────────
const IL_CGT  = 0.25;   // Israeli capital gains tax on foreign stocks
const US_LTCG = 0.20;   // US long-term capital gains (held > 1 year)
const US_STCG = 0.37;   // US short-term (highest marginal)
const NET_INV  = 0.038; // US Net Investment Income Tax

type TaxRegime = 'israel' | 'us_lt' | 'us_st';

// ── Live-quote hook (polls every N ms) ───────────────────────────────────────
interface LiveQuote {
  price:     number | null;
  usdils:    number | null;
  lastAt:    Date | null;
  loading:   boolean;
  delta:     number | null;   // price change vs previous poll
}

function useLiveQuote(ticker: string, intervalMs = 3000): LiveQuote {
  const [quote, setQuote] = useState<LiveQuote>({ price: null, usdils: null, lastAt: null, loading: false, delta: null });
  const prevPrice = useRef<number | null>(null);

  const fetch_ = useCallback(async () => {
    if (!ticker) return;
    setQuote((q) => ({ ...q, loading: true }));
    try {
      const [pr, cr] = await Promise.all([
        fetch(`/api/price/${encodeURIComponent(ticker)}`, { signal: AbortSignal.timeout(4000) }).then((r) => r.json()),
        fetch('/api/currency/USDILS',                     { signal: AbortSignal.timeout(4000) }).then((r) => r.json()),
      ]);
      const price  = (pr as { price?: number | null }).price  ?? null;
      const usdils = (cr as { current?: number | null }).current ?? null;
      const delta  = price != null && prevPrice.current != null ? price - prevPrice.current : null;
      if (price != null) prevPrice.current = price;
      setQuote({ price, usdils, lastAt: new Date(), loading: false, delta });
    } catch {
      setQuote((q) => ({ ...q, loading: false }));
    }
  }, [ticker]);

  useEffect(() => {
    fetch_();
    const id = setInterval(fetch_, intervalMs);
    return () => clearInterval(id);
  }, [fetch_, intervalMs]);

  return quote;
}

// ── Currency hook ─────────────────────────────────────────────────────────────
interface RatePoint { date: number; rate: number }
interface CurrencyData { current: number | null; history: RatePoint[] }

function useCurrency(pair: string): CurrencyData {
  const [data, setData] = useState<CurrencyData>({ current: null, history: [] });
  useEffect(() => {
    fetch(`/api/currency/${pair}`, { signal: AbortSignal.timeout(10_000) })
      .then((r) => r.json())
      .then((d: { current?: number | null; history?: RatePoint[] }) => {
        setData({ current: d.current ?? null, history: d.history ?? [] });
      })
      .catch(() => {});
  }, [pair]);
  return data;
}

interface GrantScenario {
  grantId: string;
  ticker: string;
  grantType: string;
  grantDate: string;
  vestedShares: number;
  unvestedShares: number;
  costBasis: number;           // FMV at vesting = cost basis for CGT
  docPrice: number;
  sourceFile: string;
}

function buildScenarios(grants: GrantRecord[]): GrantScenario[] {
  return grants.flatMap((g) => {
    const total   = g.totalShares?.value ?? 0;
    const unvest  = g.unvestedShares?.value;
    const vested  = g.vestedShares?.value;
    const vestedCount = vested !== undefined ? vested
      : (unvest !== undefined && total > 0 ? Math.max(0, total - unvest) : 0);
    const unvestedCount = unvest ?? Math.max(0, total - vestedCount);

    const costBasis = g.fairMarketValue?.value ??
      (g.currentMarketValue?.value && total ? g.currentMarketValue.value / total : 0);

    if (vestedCount === 0 && unvestedCount === 0) return [];

    return [{
      grantId:       g.grantId?.value ?? g.id.slice(0, 8),
      ticker:        g.tickerSymbol?.value ?? '—',
      grantType:     g.grantType?.value ?? 'Grant',
      grantDate:     g.grantDate?.value ?? '',
      vestedShares:  vestedCount,
      unvestedShares: unvestedCount,
      costBasis,
      docPrice:      costBasis,
      sourceFile:    g.sourceFiles[0] ?? '',
    }];
  });
}

function taxLabel(regime: TaxRegime) {
  if (regime === 'israel') return 'Israeli CGT (25%)';
  if (regime === 'us_lt')  return 'US LTCG (20% + 3.8% NIIT)';
  return 'US STCG (37%)';
}

function taxRate(regime: TaxRegime) {
  if (regime === 'israel') return IL_CGT;
  if (regime === 'us_lt')  return US_LTCG + NET_INV;
  return US_STCG;
}

function computeGain(shares: number, price: number, basis: number) {
  return Math.max(0, (price - basis) * shares);
}

function fmtUSD(n: number) {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000)     return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

// ── Component ─────────────────────────────────────────────────────────────────
export function WhatIfView() {
  const { portfolio, setView } = usePortfolioStore();
  const grants = portfolio.grants;

  const [customPrice, setCustomPrice] = useState('');
  const [taxRegime, setTaxRegime] = useState<TaxRegime>('israel');
  const [tab, setTab] = useState<'chart' | 'table' | 'tax' | 'nis' | 'calc' | 'forecast'>('calc');
  const usdils = useCurrency('USDILS');
  const scenarios = useMemo(() => buildScenarios(grants), [grants]);
  // Primary ticker for live quote
  const primaryTicker = useMemo(() => scenarios[0]?.ticker ?? '', [scenarios]);
  const live = useLiveQuote(primaryTicker, 3000);

  // Cost basis for capital gains = FMV at vesting, weighted by VESTED shares only.
  // Using statement FMV as the best available proxy for each lot's vesting price.
  const avgCostBasis = useMemo(() => {
    const weightedVested = scenarios.reduce((s, sc) => s + sc.costBasis * sc.vestedShares, 0);
    const totalVested    = scenarios.reduce((s, sc) => s + sc.vestedShares, 0);
    if (totalVested > 0) return weightedVested / totalVested;
    // Fallback: include unvested if no vested data
    const weighted = scenarios.reduce((s, sc) => s + sc.costBasis * (sc.vestedShares + sc.unvestedShares), 0);
    const total    = scenarios.reduce((s, sc) => s + sc.vestedShares + sc.unvestedShares, 0);
    return total > 0 ? weighted / total : 0;
  }, [scenarios]);

  const totalVestedShares   = useMemo(() => scenarios.reduce((s, sc) => s + sc.vestedShares, 0),   [scenarios]);
  const totalUnvestedShares = useMemo(() => scenarios.reduce((s, sc) => s + sc.unvestedShares, 0), [scenarios]);

  // Price range: 50%–200% of cost basis + custom
  const pricePoints = useMemo(() => {
    const base = avgCostBasis > 0 ? avgCostBasis : 10;
    const pcts  = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0];
    const pts   = pcts.map((p) => Math.round(base * p * 100) / 100);
    if (customPrice && !isNaN(Number(customPrice))) {
      const cp = Number(customPrice);
      if (!pts.includes(cp)) pts.push(cp);
      pts.sort((a, b) => a - b);
    }
    return pts;
  }, [avgCostBasis, customPrice]);

  // Build chart data
  const chartData = useMemo(() => pricePoints.map((price) => {
    const vestedGross = totalVestedShares * price;
    const unvestedGross = totalUnvestedShares * price;
    const gain = computeGain(totalVestedShares, price, avgCostBasis);
    const tax  = gain * taxRate(taxRegime);
    const netVested = vestedGross - tax;
    return { price: `$${price.toFixed(2)}`, priceRaw: price, vestedGross, unvestedGross, gain, tax, netVested };
  }), [pricePoints, totalVestedShares, totalUnvestedShares, avgCostBasis, taxRegime]);

  // Per-grant table state
  const [selectedPrice, setSelectedPrice]         = useState<number | null>(null);
  const [sortBy, setSortBy]                       = useState<string>('grantDate');
  const [sortDir, setSortDir]                     = useState<'asc' | 'desc'>('asc');
  const [filterType, setFilterType]               = useState<string>('all');
  const [filterMinVested, setFilterMinVested]     = useState('');

  const evalPrice = selectedPrice ?? avgCostBasis;

  const toggleSort = (col: string) => {
    if (sortBy === col) setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('asc'); }
  };

  const SortIcon = ({ col }: { col: string }) => (
    <span className={`ml-0.5 text-xs ${sortBy === col ? 'text-indigo-400' : 'text-slate-700'}`}>
      {sortBy === col ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
    </span>
  );

  const grantRows = useMemo(() => {
    let rows = scenarios.map((sc) => {
      const vestedGross   = sc.vestedShares   * evalPrice;
      const unvestedGross = sc.unvestedShares * evalPrice;
      const gain  = computeGain(sc.vestedShares, evalPrice, sc.costBasis);
      const tax   = gain * taxRate(taxRegime);
      const net   = vestedGross - tax;
      const pnl   = (evalPrice - sc.docPrice) * sc.vestedShares;
      const totalRSUs = sc.vestedShares + sc.unvestedShares;
      return { ...sc, vestedGross, unvestedGross, gain, tax, net, pnl, totalRSUs };
    });

    // Filters
    if (filterType !== 'all') rows = rows.filter((r) => r.grantType === filterType);
    if (filterMinVested) {
      const min = Number(filterMinVested);
      if (!isNaN(min)) rows = rows.filter((r) => r.vestedShares >= min);
    }

    // Sort
    rows.sort((a, b) => {
      let av: number | string = 0, bv: number | string = 0;
      if (sortBy === 'grantDate')    { av = a.grantDate ?? ''; bv = b.grantDate ?? ''; }
      if (sortBy === 'grantId')      { av = a.grantId;         bv = b.grantId; }
      if (sortBy === 'vestedShares') { av = a.vestedShares;     bv = b.vestedShares; }
      if (sortBy === 'totalRSUs')    { av = a.totalRSUs;        bv = b.totalRSUs; }
      if (sortBy === 'net')          { av = a.net;               bv = b.net; }
      if (sortBy === 'pnl')          { av = a.pnl;               bv = b.pnl; }
      if (sortBy === 'costBasis')    { av = a.costBasis;          bv = b.costBasis; }
      const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [scenarios, evalPrice, taxRegime, sortBy, sortDir, filterType, filterMinVested]);

  if (grants.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-12 text-center">
        <Calculator className="w-10 h-10 text-slate-600" />
        <div>
          <h2 className="text-lg font-semibold text-white mb-1">No grants to model</h2>
          <p className="text-slate-400 text-sm">Upload equity documents first.</p>
        </div>
        <Button variant="primary" onClick={() => setView('upload')}>Upload Documents</Button>
      </div>
    );
  }

  const tooltipStyle = {
    contentStyle: { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, fontSize: 12 },
    labelStyle:   { color: '#94a3b8' },
  };

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-white flex items-center gap-2">
            <Calculator className="w-5 h-5 text-indigo-400" />
            What-If Price Scenarios
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Model portfolio value, capital gains and tax across price targets
          </p>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Tax regime */}
          <select
            value={taxRegime}
            onChange={(e) => setTaxRegime(e.target.value as TaxRegime)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-300 focus:outline-none"
          >
            <option value="israel">🇮🇱 Israeli CGT (25%)</option>
            <option value="us_lt">🇺🇸 US Long-Term (23.8%)</option>
            <option value="us_st">🇺🇸 US Short-Term (37%)</option>
          </select>

          {/* Custom price */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-slate-500">Custom $</span>
            <input
              type="number"
              min={0}
              step={0.01}
              value={customPrice}
              onChange={(e) => setCustomPrice(e.target.value)}
              placeholder="e.g. 25.00"
              className="w-24 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
            />
          </div>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card padding="md">
          <div className="text-xs text-slate-500 mb-1">Vested Shares</div>
          <div className="text-2xl font-semibold text-white">{totalVestedShares.toLocaleString()}</div>
          <div className="text-xs text-slate-600 mt-0.5">avg cost basis {fmtUSD(avgCostBasis)}/sh</div>
        </Card>
        <Card padding="md">
          <div className="text-xs text-slate-500 mb-1">Unvested Shares</div>
          <div className="text-2xl font-semibold text-amber-400">{totalUnvestedShares.toLocaleString()}</div>
          <div className="text-xs text-slate-600 mt-0.5">value at future vesting prices</div>
        </Card>
        <Card padding="md">
          <div className="text-xs text-slate-500 mb-1">Tax Rate Applied</div>
          <div className="text-2xl font-semibold text-red-400">
            {(taxRate(taxRegime) * 100).toFixed(1)}%
          </div>
          <div className="text-xs text-slate-600 mt-0.5">{taxLabel(taxRegime)}</div>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-800 pb-0">
        {(['calc', 'forecast', 'chart', 'table', 'tax', 'nis'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm rounded-t-lg transition-colors ${
              tab === t
                ? 'text-white bg-slate-800 border border-b-0 border-slate-700'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {{
              calc:     '⚡ Live Sell Calc',
              forecast: '📅 Future Tax Forecast',
              chart:    'Portfolio Value',
              table:    'Per-Grant Table',
              tax:      'Tax Breakdown',
              nis:      '₪ NIS Analysis',
            }[t]}
          </button>
        ))}
      </div>

      {/* Chart tab */}
      {tab === 'chart' && (
        <Card padding="md">
          <CardHeader>
            <CardTitle>Vested Portfolio Value vs Price</CardTitle>
            <span className="text-xs text-slate-600">gross / net of {taxLabel(taxRegime)}</span>
          </CardHeader>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="price" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={fmtUSD} tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip {...tooltipStyle}
                formatter={(v, name) => [fmtUSD(Number(v)), name === 'netVested' ? 'Net (after tax)' : name === 'tax' ? 'Estimated Tax' : 'Gross Value']} />
              <ReferenceLine y={0} stroke="#1e293b" />
              <Bar dataKey="vestedGross" name="vestedGross" fill="#6366f1" opacity={0.4} radius={[3,3,0,0]}>
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={entry.priceRaw > avgCostBasis ? '#6366f1' : '#ef4444'} opacity={0.35} />
                ))}
              </Bar>
              <Bar dataKey="netVested" name="netVested" fill="#10b981" radius={[3,3,0,0]}>
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={entry.priceRaw > avgCostBasis ? '#10b981' : '#ef4444'} opacity={0.75} />
                ))}
              </Bar>
              <Bar dataKey="tax" name="tax" fill="#ef4444" opacity={0.6} radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="flex gap-4 text-xs text-slate-600 mt-2">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-indigo-500/40 inline-block" /> Gross value</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-500 inline-block" /> Net after tax</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-500/60 inline-block" /> Tax</span>
          </div>
        </Card>
      )}

      {/* Per-grant table tab */}
      {tab === 'table' && (
        <div className="space-y-3">
          {/* Price selector + filters */}
          <div className="flex items-start gap-4 flex-wrap">
            <div>
              <div className="text-xs text-slate-500 mb-1">Evaluate at price</div>
              <div className="flex gap-1 flex-wrap">
                {pricePoints.map((p) => (
                  <button key={p} onClick={() => setSelectedPrice(p)}
                    className={`text-xs px-2 py-1 rounded font-mono transition-colors ${evalPrice === p ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
                  >${p.toFixed(2)}</button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div>
                <div className="text-xs text-slate-500 mb-1">Grant Type</div>
                <select value={filterType} onChange={(e) => setFilterType(e.target.value)}
                  className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-300 focus:outline-none">
                  <option value="all">All Types</option>
                  {['RSU','ISO','NSO','ESPP','RestrictedShares','PerformanceShares'].map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Min Vested Shares</div>
                <input type="number" min={0} placeholder="0" value={filterMinVested}
                  onChange={(e) => setFilterMinVested(e.target.value)}
                  className="w-24 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono" />
              </div>
              <button onClick={() => { setFilterType('all'); setFilterMinVested(''); setSortBy('grantDate'); setSortDir('asc'); }}
                className="text-xs text-slate-600 hover:text-slate-400 mt-4">Reset</button>
              <div className="text-xs text-slate-600 mt-4">
                {grantRows.length} row{grantRows.length !== 1 ? 's' : ''}
              </div>
            </div>
          </div>

          <Card padding="none">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-950/40">
                    {[
                      { label: 'Grant',           col: 'grantId' },
                      { label: 'Grant Date',       col: 'grantDate' },
                      { label: 'Type',             col: null },
                      { label: 'Basis/sh',         col: 'costBasis' },
                      { label: 'Total RSUs',       col: 'totalRSUs' },
                      { label: 'Grant Value',      col: null },
                      { label: 'Vested',           col: 'vestedShares' },
                      { label: 'Unvested',         col: null },
                      { label: 'Gross Value',      col: null },
                      { label: 'Capital Gain',     col: null },
                      { label: 'Est. Tax',         col: null },
                      { label: 'Net Proceeds',     col: 'net' },
                      { label: 'P&L vs Doc',       col: 'pnl' },
                    ].map(({ label, col }) => (
                      <th key={label}
                        className={`text-left px-3 py-2.5 text-xs font-medium whitespace-nowrap select-none ${col ? 'cursor-pointer hover:text-slate-300 text-slate-500' : 'text-slate-600'}`}
                        onClick={() => col && toggleSort(col)}
                      >
                        {label}{col && <SortIcon col={col} />}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {grantRows.map((row) => {
                    const totalRSUs    = row.vestedShares + row.unvestedShares;
                    const grantDocVal  = totalRSUs * row.costBasis;
                    return (
                    <tr key={row.grantId} className="hover:bg-slate-800/20">
                      <td className="px-3 py-2.5">
                        <div className="font-mono text-xs text-white">{row.grantId}</div>
                        <div className="text-xs text-slate-600">{row.ticker}</div>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-300 whitespace-nowrap">
                        {row.grantDate
                          ? new Date(row.grantDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                          : <span className="text-slate-700">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-400">{row.grantType}</td>
                      {/* Cost basis per share */}
                      <td className="px-3 py-2.5 font-mono text-xs text-slate-400">${row.costBasis.toFixed(2)}</td>
                      {/* Total RSUs (vested + unvested) */}
                      <td className="px-3 py-2.5 font-mono text-xs text-white">{totalRSUs.toLocaleString()}</td>
                      {/* Grant value at doc price: RSU price × total RSUs */}
                      <td className="px-3 py-2.5">
                        <div className="font-mono text-xs text-indigo-200">{fmtUSD(grantDocVal)}</div>
                        <div className="text-xs text-slate-600">${row.costBasis.toFixed(2)} × {totalRSUs.toLocaleString()}</div>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs text-white">{row.vestedShares.toLocaleString()}</td>
                      <td className="px-3 py-2.5 font-mono text-xs text-amber-400">{row.unvestedShares.toLocaleString()}</td>
                      <td className="px-3 py-2.5 font-mono text-xs text-white">{fmtUSD(row.vestedGross)}</td>
                      <td className="px-3 py-2.5 font-mono text-xs text-emerald-400">
                        {row.gain > 0 ? fmtUSD(row.gain) : <span className="text-slate-600">—</span>}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs text-red-400">
                        {row.tax > 0 ? fmtUSD(row.tax) : <span className="text-slate-600">—</span>}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs text-indigo-300">{fmtUSD(row.net)}</td>
                      <td className="px-3 py-2.5">
                        <span className={`text-xs font-mono ${row.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {row.pnl >= 0 ? '+' : ''}{fmtUSD(row.pnl)}
                        </span>
                      </td>
                    </tr>
                    );
                  })}
                  {/* Totals */}
                  <tr className="bg-slate-950/60 border-t border-slate-700">
                    <td className="px-3 py-2.5 text-xs font-medium text-white" colSpan={2}>Total</td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">—</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-white font-medium">
                      {grantRows.reduce((s, r) => s + r.vestedShares + r.unvestedShares, 0).toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-indigo-200 font-medium">
                      {fmtUSD(grantRows.reduce((s, r) => s + (r.vestedShares + r.unvestedShares) * r.costBasis, 0))}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-white">{totalVestedShares.toLocaleString()}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-amber-400">{totalUnvestedShares.toLocaleString()}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-white font-medium">{fmtUSD(grantRows.reduce((s, r) => s + r.vestedGross, 0))}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-emerald-400 font-medium">{fmtUSD(grantRows.reduce((s, r) => s + r.gain, 0))}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-red-400 font-medium">{fmtUSD(grantRows.reduce((s, r) => s + r.tax, 0))}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-indigo-300 font-medium">{fmtUSD(grantRows.reduce((s, r) => s + r.net, 0))}</td>
                    <td className="px-3 py-2.5 font-mono text-xs">
                      {(() => { const t = grantRows.reduce((s, r) => s + r.pnl, 0); return <span className={t >= 0 ? 'text-emerald-400' : 'text-red-400'}>{t >= 0 ? '+' : ''}{fmtUSD(t)}</span>; })()}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* Tax breakdown tab */}
      {tab === 'tax' && (
        <div className="space-y-4">
          {/* Israeli tax explainer */}
          <Card padding="md" className="border-amber-900/30">
            <CardHeader>
              <CardTitle>Israeli Capital Gains Tax on Foreign Stocks</CardTitle>
              <AlertTriangle className="w-4 h-4 text-amber-500" />
            </CardHeader>
            <div className="text-xs text-slate-400 space-y-2">
              <p>Source: <a href="https://www.meitav.co.il/trade/capital_market_guide/capital_market_tax/" target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline">מיטב טרייד — מדריך מס שוק ההון</a></p>
              <div className="grid grid-cols-2 gap-3 mt-2">
                {[
                  ['Foreign stocks & options (e.g. MBLY/NASDAQ)', '25% on real gain'],
                  ['Israeli stocks & options',                     '25% on real gain'],
                  ['RSU income at vesting',                        'Ordinary income rate (marginal)'],
                  ['Post-vesting price appreciation',              '25% capital gains'],
                  ['Dividends (foreign)',                          '15%–25%'],
                  ['Loss offset',                                  'Within same calendar year only'],
                ].map(([item, rate]) => (
                  <div key={item} className="bg-slate-900 rounded-lg px-3 py-2 border border-slate-800">
                    <div className="text-slate-500">{item}</div>
                    <div className="text-amber-400 font-medium mt-0.5">{rate}</div>
                  </div>
                ))}
              </div>
              <p className="text-slate-600 pt-2">
                Note: RSU shares are taxed as ordinary income at vesting (employer withholds). Only the gain after vesting price is subject to 25% CGT when you sell.
                The cost basis for CGT = FMV at vesting date.
              </p>
            </div>
          </Card>

          {/* Scenario tax table across prices */}
          <Card padding="none">
            <div className="px-4 py-3 border-b border-slate-800">
              <CardTitle>Tax at Each Price Point — {totalVestedShares.toLocaleString()} vested shares, avg cost basis {fmtUSD(avgCostBasis)}/sh</CardTitle>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-950/40">
                    {['Price', 'Gross Value', 'Capital Gain', 'IL Tax (25%)', 'Net (IL)', 'US LTCG (23.8%)', 'Net (US-LT)', 'Best Net'].map((h) => (
                      <th key={h} className="text-left px-3 py-2.5 text-xs text-slate-500 font-medium whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {chartData.map((row) => {
                    const ilTax   = row.gain * IL_CGT;
                    const usLtTax = row.gain * (US_LTCG + NET_INV);
                    const netIL   = row.vestedGross - ilTax;
                    const netUSLT = row.vestedGross - usLtTax;
                    const bestNet = Math.max(netIL, netUSLT);
                    const isAboveBasis = row.priceRaw > avgCostBasis;
                    return (
                      <tr key={row.price} className={`hover:bg-slate-800/20 ${!isAboveBasis ? 'opacity-60' : ''}`}>
                        <td className={`px-3 py-2 font-mono text-xs font-medium ${isAboveBasis ? 'text-white' : 'text-slate-400'}`}>
                          {row.price}
                          {row.priceRaw === avgCostBasis && <span className="ml-1 text-indigo-400 text-[10px]">basis</span>}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-white">{fmtUSD(row.vestedGross)}</td>
                        <td className="px-3 py-2 font-mono text-xs text-emerald-400">{row.gain > 0 ? fmtUSD(row.gain) : '—'}</td>
                        <td className="px-3 py-2 font-mono text-xs text-red-400">{ilTax > 0 ? fmtUSD(ilTax) : '—'}</td>
                        <td className="px-3 py-2 font-mono text-xs text-indigo-300">{fmtUSD(netIL)}</td>
                        <td className="px-3 py-2 font-mono text-xs text-red-400">{usLtTax > 0 ? fmtUSD(usLtTax) : '—'}</td>
                        <td className="px-3 py-2 font-mono text-xs text-indigo-300">{fmtUSD(netUSLT)}</td>
                        <td className="px-3 py-2">
                          <span className="font-mono text-xs text-emerald-400 font-medium">{fmtUSD(bestNet)}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="text-xs text-slate-700 flex items-start gap-2">
            <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
            <span>
              These calculations are illustrative only. Israeli CGT is 25% on the real gain (post-inflation adjustment may apply for foreign securities).
              RSU income at vesting is taxed as ordinary income and is NOT included here — only post-vesting appreciation.
              Consult a tax advisor for your specific situation. IL tax reference:{' '}
              <a href="https://www.meitav.co.il/trade/capital_market_guide/capital_market_tax/" target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline">
                meitav.co.il
              </a>
            </span>
          </div>
        </div>
      )}

      {/* Live sell calculator */}
      {tab === 'calc' && (
        <LiveSellCalc
          live={live}
          scenarios={scenarios}
          avgCostBasis={avgCostBasis}
          taxRegime={taxRegime}
        />
      )}

      {/* Future tax forecast */}
      {tab === 'forecast' && (
        <FutureTaxForecast
          grants={grants}
          live={live}
          taxRegime={taxRegime}
        />
      )}

      {/* NIS Analysis tab */}
      {tab === 'nis' && <NISAnalysisTab usdils={usdils} scenarios={scenarios} avgCostBasis={avgCostBasis} totalVestedShares={totalVestedShares} />}
    </div>
  );
}

// ── Live Sell Calculator ──────────────────────────────────────────────────────
function LiveSellCalc({
  live,
  scenarios,
  avgCostBasis,
  taxRegime,
}: {
  live:         LiveQuote;
  scenarios:    GrantScenario[];
  avgCostBasis: number;
  taxRegime:    TaxRegime;
}) {
  const [sharesToSell, setSharesToSell] = useState('');
  const maxVested = scenarios.reduce((s, sc) => s + sc.vestedShares, 0);
  const shares    = Math.min(Number(sharesToSell) || 0, maxVested);

  const price  = live.price  ?? avgCostBasis;
  const rate   = live.usdils ?? 3.6;

  const grossUSD  = shares * price;
  const grossNIS  = grossUSD * rate;
  const gain      = Math.max(0, (price - avgCostBasis) * shares);
  const tax       = gain * taxRate(taxRegime);
  const taxNIS    = tax * rate;
  const netUSD    = grossUSD - tax;
  const netNIS    = netUSD * rate;
  const effTaxPct = grossUSD > 0 ? (tax / grossUSD) * 100 : 0;

  const tickerLabel = scenarios[0]?.ticker ?? 'stock';
  const isLive = live.price != null;

  return (
    <div className="space-y-4">
      {/* Live price ticker */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className={`flex items-center gap-2 px-4 py-2 rounded-xl border ${
          isLive ? 'bg-emerald-950/30 border-emerald-800/50' : 'bg-slate-800 border-slate-700'
        }`}>
          <Zap className={`w-4 h-4 ${isLive ? 'text-emerald-400' : 'text-slate-500'}`} />
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-mono font-semibold text-white">
                {price > 0 ? `$${price.toFixed(2)}` : '—'}
              </span>
              {live.delta != null && live.delta !== 0 && (
                <span className={`text-sm font-mono ${live.delta > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {live.delta > 0 ? '+' : ''}{live.delta.toFixed(3)}
                </span>
              )}
              <span className="text-xs text-slate-500">{tickerLabel}</span>
            </div>
            <div className="text-xs text-slate-600">
              {isLive ? `live · updated ${live.lastAt?.toLocaleTimeString()}` : 'loading live price…'}
              {live.loading && <RefreshCw className="w-2.5 h-2.5 inline ml-1 animate-spin" />}
            </div>
          </div>
        </div>

        {live.usdils && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-950/30 border border-amber-800/50">
            <ArrowUpDown className="w-3.5 h-3.5 text-amber-400" />
            <div>
              <span className="font-mono text-white text-sm">{live.usdils.toFixed(4)}</span>
              <span className="text-xs text-amber-500 ml-1">NIS/USD</span>
            </div>
          </div>
        )}

        <div className="text-xs text-slate-600 ml-auto">
          <span className="text-indigo-400">₪ NIS/share: </span>
          <span className="font-mono text-white">{(price * rate).toFixed(2)}</span>
        </div>
      </div>

      {/* Shares input */}
      <Card padding="md">
        <div className="flex items-center gap-3 mb-4">
          <Calculator className="w-4 h-4 text-indigo-400" />
          <span className="text-sm font-medium text-white">Shares to Sell</span>
          <span className="text-xs text-slate-600">max {maxVested.toLocaleString()} vested</span>
        </div>

        <div className="flex items-center gap-3">
          <input
            type="number"
            min={0}
            max={maxVested}
            value={sharesToSell}
            onChange={(e) => setSharesToSell(e.target.value)}
            placeholder="0"
            className="w-40 bg-slate-800 border border-slate-600 rounded-xl px-4 py-3 text-2xl font-mono text-white focus:outline-none focus:border-indigo-500 text-center"
          />
          <div className="flex gap-1">
            {[25, 50, 75, 100].map((pct) => (
              <button key={pct}
                onClick={() => setSharesToSell(String(Math.floor(maxVested * pct / 100)))}
                className="text-xs px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-slate-400 hover:bg-indigo-700 hover:text-white hover:border-indigo-600 transition-colors"
              >{pct}%</button>
            ))}
            <button
              onClick={() => setSharesToSell(String(maxVested))}
              className="text-xs px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-slate-400 hover:bg-slate-600 transition-colors"
            >All</button>
          </div>
        </div>

        {shares > 0 && (
          <div className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Gross (USD)', value: `$${grossUSD.toLocaleString('en', { maximumFractionDigits: 0 })}`, sub: `${shares.toLocaleString()} × $${price.toFixed(2)}`, color: 'text-white' },
              { label: 'Gross (NIS)', value: `₪${grossNIS.toLocaleString('he', { maximumFractionDigits: 0 })}`, sub: `@ ${rate.toFixed(3)} NIS/USD`, color: 'text-indigo-300' },
              { label: `Est. Tax (${taxLabel(taxRegime)})`, value: `-$${tax.toLocaleString('en', { maximumFractionDigits: 0 })}`, sub: `₪${taxNIS.toLocaleString('he', { maximumFractionDigits: 0 })} · ${effTaxPct.toFixed(1)}% of gross`, color: 'text-red-400' },
              { label: 'Net Proceeds', value: `$${netUSD.toLocaleString('en', { maximumFractionDigits: 0 })}`, sub: `₪${netNIS.toLocaleString('he', { maximumFractionDigits: 0 })}`, color: 'text-emerald-400' },
            ].map((row) => (
              <div key={row.label} className="bg-slate-950 border border-slate-800 rounded-xl p-3">
                <div className="text-xs text-slate-500 mb-1">{row.label}</div>
                <div className={`text-xl font-mono font-semibold ${row.color}`}>{row.value}</div>
                <div className="text-xs text-slate-600 mt-0.5">{row.sub}</div>
              </div>
            ))}
          </div>
        )}

        {shares > 0 && (
          <div className="mt-3 p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs space-y-1">
            <div className="flex justify-between text-slate-400">
              <span>Capital gain (price − basis)</span>
              <span className="font-mono">${(price - avgCostBasis).toFixed(2)}/share × {shares.toLocaleString()} = ${gain.toLocaleString('en', { maximumFractionDigits: 0 })}</span>
            </div>
            <div className="flex justify-between text-red-400">
              <span>IL CGT 25% on gain</span>
              <span className="font-mono">−${tax.toLocaleString('en', { maximumFractionDigits: 0 })} (−₪{taxNIS.toLocaleString('he', { maximumFractionDigits: 0 })})</span>
            </div>
            <div className="flex justify-between text-emerald-400 font-medium border-t border-slate-800 pt-1">
              <span>Net after tax</span>
              <span className="font-mono">${netUSD.toLocaleString('en', { maximumFractionDigits: 0 })} / ₪{netNIS.toLocaleString('he', { maximumFractionDigits: 0 })}</span>
            </div>
          </div>
        )}
      </Card>

      <p className="text-xs text-slate-700">
        Price and USD/NIS rate refresh every 3 seconds from Yahoo Finance via the local server.
        Tax calculation uses {taxLabel(taxRegime)} on post-vesting gains only.
        Consult a tax advisor for actual liability.
      </p>
    </div>
  );
}

// ── Future Tax Forecast ───────────────────────────────────────────────────────
function FutureTaxForecast({
  grants,
  live,
  taxRegime,
}: {
  grants:    GrantRecord[];
  live:      LiveQuote;
  taxRegime: TaxRegime;
}) {
  const [marginalRate, setMarginalRate] = useState(46); // IL marginal income tax % for RSU vesting

  const currentPrice = live.price ?? 0;
  const currentRate  = live.usdils ?? 3.6;

  const vestingEvents = useMemo(
    () => getAllVestingEvents(grants, currentPrice > 0 ? Object.fromEntries(
      [...new Set(grants.map((g) => g.tickerSymbol?.value).filter(Boolean) as string[])].map((t) => [t, currentPrice])
    ) : undefined),
    [grants, currentPrice]
  );

  // Group by quarter for the chart
  const quarterlyData = useMemo(() => {
    const qMap = new Map<string, { shares: number; grossUSD: number; incomeTax: number; cgtTax: number }>();
    vestingEvents.forEach((ev) => {
      const d = ev.vestDate;
      const q = `Q${Math.ceil((d.getMonth() + 1) / 3)} ${d.getFullYear()}`;
      const prev = qMap.get(q) ?? { shares: 0, grossUSD: 0, incomeTax: 0, cgtTax: 0 };
      const gross      = ev.shares * currentPrice;
      const incomeTax  = gross * (marginalRate / 100);
      const cgtTax     = 0; // at vesting price there's no post-vesting gain yet
      qMap.set(q, {
        shares:     prev.shares + ev.shares,
        grossUSD:   prev.grossUSD + gross,
        incomeTax:  prev.incomeTax + incomeTax,
        cgtTax:     prev.cgtTax + cgtTax,
      });
    });
    return Array.from(qMap.entries()).map(([quarter, v]) => ({ quarter, ...v, netUSD: v.grossUSD - v.incomeTax }));
  }, [vestingEvents, currentPrice, marginalRate]);

  const totalGross    = quarterlyData.reduce((s, r) => s + r.grossUSD,  0);
  const totalTax      = quarterlyData.reduce((s, r) => s + r.incomeTax, 0);
  const totalNet      = totalGross - totalTax;

  const tooltipStyle = {
    contentStyle: { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, fontSize: 11 },
    labelStyle:   { color: '#94a3b8' },
  };

  return (
    <div className="space-y-4">
      {/* Current tax if sold now */}
      <div className="grid grid-cols-3 gap-4">
        <Card padding="md" className="border-indigo-900/40">
          <div className="text-xs text-slate-500 mb-1">Current vested value (live)</div>
          <div className="text-xl font-mono font-semibold text-white">
            {currentPrice > 0 ? fmtUSD(grants.reduce((s, g) => {
              const t = g.totalShares?.value ?? 0;
              const u = g.unvestedShares?.value;
              const v = g.vestedShares?.value;
              const vc = v !== undefined ? v : (u !== undefined ? Math.max(0, t - u) : 0);
              return s + vc * currentPrice;
            }, 0)) : '—'}
          </div>
          <div className="text-xs text-slate-600 mt-0.5">at ${currentPrice.toFixed(2)}/share</div>
        </Card>
        <Card padding="md" className="border-red-900/40">
          <div className="text-xs text-slate-500 mb-1">Tax if sold NOW ({taxLabel(taxRegime)})</div>
          <div className="text-xl font-mono font-semibold text-red-400">
            {currentPrice > 0 ? fmtUSD(grants.reduce((s, g) => {
              const t = g.totalShares?.value ?? 0;
              const u = g.unvestedShares?.value;
              const v = g.vestedShares?.value;
              const vc = v !== undefined ? v : (u !== undefined ? Math.max(0, t - u) : 0);
              const basis = g.fairMarketValue?.value ?? 0;
              const gain = Math.max(0, (currentPrice - basis) * vc);
              return s + gain * taxRate(taxRegime);
            }, 0)) : '—'}
          </div>
          <div className="text-xs text-slate-600 mt-0.5">on post-vesting gain only</div>
        </Card>
        <Card padding="md" className="border-amber-900/40">
          <div className="text-xs text-slate-500 mb-1">Est. RSU income tax at future vesting</div>
          <div className="text-xl font-mono font-semibold text-amber-400">
            {currentPrice > 0 ? fmtUSD(totalTax) : '—'}
          </div>
          <div className="text-xs text-slate-600 mt-0.5">
            {vestingEvents.length} events · {marginalRate}% marginal rate
          </div>
        </Card>
      </div>

      {/* Marginal rate slider */}
      <Card padding="md">
        <div className="flex items-center gap-4">
          <span className="text-xs text-slate-400 whitespace-nowrap">IL Marginal Income Tax Rate (RSU vesting):</span>
          <input type="range" min={20} max={50} step={1} value={marginalRate}
            onChange={(e) => setMarginalRate(Number(e.target.value))}
            className="flex-1 accent-indigo-500" />
          <span className="text-sm font-mono text-indigo-300 w-10 text-right">{marginalRate}%</span>
        </div>
        <p className="text-xs text-slate-600 mt-1">
          RSU shares are taxed as ordinary income at vesting. Israeli marginal rates: 31% (up to ₪245K), 35% (₪245K–₪532K), 47% (above ₪532K annual income).
        </p>
      </Card>

      {/* Quarterly forecast chart */}
      {quarterlyData.length > 0 && (
        <Card padding="md">
          <CardHeader>
            <CardTitle>Future RSU Vesting — Quarterly Gross vs Tax (at current price ${currentPrice.toFixed(2)})</CardTitle>
          </CardHeader>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={quarterlyData} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="quarter" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={fmtUSD} tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip {...tooltipStyle} formatter={(v, name) => [fmtUSD(Number(v)), name === 'grossUSD' ? 'Gross Value' : name === 'incomeTax' ? 'Income Tax' : 'Net After Tax']} />
              <Bar dataKey="grossUSD"  fill="#6366f1" opacity={0.35} radius={[3, 3, 0, 0]} />
              <Bar dataKey="netUSD"    fill="#10b981" opacity={0.8}  radius={[3, 3, 0, 0]} />
              <Bar dataKey="incomeTax" fill="#ef4444" opacity={0.7}  radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="flex gap-4 text-xs text-slate-600 mt-1">
            <span><span className="text-indigo-400 font-mono">▪</span> Gross</span>
            <span><span className="text-emerald-400 font-mono">▪</span> Net after income tax</span>
            <span><span className="text-red-400 font-mono">▪</span> Income tax at {marginalRate}%</span>
          </div>
        </Card>
      )}

      {/* Per-event forecast table */}
      {vestingEvents.length > 0 && (
        <Card padding="none">
          <div className="px-4 py-3 border-b border-slate-800 flex justify-between">
            <CardTitle>Upcoming Vesting Events — Tax Forecast</CardTitle>
            <span className="text-xs text-slate-600">
              Total: {fmtUSD(totalGross)} gross · {fmtUSD(totalTax)} tax · {fmtUSD(totalNet)} net
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/40">
                  {['Vest Date', 'Grant', 'Shares', 'Est. Price', 'Gross (USD)', 'Gross (NIS)', 'Income Tax (IL)', 'Net (USD)', 'Net (NIS)'].map((h) => (
                    <th key={h} className="text-left px-3 py-2.5 text-xs text-slate-500 font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {vestingEvents.slice(0, 20).map((ev) => {
                  const gross    = ev.shares * currentPrice;
                  const grossNIS = gross * currentRate;
                  const iTax     = gross * (marginalRate / 100);
                  const iTaxNIS  = iTax * currentRate;
                  const net      = gross - iTax;
                  const netNIS   = net * currentRate;
                  const daysLeft = Math.ceil((ev.vestDate.getTime() - Date.now()) / 86400000);
                  return (
                    <tr key={ev.key} className="hover:bg-slate-800/20">
                      <td className="px-3 py-2 text-xs">
                        <div className="text-white">{ev.vestDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                        <div className={`text-xs mt-0.5 ${daysLeft <= 30 ? 'text-amber-400' : 'text-slate-600'}`}>in {daysLeft}d</div>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-400">{ev.grantId}</td>
                      <td className="px-3 py-2 font-mono text-xs text-white">{ev.shares.toLocaleString()}</td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-300">${currentPrice.toFixed(2)}</td>
                      <td className="px-3 py-2 font-mono text-xs text-white">{fmtUSD(gross)}</td>
                      <td className="px-3 py-2 font-mono text-xs text-indigo-300">₪{Math.round(grossNIS).toLocaleString()}</td>
                      <td className="px-3 py-2 font-mono text-xs text-red-400">-{fmtUSD(iTax)}<br/><span className="text-red-600">-₪{Math.round(iTaxNIS).toLocaleString()}</span></td>
                      <td className="px-3 py-2 font-mono text-xs text-emerald-400">{fmtUSD(net)}</td>
                      <td className="px-3 py-2 font-mono text-xs text-emerald-300">₪{Math.round(netNIS).toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="text-xs text-slate-700 flex items-start gap-2">
        <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
        <span>
          Future vesting income tax assumes shares vest at the <em>current live price</em> — actual vesting price will differ.
          RSU income at vesting is taxed at the marginal rate (ordinary income), not the 25% CGT rate.
          Post-vesting gains (price appreciation after vest) are taxed at 25% CGT when sold.
          IL tax reference: <a href="https://www.meitav.co.il/trade/capital_market_guide/capital_market_tax/" target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline">meitav.co.il</a>
        </span>
      </div>
    </div>
  );
}

// ── NIS Analysis ──────────────────────────────────────────────────────────────
function NISAnalysisTab({
  usdils,
  scenarios,
  avgCostBasis,
  totalVestedShares,
}: {
  usdils: CurrencyData;
  scenarios: GrantScenario[];
  avgCostBasis: number;
  totalVestedShares: number;
}) {
  const tickers = [...new Set(scenarios.map((s) => s.ticker).filter(Boolean))];
  const [rangeDays, setRangeDays] = useState(180);  // timeline slider in days

  // Fetch DAILY price + USD/ILS from the new /api/chart endpoint
  interface DailyPoint { date: number; price?: number; rate?: number }
  const [dailyPrices, setDailyPrices] = useState<DailyPoint[]>([]);
  const [dailyRates,  setDailyRates]  = useState<DailyPoint[]>([]);

  useEffect(() => {
    const ticker = tickers[0];
    if (!ticker) return;
    fetch(`/api/chart/${encodeURIComponent(ticker)}?interval=1d&range_=1y`, { signal: AbortSignal.timeout(15_000) })
      .then((r) => r.json())
      .then((d: { prices?: DailyPoint[]; usdils?: DailyPoint[] }) => {
        if (d.prices?.length)  setDailyPrices(d.prices);
        if (d.usdils?.length)  setDailyRates(d.usdils);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickers.join(',')]);

  const currentRate = usdils.current ?? 3.6;

  // Build daily combined series: align prices + rates by closest date
  const allCombinedData = useMemo(() => {
    if (!dailyPrices.length) return [];

    // Build a date → rate map from daily rates
    const rateMap = new Map<string, number>();
    dailyRates.forEach((r) => {
      const key = new Date(r.date * 1000).toISOString().slice(0, 10);
      if (r.rate != null) rateMap.set(key, r.rate);
    });

    // Fill forward for missing rate days
    let lastRate = currentRate;
    return dailyPrices.map((p) => {
      const dateKey  = new Date(p.date * 1000).toISOString().slice(0, 10);
      const dayLabel = new Date(p.date * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const rate     = rateMap.get(dateKey) ?? lastRate;
      lastRate = rate;
      const usdPrice    = p.price ?? 0;
      const nisPerShare = +(usdPrice * rate).toFixed(2);
      return { date: dateKey, day: dayLabel, usdPrice, usdilsRate: rate, nisPerShare };
    }).filter((d) => d.usdPrice > 0);
  }, [dailyPrices, dailyRates, currentRate]);

  // Slice to the selected range (days)
  const combinedData = useMemo(
    () => allCombinedData.slice(-rangeDays),
    [allCombinedData, rangeDays],
  );

  // Find best NIS value day in the selected range
  const bestNIS = combinedData.reduce(
    (b, d) => d.nisPerShare > b.nisPerShare ? d : b,
    combinedData[0] ?? { day: '—', date: '—', nisPerShare: 0, usdPrice: 0, usdilsRate: 0 },
  );

  // Statement date NIS values
  const statementPoints = scenarios.flatMap((sc) => {
    if (!sc.docPrice || !sc.sourceFile) return [];
    // Try to find the closest rate to the doc price period
    const approxRate = usdils.history.length > 0
      ? usdils.history[Math.floor(usdils.history.length / 2)].rate
      : currentRate;
    return [{
      grantId:    sc.grantId,
      sourceFile: sc.sourceFile,
      usdPrice:   sc.docPrice,
      rate:       approxRate,
      nisValue:   +(sc.docPrice * approxRate).toFixed(2),
    }];
  });

  const currentNISPerShare = avgCostBasis > 0 ? +(avgCostBasis * currentRate).toFixed(2) : 0;
  const currentNISTotal    = +(totalVestedShares * avgCostBasis * currentRate).toFixed(0);

  const tooltipStyle = {
    contentStyle: { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, fontSize: 11 },
    labelStyle:   { color: '#94a3b8' },
  };

  return (
    <div className="space-y-5">

      {/* Current stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card padding="md">
          <div className="text-xs text-slate-500 mb-1 flex items-center gap-1">
            <ArrowUpDown className="w-3 h-3" /> USD/NIS Rate
          </div>
          <div className="text-2xl font-semibold text-white font-mono">
            {currentRate.toFixed(3)}
          </div>
          <div className="text-xs text-slate-600 mt-0.5">₪ per $1</div>
        </Card>
        <Card padding="md">
          <div className="text-xs text-slate-500 mb-1">NIS / share today</div>
          <div className="text-2xl font-semibold text-indigo-300 font-mono">
            ₪{currentNISPerShare.toFixed(2)}
          </div>
          <div className="text-xs text-slate-600 mt-0.5">at avg cost basis ${avgCostBasis.toFixed(2)}</div>
        </Card>
        <Card padding="md">
          <div className="text-xs text-slate-500 mb-1 flex items-center gap-1">
            <TrendingUp className="w-3 h-3 text-emerald-500" /> Best NIS value (12m)
          </div>
          <div className="text-2xl font-semibold text-emerald-400 font-mono">
            {bestNIS.nisPerShare > 0 ? `₪${bestNIS.nisPerShare.toFixed(2)}` : '—'}
          </div>
          <div className="text-xs text-slate-600 mt-0.5">
            {(bestNIS as { day?: string }).day ?? (bestNIS as { date?: string }).date ?? '—'} · ${bestNIS.usdPrice.toFixed(2)} × {bestNIS.usdilsRate.toFixed(3)}
          </div>
        </Card>
        <Card padding="md">
          <div className="text-xs text-slate-500 mb-1">Vested Portfolio (NIS)</div>
          <div className="text-2xl font-semibold text-white font-mono">
            {currentNISTotal > 0 ? `₪${currentNISTotal.toLocaleString()}` : '—'}
          </div>
          <div className="text-xs text-slate-600 mt-0.5">{totalVestedShares.toLocaleString()} shares</div>
        </Card>
      </div>

      {/* Combined chart */}
      {combinedData.length > 0 ? (
        <Card padding="md">
          <CardHeader>
            <div>
              <CardTitle>₪ NIS Value per Share vs USD/NIS Rate</CardTitle>
              <p className="text-xs text-slate-600 mt-0.5">stock price × exchange rate</p>
            </div>
              {/* Timeline range slider — in trading days */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-xs text-slate-500">Range:</span>
              <div className="flex gap-1">
                {[30, 90, 180, 365].map((d) => (
                  <button key={d}
                    onClick={() => setRangeDays(d)}
                    className={`text-xs px-2 py-1 rounded transition-colors ${
                      rangeDays === d ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}
                  >{d >= 365 ? '1Y' : d >= 180 ? '6M' : d >= 90 ? '3M' : '1M'}</button>
                ))}
              </div>
              <input
                type="range"
                min={5}
                max={allCombinedData.length || 252}
                step={1}
                value={rangeDays}
                onChange={(e) => setRangeDays(Number(e.target.value))}
                className="w-28 accent-indigo-500"
              />
              <span className="text-xs font-mono text-indigo-300 w-16 text-right">
                {rangeDays}d / {combinedData.length}pts
              </span>
            </div>
          </CardHeader>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={combinedData} margin={{ top: 4, right: 40, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="nisGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="day"
                tick={{ fill: '#64748b', fontSize: 9 }} axisLine={false} tickLine={false}
                interval={Math.max(1, Math.floor(combinedData.length / 8))}
              />
              {/* Left axis: NIS per share */}
              <YAxis yAxisId="nis" tickFormatter={(v) => `₪${v.toFixed(0)}`}
                tick={{ fill: '#818cf8', fontSize: 10 }} axisLine={false} tickLine={false} />
              {/* Right axis: USD/NIS rate */}
              <YAxis yAxisId="rate" orientation="right" domain={['auto', 'auto']}
                tickFormatter={(v) => v.toFixed(3)}
                tick={{ fill: '#f59e0b', fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip {...tooltipStyle}
                formatter={(v, name) => {
                  if (name === 'nisPerShare') return [`₪${Number(v).toFixed(2)}`, '₪ per share'];
                  if (name === 'usdilsRate')  return [Number(v).toFixed(4), 'USD/NIS'];
                  if (name === 'usdPrice')    return [`$${Number(v).toFixed(2)}`, 'USD price'];
                  return [v, name];
                }}
              />
              {/* NIS per share area */}
              <Area yAxisId="nis" type="monotone" dataKey="nisPerShare"
                stroke="#6366f1" fill="url(#nisGrad)" strokeWidth={2} dot={false} />
              {/* Stock price in USD */}
              <Line yAxisId="nis" type="monotone" dataKey="usdPrice"
                stroke="#10b981" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
              {/* USD/NIS rate */}
              <Line yAxisId="rate" type="monotone" dataKey="usdilsRate"
                stroke="#f59e0b" strokeWidth={1.5} dot={false} />
              {/* Best NIS month */}
              {bestNIS.nisPerShare > 0 && (
                <ReferenceLine yAxisId="nis" y={bestNIS.nisPerShare} stroke="#10b981" strokeDasharray="3 3" strokeOpacity={0.5}
                  label={{ value: `Best ₪${bestNIS.nisPerShare.toFixed(0)}`, position: 'right', fill: '#10b981', fontSize: 9 }} />
              )}
            </ComposedChart>
          </ResponsiveContainer>
          <div className="flex gap-4 text-xs text-slate-600 mt-1 flex-wrap">
            <span className="flex items-center gap-1"><span className="w-4 border-t-2 border-indigo-500 inline-block" /> ₪ NIS/share (left axis)</span>
            <span className="flex items-center gap-1"><span className="w-4 border-t border-emerald-500 border-dashed inline-block" /> USD price (left axis)</span>
            <span className="flex items-center gap-1"><span className="w-4 border-t border-amber-500 inline-block" /> USD/NIS rate (right axis)</span>
          </div>
        </Card>
      ) : (
        <Card padding="md">
          <p className="text-xs text-slate-500 text-center py-4">
            Loading price + currency history… (requires server running)
          </p>
        </Card>
      )}

      {/* Statement-date NIS value table */}
      {statementPoints.length > 0 && (
        <Card padding="none">
          <div className="px-4 py-3 border-b border-slate-800">
            <CardTitle>Statement-Date NIS Values</CardTitle>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/40">
                  {['Grant', 'Source', 'USD Price (doc)', 'USD/NIS (est.)', '₪ per Share', '₪ Total (vested)', 'vs Current ₪'].map((h) => (
                    <th key={h} className="text-left px-3 py-2.5 text-xs text-slate-500 font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {statementPoints.map((sp) => {
                  const sc       = scenarios.find((s) => s.grantId === sp.grantId);
                  const vested   = sc?.vestedShares ?? 0;
                  const nisTotal = +(vested * sp.usdPrice * sp.rate).toFixed(0);
                  const curNIS   = +(vested * avgCostBasis * currentRate).toFixed(0);
                  const diff     = curNIS - nisTotal;
                  return (
                    <tr key={sp.grantId} className="hover:bg-slate-800/20">
                      <td className="px-3 py-2.5 font-mono text-xs text-white">{sp.grantId}</td>
                      <td className="px-3 py-2.5 text-xs text-slate-500 max-w-32 truncate">{sp.sourceFile}</td>
                      <td className="px-3 py-2.5 font-mono text-xs text-white">${sp.usdPrice.toFixed(2)}</td>
                      <td className="px-3 py-2.5 font-mono text-xs text-amber-400">{sp.rate.toFixed(4)}</td>
                      <td className="px-3 py-2.5 font-mono text-xs text-indigo-300">₪{sp.nisValue.toFixed(2)}</td>
                      <td className="px-3 py-2.5 font-mono text-xs text-white">₪{nisTotal.toLocaleString()}</td>
                      <td className="px-3 py-2.5">
                        <span className={`text-xs font-mono ${diff >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {diff >= 0 ? '+' : ''}₪{diff.toLocaleString()}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* What-if NIS scenarios */}
      <Card padding="md">
        <CardHeader>
          <CardTitle>NIS Value at Different USD/NIS Rates (current stock price)</CardTitle>
          <span className="text-xs text-slate-600">{avgCostBasis > 0 ? `$${avgCostBasis.toFixed(2)}/share` : ''}</span>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="text-left px-3 py-2 text-slate-500">USD/NIS Rate</th>
                <th className="text-left px-3 py-2 text-slate-500">₪ / share</th>
                <th className="text-left px-3 py-2 text-slate-500">Total (vested)</th>
                <th className="text-left px-3 py-2 text-slate-500">vs Current</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {[3.0, 3.2, 3.4, 3.5, 3.6, 3.7, 3.8, 4.0, 4.2].map((rate) => {
                const nisPS    = +(avgCostBasis * rate).toFixed(2);
                const total    = +(totalVestedShares * avgCostBasis * rate).toFixed(0);
                const curTotal = +(totalVestedShares * avgCostBasis * currentRate).toFixed(0);
                const diff     = total - curTotal;
                const isCurrent = Math.abs(rate - currentRate) < 0.1;
                return (
                  <tr key={rate} className={`${isCurrent ? 'bg-indigo-950/30' : 'hover:bg-slate-800/20'}`}>
                    <td className={`px-3 py-1.5 font-mono ${isCurrent ? 'text-indigo-300 font-medium' : 'text-slate-400'}`}>
                      {rate.toFixed(1)} {isCurrent && <span className="text-xs text-indigo-500 ml-1">← current</span>}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-white">₪{nisPS.toFixed(2)}</td>
                    <td className="px-3 py-1.5 font-mono text-white">₪{total.toLocaleString()}</td>
                    <td className="px-3 py-1.5">
                      {!isCurrent && (
                        <span className={`font-mono ${diff >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {diff >= 0 ? '+' : ''}₪{diff.toLocaleString()}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-xs text-slate-700">
        USD/NIS history via Yahoo Finance · Statement-date rates are approximate (mid-month).
        For Israeli residents, RSU proceeds received in USD are converted to NIS for tax reporting purposes.
      </p>
    </div>
  );
}
