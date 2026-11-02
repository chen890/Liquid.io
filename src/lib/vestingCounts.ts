import type { ExtractedField, GrantRecord } from '../types';

export interface VestingCounts {
  total: number;
  vested: number;
  unvested: number;
  /** Shares available to sell now (≤ vested). */
  sellable: number;
  /** Vested − sellable when known (sold / transferred / restricted). */
  sold: number;
  /** True when vested was inferred (total − unvested) rather than stated. */
  vestedDerived: boolean;
  /** True when unvested was inferred (total − vested) rather than stated. */
  unvestedDerived: boolean;
  /** True when sellable was inferred rather than stated. */
  sellableDerived: boolean;
}

function num(field: ExtractedField<number> | undefined): number | undefined {
  if (!field || field.value === null || field.value === undefined) return undefined;
  const n = Number(field.value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Resolve vested / unvested / total share counts for display and analytics.
 *
 * Brokerage extracts often set `vestedShares: 0` on unvested-only rows, or omit
 * vested entirely while filling `unvestedShares` + `totalShares`. Treat an
 * explicit 0 as missing when it contradicts total − unvested.
 */
export function resolveVestingCounts(grant: GrantRecord): VestingCounts {
  let total = num(grant.totalShares);
  let vested = num(grant.vestedShares);
  let unvested = num(grant.unvestedShares);
  let sellable = num(grant.sellableShares);
  let sold = num(grant.soldShares);
  let vestedDerived = false;
  let unvestedDerived = false;
  let sellableDerived = false;

  // Explicit 0 that contradicts total/unvested is almost always a missing value
  // from an unvested-only statement row — ignore it for derivation.
  if (vested === 0 && unvested !== undefined && total !== undefined && total > unvested) {
    vested = undefined;
  }
  if (unvested === 0 && vested !== undefined && total !== undefined && total > vested) {
    unvested = undefined;
  }

  if (total === undefined && vested !== undefined && unvested !== undefined) {
    total = vested + unvested;
  }
  if (vested === undefined && total !== undefined && unvested !== undefined) {
    vested = Math.max(0, total - unvested);
    vestedDerived = true;
  }
  if (unvested === undefined && total !== undefined && vested !== undefined) {
    unvested = Math.max(0, total - vested);
    unvestedDerived = true;
  }

  const vestedN = vested ?? 0;

  if (sellable === undefined) {
    if (sold !== undefined) {
      sellable = Math.max(0, vestedN - sold);
      sellableDerived = true;
    } else {
      // Legacy extracts: no sellable/sold → assume all vested RSUs are still held.
      sellable = vestedN;
      sellableDerived = true;
    }
  }
  if (sold === undefined) {
    sold = Math.max(0, vestedN - (sellable ?? 0));
  }

  return {
    total: total ?? 0,
    vested: vestedN,
    unvested: unvested ?? 0,
    sellable: sellable ?? 0,
    sold: sold ?? 0,
    vestedDerived,
    unvestedDerived,
    sellableDerived,
  };
}

function syntheticField(
  value: number,
  confidence: number,
): ExtractedField<number> {
  return { value, confidence, sources: [] };
}

/**
 * Fill missing vesting fields on a grant after extraction / merge so the
 * portfolio stores coherent vested/unvested/total numbers.
 */
export function normalizeGrantVesting(grant: GrantRecord): GrantRecord {
  const counts = resolveVestingCounts(grant);
  const next: GrantRecord = { ...grant };

  if (!grant.totalShares && counts.total > 0) {
    next.totalShares = syntheticField(counts.total, 60);
  }
  if ((!grant.vestedShares || (grant.vestedShares.value === 0 && counts.vestedDerived)) && counts.vested > 0) {
    next.vestedShares = syntheticField(counts.vested, counts.vestedDerived ? 55 : (grant.vestedShares?.confidence ?? 70));
  }
  if ((!grant.unvestedShares || (grant.unvestedShares.value === 0 && counts.unvestedDerived)) && counts.unvested > 0) {
    next.unvestedShares = syntheticField(counts.unvested, counts.unvestedDerived ? 55 : (grant.unvestedShares?.confidence ?? 70));
  }
  if (!grant.sellableShares && counts.sellable >= 0) {
    next.sellableShares = syntheticField(
      counts.sellable,
      counts.sellableDerived ? 55 : 70,
    );
  }
  if ((!grant.soldShares || grant.soldShares.value === undefined) && counts.sold > 0) {
    next.soldShares = syntheticField(counts.sold, 60);
  }
  return next;
}
