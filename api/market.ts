import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Read-only market data for the Stocks view (no API keys, no paid services).
 *
 *   /api/market?action=candles&ticker=MBLY&range=3mo&interval=1d
 *   /api/market?action=news&ticker=MBLY
 *   /api/market?action=filings&ticker=MBLY
 *
 * Sources:
 *  - Prices and headlines: Yahoo Finance's UNOFFICIAL endpoints. Yahoo has not authorised this
 *    use, can change or block it, and its terms may not allow it. Kept behind this one function so
 *    it can be replaced by a licensed provider without touching the UI.
 *  - Filings and reported figures: SEC EDGAR (free; descriptive User-Agent required; max 10
 *    requests/second). Only SEC reporting issuers are covered.
 * Every response carries `source` and `fetchedAt` so the UI can show where data came from.
 */

const YAHOO_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
// SEC asks automated clients to identify themselves. Default is a neutral app name; set SEC_USER_AGENT
// (e.g. "AppName contact@example.com") in the deployment environment if SEC requires a contact.
const SEC_UA = process.env.SEC_USER_AGENT?.trim() || 'EquityLens/1.0 (personal portfolio tool)';
const TICKER_RE = /^[A-Z0-9.\-^=]{1,12}$/;

const RANGES = new Set(['5d', '1mo', '3mo', '6mo', '1y', '2y', '5y']);
const INTERVALS = new Set(['15m', '1d', '1wk']);

function bad(res: VercelResponse, code: number, error: string) {
  return res.status(code).json({ ok: false, error });
}

async function getJson(url: string, ua: string): Promise<unknown> {
  const r = await fetch(url, { headers: { 'User-Agent': ua, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${new URL(url).host}`);
  return r.json();
}

async function candles(ticker: string, range: string, interval: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=${interval}&includePrePost=false`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const j = (await getJson(url, YAHOO_UA)) as any;
  const result = j?.chart?.result?.[0];
  if (!result) throw new Error('No chart data for ticker');
  const q = result.indicators?.quote?.[0] ?? {};
  const ts: number[] = result.timestamp ?? [];
  const out = ts
    .map((t, i) => ({
      time: t,
      open: q.open?.[i],
      high: q.high?.[i],
      low: q.low?.[i],
      close: q.close?.[i],
      volume: q.volume?.[i] ?? 0,
    }))
    .filter((c) => [c.open, c.high, c.low, c.close].every((v) => typeof v === 'number'));
  const m = result.meta ?? {};
  return {
    ok: true,
    source: 'Yahoo Finance (unofficial)',
    fetchedAt: new Date().toISOString(),
    candles: out,
    meta: {
      symbol: m.symbol,
      shortName: m.shortName ?? m.longName ?? null,
      currency: m.currency ?? null,
      exchange: m.fullExchangeName ?? null,
      regularMarketPrice: m.regularMarketPrice ?? null,
      previousClose: m.previousClose ?? null, // chartPreviousClose is the close before the range start, so it is not used
      regularMarketTime: m.regularMarketTime ?? null,
      fiftyTwoWeekHigh: m.fiftyTwoWeekHigh ?? null,
      fiftyTwoWeekLow: m.fiftyTwoWeekLow ?? null,
    },
  };
}

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ');
const COMPANY_SUFFIX = /\b(inc|corp|corporation|ltd|limited|plc|co|company|holdings|global|group|n v|nv|class [a-c])\b/g;

/**
 * Yahoo's search returns headlines that merely mention the ticker. Each item is classified so the UI
 * never presents unrelated news as company news:
 *  - specific: Yahoo tags only this ticker, or the title names the company/ticker and at most one other symbol is tagged
 *  - multi:    also tagged with other tickers (shown, labeled)
 *  - broad:    not tagged with this ticker and the title does not name the company or ticker
 */
export function classifyNews(
  ticker: string,
  name: string,
  title: string,
  relatedRaw: unknown,
): 'specific' | 'multi' | 'broad' {
  const related = Array.isArray(relatedRaw) ? (relatedRaw as unknown[]).map((x) => String(x).toUpperCase()) : [];
  const core = norm(name).replace(COMPANY_SUFFIX, '').trim();
  const nt = ' ' + norm(title) + ' ';
  // Tickers are matched case-sensitively as whole tokens so a symbol like "A" or "ON" cannot match ordinary words.
  const esc = ticker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tickerInTitle = new RegExp(`(^|[^A-Za-z0-9])\\$?${esc}([^A-Za-z0-9]|$)`).test(title);
  const namesCompany = (core.length >= 4 && nt.includes(' ' + core)) || tickerInTitle;
  const tagged = related.includes(ticker);
  const others = new Set(related.filter((t) => t !== ticker));
  if (tagged && others.size === 0) return 'specific';
  if (tagged) return namesCompany && others.size <= 1 ? 'specific' : 'multi';
  return namesCompany ? 'multi' : 'broad';
}

// Per-instance memo so repeated views do not hit Yahoo/SEC every time (best effort; serverless instances come and go).
const memo = new Map<string, { at: number; body: unknown }>();
const MEMO_MS = 5 * 60_000;
async function memoized<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < MEMO_MS) return hit.body as T;
  // Coalesce concurrent identical requests into one upstream call (same instance only).
  const running = inflight.get(key);
  if (running) return running as Promise<T>;
  const p = fn()
    .then((body) => {
      if (memo.size > 200) memo.clear();
      memo.set(key, { at: Date.now(), body });
      return body;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
const inflight = new Map<string, Promise<unknown>>();

async function news(ticker: string, name: string) {
  const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(ticker)}&newsCount=20&quotesCount=0`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const j = (await getJson(url, YAHOO_UA)) as any;
  const items = (j?.news ?? []).map((n: Record<string, unknown>) => {
    const title = String(n.title ?? '');
    const related = Array.isArray(n.relatedTickers) ? (n.relatedTickers as string[]).map((x) => String(x).toUpperCase()) : [];
    return {
      title,
      publisher: n.publisher,
      link: n.link,
      relatedTickers: [...new Set(related)],
      relevance: classifyNews(ticker, name, title, related),
      publishedAt: typeof n.providerPublishTime === 'number'
        ? new Date((n.providerPublishTime as number) * 1000).toISOString()
        : null,
    };
  });
  return { ok: true, source: 'Yahoo Finance search (unofficial)', fetchedAt: new Date().toISOString(), items };
}

type TickerRow = { cik_str: number; ticker: string; title: string };
let tickerMap: Map<string, TickerRow> | null = null;

async function lookupCik(ticker: string): Promise<TickerRow | null> {
  if (!tickerMap) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const j = (await getJson('https://www.sec.gov/files/company_tickers.json', SEC_UA)) as any;
    tickerMap = new Map(
      (Object.values(j) as TickerRow[]).map((r) => [r.ticker.toUpperCase(), r]),
    );
  }
  return tickerMap.get(ticker.toUpperCase()) ?? null;
}

// Duration facts (income statement). Instant facts are not used.
const FACTS: { label: string; tags: string[]; unit: string }[] = [
  { label: 'Revenue', tags: ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet'], unit: 'USD' },
  { label: 'Net income', tags: ['NetIncomeLoss'], unit: 'USD' },
  { label: 'Diluted EPS', tags: ['EarningsPerShareDiluted'], unit: 'USD/shares' },
];

type Pt = { start?: string; end: string; val: number; form: string; fp: string; fy: number; filed: string };
const DAY = 86_400_000;
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

/** Latest standalone-quarter or full-year value, with the same period a year earlier when reported. */
function latestComparable(points: Pt[], kind: 'quarterly' | 'annual') {
  const [lo, hi] = kind === 'quarterly' ? [80, 100] : [350, 380];
  const own = points
    .filter((p) => p.start && days(p.start, p.end) >= lo && days(p.start, p.end) <= hi)
    .filter((p) => (kind === 'annual' ? p.form === '10-K' : p.form === '10-Q' || p.form === '10-K'));
  if (!own.length) return null;
  own.sort((a, b) => (a.end < b.end ? 1 : a.end > b.end ? -1 : a.filed < b.filed ? 1 : -1));
  const cur = own[0];
  const prior = own.find((p) => Math.abs(days(p.end, cur.end) - 365) <= 20) ?? null;
  return { cur, prior };
}

async function filings(ticker: string) {
  const row = await lookupCik(ticker);
  if (!row) {
    return {
      ok: true, covered: false, source: 'SEC EDGAR', fetchedAt: new Date().toISOString(),
      note: 'Ticker not found in the SEC reporting-issuer list (foreign or non-SEC issuer, or wrong symbol).',
      filings: [], facts: [], factsNote: '',
    };
  }
  const cik = String(row.cik_str).padStart(10, '0');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sub = (await getJson(`https://data.sec.gov/submissions/CIK${cik}.json`, SEC_UA)) as any;
  const recent = sub?.filings?.recent ?? {};
  const wanted = new Set(['10-K', '10-Q', '8-K', '20-F', '6-K', '40-F']);
  const list: Record<string, string>[] = [];
  for (let i = 0; i < (recent.form?.length ?? 0) && list.length < 8; i++) {
    if (!wanted.has(recent.form[i])) continue;
    const acc = String(recent.accessionNumber[i]);
    list.push({
      form: recent.form[i],
      filedAt: recent.filingDate[i],
      period: recent.reportDate[i] || '',
      description: recent.primaryDocDescription?.[i] || '',
      url: `https://www.sec.gov/Archives/edgar/data/${row.cik_str}/${acc.replace(/-/g, '')}/${recent.primaryDocument[i]}`,
    });
  }

  type Fact = {
    label: string; kind: 'quarterly' | 'annual'; value: number; unit: string; start: string; end: string;
    fiscal: string; form: string; filedAt: string; priorYearValue: number | null; priorYearEnd: string | null;
  };
  const facts: Fact[] = [];
  let factsNote = '';
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cf = (await getJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, SEC_UA)) as any;
    const gaap = cf?.facts?.['us-gaap'];
    if (!gaap) factsNote = 'No US-GAAP figures for this filer (for example IFRS foreign issuers); see the filings list.';
    else {
      for (const f of FACTS) {
        // Use the tag that has the most recent period, since companies switch tags over time.
        const best: { kind: 'quarterly' | 'annual'; res: NonNullable<ReturnType<typeof latestComparable>> }[] = [];
        for (const kind of ['quarterly', 'annual'] as const) {
          let pick: NonNullable<ReturnType<typeof latestComparable>> | null = null;
          for (const tag of f.tags) {
            const pts: Pt[] = gaap[tag]?.units?.[f.unit] ?? [];
            const r = latestComparable(pts, kind);
            if (r && (!pick || r.cur.end > pick.cur.end)) pick = r;
          }
          if (pick) best.push({ kind, res: pick });
        }
        for (const { kind, res } of best) {
          facts.push({
            label: f.label, kind, value: res.cur.val, unit: f.unit, start: res.cur.start!, end: res.cur.end,
            fiscal: `${res.cur.fp} ${res.cur.fy}`, form: res.cur.form, filedAt: res.cur.filed,
            priorYearValue: res.prior ? res.prior.val : null, priorYearEnd: res.prior ? res.prior.end : null,
          });
        }
      }
    }
  } catch {
    factsNote = 'Reported figures could not be loaded.';
  }

  return {
    ok: true, covered: true, source: 'SEC EDGAR', fetchedAt: new Date().toISOString(),
    company: { name: row.title, cik: row.cik_str, ticker: row.ticker },
    filings: list, facts, factsNote,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = String(req.query.action ?? '');
  const ticker = String(req.query.ticker ?? '').toUpperCase();
  if (!TICKER_RE.test(ticker)) return bad(res, 400, 'Invalid ticker');
  try {
    let body: unknown;
    if (action === 'candles') {
      const range = String(req.query.range ?? '3mo');
      const interval = String(req.query.interval ?? '1d');
      if (!RANGES.has(range) || !INTERVALS.has(interval)) return bad(res, 400, 'Invalid range or interval');
      body = await memoized(`c:${ticker}:${range}:${interval}`, () => candles(ticker, range, interval));
    } else if (action === 'news') {
      const name = String(req.query.name ?? '').slice(0, 80);
      body = await memoized(`n:${ticker}:${name}`, () => news(ticker, name));
    } else if (action === 'filings') {
      body = await memoized(`f:${ticker}`, () => filings(ticker));
    } else {
      return bad(res, 400, 'Unknown action');
    }
    // Cache at the edge so repeated views do not hit upstream providers.
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json(body);
  } catch (e) {
    void e; // do not echo upstream error text to callers
    return bad(res, 502, 'Upstream data provider error');
  }
                     }
