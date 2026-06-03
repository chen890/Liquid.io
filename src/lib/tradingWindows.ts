import type { TradingWindow, TaxRoute } from '../types';

/**
 * Returns true if today falls inside one of the configured trading windows.
 */
export function isInTradingWindow(windows: TradingWindow[], date = new Date()): boolean {
  const ts = date.getTime();
  return windows.some((w) => {
    const open  = new Date(w.openDate).getTime();
    const close = new Date(w.closeDate).getTime();
    return ts >= open && ts <= close;
  });
}

/**
 * Returns the next upcoming open window, or null if none.
 */
export function nextTradingWindow(windows: TradingWindow[]): TradingWindow | null {
  const now = Date.now();
  return (
    windows
      .filter((w) => new Date(w.openDate).getTime() > now)
      .sort((a, b) => new Date(a.openDate).getTime() - new Date(b.openDate).getTime())[0] ?? null
  );
}

/**
 * Returns the active window (if any).
 */
export function currentTradingWindow(windows: TradingWindow[]): TradingWindow | null {
  const now = new Date();
  return windows.find((w) => {
    const open  = new Date(w.openDate);
    const close = new Date(w.closeDate);
    return now >= open && now <= close;
  }) ?? null;
}

/**
 * Compute the trustee release date for a Section 102(b)(2) grant.
 * Under IL law, shares must be held in a trustee for 24 months from grant date.
 */
export function trusteReleaseDate(grantDate: string): string {
  const d = new Date(grantDate);
  d.setMonth(d.getMonth() + 24);
  return d.toISOString().slice(0, 10);
}

/**
 * For a given grant's tax route and share count, compute the corrected tax.
 *
 * 102(b)(2): All proceeds taxed at 25% CGT (no income tax at vest).
 *            Cost basis = 0 (or grant-date FMV depending on sub-route).
 * 102(b)(1): Income tax at vest (marginalRate * vestedValue) + 25% CGT on appreciation.
 * US:        LTCG or STCG on post-vest appreciation; ordinary income at vest.
 */
export interface TaxBreakdown {
  grossUSD: number;
  incomeTaxUSD: number;     // ordinary income component
  capitalGainUSD: number;   // post-vest appreciation
  cgtUSD: number;           // capital gains tax
  totalTaxUSD: number;
  netUSD: number;
  route: TaxRoute;
}

export function computeSection102Tax(params: {
  route: TaxRoute;
  shares: number;
  salePrice: number;
  fmvAtVest: number;       // cost basis (= FMV at vest date)
  marginalRate: number;    // decimal e.g. 0.46 for 46%
  cgtRate?: number;        // default 0.25
  ltcgRate?: number;       // default 0.238 (US LTCG + NIIT)
}): TaxBreakdown {
  const { route, shares, salePrice, fmvAtVest, marginalRate, cgtRate = 0.25, ltcgRate = 0.238 } = params;
  const grossUSD      = shares * salePrice;
  const vestValue     = shares * fmvAtVest;
  const appreciation  = Math.max(0, grossUSD - vestValue);

  let incomeTaxUSD = 0;
  let cgtUSD       = 0;

  if (route === '102b2') {
    // ALL proceeds taxed at CGT rate — no income tax at vest
    // Cost basis for CGT = grant-date FMV (typically $0 for RSUs)
    cgtUSD = grossUSD * cgtRate;
    incomeTaxUSD = 0;
  } else if (route === '102b1') {
    // Income tax on the full vest value + CGT on appreciation only
    incomeTaxUSD = vestValue * marginalRate;
    cgtUSD       = appreciation * cgtRate;
  } else if (route === 'us') {
    // Simplified: ordinary income at vest + LTCG on appreciation
    incomeTaxUSD = vestValue * marginalRate;
    cgtUSD       = appreciation * ltcgRate;
  } else {
    // Generic fallback: 25% on all gains
    cgtUSD = Math.max(0, grossUSD - vestValue) * cgtRate;
  }

  const totalTaxUSD = incomeTaxUSD + cgtUSD;
  return {
    grossUSD,
    incomeTaxUSD,
    capitalGainUSD: appreciation,
    cgtUSD,
    totalTaxUSD,
    netUSD: grossUSD - totalTaxUSD,
    route,
  };
}

/** Human-readable label for a tax route */
export function taxRouteLabel(route?: TaxRoute): string {
  if (route === '102b2') return 'IL 102(b)(2) — CGT route';
  if (route === '102b1') return 'IL 102(b)(1) — Income route';
  if (route === 'us')    return 'US — ordinary income + LTCG';
  return 'IL CGT (default)';
}
