/**
 * VestedInsights — personalised sell/hold analysis for vested RSU positions.
 *
 * Data sources:
 *  - Yahoo Finance v8 chart: 12-month price history, 52w high/low
 *  - Grant records: multiple statement-date prices for cross-period comparison
 *  - Portfolio stats: concentration & cost basis
 */

import { useState, useEffect, useCallback } from 'react';
import {
  AreaChart, Area, ReferenceLine, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { TrendingUp, TrendingDown, AlertTriangle, Scale, Info, Calendar, Megaphone, BarChart2, Globe, ExternalLink, Loader2 } from 'lucide-react';
import type { GrantRecord } from '../../types';
import { Card } from '../ui/Card';

// ── Types ─────────────────────────────────────────────────────────────────────
interface AnalysisData {
  ok: boolean;
  ticker: string;
  currentPrice: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  shortName: string | null;
  regularMarketVolume: number | null;
  priceHistory: Array<{ date: number; price: number }>;
}

interface Insight {
  type: 'positive' | 'negative' | 'neutral' | 'warning';
  title: string;
  body: string;
}

interface MarketEvent {
  ticker: string | null;
  type: string;
  date: number;
  label: string;
  source: string;
  description?: string;
  url?: string;
  impact?: 'high' | 'medium' | 'low';
  estimated?: boolean;
  epsEstimate?: number | null;
}

interface EventsData {
  ticker: string;
  relatedTickers: string[];
  sectors: string[];
  events: MarketEvent[];
}

// ── Safe external link — checks URL before opening ───────────────────────────
function SafeLink({ url, className, children }: { url: string; className?: string; children: React.ReactNode }) {
  const [checking, setChecking] = useState(false);
  const handleClick = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    setChecking(true);
    try {
      const r = await fetch(`/api/check-url?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(7000) });
      const d = await r.json() as { ok: boolean | null };
      if (d.ok === false && !confirm(`This link may have moved:\n${url}\n\nOpen anyway?`)) {
        setChecking(false); return;
      }
    } catch { /* server offline — open anyway */ }
    window.open(url, '_blank', 'noopener');
    setChecking(false);
  }, [url]);
  return (
    <button onClick={handleClick} className={className} disabled={checking}>
      {checking && <Loader2 className="w-3 h-3 animate-spin inline mr-0.5" />}
      {children}
    </button>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────
function useTickerAnalysis(ticker: string): { data: AnalysisData | null; loading: boolean } {
  const [data, setData] = useState<AnalysisData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!ticker) return;
    setLoading(true);
    fetch(`/api/analysis/${encodeURIComponent(ticker)}`, { signal: AbortSignal.timeout(12_000) })
      .then((r) => r.json())
      .then((d) => setData(d as AnalysisData))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [ticker]);

  return { data, loading };
}

function useTickerEvents(ticker: string): { data: EventsData | null; loading: boolean } {
  const [data, setData] = useState<EventsData | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!ticker) return;
    setLoading(true);
    fetch(`/api/events/${encodeURIComponent(ticker)}`, { signal: AbortSignal.timeout(25_000) })
      .then((r) => r.json())
      .then((d) => setData(d as EventsData))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [ticker]);
  return { data, loading };
}

// ── Event type config ─────────────────────────────────────────────────────────
const EVENT_CONFIG: Record<string, { icon: React.ElementType; color: string; bg: string; label: string }> = {
  earnings:          { icon: BarChart2,  color: 'text-indigo-400',  bg: 'bg-indigo-950/40 border-indigo-800/50',  label: 'Earnings' },
  earnings_related:  { icon: BarChart2,  color: 'text-slate-400',   bg: 'bg-slate-800/40 border-slate-700/50',    label: 'Peer Earnings' },
  conference:        { icon: Megaphone,  color: 'text-purple-400',  bg: 'bg-purple-950/40 border-purple-800/50',  label: 'Conference' },
  industry:          { icon: Globe,      color: 'text-blue-400',    bg: 'bg-blue-950/40 border-blue-800/50',      label: 'Industry' },
  macro:             { icon: Globe,      color: 'text-amber-400',   bg: 'bg-amber-950/40 border-amber-800/50',    label: 'Macro' },
  product:           { icon: Megaphone,  color: 'text-emerald-400', bg: 'bg-emerald-950/40 border-emerald-800/50', label: 'Product' },
};

function fmtEventDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function daysFromNow(ts: number): number {
  return Math.ceil((ts * 1000 - Date.now()) / 86_400_000);
}

// ── Insight generation ────────────────────────────────────────────────────────
function generateInsights(
  ticker: string,
  currentPrice: number,
  analysis: AnalysisData,
  grants: GrantRecord[],
  totalPortfolioValue: number,
): Insight[] {
  const insights: Insight[] = [];
  const high52 = analysis.fiftyTwoWeekHigh;
  const low52  = analysis.fiftyTwoWeekLow;

  // 1. Position relative to 52-week range
  if (high52 && low52) {
    const fromHigh = ((currentPrice - high52) / high52) * 100;
    const fromLow  = ((currentPrice - low52) / low52)  * 100;
    const rangePos = ((currentPrice - low52) / (high52 - low52)) * 100;

    if (rangePos >= 75) {
      insights.push({
        type: 'positive',
        title: 'Near 52-week high',
        body: `${ticker} is trading at $${currentPrice.toFixed(2)}, which is ${Math.abs(fromHigh).toFixed(0)}% below its 52-week high of $${high52.toFixed(2)}. Selling near range highs locks in gains — consider staged exits to average your sell price.`,
      });
    } else if (rangePos <= 25) {
      insights.push({
        type: 'negative',
        title: 'Near 52-week low',
        body: `${ticker} is trading close to its 52-week low of $${low52.toFixed(2)} (currently ${fromLow.toFixed(0)}% above). Selling near 52-week lows may not be optimal unless you need liquidity. If you have high conviction, holding through the trough is a common strategy.`,
      });
    } else {
      insights.push({
        type: 'neutral',
        title: '52-week range',
        body: `${ticker} is $${currentPrice.toFixed(2)}, positioned at ${rangePos.toFixed(0)}% between its 52-week low ($${low52.toFixed(2)}) and high ($${high52.toFixed(2)}). The stock is in mid-range — neither a screaming buy nor sell signal from price momentum alone.`,
      });
    }
  }

  // 2. Price trend vs statement dates
  const statementPrices = grants
    .flatMap((g) => g.fairMarketValue?.value ? [{ price: g.fairMarketValue.value, file: g.sourceFiles[0] ?? '' }] : [])
    .filter((v, i, arr) => arr.findIndex((x) => Math.abs(x.price - v.price) < 0.01) === i)
    .sort((a, b) => a.price - b.price);

  if (statementPrices.length >= 2) {
    const oldest = statementPrices[statementPrices.length - 1]; // highest = oldest for falling stocks
    const newest = statementPrices[0]; // lowest doc price = most recent
    const vsOldest = ((currentPrice - oldest.price) / oldest.price) * 100;
    const vsNewest = ((currentPrice - newest.price) / newest.price) * 100;

    if (vsOldest < -30) {
      insights.push({
        type: 'warning',
        title: 'Underwater vs earlier statements',
        body: `At $${currentPrice.toFixed(2)}, ${ticker} is ${Math.abs(vsOldest).toFixed(0)}% below the $${oldest.price.toFixed(2)} price shown in your older statement. However, it's ${vsNewest >= 0 ? '+' : ''}${vsNewest.toFixed(0)}% vs your most recent statement price of $${newest.price.toFixed(2)}${vsNewest > 0 ? ' — the trend has reversed' : ''}.`,
      });
    }
  }

  // 3. Historical price trend from monthly data
  const history = analysis.priceHistory;
  if (history.length >= 3) {
    const sixMonthAgo = history[Math.max(0, history.length - 7)]?.price;
    const threeMonthAgo = history[Math.max(0, history.length - 4)]?.price;
    if (sixMonthAgo) {
      const momentum6m = ((currentPrice - sixMonthAgo) / sixMonthAgo) * 100;
      const momentum3m = threeMonthAgo ? ((currentPrice - threeMonthAgo) / threeMonthAgo) * 100 : null;

      if (momentum6m > 20 && (momentum3m ?? 0) > 5) {
        insights.push({
          type: 'positive',
          title: 'Positive price momentum',
          body: `${ticker} is up ${momentum6m.toFixed(0)}% over the last 6 months${momentum3m ? ` and ${momentum3m.toFixed(0)}% over 3 months` : ''}. Sustained momentum can continue, but it also increases the risk of a pullback. A staged exit (selling a portion each month) can reduce timing risk.`,
        });
      } else if (momentum6m < -20) {
        insights.push({
          type: 'negative',
          title: 'Declining trend',
          body: `${ticker} has declined ${Math.abs(momentum6m).toFixed(0)}% over 6 months. If the decline is driven by company fundamentals rather than macro factors, continued selling pressure is possible. Evaluate whether the investment thesis has changed before deciding to hold.`,
        });
      }
    }
  }

  // 4. Concentration risk
  const vestedValue = grants.reduce((s, g) => {
    const shares = g.vestedShares?.value ?? 0;
    return s + shares * currentPrice;
  }, 0);

  if (totalPortfolioValue > 0 && vestedValue > 0) {
    const concentration = (vestedValue / totalPortfolioValue) * 100;
    if (concentration > 50) {
      insights.push({
        type: 'warning',
        title: `High concentration — ${concentration.toFixed(0)}% in ${ticker}`,
        body: `Your vested ${ticker} shares represent ${concentration.toFixed(0)}% of your total equity portfolio value ($${(vestedValue / 1000).toFixed(0)}K of $${(totalPortfolioValue / 1000).toFixed(0)}K). Financial advisors generally recommend keeping a single stock below 10–20% to reduce company-specific risk. Consider a systematic diversification plan.`,
      });
    }
  }

  // 5. Tax insight (always useful)
  const hasGrantsOver1Year = grants.some((g) => {
    if (!g.grantDate?.value) return false;
    const months = (Date.now() - new Date(g.grantDate.value).getTime()) / (1000 * 60 * 60 * 24 * 30);
    return months > 12;
  });

  if (hasGrantsOver1Year) {
    insights.push({
      type: 'neutral',
      title: 'Long-term capital gains eligible',
      body: `Shares from grants more than 12 months ago may qualify for long-term capital gains tax treatment in the US, which is taxed at 0%, 15%, or 20% vs ordinary income rates (up to 37%). RSU income is taxed as ordinary income at vesting — only post-vest appreciation qualifies for LTCG. Consult your tax advisor for your jurisdiction.`,
    });
  }

  // 6. General RSU wisdom
  insights.push({
    type: 'neutral',
    title: 'Staged selling strategy',
    body: `A common approach for RSU holders is to sell a fixed percentage of shares immediately upon vesting (to diversify) and hold the rest if you have conviction in the company. Selling immediately at vesting removes market risk and avoids the "employee double-down" — both your income and investments tied to one company's performance.`,
  });

  return insights.slice(0, 5); // max 5 insights
}

// ── Sparkline ─────────────────────────────────────────────────────────────────
function PriceSparkline({
  history,
  currentPrice,
  high52,
  low52,
  statementPrices,
}: {
  history: Array<{ date: number; price: number }>;
  currentPrice: number;
  high52: number | null;
  low52: number | null;
  statementPrices: number[];
}) {
  const data = history.map((h) => ({
    date: new Date(h.date * 1000).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
    price: h.price,
  }));

  const allPrices = [...data.map((d) => d.price), ...statementPrices, currentPrice].filter(Boolean);
  const minY = Math.min(...allPrices) * 0.93;
  const maxY = Math.max(...allPrices) * 1.07;

  const isUp = data.length > 1 && data[data.length - 1].price >= data[0].price;

  return (
    <ResponsiveContainer width="100%" height={120}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -28, bottom: 0 }}>
        <defs>
          <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={isUp ? '#10b981' : '#ef4444'} stopOpacity={0.2} />
            <stop offset="95%" stopColor={isUp ? '#10b981' : '#ef4444'} stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="date" tick={{ fill: '#475569', fontSize: 9 }} axisLine={false} tickLine={false} />
        <YAxis domain={[minY, maxY]} tick={{ fill: '#475569', fontSize: 9 }} axisLine={false} tickLine={false}
          tickFormatter={(v) => `$${v.toFixed(0)}`} />
        <Tooltip
          contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 6, fontSize: 11 }}
          formatter={(v) => [`$${Number(v).toFixed(2)}`, 'Price']}
        />
        {/* Statement price reference lines */}
        {statementPrices.map((p, i) => (
          <ReferenceLine key={i} y={p} stroke="#6366f1" strokeDasharray="3 3" strokeOpacity={0.5} />
        ))}
        {/* 52-week range */}
        {high52 && <ReferenceLine y={high52} stroke="#10b981" strokeDasharray="2 4" strokeOpacity={0.4} />}
        {low52  && <ReferenceLine y={low52}  stroke="#ef4444" strokeDasharray="2 4" strokeOpacity={0.4} />}
        <Area type="monotone" dataKey="price" stroke={isUp ? '#10b981' : '#ef4444'}
          fill="url(#sparkGrad)" strokeWidth={1.5} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────
const INSIGHT_ICONS = {
  positive: TrendingUp,
  negative: TrendingDown,
  neutral:  Info,
  warning:  AlertTriangle,
};

const INSIGHT_COLORS = {
  positive: 'text-emerald-400 bg-emerald-950/30 border-emerald-800/50',
  negative: 'text-red-400    bg-red-950/30    border-red-800/50',
  neutral:  'text-blue-400   bg-blue-950/30   border-blue-800/50',
  warning:  'text-amber-400  bg-amber-950/30  border-amber-800/50',
};

// ── Main export ───────────────────────────────────────────────────────────────
export function VestedInsights({
  ticker,
  grants,
  currentPrice,
  totalPortfolioValue,
}: {
  ticker: string;
  grants: GrantRecord[];
  currentPrice: number;
  totalPortfolioValue: number;
}) {
  const { data, loading }       = useTickerAnalysis(ticker);
  const { data: evData }        = useTickerEvents(ticker);

  if (loading) {
    return (
      <Card padding="md">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25"/>
            <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" className="opacity-75"/>
          </svg>
          Loading {ticker} analysis…
        </div>
      </Card>
    );
  }

  if (!data) return null;

  const statementPrices = [
    ...new Set(
      grants.flatMap((g) => g.fairMarketValue?.value ? [g.fairMarketValue.value] : [])
    ),
  ];

  const insights = generateInsights(ticker, currentPrice, data, grants, totalPortfolioValue);

  return (
    <Card padding="none">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-slate-400 uppercase tracking-wider">
            {ticker} · Sell / Hold Analysis
          </div>
          <p className="text-xs text-slate-600 mt-0.5">
            {data.shortName ?? ticker} · 12-month price history + position insights
          </p>
        </div>
        <Scale className="w-4 h-4 text-slate-600" />
      </div>

      <div className="p-4 grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* Sparkline + key levels — left 2 cols */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500">12-month price</span>
            <span className="font-mono text-white font-medium">${currentPrice.toFixed(2)}</span>
          </div>

          {data.priceHistory.length > 1 && (
            <PriceSparkline
              history={data.priceHistory}
              currentPrice={currentPrice}
              high52={data.fiftyTwoWeekHigh}
              low52={data.fiftyTwoWeekLow}
              statementPrices={statementPrices}
            />
          )}

          {/* Legend */}
          <div className="space-y-1 text-xs text-slate-500">
            {data.fiftyTwoWeekHigh && (
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <span className="w-4 border-t border-emerald-500 border-dashed inline-block" />
                  52w High
                </span>
                <span className="font-mono text-emerald-400">${data.fiftyTwoWeekHigh.toFixed(2)}</span>
              </div>
            )}
            {data.fiftyTwoWeekLow && (
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <span className="w-4 border-t border-red-500 border-dashed inline-block" />
                  52w Low
                </span>
                <span className="font-mono text-red-400">${data.fiftyTwoWeekLow.toFixed(2)}</span>
              </div>
            )}
            {statementPrices.map((p, i) => (
              <div key={i} className="flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <span className="w-4 border-t border-indigo-500 border-dashed inline-block" />
                  Statement price
                </span>
                <span className="font-mono text-indigo-400">${p.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Insights — right 3 cols */}
        <div className="lg:col-span-3 space-y-2.5">
          {insights.map((ins, i) => {
            const Icon = INSIGHT_ICONS[ins.type];
            return (
              <div key={i} className={`border rounded-xl px-3 py-2.5 ${INSIGHT_COLORS[ins.type]}`}>
                <div className="flex items-center gap-2 mb-1">
                  <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="text-xs font-medium">{ins.title}</span>
                </div>
                <p className="text-xs opacity-80 leading-relaxed">{ins.body}</p>
              </div>
            );
          })}

          <p className="text-xs text-slate-700 pt-1">
            Data: Yahoo Finance · Not financial advice — consult your financial advisor and tax professional.
          </p>
        </div>
      </div>

      {/* Market calendar */}
      {evData && evData.events.length > 0 && (
        <div className="border-t border-slate-800 px-4 py-3">
          <div className="flex items-center gap-2 mb-3">
            <Calendar className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
              Upcoming Market Events
            </span>
            <span className="text-xs text-slate-600">
              · {ticker} + competitors · next 12 months
            </span>
          </div>

          <div className="space-y-2">
            {evData.events.map((ev, i) => {
              const cfg  = EVENT_CONFIG[ev.type] ?? EVENT_CONFIG['industry'];
              const Icon = cfg.icon;
              const days = daysFromNow(ev.date);
              const isSelf = ev.ticker === ticker;
              const isUrgent = days <= 14;

              const impactColor: Record<string, string> = {
                high:   'bg-red-950/50 text-red-400 border-red-800/60',
                medium: 'bg-amber-950/50 text-amber-400 border-amber-800/60',
                low:    'bg-slate-800 text-slate-500 border-slate-700',
              };

              const handleRemind = () => {
                if (!('Notification' in window)) { alert('Notifications not supported in this browser.'); return; }
                Notification.requestPermission().then((perm) => {
                  if (perm !== 'granted') return;
                  // Schedule a notification 1 day before the event
                  const msUntil = ev.date * 1000 - Date.now() - 86_400_000;
                  if (msUntil < 0) {
                    new Notification(`EquityLens: ${ev.label}`, { body: 'This event is happening today or tomorrow!', icon: '/favicon.svg' });
                  } else {
                    setTimeout(() => {
                      new Notification(`EquityLens: ${ev.label}`, { body: `Tomorrow: ${fmtEventDate(ev.date)}`, icon: '/favicon.svg' });
                    }, msUntil);
                    alert(`Reminder set! You'll be notified on ${new Date(ev.date * 1000 - 86_400_000).toLocaleDateString()}`);
                  }
                });
              };

              return (
                <div key={i} className={`rounded-xl border px-3 py-2.5 ${cfg.bg} ${isUrgent ? 'ring-1 ring-amber-700/40' : ''}`}>
                  <div className="flex items-start gap-2.5">
                    <Icon className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${cfg.color}`} />
                    <div className="flex-1 min-w-0">
                      {/* Header row */}
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        {ev.url ? (
                          <SafeLink url={ev.url}
                            className={`text-xs font-medium hover:underline underline-offset-2 text-left ${isSelf ? 'text-white' : 'text-slate-200'}`}>
                            {ev.label} <ExternalLink className="w-2.5 h-2.5 inline mb-0.5" />
                          </SafeLink>
                        ) : (
                          <span className={`text-xs font-medium ${isSelf ? 'text-white' : 'text-slate-300'}`}>{ev.label}</span>
                        )}
                        {ev.estimated && <span className="text-xs text-slate-600 italic">est.</span>}
                        {ev.impact && (
                          <span className={`text-xs px-1.5 py-0.5 rounded border ${impactColor[ev.impact]}`}>
                            {ev.impact} impact
                          </span>
                        )}
                      </div>

                      {/* Description */}
                      {ev.description && (
                        <p className="text-xs text-slate-500 leading-relaxed mt-1 mb-1.5">{ev.description}</p>
                      )}

                      {/* Meta row */}
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-xs text-slate-500">{fmtEventDate(ev.date)}</span>
                        <span className={`text-xs font-medium ${isUrgent ? 'text-amber-400' : days <= 45 ? 'text-slate-400' : 'text-slate-600'}`}>
                          {isUrgent ? '⚠ ' : ''}in {days} day{days !== 1 ? 's' : ''}
                        </span>
                        <span className="text-xs text-slate-700">{ev.source}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded border ${cfg.bg} ${cfg.color}`}>{cfg.label}</span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button onClick={handleRemind}
                        title="Set browser reminder 1 day before"
                        className="text-xs px-2 py-1 rounded bg-slate-800 border border-slate-700 text-slate-400 hover:text-amber-400 hover:border-amber-700 transition-colors">
                        🔔
                      </button>
                      {ev.url && (
                        <SafeLink url={ev.url}
                          className="text-xs px-2 py-1 rounded bg-slate-800 border border-slate-700 text-slate-400 hover:text-indigo-400 hover:border-indigo-700 transition-colors">
                          <ExternalLink className="w-3 h-3" />
                        </SafeLink>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <p className="text-xs text-slate-700 mt-2">
            Projected earnings are extrapolated from historical quarterly patterns.
            🔔 sets a browser notification 1 day before the event (requires notification permission).
          </p>
        </div>
      )}
    </Card>
  );
}
