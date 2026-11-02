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
const SEC_UA = process.env.SEC_USER_AGENT?.trim() || 'EquityLens personal app chen890890@gmail.com';
const TICKER_RE = /^[A-Z0-9.\-^=]{1,12}$/;

const RANGES = new Set(['5d', '1mo', '3mo', '6mo', '1y', '2y', '5y']);
const INTERVALS = new Set(['15m', '1d', '1wk']);

function bad(res: VercelResponse, code: number, error: string) {
  return res.status(code).json({ ok: false, error });
}

async function getJson(url: string, ua: string): Promise<unknown> {
  const r = await fetch(url, { headers: { 'User-Agent': ua, Accept: 'application/json' } });
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

async function news(ticker: string) {
  const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(ticker)}&newsCount=8&quotesCount=0`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const j = (await getJson(url, YAHOO_UA)) as any;
  const items = (j?.news ?? []).map((n: Record<string, unknown>) => ({
    title: n.title,
    publisher: n.publisher,
    link: n.link,
    publishedAt: typeof n.providerPublishTime === 'number'
      ? new Date((n.providerPublishTime as number) * 1000).toISOString()
      : null,
  }));
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

const FACTS: { label: string; tags: string[]; unit: string }[] = [
  { label: 'Revenue', tags: ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet'], unit: 'USD' },
  { label: 'Net income', tags: ['NetIncomeLoss'], unit: 'USD' },
  { label: 'Diluted EPS', tags: ['EarningsPerShareDiluted'], unit: 'USD/shares' },
];

async function filings(ticker: string) {
  const row = await lookupCik(ticker);
  if (!row) {
    return {
      ok: true, covered: false, source: 'SEC EDGAR', fetchedAt: new Date().toISOString(),
      note: 'Ticker not found in the SEC reporting-issuer list (foreign or non-SEC issuer, or wrong symbol).',
      filings: [], facts: [],
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

  const facts: { label: string; value: number; unit: string; period: string; form: string; filedAt: string }[] = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cf = (await getJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, SEC_UA)) as any;
    const gaap = cf?.facts?.['us-gaap'] ?? {};
    for (const f of FACTS) {
      for (const tag of f.tags) {
        const pts = (gaap[tag]?.units?.[f.unit] ?? []).filter(
          (p: { form: string; fp: string }) => (p.form === '10-Q' || p.form === '10-K') && p.fp,
        );
        if (!pts.length) continue;
        pts.sort((a: { end: string }, b: { end: string }) => (a.end < b.end ? 1 : -1));
        const p = pts[0];
        facts.push({ label: f.label, value: p.val, unit: f.unit, period: `${p.fp} ${p.fy} (ends ${p.end})`, form: p.form, filedAt: p.filed });
        break;
      }
    }
  } catch {
    /* facts are optional */
  }

  return {
    ok: true, covered: true, source: 'SEC EDGAR', fetchedAt: new Date().toISOString(),
    company: { name: row.title, cik: row.cik_str, ticker: row.ticker },
    filings: list, facts,
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
      body = await candles(ticker, range, interval);
    } else if (action === 'news') {
      body = await news(ticker);
    } else if (action === 'filings') {
      body = await filings(ticker);
    } else {
      return bad(res, 400, 'Unknown action');
    }
    // Cache at the edge so repeated views do not hit upstream providers.
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json(body);
  } catch (e) {
    return bad(res, 502, e instanceof Error ? e.message : 'Upstream error');
  }
}
