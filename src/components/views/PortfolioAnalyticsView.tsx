/**
 * PortfolioAnalyticsView — advanced portfolio analysis.
 *
 * Tabs:
 *   Benchmark   — MBLY vs QQQ / SPY since first grant date
 *   TWRR        — Time-weighted return per grant and portfolio total
 *   Monte Carlo — Probability distribution at each future vest date
 *   Export      — Year-end tax summary CSV export
 */

import { useState, useEffect, useMemo } from 'react';
import {
  AreaChart, Area, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts';
import { BarChart2, TrendingUp, Download, Dices } from 'lucide-react';
import { usePortfolioStore } from '../../store/portfolioStore';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';

const tooltipStyle = {
  contentStyle: { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, fontSize: 11 },
  labelStyle:   { color: '#94a3b8' },
};

function fmtUSD(n: number) {
  return n >= 1_000_000 ? `$${(n/1_000_000).toFixed(1)}M` : n >= 1_000 ? `$${(n/1_000).toFixed(0)}K` : `$${n.toFixed(0)}`;
}

// ──────────────────────────────────────────────────────────────────────────────
// Benchmark tab
// ──────────────────────────────────────────────────────────────────────────────
interface PricePoint { date: number; price: number }

function useBenchmark(ticker: string, benchmarks: string[]) {
  const [data, setData] = useState<Record<string, PricePoint[]>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!ticker) return;
    setLoading(true);
    const all = [ticker, ...benchmarks];
    Promise.all(
      all.map((sym) =>
        fetch(`/api/chart/${encodeURIComponent(sym)}?interval=1mo&range_=3y`, { signal: AbortSignal.timeout(12_000) })
          .then((r) => r.json())
          .then((d: { prices?: PricePoint[] }) => ({ sym, prices: d.prices ?? [] }))
          .catch(() => ({ sym, prices: [] })),
      ),
    ).then((results) => {
      const map: Record<string, PricePoint[]> = {};
      results.forEach(({ sym, prices }) => { map[sym] = prices; });
      setData(map);
      setLoading(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, benchmarks.join(',')]);

  return { data, loading };
}

function BenchmarkTab({ ticker }: { ticker: string }) {
  const benchmarks = ['QQQ', 'SPY'];
  const { data, loading } = useBenchmark(ticker, benchmarks);

  const chartData = useMemo(() => {
    const allSyms = [ticker, ...benchmarks];
    const base = data[ticker]?.[0]?.price;
    if (!base) return [];

    // Normalise to 100 at the start
    const refMap: Record<string, number> = {};
    allSyms.forEach((sym) => { refMap[sym] = data[sym]?.[0]?.price ?? 1; });

    return (data[ticker] ?? []).map((p) => {
      const dateKey = new Date(p.date * 1000).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
      const row: Record<string, string | number> = { date: dateKey };
      allSyms.forEach((sym) => {
        const match = (data[sym] ?? []).find((q) => Math.abs(q.date - p.date) < 86400 * 15);
        row[sym] = match ? +((match.price / refMap[sym]) * 100).toFixed(2) : 0;
      });
      return row;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, ticker]);

  const COLORS: Record<string, string> = { QQQ: '#f59e0b', SPY: '#10b981' };
  COLORS[ticker] = '#6366f1';

  const finalRow = chartData[chartData.length - 1];
  const tickerReturn = finalRow ? +((Number(finalRow[ticker]) - 100).toFixed(1)) : null;

  return (
    <div className="space-y-4">
      {loading && <p className="text-xs text-slate-500 text-center py-4">Loading 3-year price history…</p>}

      {tickerReturn !== null && (
        <div className="grid grid-cols-3 gap-3">
          {[ticker, 'QQQ', 'SPY'].map((sym) => {
            const ret = finalRow ? +((Number(finalRow[sym]) - 100).toFixed(1)) : null;
            return (
              <Card key={sym} padding="md">
                <div className="text-xs text-slate-500 mb-1">{sym} 3-year return</div>
                <div className={`text-xl font-mono font-semibold ${(ret ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {ret != null ? `${ret >= 0 ? '+' : ''}${ret}%` : '—'}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {chartData.length > 0 && (
        <Card padding="md">
          <CardHeader>
            <CardTitle>{ticker} vs QQQ vs SPY — 3-year normalised (base=100)</CardTitle>
          </CardHeader>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 9 }} axisLine={false} tickLine={false}
                interval={Math.max(1, Math.floor(chartData.length / 8))} />
              <YAxis tick={{ fill: '#64748b', fontSize: 9 }} axisLine={false} tickLine={false}
                tickFormatter={(v) => `${v}`} />
              <Tooltip {...tooltipStyle} formatter={(v) => [`${Number(v).toFixed(1)}`, '']} />
              <ReferenceLine y={100} stroke="#334155" strokeDasharray="3 3" />
              <Legend wrapperStyle={{ fontSize: 11, color: '#64748b' }} />
              {[ticker, 'QQQ', 'SPY'].map((sym) => (
                <Line key={sym} type="monotone" dataKey={sym} stroke={COLORS[sym]}
                  strokeWidth={sym === ticker ? 2 : 1.5} dot={false}
                  strokeDasharray={sym !== ticker ? '4 2' : undefined} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}

      <p className="text-xs text-slate-700">
        QQQ = NASDAQ-100 ETF · SPY = S&P 500 ETF · Normalised to 100 at the earliest available common date.
        Past performance does not predict future results.
      </p>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// TWRR tab
// ──────────────────────────────────────────────────────────────────────────────
function TWRRTab() {
  const { portfolio } = usePortfolioStore();
  const { grants } = portfolio;

  const [livePrice, setLivePrice] = useState<Record<string, number>>({});
  const tickers = [...new Set(grants.map((g) => g.tickerSymbol?.value).filter(Boolean) as string[])];

  useEffect(() => {
    tickers.forEach((t) => {
      fetch(`/api/price/${encodeURIComponent(t)}`, { signal: AbortSignal.timeout(6_000) })
        .then((r) => r.json())
        .then((d: { price?: number }) => { if (d.price) setLivePrice((prev) => ({ ...prev, [t]: d.price! })); })
        .catch(() => {});
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickers.join(',')]);

  const rows = useMemo(() => grants.map((g) => {
    const ticker    = g.tickerSymbol?.value ?? '';
    const current   = livePrice[ticker] ?? g.fairMarketValue?.value ?? 0;
    const basis     = g.fairMarketValue?.value ?? 0;
    const grantDate = g.grantDate?.value;

    // Simple IRR proxy: (current / basis) ^ (1 / years) - 1
    let irr: number | null = null;
    if (basis > 0 && current > 0 && grantDate) {
      const years = (Date.now() - new Date(grantDate).getTime()) / (365.25 * 86_400_000);
      if (years > 0.1) irr = Math.pow(current / basis, 1 / years) - 1;
    }

    const total  = g.totalShares?.value ?? 0;
    const unvest = g.unvestedShares?.value;
    const vested = g.vestedShares?.value;
    const vc     = vested !== undefined ? vested : (unvest !== undefined ? Math.max(0, total - unvest) : 0);
    const vestedValue = vc * current;

    return {
      id:         g.id,
      grantId:    g.grantId?.value ?? g.id.slice(0, 8),
      ticker,
      grantDate:  grantDate ?? '—',
      basisPrice: basis,
      currentPrice: current,
      vestedShares: vc,
      vestedValue,
      irr,
    };
  }).sort((a, b) => (b.irr ?? -Infinity) - (a.irr ?? -Infinity)), [grants, livePrice]);

  const totalVested = rows.reduce((s, r) => s + r.vestedValue, 0);
  const totalBasis  = rows.reduce((s, r) => s + r.vestedShares * r.basisPrice, 0);
  const portfolioReturn = totalBasis > 0 ? ((totalVested - totalBasis) / totalBasis) * 100 : null;

  return (
    <div className="space-y-4">
      {portfolioReturn !== null && (
        <div className="grid grid-cols-3 gap-4">
          <Card padding="md">
            <div className="text-xs text-slate-500 mb-1">Total Vested Value (live)</div>
            <div className="text-xl font-mono font-semibold text-white">{fmtUSD(totalVested)}</div>
          </Card>
          <Card padding="md">
            <div className="text-xs text-slate-500 mb-1">Total Cost Basis (doc FMV)</div>
            <div className="text-xl font-mono font-semibold text-slate-400">{fmtUSD(totalBasis)}</div>
          </Card>
          <Card padding="md">
            <div className="text-xs text-slate-500 mb-1">Overall Return</div>
            <div className={`text-xl font-mono font-semibold ${portfolioReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {portfolioReturn >= 0 ? '+' : ''}{portfolioReturn.toFixed(1)}%
            </div>
          </Card>
        </div>
      )}

      <Card padding="none">
        <div className="px-4 py-3 border-b border-slate-800">
          <CardTitle>Per-Grant Return (IRR proxy — annualised)</CardTitle>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/40">
                {['Grant', 'Grant Date', 'Basis/sh', 'Live Price', 'Vested', 'Vested Value', 'Annualised Return'].map((h) => (
                  <th key={h} className="text-left px-3 py-2.5 text-xs text-slate-500 font-medium whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-800/20">
                  <td className="px-3 py-2.5 font-mono text-xs text-white">{r.grantId}<span className="ml-1.5 text-slate-600">{r.ticker}</span></td>
                  <td className="px-3 py-2.5 text-xs text-slate-400 whitespace-nowrap">
                    {r.grantDate !== '—' ? new Date(r.grantDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '—'}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-slate-400">${r.basisPrice.toFixed(2)}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-white">{r.currentPrice > 0 ? `$${r.currentPrice.toFixed(2)}` : '—'}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-white">{r.vestedShares.toLocaleString()}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-white">{fmtUSD(r.vestedValue)}</td>
                  <td className="px-3 py-2.5">
                    {r.irr != null ? (
                      <span className={`font-mono text-xs font-medium ${r.irr >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {r.irr >= 0 ? '+' : ''}{(r.irr * 100).toFixed(1)}% / yr
                      </span>
                    ) : <span className="text-slate-600 text-xs">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-xs text-slate-700">
        IRR proxy = annualised return from doc FMV to live price. Does not account for dividends or exercise costs.
        Time-Weighted Return (TWRR) requires complete transaction history.
      </p>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Monte Carlo tab
// ──────────────────────────────────────────────────────────────────────────────
function MonteCarloTab({ ticker }: { ticker: string }) {
  const [loading, setLoading]   = useState(false);
  const [history, setHistory]   = useState<{ price: number }[]>([]);
  const [simulations, setSims]  = useState<{ date: string; p10: number; p25: number; p50: number; p75: number; p90: number }[]>([]);
  const [runs, setRuns]         = useState(500);
  const [livePrice, setLive]    = useState<number | null>(null);

  useEffect(() => {
    if (!ticker) return;
    Promise.all([
      fetch(`/api/chart/${encodeURIComponent(ticker)}?interval=1d&range_=1y`).then((r) => r.json()),
      fetch(`/api/price/${encodeURIComponent(ticker)}`).then((r) => r.json()),
    ]).then(([chart, price]) => {
      setHistory((chart.prices ?? []).map((p: { price: number }) => ({ price: p.price })));
      if (price.price) setLive(price.price);
    }).catch(() => {});
  }, [ticker]);

  const runSimulation = () => {
    if (history.length < 10) return;
    setLoading(true);

    const returns = history.slice(1).map((p, i) => Math.log(p.price / history[i].price));
    const mu      = returns.reduce((s, r) => s + r, 0) / returns.length;
    const sigma   = Math.sqrt(returns.reduce((s, r) => s + (r - mu) ** 2, 0) / returns.length);
    const S0      = livePrice ?? history[history.length - 1].price;

    // Forward-simulate to next 12 monthly vest dates
    const months = Array.from({ length: 12 }, (_, i) => i + 1);
    const simData = months.map((m) => {
      const tradingDays = m * 21;
      const paths = Array.from({ length: runs }, () => {
        let S = S0;
        for (let d = 0; d < tradingDays; d++) {
          const z = Math.sqrt(-2 * Math.log(Math.random())) * Math.cos(2 * Math.PI * Math.random());
          S *= Math.exp((mu - 0.5 * sigma * sigma) + sigma * z);
        }
        return S;
      }).sort((a, b) => a - b);

      const percentile = (p: number) => paths[Math.floor(p * paths.length)];
      const date = new Date();
      date.setMonth(date.getMonth() + m);

      return {
        date: date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        p10: +percentile(0.10).toFixed(2),
        p25: +percentile(0.25).toFixed(2),
        p50: +percentile(0.50).toFixed(2),
        p75: +percentile(0.75).toFixed(2),
        p90: +percentile(0.90).toFixed(2),
      };
    });

    setSims(simData);
    setLoading(false);
  };

  const lastSim = simulations[simulations.length - 1];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div>
          <div className="text-xs text-slate-500 mb-1">Simulation runs</div>
          <input type="number" min={100} max={2000} step={100} value={runs}
            onChange={(e) => setRuns(Number(e.target.value))}
            className="w-24 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none" />
        </div>
        <Button variant="primary" size="sm" loading={loading} onClick={runSimulation}
          disabled={history.length < 10}>
          <Dices className="w-3.5 h-3.5" />
          Run Monte Carlo
        </Button>
        {livePrice && <span className="text-xs text-slate-500">Current: <span className="font-mono text-white">${livePrice.toFixed(2)}</span></span>}
      </div>

      {simulations.length > 0 && (
        <>
          {lastSim && (
            <div className="grid grid-cols-5 gap-3 text-center">
              {[['10th pct', lastSim.p10, 'text-red-400'], ['25th pct', lastSim.p25, 'text-orange-400'],
                ['Median', lastSim.p50, 'text-white'], ['75th pct', lastSim.p75, 'text-emerald-400'],
                ['90th pct', lastSim.p90, 'text-emerald-300']].map(([label, price, color]) => (
                <Card key={label as string} padding="sm">
                  <div className="text-xs text-slate-600">{label}</div>
                  <div className={`text-sm font-mono font-semibold ${color}`}>${Number(price).toFixed(2)}</div>
                  <div className={`text-xs ${(Number(price) >= (livePrice ?? 0)) ? 'text-emerald-600' : 'text-red-600'}`}>
                    {livePrice ? `${(((Number(price) - livePrice) / livePrice) * 100).toFixed(0)}%` : ''}
                  </div>
                </Card>
              ))}
            </div>
          )}

          <Card padding="md">
            <CardHeader>
              <CardTitle>{ticker} Monte Carlo — {runs} paths, 12-month horizon</CardTitle>
              <span className="text-xs text-slate-600">Geometric Brownian Motion · based on 1-year daily returns</span>
            </CardHeader>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={simulations} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 9 }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(v) => `$${v}`} tick={{ fill: '#64748b', fontSize: 9 }} axisLine={false} tickLine={false} />
                <Tooltip {...tooltipStyle} formatter={(v, name) => [`$${Number(v).toFixed(2)}`, String(name)]} />
                <Area type="monotone" dataKey="p90" stroke="#10b981" fill="none" strokeWidth={1} strokeDasharray="3 2" />
                <Area type="monotone" dataKey="p75" stroke="#10b981" fill="#10b981" fillOpacity={0.08} strokeWidth={1} />
                <Area type="monotone" dataKey="p50" stroke="#6366f1" fill="#6366f1" fillOpacity={0.15} strokeWidth={2} />
                <Area type="monotone" dataKey="p25" stroke="#ef4444" fill="#ef4444" fillOpacity={0.08} strokeWidth={1} />
                <Area type="monotone" dataKey="p10" stroke="#ef4444" fill="none" strokeWidth={1} strokeDasharray="3 2" />
                {livePrice && <ReferenceLine y={livePrice} stroke="#64748b" strokeDasharray="4 2"
                  label={{ value: `Now $${livePrice.toFixed(2)}`, position: 'right', fill: '#64748b', fontSize: 9 }} />}
              </AreaChart>
            </ResponsiveContainer>
          </Card>

          <p className="text-xs text-slate-700">
            Geometric Brownian Motion simulation using 1-year daily log-returns (mean μ, volatility σ).
            This is illustrative only — actual prices may deviate significantly. Not financial advice.
          </p>
        </>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Export tab (G8)
// ──────────────────────────────────────────────────────────────────────────────
function ExportTab() {
  const { grants, transactions } = usePortfolioStore().portfolio;

  const exportGrants = () => {
    const year = new Date().getFullYear();
    const rows: string[][] = [
      ['Grant ID', 'Type', 'Ticker', 'Grant Date', 'Total Shares', 'Vested', 'Unvested',
       'FMV at Statement', 'Tax Route', 'Trustee Release', 'Source File'],
    ];
    grants.forEach((g) => {
      rows.push([
        g.grantId?.value ?? g.id.slice(0, 8),
        g.grantType?.value ?? '',
        g.tickerSymbol?.value ?? '',
        g.grantDate?.value ?? '',
        String(g.totalShares?.value ?? ''),
        String(g.vestedShares?.value ?? ''),
        String(g.unvestedShares?.value ?? ''),
        String(g.fairMarketValue?.value ?? ''),
        g.taxRoute ?? '',
        g.trusteeReleaseDate ?? '',
        g.sourceFiles[0] ?? '',
      ]);
    });
    downloadCSV(`equitylens_grants_${year}.csv`, rows);
  };

  const exportTransactions = () => {
    const year = new Date().getFullYear();
    const rows: string[][] = [
      ['Date', 'Ticker', 'Shares Sold', 'Sale Price', 'Cost Basis', 'Realized Gain (USD)',
       'Est. IL CGT (25%)', 'Net (USD)', 'Notes'],
    ];
    transactions.forEach((t) => {
      const cgt = Math.max(0, t.realizedGainUSD * 0.25);
      rows.push([
        t.date, t.ticker,
        String(t.sharesSold), String(t.salePrice), String(t.costBasis),
        String(t.realizedGainUSD.toFixed(2)),
        String(cgt.toFixed(2)),
        String((t.realizedGainUSD - cgt).toFixed(2)),
        t.notes ?? '',
      ]);
    });
    downloadCSV(`equitylens_transactions_${year}.csv`, rows);
  };

  const exportTaxSummary = () => {
    const year = new Date().getFullYear();
    const ytd = transactions.filter((t) => new Date(t.date).getFullYear() === year);
    const totalGain = ytd.reduce((s, t) => s + t.realizedGainUSD, 0);
    const totalCgt  = Math.max(0, totalGain * 0.25);

    const rows: string[][] = [
      [`Year-End Tax Summary — ${year}`, '', '', ''],
      ['', '', '', ''],
      ['REALIZED GAINS', '', '', ''],
      ['Date', 'Ticker', 'Gain (USD)', 'Est. CGT (USD)'],
      ...ytd.map((t) => [t.date, t.ticker, t.realizedGainUSD.toFixed(2), Math.max(0, t.realizedGainUSD * 0.25).toFixed(2)]),
      ['', '', '', ''],
      ['Total Net Gain', '', totalGain.toFixed(2), totalCgt.toFixed(2)],
      ['', '', '', ''],
      ['UNREALIZED POSITIONS', '', '', ''],
      ['Grant ID', 'Type', 'Vested Shares', 'FMV at Statement'],
      ...grants.map((g) => [
        g.grantId?.value ?? '', g.grantType?.value ?? '',
        String(g.vestedShares?.value ?? ''), String(g.fairMarketValue?.value ?? ''),
      ]),
    ];
    downloadCSV(`equitylens_tax_summary_${year}.csv`, rows);
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <p className="text-xs text-slate-400">
        Export your portfolio data as CSV files suitable for sharing with your tax advisor.
        All amounts in USD; Israeli CGT estimated at 25% on net realized gain.
      </p>

      {[
        {
          title:  'Grant Portfolio',
          detail: `${grants.length} grants — type, dates, shares, FMV, tax route, trustee dates`,
          action: exportGrants,
          disabled: grants.length === 0,
        },
        {
          title:  'Sale Transactions',
          detail: `${transactions.length} transactions — realized gain, estimated CGT per sale`,
          action: exportTransactions,
          disabled: transactions.length === 0,
        },
        {
          title:  `Year-End Tax Summary (${new Date().getFullYear()})`,
          detail: 'YTD realized gains/losses + unrealized positions for tax advisor',
          action: exportTaxSummary,
          disabled: false,
        },
      ].map(({ title, detail, action, disabled }) => (
        <Card key={title} padding="md" className="flex items-center gap-4">
          <div className="flex-1">
            <div className="text-sm font-medium text-white">{title}</div>
            <div className="text-xs text-slate-500 mt-0.5">{detail}</div>
          </div>
          <Button variant={disabled ? 'ghost' : 'secondary'} size="sm" onClick={action} disabled={disabled}>
            <Download className="w-3.5 h-3.5" />
            CSV
          </Button>
        </Card>
      ))}
    </div>
  );
}

function downloadCSV(filename: string, rows: string[][]) {
  const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ──────────────────────────────────────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────────────────────────────────────
export function PortfolioAnalyticsView() {
  const { portfolio } = usePortfolioStore();
  const primaryTicker = portfolio.grants.find((g) => g.tickerSymbol?.value)?.tickerSymbol?.value ?? '';

  const [tab, setTab] = useState<'benchmark' | 'twrr' | 'monte' | 'export'>('benchmark');

  const tabs = [
    { id: 'benchmark' as const, label: 'Benchmark Comparison', icon: BarChart2 },
    { id: 'twrr'      as const, label: 'Portfolio Return',     icon: TrendingUp },
    { id: 'monte'     as const, label: 'Monte Carlo',          icon: Dices },
    { id: 'export'    as const, label: 'Tax Export',           icon: Download },
  ];

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Portfolio Analytics</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Benchmark, return analysis, probability forecasting, and tax export
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-800">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm rounded-t-lg transition-colors ${
              tab === id ? 'text-white bg-slate-800 border border-b-0 border-slate-700' : 'text-slate-500 hover:text-slate-300'
            }`}>
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'benchmark' && <BenchmarkTab ticker={primaryTicker} />}
      {tab === 'twrr'      && <TWRRTab />}
      {tab === 'monte'     && <MonteCarloTab ticker={primaryTicker} />}
      {tab === 'export'    && <ExportTab />}
    </div>
  );
}
