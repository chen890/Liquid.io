import type { DocumentRecord, GrantRecord } from '../types';

export interface DetectedCompany {
  /** Stable key: ticker when known, otherwise normalised company name. */
  key: string;
  ticker: string | null;
  companyName: string | null;
  /** Where the identification came from, shown so the user can verify it. */
  evidence: string[];
  grants: GrantRecord[];
  /** Ticker found only in document text (no grant carries it). */
  fromTextOnly: boolean;
}

const RSU_TYPES = new Set(['RSU', 'RestrictedShares', 'PerformanceShares']);
export const isRsuGrant = (g: GrantRecord) =>
  !g.grantType || RSU_TYPES.has(g.grantType.value);

const normTicker = (t: string) => t.trim().toUpperCase().replace(/^\$/, '');
const normName = (n: string) =>
  n.toLowerCase().replace(/[.,]/g, '').replace(/\b(inc|corp|corporation|ltd|limited|plc|co|company|holdings|n\.v|nv)\b/g, '').replace(/\s+/g, ' ').trim();

const VALID = /^[A-Z]{1,5}(\.[A-Z])?$/;
/** Words that look like tickers but are common in grant paperwork. */
const STOP = new Set(['RSU', 'USD', 'ILS', 'NIS', 'CGT', 'ESPP', 'ISO', 'NSO', 'FMV', 'LLC', 'INC', 'LTD', 'PDF', 'NYSE', 'NASDAQ', 'THE', 'AND', 'FOR', 'TAX', 'IRS', 'ITA', 'USA', 'CEO', 'CFO', 'N/A', 'ID', 'IS', 'IT', 'OR', 'AS', 'AT', 'BY', 'ON', 'IN', 'TO', 'OF']);

/** Tickers mentioned in free text: `$TSLA`, `(NASDAQ: MBLY)`, `NYSE:ABC`, `ticker symbol: XYZ`. */
export function tickersInText(text: string): { ticker: string; snippet: string }[] {
  const found = new Map<string, string>();
  const add = (raw: string, idx: number) => {
    const t = normTicker(raw);
    if (!VALID.test(t) || STOP.has(t) || found.has(t)) return;
    found.set(t, text.slice(Math.max(0, idx - 30), idx + 40).replace(/\s+/g, ' ').trim());
  };
  const patterns: RegExp[] = [
    /\$([A-Z]{1,5})\b/g,
    /\b(?:NASDAQ|NYSE|NYSE American|AMEX|TASE)\s*[:-]\s*([A-Z]{1,5}(?:\.[A-Z])?)\b/g,
    /\b[Tt]icker(?:\s+[Ss]ymbol)?\s*[:-]?\s*([A-Z]{1,5}(?:\.[A-Z])?)\b/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) add(m[1], m.index);
  }
  return [...found.entries()].map(([ticker, snippet]) => ({ ticker, snippet }));
}

/**
 * Groups the portfolio by company. Grants are the primary source (extracted ticker/company),
 * document text adds candidates the user can confirm. Companies are never merged by guess:
 * two grants join only if their ticker matches, or they have no ticker and the same normalised name.
 */
export function detectCompanies(
  grants: GrantRecord[],
  documents: DocumentRecord[],
  manualTickers: string[] = [],
  removed: string[] = [],
  /** Tickers the user picked for name-only companies (normalised company name -> ticker). */
  chosenTickers: Record<string, string> = {},
): DetectedCompany[] {
  const byKey = new Map<string, DetectedCompany>();
  const nameToKey = new Map<string, string>();

  for (const g of grants) {
    const rawTicker = g.tickerSymbol?.value ? normTicker(g.tickerSymbol.value) : null;
    // A grant field like "RSU" or "USD" is not a ticker; ignore it rather than chart a nonsense symbol.
    const nameForPick = g.companyName?.value?.trim() || null;
    const picked = nameForPick ? chosenTickers[normName(nameForPick)] : undefined;
    const ticker = rawTicker && VALID.test(rawTicker) && !STOP.has(rawTicker) ? rawTicker : picked ? normTicker(picked) : null;
    const name = nameForPick;
    if (!ticker && !name) continue;
    const key = ticker ?? (nameToKey.get(normName(name!)) ?? `name:${normName(name!)}`);
    let c = byKey.get(key);
    if (!c) {
      c = { key, ticker, companyName: name, evidence: [], grants: [], fromTextOnly: false };
      byKey.set(key, c);
    }
    if (name) {
      nameToKey.set(normName(name), key);
      if (!c.companyName) c.companyName = name;
    }
    c.grants.push(g);
    if (picked && ticker === normTicker(picked) && !c.evidence.includes('ticker chosen by you')) c.evidence.push('ticker chosen by you');
    const src = g.tickerSymbol?.sources?.[0] ?? g.companyName?.sources?.[0];
    const ev = src ? `${src.file}${src.page ? ` p.${src.page}` : ''}` : 'extracted grant';
    if (!c.evidence.includes(ev)) c.evidence.push(ev);
  }

  // Name-only companies that match a ticker company by name: attach, do not duplicate.
  for (const [key, c] of [...byKey.entries()]) {
    if (!key.startsWith('name:')) continue;
    const target = [...byKey.values()].find((o) => o.ticker && o.companyName && normName(o.companyName) === normName(c.companyName ?? ''));
    if (target) {
      target.grants.push(...c.grants);
      byKey.delete(key);
    }
  }

  const addText = (ticker: string, ev: string) => {
    const t = normTicker(ticker);
    if (byKey.has(t)) {
      const c = byKey.get(t)!;
      if (!c.evidence.includes(ev)) c.evidence.push(ev);
      return;
    }
    byKey.set(t, { key: t, ticker: t, companyName: null, evidence: [ev], grants: [], fromTextOnly: true });
  };
  for (const d of documents) {
    if (!d.rawText) continue;
    for (const { ticker, snippet } of tickersInText(d.rawText)) addText(ticker, `${d.filename}: "${snippet}"`);
  }
  for (const t of manualTickers) addText(t, 'added manually');

  const gone = new Set(removed.map(normTicker));
  return [...byKey.values()]
    .filter((c) => !(c.ticker && gone.has(c.ticker)))
    .sort((a, b) => b.grants.length - a.grants.length || (a.ticker ?? '').localeCompare(b.ticker ?? ''));
}

export interface RsuSummary {
  grantCount: number;
  totalShares: number;
  vestedShares: number;
  unvestedShares: number;
  nextVest: { date: string; shares: number } | null;
}

export function summarizeRsu(grants: GrantRecord[], now = new Date()): RsuSummary {
  const rsu = grants.filter(isRsuGrant);
  let total = 0, vested = 0, unvested = 0;
  let next: { date: string; shares: number } | null = null;
  for (const g of rsu) {
    total += g.totalShares?.value ?? 0;
    vested += g.vestedShares?.value ?? 0;
    unvested += g.unvestedShares?.value ?? 0;
    for (const e of g.vestingSchedule ?? []) {
      if (e.vested || new Date(e.date) <= now) continue;
      if (!next || e.date < next.date) next = { date: e.date, shares: e.shares };
      else if (e.date === next.date) next.shares += e.shares;
    }
  }
  return { grantCount: rsu.length, totalShares: total, vestedShares: vested, unvestedShares: unvested, nextVest: next };
      }
