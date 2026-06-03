import type { GrantRecord } from '../types';

export interface VestingEvent {
  /** Unique key for React rendering */
  key: string;
  grantId: string;
  grantType: string;
  ticker: string;
  companyName: string;
  sourceFile: string;
  /** Date shares vest (become owned) */
  vestDate: Date;
  /** Date shares can be sold (same as vestDate for RSUs; varies for options) */
  canSellDate: Date;
  shares: number;
  pricePerShare: number;
  /** Estimated gross value at current FMV */
  estimatedValue: number;
}

function addMonths(date: Date, n: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
}

/**
 * Derives a forward-looking vesting schedule from a GrantRecord.
 * Only returns FUTURE events (after today).
 *
 * Logic:
 *  - Uses vestingStartDate + cliffDuration to find the first vest date.
 *  - Repeats at the grant's vestingFrequency until vestingEndDate.
 *  - If vestingEndDate is missing, falls back to a 4-year window from
 *    vestingStartDate (industry default for monthly RSU grants).
 *  - "Can sell" date = vestDate for RSUs; vestDate + 1y for ISO options
 *    (simplified — full AMT/LTCG analysis is outside scope).
 */
export function computeVestingEvents(grant: GrantRecord): VestingEvent[] {
  const totalShares = grant.totalShares?.value;
  if (!totalShares || totalShares <= 0) return [];

  // ── Key dates ──────────────────────────────────────────────────────────────
  const startDateStr  = grant.vestingStartDate?.value ?? grant.grantDate?.value;
  if (!startDateStr) return [];

  const startDate = new Date(startDateStr);

  const endDate = grant.vestingEndDate?.value
    ? new Date(grant.vestingEndDate.value)
    : addMonths(startDate, 48); // 4-year default

  const cliffMonths = grant.cliffDuration?.value ?? 0;
  const cliffDate   = addMonths(startDate, cliffMonths);

  // ── Period length ──────────────────────────────────────────────────────────
  const freq = grant.vestingFrequency?.value ?? 'Monthly';
  const periodMonths = freq === 'Quarterly' ? 3 : freq === 'Annual' ? 12 : 1;

  // ── How many vesting events fit after the cliff ────────────────────────────
  const remainingMonths =
    (endDate.getFullYear() - cliffDate.getFullYear()) * 12 +
    (endDate.getMonth() - cliffDate.getMonth());

  const totalPeriods = Math.max(1, Math.floor(remainingMonths / periodMonths));

  // Shares already vested — use to compute what's left to vest
  const alreadyVested = grant.vestedShares?.value ?? 0;
  const unvested      = totalShares - alreadyVested;
  if (unvested <= 0) return [];

  // Shares per future period (simplified — pro-rated evenly)
  // Count future periods only
  const now = new Date();
  const futurePeriods: Date[] = [];
  for (let i = 0; i < totalPeriods; i++) {
    const d = addMonths(cliffDate, i * periodMonths);
    if (d > now && d <= endDate) futurePeriods.push(d);
  }
  if (futurePeriods.length === 0) return [];

  const sharesPerPeriod = Math.floor(unvested / futurePeriods.length);
  let remainder = unvested - sharesPerPeriod * futurePeriods.length;

  // ── Price — use document FMV per share; derive from total if needed ────────
  const price =
    grant.fairMarketValue?.value ??
    (grant.currentMarketValue?.value && grant.totalShares?.value
      ? grant.currentMarketValue.value / grant.totalShares.value
      : 0);

  // ── "Can sell" offset ──────────────────────────────────────────────────────
  const isISO = grant.grantType?.value === 'ISO';
  const canSellOffsetMonths = isISO ? 12 : 0;

  // ── Build events ──────────────────────────────────────────────────────────
  const grantId    = grant.grantId?.value ?? grant.id.slice(0, 8);
  const ticker     = grant.tickerSymbol?.value ?? '';
  const company    = grant.companyName?.value ?? ticker;
  const grantType  = grant.grantType?.value ?? 'Grant';
  const sourceFile = grant.sourceFiles[0] ?? '';

  return futurePeriods.map((vestDate, idx) => {
    const shares = sharesPerPeriod + (idx === 0 ? remainder-- : 0);
    if (remainder < 0) remainder = 0;
    const canSellDate = addMonths(vestDate, canSellOffsetMonths);
    return {
      key:            `${grant.id}-${idx}`,
      grantId,
      grantType,
      ticker,
      companyName:    company,
      sourceFile,
      vestDate,
      canSellDate,
      shares,
      pricePerShare:  price,
      estimatedValue: shares * price,
    };
  });
}

/** Aggregate all vesting events across all grants, sorted by date */
export function getAllVestingEvents(
  grants: GrantRecord[],
  livePrices?: Record<string, number>,
): VestingEvent[] {
  return grants
    .flatMap((g) => {
      const events = computeVestingEvents(g);
      if (!livePrices) return events;
      const lp = livePrices[g.tickerSymbol?.value ?? ''];
      if (lp == null) return events;
      return events.map((ev) => ({
        ...ev,
        pricePerShare:  lp,
        estimatedValue: ev.shares * lp,
      }));
    })
    .sort((a, b) => a.vestDate.getTime() - b.vestDate.getTime());
}

/** Group events by calendar month for charting */
export function groupByMonth(events: VestingEvent[]): { month: string; shares: number; value: number }[] {
  const map = new Map<string, { shares: number; value: number }>();
  for (const ev of events) {
    const key = ev.vestDate.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    const cur = map.get(key) ?? { shares: 0, value: 0 };
    map.set(key, { shares: cur.shares + ev.shares, value: cur.value + ev.estimatedValue });
  }
  return Array.from(map.entries()).map(([month, v]) => ({ month, ...v }));
}
