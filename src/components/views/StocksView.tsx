/**
 * StocksView — one section per company found in the user's grants and documents:
 * RSU position, price chart with moving averages, today's snapshot, SEC filings,
 * headlines and a rule-based reading. Read-only: no trades, no advice.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ColorType, CandlestickSeries, LineSeries, createChart } from 'lightweight-charts';
import { Plus, X, RefreshCw, ExternalLink } from 'lucide-react';
import { usePortfolioStore, useWorkingGrants } from '../../store/portfolioStore';
import { Card } from '../ui/Card';
import { detectCompanies, isRsuGrant, summarizeRsu, type DetectedCompany } from '../../lib/stockDetect';
import { ema, sma, snapshot, type Candle } from '../../lib/indicators';
import { assess } from '../../lib/stockConsiderations';
import { computeComparison, type CompareResult } from '../../lib/compare';

interface CandlesResp {
  ok: boolean;
  source: string;
  fetchedAt: string;
  candles: Candle[];
  meta: { shortName: string | null; currency: string | null; previousClose: number | null; regularMarketTime: number | null };
  error?: string;
}
interface Fact {
  label: string;
  kind: 'quarterly' | 'annual';
  value: number;
  unit: string;
  start: string;
  end: string;
  fiscal: string;
  form: string;
  filedAt: string;
  priorYearValue: number | null;
  priorYearEnd: string | null;
}
interface FilingsResp {
  ok: boolean;
  covered?: boolean;
  note?: string;
  factsNote?: string;
  source: string;
  fetchedAt: string;
  company?: { name: string; cik: number };
  filings: { form: string; filedAt: string; period: string; url: string }[];
  facts: Fact[];
  error?: string;
}
interface NewsItem {
  title: string;
  publisher: string;
  link: string;
  publishedAt: string | null;
  relatedTickers: string[];
  relevance: 'specific' | 'multi' | 'broad';
}
interface NewsResp {
  ok: boolean;
  source: string;
  fetchedAt: string;
  items: NewsItem[];
  error?: string;
}

const RANGES = [
  { label: '1M', range: '1mo', interval: '1d' },
  { label: '3M', range: '3mo', interval: '1d' },
  { label: '6M', range: '6mo', interval: '1d' },
  { label: '1Y', range: '1y', interval: '1d' },
];

const LS_MANUAL = 'equitylens.stocks.manual';
const LS_REMOVED = 'equitylens.stocks.removed';
const LS_PICKED = 'equitylens.stocks.picked';
const normNameKey = (n: string) =>
  n.toLowerCase().replace(/[.,]/g, '').replace(/\b(inc|corp|corporation|ltd|limited|plc|co|company|holdings|n\.v|nv)\b/g, '').replace(/\s+/g, ' ').trim();
const readMap = (k: string): Record<string, string> => {
  try { return JSON.parse(localStorage.getItem(k) ?? '{}') as Record<string, string>; } catch { return {}; }
};

interface Candidate { symbol: string; name: string; exchange: string }

/** Name-only company: lists possible listings and lets the user choose. Never selects one itself. */
function TickerPicker({ name, onPick }: { name: string; onPick: (symbol: string) => void }) {
  const [cands, setCands] = useState<Candidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const find = async () => {
    setBusy(true); setErr('');
    try {
      const r = await getJson<{ candidates: Candidate[] }>(`/api/market?action=lookup&q=${encodeURIComponent(name)}`);
      setCands(r.candidates);
    } catch { setErr('Lookup failed. You can still type the ticker above.'); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-2 text-sm">
      <button type="button" onClick={() => void find()} disabled={busy} className="rounded-lg bg-slate-800 px-3 py-1.5 text-white">
        {busy ? 'Searching...' : 'Find ticker'}
      </button>
      {err && <p className="text-red-400">{err}</p>}
      {cands && cands.length === 0 && <p className="text-slate-400">No match found. Type the ticker above.</p>}
      {cands && cands.length > 0 && (
        <div>
          <p className="text-slate-400">Possible matches. Nothing is chosen until you pick one:</p>
          <ul className="mt-1 space-y-1">
            {cands.map((c) => (
              <li key={c.symbol} className="flex items-center gap-2">
                <span className="text-white">{c.symbol}</span>
                <span className="text-slate-400">{c.name} {c.exchange && `(${c.exchange})`}</span>
                <button type="button" onClick={() => onPick(c.symbol)} className="rounded bg-indigo-600 px-2 py-0.5 text-white">Use this</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
const readList = (k: string): string[] => {
  try { return JSON.parse(localStorage.getItem(k) ?? '[]') as string[]; } catch { return []; }
};

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  const j = (await r.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
  if (!r.ok || j.ok === false) throw new Error(j.error ?? `Request failed (${r.status})`);
  return j;
}

const fmtMoney = (n: number, unit: string) => {
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  return unit === 'USD/shares'
    ? `${sign}$${a.toFixed(2)}`
    : `${sign}$${(a / 1e6).toLocaleString('en-US', { maximumFractionDigits: 0 })}M`;
};
const when = (iso: string) => new Date(iso).toLocaleString();
const nyDate = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

/** Says what the last candle really is, so an older close is never read as today's price. */
function quoteLabel(asOfSec: number, marketTimeSec: number | null): { text: string; today: boolean } {
  const asOf = new Date(asOfSec * 1000);
  const today = nyDate(new Date());
  const isToday = nyDate(asOf) === today;
  const live = marketTimeSec != null && nyDate(new Date(marketTimeSec * 1000)) === today;
  if (isToday && live) return { text: `today's session, updated ${new Date(marketTimeSec! * 1000).toLocaleTimeString()}`, today: true };
  return { text: `close of ${nyDate(asOf)} (not today's price)`, today: false };
}


function StockChart({ candles }: { candles: Candle[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || !candles.length) return;
    const chart = createChart(ref.current, {
      layout: { background: { type: ColorType.Solid, color: '#0f1117' }, textColor: '#64748b', fontSize: 11 },
      grid: { vertLines: { color: '#1e293b' }, horzLines: { color: '#1e293b' } },
      width: ref.current.clientWidth,
      height: 280,
      timeScale: { timeVisible: false },
    });
    const toTime = (t: number) => t as unknown as import('lightweight-charts').Time;
    const cs = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981', downColor: '#ef4444', borderUpColor: '#10b981',
      borderDownColor: '#ef4444', wickUpColor: '#10b981', wickDownColor: '#ef4444',
    });
    cs.setData(candles.map((c) => ({ time: toTime(c.time), open: c.open, high: c.high, low: c.low, close: c.close })));
    const closes = candles.map((c) => c.close);
    const addLine = (vals: (number | null)[], color: string) => {
      const s = chart.addSeries(LineSeries, { color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      s.setData(vals.flatMap((v, i) => (v == null ? [] : [{ time: toTime(candles[i].time), value: v }])));
    };
    addLine(sma(closes, 20), '#f59e0b');
    addLine(sma(closes, 50), '#6366f1');
    addLine(ema(closes, 20), '#22d3ee');
    chart.timeScale().fitContent();
    const onResize = () => ref.current && chart.applyOptions({ width: ref.current.clientWidth });
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); chart.remove(); };
  }, [candles]);
  return <div ref={ref} className="w-full" />;
}

const COMPARE_COLORS = ['#f59e0b', '#22d3ee', '#a78bfa', '#34d399', '#f472b6', '#60a5fa', '#fb7185', '#fbbf24'];

/** One chart for several stocks: percent change from a shared start date, one colored line per stock. */
function fmtPct(v: number): string {
  const r = Math.round(v * 10) / 10;
  if (r === 0) return '0.0%';
  return `${r > 0 ? '+' : '-'}${Math.abs(r).toFixed(1)}%`;
}

function ComparisonChart({ tickers }: { tickers: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [rangeIdx, setRangeIdx] = useState(1);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const { range, interval } = RANGES[rangeIdx];
  const key = tickers.join(',');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void Promise.allSettled(
      tickers.map((t) => getJson<CandlesResp>(`/api/market?action=candles&ticker=${encodeURIComponent(t)}&range=${range}&interval=${interval}`)),
    ).then((res) => {
      if (cancelled) return;
      const inputs = tickers.map((t, i) => {
        const r = res[i];
        return { ticker: t, candles: r.status === 'fulfilled' ? r.value.candles ?? [] : [] };
      });
      setFailed(tickers.filter((_, i) => res[i].status === 'rejected'));
      setResult(computeComparison(inputs));
      setLoading(false);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, range, interval]);

  useEffect(() => {
    if (!ref.current || !result || result.series.every((x) => x.points.length === 0)) return;
    const chart = createChart(ref.current, {
      layout: { background: { type: ColorType.Solid, color: '#0f1117' }, textColor: '#64748b', fontSize: 11 },
      grid: { vertLines: { color: '#1e293b' }, horzLines: { color: '#1e293b' } },
      width: ref.current.clientWidth,
      height: 280,
      timeScale: { timeVisible: false },
    });
    const toTime = (t: number) => t as unknown as import('lightweight-charts').Time;
    result.series.forEach((sr, i) => {
      if (!sr.points.length) return;
      const line = chart.addSeries(LineSeries, {
        color: COMPARE_COLORS[i % COMPARE_COLORS.length],
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        priceFormat: { type: 'custom', formatter: (v: number) => fmtPct(v), minMove: 0.1 },
      });
      line.setData(sr.points.map((p) => ({ time: toTime(p.time), value: p.pct })));
    });
    chart.timeScale().fitContent();
    const onResize = () => ref.current && chart.applyOptions({ width: ref.current.clientWidth });
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); chart.remove(); };
  }, [result]);

  const day = (sec: number) => new Date(sec * 1000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const drawn = result?.series.filter((x) => x.points.length > 0) ?? [];
  return (
    <Card className="p-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-white">Comparison</h2>
          <p className="text-xs text-slate-500">
            Percent change since {result?.baseTime ? day(result.baseTime) : 'the start of the period'}, so different share prices are comparable. These are not prices.
          </p>
        </div>
        <div className="flex gap-1">
          {RANGES.map((r, i) => (
            <button key={r.label} type="button" onClick={() => setRangeIdx(i)}
              className={`rounded px-2 py-1 text-xs ${i === rangeIdx ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300'}`}>{r.label}</button>
          ))}
        </div>
      </div>
      {loading && !result && <p className="text-sm text-slate-500">Loading...</p>}
      {drawn.length > 0 && <div ref={ref} className="w-full" />}
      {drawn.length > 0 && (
        <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
          {result!.series.map((sr, i) => sr.points.length > 0 && (
            <li key={sr.ticker} className="flex items-center gap-2 text-slate-300">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: COMPARE_COLORS[i % COMPARE_COLORS.length] }} />
              <span className="text-white">{sr.ticker}</span>
              <span className={Math.round(sr.lastPct! * 10) === 0 ? 'text-slate-300' : sr.lastPct! > 0 ? 'text-emerald-400' : 'text-red-400'}>{fmtPct(sr.lastPct!)}</span>
              <span className="text-xs text-slate-500">to {day(sr.lastTime!)}</span>
            </li>
          ))}
        </ul>
      )}
      {(failed.length > 0 || (result?.missing.length ?? 0) > 0) && (
        <p className="text-xs text-amber-400">No price data for: {[...new Set([...failed, ...(result?.missing ?? [])])].join(', ')} (left out of the chart).</p>
      )}
    </Card>
  );
}

function CompanySection({ company, onRemove, onPickTicker }: { company: DetectedCompany; onRemove: () => void; onPickTicker?: (name: string, symbol: string) => void }) {
  const tradingWindows = usePortfolioStore((s) => s.portfolio.tradingWindows);
  const [rangeIdx, setRangeIdx] = useState(1);
  const [prices, setPrices] = useState<CandlesResp | null>(null);
  const [filings, setFilings] = useState<FilingsResp | null>(null);
  const [news, setNews] = useState<NewsResp | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);

  const ticker = company.ticker;
  const { range, interval } = RANGES[rangeIdx];

  useEffect(() => {
    if (!ticker) return;
    let cancelled = false;
    setLoading(true);
    const q = encodeURIComponent(ticker);
    const err: Record<string, string> = {};
    const run = async <T,>(key: string, url: string, set: (v: T | null) => void) => {
      try { const v = await getJson<T>(url); if (!cancelled) set(v); }
      catch (e) { err[key] = e instanceof Error ? e.message : 'failed'; if (!cancelled) set(null); }
    };
    void Promise.all([
      run<CandlesResp>('prices', `/api/market?action=candles&ticker=${q}&range=${range}&interval=${interval}`, setPrices),
      run<FilingsResp>('filings', `/api/market?action=filings&ticker=${q}`, setFilings),
      run<NewsResp>('news', `/api/market?action=news&ticker=${q}&name=${encodeURIComponent(company.companyName ?? '')}`, setNews),
    ]).then(() => { if (!cancelled) { setErrors(err); setLoading(false); } });
    return () => { cancelled = true; };
  }, [ticker, range, interval, nonce, company.companyName]);

  const rsu = useMemo(() => summarizeRsu(company.grants), [company.grants]);
  const snap = useMemo(
    () => (prices?.candles?.length ? snapshot(prices.candles, prices.meta.previousClose) : null),
    [prices],
  );
  const ql = snap ? quoteLabel(snap.asOf, prices?.meta.regularMarketTime ?? null) : null;
  const stale = snap ? Date.now() / 1000 - snap.asOf > 4 * 86400 : false;
  const filingsNote = filings && filings.covered === false
    ? 'No SEC filings found for this symbol, so no financial-report data is shown.'
    : undefined;
  const grantRows = useMemo(
    () => company.grants.filter(isRsuGrant).map((g) => {
      const t = g.totalShares?.value ?? null;
      const v = g.vestedShares?.value ?? null;
      const u = g.unvestedShares?.value ?? null;
      return { id: g.id, number: g.grantId?.value ?? g.id.slice(0, 6), t, v, u, sell: g.sellableShares?.value ?? null,
        gap: t != null && v != null && u != null ? v + u - t : 0 };
    }),
    [company.grants],
  );
  const dupNumbers = new Set(grantRows.map((r) => r.number).filter((n, i, a) => a.indexOf(n) !== i));
  const hasIssue = grantRows.some((r) => r.gap !== 0) || dupNumbers.size > 0;
  const assessment = useMemo(() => assess(snap, rsu, tradingWindows, filingsNote, hasIssue), [snap, rsu, tradingWindows, filingsNote, hasIssue]);

  const title = prices?.meta.shortName ?? company.companyName ?? ticker ?? 'Unknown company';
  const tone = { positive: 'text-emerald-400', caution: 'text-amber-400', neutral: 'text-slate-300' } as const;

  return (
    <Card className="p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">
            {title} {ticker && <span className="text-slate-400 font-normal">({ticker})</span>}
          </h2>
          <p className="text-xs text-slate-500">
            Identified from: {company.evidence.slice(0, 2).join('; ') || 'n/a'}
            {company.evidence.length > 2 ? ` (+${company.evidence.length - 2} more)` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setNonce((n) => n + 1)} className="rounded-lg p-2 text-slate-400 hover:text-white" aria-label="Refresh">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button type="button" onClick={onRemove} className="rounded-lg p-2 text-slate-400 hover:text-white" aria-label="Hide this stock">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {!ticker && (
        <p className="text-sm text-amber-400">
          Company "{company.companyName}" has no ticker in your data. Add its ticker above, or find it by name.
        </p>
      )}
      {!ticker && company.companyName && onPickTicker && (
        <TickerPicker name={company.companyName} onPick={(sym) => onPickTicker(company.companyName!, sym)} />
      )}

      <div className="grid gap-3 sm:grid-cols-4 text-sm">
        <div><div className="text-slate-500 text-xs">RSU grants</div><div className="text-white">{rsu.grantCount}</div></div>
        <div><div className="text-slate-500 text-xs">Vested / unvested</div><div className="text-white">{rsu.vestedShares.toLocaleString()} / {rsu.unvestedShares.toLocaleString()}</div></div>
        <div><div className="text-slate-500 text-xs">Next vest</div><div className="text-white">{rsu.nextVest ? `${rsu.nextVest.shares.toLocaleString()} on ${rsu.nextVest.date}` : 'none scheduled'}</div></div>
        <div>
          <div className="text-slate-500 text-xs">Last price{snap ? ` (${ql?.text})` : ''}</div>
          <div className="text-white">
            {snap ? `${snap.last.toFixed(2)} ${prices?.meta.currency ?? ''}` : '-'}
            {snap?.dayChangePct != null && (
              <span className={snap.dayChangePct >= 0 ? ' text-emerald-400' : ' text-red-400'}> {snap.dayChangePct >= 0 ? '+' : ''}{snap.dayChangePct.toFixed(2)}%</span>
            )}
          </div>
        </div>
      </div>

      {grantRows.length > 0 && (
        <details className="text-xs text-slate-300" open={hasIssue}>
          <summary className="cursor-pointer text-slate-400">RSU grants behind these numbers ({grantRows.length})</summary>
          <table className="mt-1 w-full text-left">
            <thead className="text-slate-500"><tr><th>Grant</th><th>Total</th><th>Vested</th><th>Unvested</th><th>Sellable</th></tr></thead>
            <tbody>
              {grantRows.map((r) => (
                <tr key={r.id}><td>{r.number}</td><td>{r.t ?? '-'}</td><td>{r.v ?? '-'}</td><td>{r.u ?? '-'}</td><td>{r.sell ?? '-'}</td></tr>
              ))}
            </tbody>
          </table>
          {hasIssue && (
            <p className="mt-1 text-amber-400">
              Check the grant data: {dupNumbers.size > 0 ? 'the same grant number appears more than once. ' : ''}
              {grantRows.some((r) => r.gap !== 0) ? 'For some grants vested + unvested does not equal the total. ' : ''}
              The totals above add these rows as stored, so they may be wrong until the grant data is corrected.
            </p>
          )}
        </details>
      )}

      {ticker && (
        <>
          <div className="flex gap-1">
            {RANGES.map((r, i) => (
              <button key={r.label} type="button" onClick={() => setRangeIdx(i)}
                className={`rounded px-2 py-1 text-xs ${i === rangeIdx ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400'}`}>{r.label}</button>
            ))}
            <span className="ml-3 text-xs text-slate-500 self-center">
              <span className="text-amber-400">SMA20</span> · <span className="text-indigo-400">SMA50</span> · <span className="text-cyan-400">EMA20</span>
            </span>
          </div>
          {prices?.candles?.length ? <StockChart candles={prices.candles} /> : (
            <p className="text-sm text-slate-500">{errors.prices ? `Price data unavailable: ${errors.prices}` : loading ? 'Loading prices...' : 'No price data.'}</p>
          )}
          {prices && (
            <p className="text-xs text-slate-500">
              Source: {prices.source}, fetched {when(prices.fetchedAt)}.
              {stale && <span className="text-amber-400"> Latest candle is older than 4 days.</span>}
            </p>
          )}
        </>
      )}

      {snap && (
        <div className="grid gap-2 sm:grid-cols-4 text-xs text-slate-300">
          <div>SMA20: {snap.sma20?.toFixed(2) ?? '-'}</div>
          <div>SMA50: {snap.sma50?.toFixed(2) ?? '-'}</div>
          <div>EMA20: {snap.ema20?.toFixed(2) ?? '-'}</div>
          <div>Range: {snap.low.toFixed(2)} - {snap.high.toFixed(2)}</div>
        </div>
      )}

      {ticker && (
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="text-sm font-medium text-white mb-1">Financial reports (SEC)</h3>
            {filings?.facts?.length ? (
              <div className="text-xs text-slate-300 mb-2 space-y-1">
                {(['quarterly', 'annual'] as const).map((kind) => {
                  const rows = filings.facts.filter((f) => f.kind === kind);
                  if (!rows.length) return null;
                  const r0 = rows[0];
                  return (
                    <div key={kind}>
                      <div className="text-slate-400">
                        {kind === 'quarterly' ? 'Latest quarter' : 'Latest fiscal year'}: {r0.start} to {r0.end} ({r0.fiscal}, {r0.form} filed {r0.filedAt})
                      </div>
                      {rows.map((f) => (
                        <div key={f.label}>
                          {f.label}: {fmtMoney(f.value, f.unit)}
                          {f.priorYearValue != null && ` (prior year: ${fmtMoney(f.priorYearValue, f.unit)})`}
                        </div>
                      ))}
                    </div>
                  );
                })}
                <div className="text-slate-600">US-GAAP figures as reported to the SEC; USD, EPS per diluted share.</div>
              </div>
            ) : filings?.factsNote ? <p className="text-xs text-slate-500 mb-1">{filings.factsNote}</p> : null}
            {filings?.filings?.length ? (
              <ul className="text-xs space-y-0.5">
                {filings.filings.map((f) => (
                  <li key={f.url}><a className="text-indigo-400 hover:underline inline-flex items-center gap-1" href={f.url} target="_blank" rel="noreferrer">{f.form} filed {f.filedAt}{f.period ? ` (period ${f.period})` : ''}<ExternalLink className="h-3 w-3" /></a></li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-500">{filings?.note ?? errors.filings ?? (loading ? 'Loading...' : 'None found.')}</p>
            )}
            {filings && <p className="text-xs text-slate-600 mt-1">Source: {filings.source}, fetched {when(filings.fetchedAt)}</p>}
          </div>
          <div>
            <h3 className="text-sm font-medium text-white mb-1">Recent headlines</h3>
            {news?.items?.length ? (
              <>
                <ul className="text-xs space-y-1">
                  {news.items.filter((n) => n.relevance !== 'broad').slice(0, 8).map((n) => (
                    <li key={n.link}>
                      <a className="text-indigo-400 hover:underline" href={n.link} target="_blank" rel="noreferrer">{n.title}</a>
                      <span className="text-slate-500"> {n.publisher}{n.publishedAt ? `, ${when(n.publishedAt)}` : ''}</span>
                      {n.relevance === 'multi' && (
                        <span className="text-amber-500"> [covers several stocks: {n.relatedTickers.join(', ')}]</span>
                      )}
                    </li>
                  ))}
                </ul>
                {news.items.some((n) => n.relevance === 'broad') && (
                  <details className="mt-1 text-xs text-slate-500">
                    <summary className="cursor-pointer">Not specific to this company ({news.items.filter((n) => n.relevance === 'broad').length})</summary>
                    <ul className="space-y-1 mt-1">
                      {news.items.filter((n) => n.relevance === 'broad').map((n) => (
                        <li key={n.link}><a className="hover:underline" href={n.link} target="_blank" rel="noreferrer">{n.title}</a> {n.publisher}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            ) : <p className="text-xs text-slate-500">{errors.news ?? (loading ? 'Loading...' : 'No headlines found.')}</p>}
            {news && <p className="text-xs text-slate-600 mt-1">Source: {news.source}, fetched {when(news.fetchedAt)}</p>}
          </div>
        </div>
      )}

      <div>
        <h3 className="text-sm font-medium text-white mb-1">Considerations (rule-based, not advice)</h3>
        <ul className="text-xs space-y-0.5">
          {assessment.considerations.map((c, i) => <li key={i} className={tone[c.tone]}>• {c.text}</li>)}
        </ul>
        <ul className="text-xs text-slate-400 mt-2 space-y-0.5">
          {assessment.scenarios.map((s) => <li key={s.label}><span className="text-slate-300">{s.label}:</span> {s.text}</li>)}
        </ul>
        <p className="text-xs text-slate-600 mt-2">
          This describes current conditions and scenarios. It does not predict prices, does not tell you when to buy or sell, and ignores your tax position.
        </p>
      </div>
    </Card>
  );
}

export function StocksView() {
  const grants = useWorkingGrants();
  const documents = usePortfolioStore((s) => s.portfolio.documents);
  const [manual, setManual] = useState<string[]>(() => readList(LS_MANUAL));
  const [removed, setRemoved] = useState<string[]>(() => readList(LS_REMOVED));
  const [picked, setPicked] = useState<Record<string, string>>(() => readMap(LS_PICKED));
  const [input, setInput] = useState('');

  useEffect(() => { localStorage.setItem(LS_PICKED, JSON.stringify(picked)); }, [picked]);
  useEffect(() => { localStorage.setItem(LS_MANUAL, JSON.stringify(manual)); }, [manual]);
  useEffect(() => { localStorage.setItem(LS_REMOVED, JSON.stringify(removed)); }, [removed]);

  const companies = useMemo(() => detectCompanies(grants, documents, manual, removed, picked), [grants, documents, manual, removed, picked]);

  const add = () => {
    const t = input.trim().toUpperCase().replace(/^\$/, '');
    if (!/^[A-Z]{1,5}(\.[A-Z])?$/.test(t)) return;
    setManual((m) => (m.includes(t) ? m : [...m, t]));
    setRemoved((r) => r.filter((x) => x !== t));
    setInput('');
  };

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Stocks</h1>
        <p className="text-sm text-slate-400">
          Companies are detected from your grants and uploaded documents. Each gets its own chart, report data and reading.
          Check the identification before relying on it.
        </p>
      </div>
      <div className="flex gap-2">
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="Add ticker, e.g. MBLY" className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-white" />
        <button type="button" onClick={add} className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm text-white"><Plus className="h-4 w-4" />Add</button>
        {removed.length > 0 && (
          <button type="button" onClick={() => setRemoved([])} className="text-xs text-slate-400 underline">Restore hidden ({removed.length})</button>
        )}
      </div>
      {companies.length === 0 && (
        <p className="text-sm text-slate-500">No companies found yet. Upload grant documents or add a ticker.</p>
      )}
      {companies.filter((c) => c.ticker).length >= 2 && (
        <ComparisonChart tickers={companies.flatMap((c) => (c.ticker ? [c.ticker] : [])).slice(0, 8)} />
      )}
      {companies.map((c) => (
        <CompanySection key={c.key} company={c}
          onPickTicker={(name, sym) => setPicked((p) => ({ ...p, [normNameKey(name)]: sym }))}
          onRemove={() => { if (c.ticker) setRemoved((r) => [...r, c.ticker!]); setManual((m) => m.filter((x) => x !== c.ticker)); }} />
      ))}
    </div>
  );
            }
