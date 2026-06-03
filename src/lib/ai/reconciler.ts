import type { GrantRecord, ExtractedField } from '../../types';
import { v4 as uuidv4 } from 'uuid';

// ──────────────────────────────────────────────────────────────────────────────
// Scoring
// ──────────────────────────────────────────────────────────────────────────────

/** Strip leading zeros, whitespace and common prefixes for robust ID comparison */
function normalizeGrantId(id: string): string {
  return id.trim().replace(/^0+/, '').toUpperCase();
}

function dateSimilarity(a?: string, b?: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.substring(0, 7) === b.substring(0, 7)) return 0.8; // same year-month
  if (a.substring(0, 4) === b.substring(0, 4)) return 0.4; // same year
  return 0;
}

export interface MatchResult {
  score: number;
  reasons: string[];
}

export function computeMatchScore(a: GrantRecord, b: GrantRecord): MatchResult {
  let score = 0;
  const reasons: string[] = [];

  // Grant ID — definitive signal (normalised comparison)
  if (a.grantId?.value && b.grantId?.value) {
    if (normalizeGrantId(a.grantId.value) === normalizeGrantId(b.grantId.value)) {
      score += 60;
      reasons.push('Grant ID match');
    }
  }

  // Grant date
  if (a.grantDate?.value && b.grantDate?.value) {
    const sim = dateSimilarity(a.grantDate.value, b.grantDate.value);
    score += sim * 20;
    if (sim > 0) reasons.push('Grant date match');
  }

  // Total shares — use ORIGINAL share count at grant time.
  // Note: "remaining unvested" shrinks every period, so only treat
  // shares as a signal if one side has no vesting info (likely the full grant).
  if (a.totalShares?.value && b.totalShares?.value) {
    const aIsLikelyOriginal = !a.unvestedShares?.value;
    const bIsLikelyOriginal = !b.unvestedShares?.value;
    if (aIsLikelyOriginal || bIsLikelyOriginal) {
      if (a.totalShares.value === b.totalShares.value) {
        score += 20;
        reasons.push('Share count match');
      } else if (
        Math.abs(a.totalShares.value - b.totalShares.value) /
          Math.max(a.totalShares.value, b.totalShares.value) < 0.02
      ) {
        score += 10;
        reasons.push('Share count ~match');
      }
    }
  }

  // Grant type
  if (a.grantType?.value && b.grantType?.value) {
    if (a.grantType.value === b.grantType.value) { score += 10; reasons.push('Type match'); }
  }

  // Ticker / company
  if (a.tickerSymbol?.value && b.tickerSymbol?.value) {
    if (a.tickerSymbol.value.toUpperCase() === b.tickerSymbol.value.toUpperCase()) {
      score += 5; reasons.push('Ticker match');
    }
  } else if (a.companyName?.value && b.companyName?.value) {
    if (a.companyName.value.toLowerCase() === b.companyName.value.toLowerCase()) {
      score += 5; reasons.push('Company match');
    }
  }

  return { score, reasons };
}

// ──────────────────────────────────────────────────────────────────────────────
// Merging
// ──────────────────────────────────────────────────────────────────────────────

function mergeField<T>(
  a: ExtractedField<T> | undefined,
  b: ExtractedField<T> | undefined,
): ExtractedField<T> | undefined {
  if (!a && !b) return undefined;
  if (!a) return b;
  if (!b) return a;
  const winner = a.confidence >= b.confidence ? a : b;
  return {
    value: winner.value,
    confidence: Math.max(a.confidence, b.confidence),
    sources: [...a.sources, ...b.sources],
  };
}

/**
 * Merge two grants, keeping the highest-confidence value for each field.
 * For time-sensitive fields (price, unvestedShares, currentMarketValue),
 * the value from the grant with the LATER source file wins.
 */
export function mergeGrants(base: GrantRecord, incoming: GrantRecord): GrantRecord {
  return {
    id: base.id, // preserve the canonical ID of the base record
    grantId:            mergeField(base.grantId,            incoming.grantId),
    grantType:          mergeField(base.grantType,          incoming.grantType),
    companyName:        mergeField(base.companyName,        incoming.companyName),
    tickerSymbol:       mergeField(base.tickerSymbol,       incoming.tickerSymbol),
    grantDate:          mergeField(base.grantDate,          incoming.grantDate),
    vestingStartDate:   mergeField(base.vestingStartDate,   incoming.vestingStartDate),
    vestingEndDate:     mergeField(base.vestingEndDate,     incoming.vestingEndDate),
    // For original grant size, take the larger value (statements show "remaining unvested")
    totalShares:        pickLarger(base.totalShares,        incoming.totalShares),
    strikePrice:        mergeField(base.strikePrice,        incoming.strikePrice),
    exercisePrice:      mergeField(base.exercisePrice,      incoming.exercisePrice),
    // Time-sensitive — use incoming (assumed to be newer)
    fairMarketValue:    mergeField(incoming.fairMarketValue,    base.fairMarketValue),
    unvestedShares:     mergeField(incoming.unvestedShares,     base.unvestedShares),
    currentMarketValue: mergeField(incoming.currentMarketValue, base.currentMarketValue),
    vestedShares:       mergeField(incoming.vestedShares,       base.vestedShares),
    cliffDuration:      mergeField(base.cliffDuration,      incoming.cliffDuration),
    vestingFrequency:   mergeField(base.vestingFrequency,   incoming.vestingFrequency),
    exercisedShares:    mergeField(base.exercisedShares,    incoming.exercisedShares),
    cancelledShares:    mergeField(base.cancelledShares,    incoming.cancelledShares),
    soldShares:         mergeField(base.soldShares,         incoming.soldShares),
    remainingShares:    mergeField(incoming.remainingShares,    base.remainingShares),
    costBasis:          mergeField(base.costBasis,          incoming.costBasis),
    estimatedTaxBasis:  mergeField(base.estimatedTaxBasis,  incoming.estimatedTaxBasis),
    sourceFiles:        [...new Set([...base.sourceFiles, ...incoming.sourceFiles])],
    mergedFromIds:      [...new Set([base.id, incoming.id, ...(base.mergedFromIds ?? []), ...(incoming.mergedFromIds ?? [])])],
    matchConfidence:    computeMatchScore(base, incoming).score,
    vestingSchedule:    base.vestingSchedule ?? incoming.vestingSchedule,
  };
}

/** For originalShareCount: keep the larger value (quarterly statements show shrinking "remaining") */
function pickLarger(
  a: ExtractedField<number> | undefined,
  b: ExtractedField<number> | undefined,
): ExtractedField<number> | undefined {
  if (!a && !b) return undefined;
  if (!a) return b;
  if (!b) return a;
  return (a.value ?? 0) >= (b.value ?? 0) ? a : b;
}

// ──────────────────────────────────────────────────────────────────────────────
// Session-level deduplication (within one upload batch)
// ──────────────────────────────────────────────────────────────────────────────

const SESSION_MERGE_THRESHOLD = 40;

/**
 * Deduplicate a batch of raw-extracted grants.
 * Grants from the SAME source file are never merged with each other
 * (they are distinct grants, just coincidentally in one document).
 */
export function reconcileGrants(allGrants: GrantRecord[]): GrantRecord[] {
  const remaining = [...allGrants];
  const merged: GrantRecord[] = [];
  const used = new Set<number>();

  for (let i = 0; i < remaining.length; i++) {
    if (used.has(i)) continue;
    let current = remaining[i];

    for (let j = i + 1; j < remaining.length; j++) {
      if (used.has(j)) continue;

      // Same file → distinct grants, never merge
      const sameFile = remaining[j].sourceFiles.some((f) => current.sourceFiles.includes(f));
      if (sameFile) continue;

      const { score } = computeMatchScore(current, remaining[j]);
      if (score >= SESSION_MERGE_THRESHOLD) {
        current = { ...mergeGrants(current, remaining[j]), id: uuidv4() };
        used.add(j);
      }
    }

    used.add(i);
    merged.push(current);
  }

  return merged;
}

// ──────────────────────────────────────────────────────────────────────────────
// Portfolio-level deduplication (new grants vs already stored grants)
// ──────────────────────────────────────────────────────────────────────────────

const PORTFOLIO_MERGE_THRESHOLD = 40;

export interface PortfolioMergeResult {
  /** New grants that don't match anything in the portfolio — save as-is */
  toAdd: GrantRecord[];
  /** Existing grants that should be updated with merged data */
  toUpdate: GrantRecord[];
  /** Summary of what was merged */
  mergedCount: number;
}

/**
 * Compare incoming (newly extracted + session-reconciled) grants against the
 * already-stored portfolio grants.
 *
 * Returns:
 *  - toAdd:    genuinely new grants to insert
 *  - toUpdate: existing grants enriched with new data (update in DB)
 */
export function deduplicateAgainstPortfolio(
  incoming: GrantRecord[],
  existing: GrantRecord[],
): PortfolioMergeResult {
  const toAdd: GrantRecord[] = [];
  const toUpdate: GrantRecord[] = [];
  const updatedExistingIds = new Set<string>();

  for (const newGrant of incoming) {
    let bestScore = 0;
    let bestMatch: GrantRecord | null = null;

    for (const existingGrant of existing) {
      // Skip if this existing grant was already updated in this run
      if (updatedExistingIds.has(existingGrant.id)) continue;

      // Skip if the new grant's source file is already listed on the existing grant
      // (means this exact extraction was already imported before)
      const alreadyImported = newGrant.sourceFiles.every((f) =>
        existingGrant.sourceFiles.includes(f),
      );
      if (alreadyImported) { bestScore = 100; bestMatch = existingGrant; break; }

      const { score } = computeMatchScore(newGrant, existingGrant);
      if (score > bestScore) { bestScore = score; bestMatch = existingGrant; }
    }

    if (bestScore >= PORTFOLIO_MERGE_THRESHOLD && bestMatch) {
      // Merge new data into the existing grant record
      const merged = mergeGrants(bestMatch, newGrant);
      toUpdate.push(merged);
      updatedExistingIds.add(bestMatch.id);
    } else {
      toAdd.push(newGrant);
    }
  }

  return { toAdd, toUpdate, mergedCount: toUpdate.length };
}
