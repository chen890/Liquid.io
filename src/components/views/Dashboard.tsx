import React, { useMemo, useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, ResponsiveContainer, Legend,
  ComposedChart, Area,
} from 'recharts';
import { TrendingUp, DollarSign, Layers, ArrowRight, Clock, Tag, Banknote, RefreshCw } from 'lucide-react';
import { usePortfolioStore } from '../../store/portfolioStore';
import { computePortfolioStats } from '../../lib/insights';
import { getAllVestingEvents, groupByMonth } from '../../lib/vestingSchedule';
import { VestedInsights } from './VestedInsights';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────
function StatCard({
  label, value, sub, icon: Icon, accent,
}: {
  label: string; value: string; sub?: string; icon: React.ElementType; accent: string;
}) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500 uppercase tracking-wider">{label}</span>
        <div className={`w-8 h-8 rounded-lg ${accent} flex items-center justify-center`}>
          <Icon className="w-4 h-4 text-white" />
        </div>
      </div>
      <div>
        <div className="text-2xl font-semibold text-white">{value}</div>
        {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

const GRANT_COLORS: Record<string, string> = {
  RSU: '#6366f1', ISO: '#0ea5e9', NSO: '#10b981',
  ESPP: '#f59e0b', RestrictedShares: '#8b5cf6', PerformanceShares: '#ec4899',
};

const GRANT_BADGE_VARIANT: Record<string, 'purple' | 'info' | 'success' | 'warning' | 'default'> = {
  RSU: 'purple', ISO: 'info', NSO: 'success', ESPP: 'warning',
};

const fmtUSD = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M`
  : n >= 1_000   ? `$${(n / 1_000).toFixed(0)}K`
  : `$${n.toFixed(0)}`;

const fmtDate = (d: Date) =>
  d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

const fmtShort = (d: Date) =>
  d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });

// ──────────────────────────────────────────────────────────────────────────────
// Vesting event row
// ──────────────────────────────────────────────────────────────────────────────
function daysUntil(d: Date) {
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000);
}

function urgencyClass(d: Date) {
  const days = daysUntil(d);
  if (days <= 30)  return 'text-amber-400';
  if (days <= 90)  return 'text-emerald-400';
  return 'text-slate-400';
}

// ──────────────────────────────────────────────────────────────────────────────
// Live price hook — calls /api/price/{ticker} via the Python server
// ──────────────────────────────────────────────────────────────────────────────
interface LivePrice { price: number | null; name: string; failed?: boolean }

function useLivePrices(tickers: string[], refreshKey = 0): {
  prices: Record<string, LivePrice>;
  loading: boolean;
  serverOnline: boolean;
} {
  const [prices, setPrices] = useState<Record<string, LivePrice>>({});
  const [pending, setPending] = useState(0);
  const [serverOnline, setServerOnline] = useState(true);

  useEffect(() => {
    const unique = [...new Set(tickers.filter(Boolean))];
    if (unique.length === 0) return;

    setPending(unique.length);
    setPrices({});

    unique.forEach(async (ticker) => {
      try {
        const r = await fetch(`/api/price/${encodeURIComponent(ticker)}`, {
          signal: AbortSignal.timeout(8000),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json() as { price?: number | null; name?: string; ok?: boolean };
        setServerOnline(true);
        setPrices((prev) => ({
          ...prev,
          [ticker]: d.ok && d.price != null
            ? { price: d.price, name: d.name ?? ticker }
            : { price: null, name: ticker, failed: true },
        }));
      } catch {
        setServerOnline(false);
        setPrices((prev) => ({ ...prev, [ticker]: { price: null, name: ticker, failed: true } }));
      } finally {
        setPending((n) => n - 1);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickers.join(','), refreshKey]);

  return { prices, loading: pending > 0, serverOnline };
}

// ──────────────────────────────────────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────────────────────────────────────
export function Dashboard() {
  const { portfolio, setView } = usePortfolioStore();
  const grants = portfolio.grants;
  const stats  = useMemo(() => computePortfolioStats(grants), [grants]);

  // Live prices — collect unique tickers from all grants
  const tickers = useMemo(
    () => [...new Set(grants.map((g) => g.tickerSymbol?.value).filter(Boolean) as string[])],
    [grants],
  );
  const [priceRefreshKey, setPriceRefreshKey] = useState(0);
  const { prices: livePrices, loading: pricesLoading, serverOnline: priceServerOnline } =
    useLivePrices(tickers, priceRefreshKey);

  // Recompute key values using live prices where available, fall back to doc price
  const liveStats = useMemo(() => {
    let liveVestedValue = 0;
    let liveSellableValue = 0;
    let liveUnvestedValue = 0;
    let pricesLoaded = 0;

    for (const g of grants) {
      const ticker     = g.tickerSymbol?.value ?? '';
      const livePrice  = (livePrices[ticker]?.price ?? null) as number | null;
      const docPrice   = g.fairMarketValue?.value ??
        (g.currentMarketValue?.value && g.totalShares?.value
          ? g.currentMarketValue.value / g.totalShares.value : 0);
      const price      = livePrice ?? docPrice;
      if (livePrice != null) pricesLoaded++;

      const total  = g.totalShares?.value ?? 0;
      const unvest = g.unvestedShares?.value;
      const vested = g.vestedShares?.value;

      const vestedCount = vested !== undefined ? vested
        : (unvest !== undefined && total > 0 ? Math.max(0, total - unvest) : 0);
      const unvestedCount = unvest !== undefined ? unvest
        : (vested !== undefined && total > 0 ? Math.max(0, total - vested) : total);

      liveVestedValue   += price * vestedCount;
      liveUnvestedValue += price * unvestedCount;

      const type = g.grantType?.value ?? '';
      if (!['ISO', 'NSO'].includes(type)) liveSellableValue += price * vestedCount;
    }

    return { liveVestedValue, liveSellableValue, liveUnvestedValue, pricesLoaded };
  }, [grants, livePrices]);

  // All future vesting events — use live prices for value columns when available
  const livePriceMap = useMemo(
    () => Object.fromEntries(Object.entries(livePrices).map(([t, v]) => [t, v.price ?? 0]).filter(([, p]) => Number(p) > 0)),
    [livePrices],
  );
  const vestingEvents = useMemo(
    () => getAllVestingEvents(grants, Object.keys(livePriceMap).length > 0 ? livePriceMap : undefined),
    [grants, livePriceMap],
  );

  // Monthly chart data — next 24 months
  const vestingByMonth = useMemo(() => groupByMonth(vestingEvents).slice(0, 24), [vestingEvents]);

  // Next 15 events shown in the table
  const upcomingEvents = useMemo(() => vestingEvents.slice(0, 15), [vestingEvents]);

  // Grant type pie
  const grantTypeData = useMemo(() => {
    const byType: Record<string, number> = {};
    grants.forEach((g) => {
      const type = g.grantType?.value ?? 'Unknown';
      byType[type] = (byType[type] ?? 0) + (g.totalShares?.value ?? 0);
    });
    return Object.entries(byType).map(([name, value]) => ({ name, value }));
  }, [grants]);

  // Cumulative vesting value projection
  const cumulativeData = useMemo(() => {
    let running = stats.vestedValue;
    return vestingByMonth.map((m) => {
      running += m.value;
      return { month: m.month, cumulative: Math.round(running), monthly: Math.round(m.value) };
    });
  }, [vestingByMonth, stats.vestedValue]);

  // ── Empty state ─────────────────────────────────────────────────────────────
  if (grants.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-6 p-12 text-center">
        <div className="w-16 h-16 rounded-2xl bg-indigo-600/20 border border-indigo-700/30 flex items-center justify-center">
          <TrendingUp className="w-8 h-8 text-indigo-400" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-white mb-2">No grants imported yet</h2>
          <p className="text-slate-400 max-w-sm">
            Upload your equity documents and let the AI extract and organize your portfolio.
          </p>
        </div>
        <Button variant="primary" size="lg" onClick={() => setView('upload')}>
          <ArrowRight className="w-4 h-4" /> Upload Documents
        </Button>
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Portfolio Overview</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {grants.length} grants · {vestingEvents.length} upcoming vesting events
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setView('upload')}>
          <TrendingUp className="w-3.5 h-3.5" /> Add Documents
        </Button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Grants"   value={String(stats.totalGrants)}
          sub={`${stats.totalShares.toLocaleString()} total shares`} icon={Layers} accent="bg-indigo-600" />

        <StatCard
          label="Vested Value"
          value={fmtUSD(liveStats.pricesLoaded > 0 ? liveStats.liveVestedValue : stats.vestedValue)}
          sub={liveStats.pricesLoaded > 0
            ? `doc: ${fmtUSD(stats.vestedValue)} · live price`
            : 'at statement date price'}
          icon={DollarSign} accent="bg-emerald-600"
        />

        <StatCard
          label="Sellable Now"
          value={fmtUSD(liveStats.pricesLoaded > 0 ? liveStats.liveSellableValue : stats.sellableNowValue)}
          sub={liveStats.pricesLoaded > 0
            ? `RSU · live price · doc: ${fmtUSD(stats.sellableNowValue)}`
            : 'RSU · subject to trading window'}
          icon={Banknote} accent="bg-teal-600"
        />

        <StatCard
          label="Unvested Value"
          value={fmtUSD(liveStats.pricesLoaded > 0 ? liveStats.liveUnvestedValue : stats.unvestedValue)}
          sub={vestingEvents[0]
            ? `Next: ${fmtShort(vestingEvents[0].vestDate)}${liveStats.pricesLoaded > 0 ? ' · live price' : ''}`
            : `${stats.totalUnvested.toLocaleString()} shares`}
          icon={TrendingUp} accent="bg-amber-600"
        />
      </div>

      {/* Vesting timeline + pie */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Monthly vesting chart */}
        <Card className="lg:col-span-2" padding="md">
          <CardHeader>
            <CardTitle>Shares Vesting Per Month</CardTitle>
            <span className="text-xs text-slate-600">next 24 months</span>
          </CardHeader>
          {vestingByMonth.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={vestingByMonth} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false}
                  tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}K` : v} />
                <Tooltip {...tooltipStyle} itemStyle={{ color: '#818cf8' }}
                  formatter={(v) => [Number(v).toLocaleString(), 'Shares']} />
                <Bar dataKey="shares" fill="#6366f1" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[200px] flex items-center justify-center text-slate-600 text-sm">
              All grants are fully vested
            </div>
          )}
        </Card>

        {/* Grant type pie */}
        <Card padding="md">
          <CardHeader><CardTitle>By Grant Type</CardTitle></CardHeader>
          {grantTypeData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={grantTypeData} cx="50%" cy="50%" innerRadius={50} outerRadius={75}
                  paddingAngle={2} dataKey="value">
                  {grantTypeData.map((entry, i) => (
                    <Cell key={entry.name} fill={GRANT_COLORS[entry.name] ?? `hsl(${i * 60}, 60%, 55%)`} />
                  ))}
                </Pie>
                <Tooltip {...tooltipStyle} formatter={(v) => [Number(v).toLocaleString(), 'Shares']} />
                <Legend iconSize={8} wrapperStyle={{ fontSize: 11, color: '#64748b' }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[200px] flex items-center justify-center text-slate-600 text-sm">No data</div>
          )}
        </Card>
      </div>

      {/* Cumulative portfolio value */}
      {cumulativeData.length > 0 && (
        <Card padding="md">
          <CardHeader>
            <CardTitle>Cumulative Portfolio Value as Shares Vest</CardTitle>
            <span className="text-xs text-slate-600">at current FMV · illustrative</span>
          </CardHeader>
          <ResponsiveContainer width="100%" height={180}>
            <ComposedChart data={cumulativeData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="cumGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={fmtUSD} tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip {...tooltipStyle}
                formatter={(v, name) => [fmtUSD(Number(v)), name === 'cumulative' ? 'Portfolio Value' : 'Monthly Vest']} />
              <Area type="monotone" dataKey="cumulative" stroke="#6366f1" fill="url(#cumGrad)" strokeWidth={2} />
              <Bar dataKey="monthly" fill="#334155" radius={[2, 2, 0, 0]} />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Already vested — sellable now */}
      {stats.sellableNowValue > 0 && (() => {
        const sellableGrants = grants.filter((g) => {
          const type = g.grantType?.value ?? '';
          if (['ISO', 'NSO'].includes(type)) return false;
          const vested  = g.vestedShares?.value;
          const total   = g.totalShares?.value ?? 0;
          const unvest  = g.unvestedShares?.value;
          const count =
            vested !== undefined ? vested :
            (unvest !== undefined && total > 0 ? Math.max(0, total - unvest) : total);
          return count > 0;
        });
        if (sellableGrants.length === 0) return null;

        return (
          <Card padding="none">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
              <div>
                <CardTitle>Currently Vested — Sellable Now</CardTitle>
                <p className="text-xs text-slate-600 mt-0.5">
                  RSU shares already vested and held in your account · subject to company trading windows
                </p>
              </div>
              <div className="flex items-center gap-2">
                {!priceServerOnline && (
                  <span className="text-xs text-amber-500">server offline — showing doc price</span>
                )}
                <button
                  onClick={() => setPriceRefreshKey((k) => k + 1)}
                  title="Refresh live prices"
                  className={`p-1.5 rounded text-slate-500 hover:text-white hover:bg-slate-700 transition-colors ${pricesLoading ? 'animate-spin' : ''}`}
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
                <Banknote className="w-4 h-4 text-teal-500" />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-950/40">
                    {['Grant', 'Grant Date', 'Type', 'Source', 'Vested Shares', 'Doc Price', 'Current Price', 'Current Value', 'P&L', 'Status'].map((h) => (
                      <th key={h} className="text-left px-4 py-2.5 text-xs text-slate-500 font-medium whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {sellableGrants.map((g) => {
                    const type    = g.grantType?.value ?? 'Grant';
                    const total   = g.totalShares?.value ?? 0;
                    const unvest  = g.unvestedShares?.value;
                    const vested  = g.vestedShares?.value;
                    const count   = vested !== undefined ? vested :
                      (unvest !== undefined && total > 0 ? Math.max(0, total - unvest) : total);
                    const docPrice = g.fairMarketValue?.value ??
                      (g.currentMarketValue?.value && total ? g.currentMarketValue.value / total : 0);
                    const ticker   = g.tickerSymbol?.value ?? '';
                    const live     = livePrices[ticker];
                    const curPrice = live?.price ?? null;
                    const docVal   = count * docPrice;
                    const curVal   = curPrice != null ? count * curPrice : null;
                    const pnl      = curVal != null && docVal > 0 ? curVal - docVal : null;
                    const pnlPct   = pnl != null && docVal > 0 ? (pnl / docVal) * 100 : null;
                    const grantDateStr = g.grantDate?.value
                      ? new Date(g.grantDate.value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                      : '—';

                    return (
                      <tr key={g.id} className="hover:bg-slate-800/20">
                        {/* Grant ID + ticker */}
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className="text-white font-mono text-xs">
                              {g.grantId?.value ?? g.id.slice(0, 8)}
                            </span>
                            {ticker && (
                              <span className="text-xs text-slate-500 flex items-center gap-0.5">
                                <Tag className="w-2.5 h-2.5" />{ticker}
                              </span>
                            )}
                          </div>
                        </td>
                        {/* Grant date */}
                        <td className="px-4 py-2.5 text-xs text-slate-400 whitespace-nowrap">
                          {grantDateStr}
                        </td>
                        {/* Type */}
                        <td className="px-4 py-2.5">
                          <Badge variant={GRANT_BADGE_VARIANT[type] ?? 'default'} size="sm">{type}</Badge>
                        </td>
                        {/* Source file */}
                        <td className="px-4 py-2.5">
                          <span className="text-xs text-slate-600 max-w-28 truncate block">{g.sourceFiles[0]}</span>
                        </td>
                        {/* Vested shares */}
                        <td className="px-4 py-2.5 font-mono text-xs text-white">
                          {count.toLocaleString()}
                        </td>
                        {/* Doc price */}
                        <td className="px-4 py-2.5">
                          <div>
                            <span className="font-mono text-xs text-slate-300">
                              {docPrice > 0 ? `$${docPrice.toFixed(2)}` : '—'}
                            </span>
                            <span className="block text-xs text-slate-600 mt-0.5">at statement date</span>
                          </div>
                        </td>
                        {/* Live price */}
                        <td className="px-4 py-2.5">
                          {curPrice != null ? (
                            <div>
                              <span className="font-mono text-xs text-white">${curPrice.toFixed(2)}</span>
                              {docPrice > 0 && (
                                <span className={`block text-xs mt-0.5 ${curPrice >= docPrice ? 'text-emerald-500' : 'text-red-400'}`}>
                                  {curPrice >= docPrice ? '▲' : '▼'} {Math.abs(((curPrice - docPrice) / docPrice) * 100).toFixed(1)}% vs doc
                                </span>
                              )}
                            </div>
                          ) : livePrices[ticker]?.failed ? (
                            <span className="text-xs text-slate-600">unavailable</span>
                          ) : pricesLoading ? (
                            <span className="text-xs text-slate-600 flex items-center gap-1">
                              <svg className="animate-spin w-2.5 h-2.5" viewBox="0 0 24 24" fill="none">
                                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25"/>
                                <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" className="opacity-75"/>
                              </svg>
                              fetching
                            </span>
                          ) : (
                            <span className="text-xs text-slate-600">—</span>
                          )}
                        </td>
                        {/* Current value */}
                        <td className="px-4 py-2.5">
                          <span className="text-xs font-mono text-white">
                            {curVal != null ? fmtUSD(curVal) : fmtUSD(docVal)}
                          </span>
                        </td>
                        {/* P&L vs doc */}
                        <td className="px-4 py-2.5">
                          {pnl != null ? (
                            <div>
                              <span className={`text-xs font-mono ${pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {pnl >= 0 ? '+' : ''}{fmtUSD(pnl)}
                              </span>
                              {pnlPct != null && (
                                <span className={`block text-xs mt-0.5 ${pnl >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                  {pnl >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-600">—</span>
                          )}
                        </td>
                        {/* Status */}
                        <td className="px-4 py-2.5">
                          <span className="inline-flex items-center gap-1 text-xs text-teal-400 bg-teal-950/40 border border-teal-800/50 px-2 py-0.5 rounded whitespace-nowrap">
                            Sellable Now
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 border-t border-slate-800 text-xs text-slate-600 flex items-center justify-between">
              <span>
                Current prices via Yahoo Finance
                {priceServerOnline && !pricesLoading && Object.values(livePrices).some((v) => v.price != null) && (
                  <span className="text-slate-700"> · updated just now</span>
                )}
              </span>
              {!priceServerOnline && (
                <span className="text-amber-600">
                  Run <code className="font-mono">npm start</code> to enable live prices
                </span>
              )}
            </div>
          </Card>
        );
      })()}

      {/* Sell / Hold insights per ticker */}
      {liveStats.pricesLoaded > 0 && (() => {
        // Group vested grants by ticker
        const byTicker = new Map<string, typeof grants>();
        for (const g of grants) {
          const ticker = g.tickerSymbol?.value;
          if (!ticker) continue;
          const type = g.grantType?.value ?? '';
          if (['ISO', 'NSO'].includes(type)) continue; // options handled separately
          const total = g.totalShares?.value ?? 0;
          const unvest = g.unvestedShares?.value;
          const vested = g.vestedShares?.value;
          const count = vested !== undefined ? vested
            : (unvest !== undefined && total > 0 ? Math.max(0, total - unvest) : 0);
          if (count <= 0) continue;
          byTicker.set(ticker, [...(byTicker.get(ticker) ?? []), g]);
        }
        if (byTicker.size === 0) return null;
        return Array.from(byTicker.entries()).map(([ticker, tickerGrants]) => {
          const curPrice = livePrices[ticker]?.price ?? 0;
          if (!curPrice) return null;
          return (
            <VestedInsights
              key={ticker}
              ticker={ticker}
              grants={tickerGrants}
              currentPrice={curPrice}
              totalPortfolioValue={liveStats.liveVestedValue + liveStats.liveUnvestedValue}
            />
          );
        });
      })()}

      {/* Upcoming vesting events table */}
      {upcomingEvents.length > 0 && (
        <Card padding="none">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <div>
              <CardTitle>Upcoming Vesting Events</CardTitle>
              <p className="text-xs text-slate-600 mt-0.5">
                When shares vest and can be sold · ISO options require +12 mo holding for LTCG
              </p>
            </div>
            <Clock className="w-4 h-4 text-slate-600" />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/40">
                  {['Grant', 'Type', 'Source', 'Vest Date', 'Can Sell', 'Shares', 'Est. Value'].map((h) => (
                    <th key={h} className="text-left px-4 py-2.5 text-xs text-slate-500 font-medium whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {upcomingEvents.map((ev) => {
                  const days = daysUntil(ev.vestDate);
                  return (
                    <tr key={ev.key} className="hover:bg-slate-800/20 transition-colors">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="text-white font-mono text-xs">{ev.grantId}</span>
                          {ev.ticker && (
                            <span className="text-xs text-slate-500 flex items-center gap-0.5">
                              <Tag className="w-2.5 h-2.5" />{ev.ticker}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge variant={GRANT_BADGE_VARIANT[ev.grantType] ?? 'default'} size="sm">
                          {ev.grantType}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-xs text-slate-500 max-w-32 truncate block">
                          {ev.sourceFile}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <div>
                          <span className={`text-xs font-medium ${urgencyClass(ev.vestDate)}`}>
                            {fmtDate(ev.vestDate)}
                          </span>
                          <span className="block text-xs text-slate-600 mt-0.5">
                            in {days} day{days !== 1 ? 's' : ''}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div>
                          <span className="text-xs text-slate-300">{fmtDate(ev.canSellDate)}</span>
                          {ev.grantType === 'ISO' && (
                            <span className="block text-xs text-slate-600 mt-0.5">+12mo hold</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-white">
                        {ev.shares.toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5">
                        {ev.estimatedValue > 0 ? (
                          <span className="text-xs text-emerald-400 font-mono">
                            {fmtUSD(ev.estimatedValue)}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-600">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {vestingEvents.length > 15 && (
            <div className="px-4 py-2.5 border-t border-slate-800 text-xs text-slate-600 text-center">
              Showing 15 of {vestingEvents.length} upcoming events
            </div>
          )}
        </Card>
      )}

      {/* Recent grants */}
      <Card padding="none">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <CardTitle>Grants</CardTitle>
          <Button variant="ghost" size="sm" onClick={() => setView('grants')}>
            View all <ArrowRight className="w-3 h-3" />
          </Button>
        </div>
        <div className="divide-y divide-slate-800">
          {grants.slice(0, 5).map((g) => (
            <div key={g.id} className="px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white font-mono truncate">
                    {g.grantId?.value ?? g.id.slice(0, 8)}
                  </span>
                  {g.grantType?.value && (
                    <Badge variant={GRANT_BADGE_VARIANT[g.grantType.value] ?? 'default'} size="sm">
                      {g.grantType.value}
                    </Badge>
                  )}
                  {g.tickerSymbol?.value && (
                    <span className="text-xs text-slate-500">{g.tickerSymbol.value}</span>
                  )}
                </div>
                <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2">
                  {g.grantDate?.value && (
                    <span>Granted {new Date(g.grantDate.value).toLocaleDateString()}</span>
                  )}
                  {g.sourceFiles[0] && (
                    <span className="text-slate-700">· {g.sourceFiles[0]}</span>
                  )}
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-sm text-white font-mono">
                  {g.totalShares?.value?.toLocaleString() ?? '—'} shares
                </div>
                {g.vestedShares?.value !== undefined && g.totalShares?.value ? (
                  <div className="text-xs text-slate-500">
                    {Math.round((g.vestedShares.value / g.totalShares.value) * 100)}% vested
                  </div>
                ) : g.vestingEndDate?.value ? (
                  <div className="text-xs text-slate-500">
                    Full vest {new Date(g.vestingEndDate.value).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </Card>

    </div>
  );
}
