/**
 * Deterministic parser for Morgan Stanley at Work "By Status" Excel exports
 * (sheets named Sellable + Unvested). Prefer this over LLM extraction — the
 * portal's sellable vs vested gap (sold/transferred shares) is explicit here.
 */

import type { ExtractedField, GrantRecord, GrantType, VestLot } from '../../types';
import { v4 as uuidv4 } from 'uuid';
import { normalizeGrantVesting } from '../vestingCounts';

type Row = Record<string, unknown>;

function field<T>(value: T, confidence = 98, file = '', snippet = ''): ExtractedField<T> {
  return {
    value,
    confidence,
    sources: snippet || file ? [{ file, snippet }] : [],
  };
}

function num(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '' || v === '--') return undefined;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = Number(String(v).replace(/[$,%\s]/g, '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

function str(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s && s !== '--' ? s : undefined;
}

/** Normalize MS dates like 31-JAN-2024 / 01/31/2025 → YYYY-MM-DD */
function toISODate(v: unknown): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const months: Record<string, string> = {
    JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
    JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
  };

  const m1 = s.match(/^(\d{1,2})[-/]([A-Za-z]{3})[-/](\d{4})$/);
  if (m1) {
    const mon = months[m1[2].toUpperCase()];
    if (mon) return `${m1[3]}-${mon}-${m1[1].padStart(2, '0')}`;
  }

  const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m2) {
    return `${m2[3]}-${m2[1].padStart(2, '0')}-${m2[2].padStart(2, '0')}`;
  }

  const m3 = s.match(/^([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i);
  if (m3) {
    const mon = months[m3[1].slice(0, 3).toUpperCase()];
    if (mon) return `${m3[3]}-${mon}-${m3[2].padStart(2, '0')}`;
  }

  const t = Date.parse(s);
  if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  return undefined;
}

function col(row: Row, ...names: string[]): unknown {
  for (const name of names) {
    if (name in row && row[name] != null && row[name] !== '') return row[name];
  }
  // Tolerate trailing spaces in MS headers ("Shares Withheld ")
  for (const [k, v] of Object.entries(row)) {
    const kn = k.trim();
    if (names.some((n) => n.trim() === kn) && v != null && v !== '') return v;
  }
  return undefined;
}

export function isMorganStanleyByStatusWorkbook(sheetNames: string[]): boolean {
  const lower = sheetNames.map((s) => s.trim().toLowerCase());
  return lower.includes('sellable') && lower.includes('unvested');
}

interface Agg {
  grantId: string;
  grantDate?: string;
  ticker?: string;
  granted?: number;
  unvested?: number;
  sellable: number;
  vestedFromLots: number;
  soldFromLots: number;
  fmv?: number;
  costBasis?: number;
  companyName?: string;
  taxRouteHint?: string;
  vestLots: VestLot[];
  nextVestDate?: string;
  vestingEndDate?: string;
}

/**
 * Build GrantRecords from a parsed By Status workbook (json rows per sheet).
 */
export function grantsFromMorganStanleyByStatus(
  sheets: Record<string, Row[]>,
  filename: string,
): GrantRecord[] {
  const sellableRows = sheets.Sellable ?? sheets.sellable ?? [];
  const unvestedRows = sheets.Unvested ?? sheets.unvested ?? [];

  const byId = new Map<string, Agg>();

  const ensure = (grantId: string): Agg => {
    let a = byId.get(grantId);
    if (!a) {
      a = {
        grantId,
        sellable: 0,
        vestedFromLots: 0,
        soldFromLots: 0,
        vestLots: [],
      };
      byId.set(grantId, a);
    }
    return a;
  };

  for (const row of sellableRows) {
    if (str(col(row, 'Record Type')) !== 'Grant') continue;
    const grantId = str(col(row, 'Grant Number'));
    if (!grantId) continue;
    const a = ensure(grantId);
    a.ticker = str(col(row, 'Symbol')) ?? a.ticker;
    a.grantDate = toISODate(col(row, 'Grant Date')) ?? a.grantDate;
    a.taxRouteHint = str(col(row, 'Tax Qualified For Granted Shares')) ?? a.taxRouteHint;

    const sellable = num(col(row, 'Sellable Qty.', 'Sellable Qty')) ?? 0;
    const purchased = num(col(row, 'Purchased Qty.', 'Purchased Qty')) ?? 0;
    const net = num(col(row, 'Net Shares')) ?? purchased;
    const withheld = num(col(row, 'Shares Withheld', 'Shares Withheld ')) ?? 0;

    a.sellable += sellable;
    a.vestedFromLots += net;
    a.soldFromLots += Math.max(0, net - sellable);

    const fmv = num(col(row, 'Purchase Date FMV', 'Est. Cost Basis (per share):', 'Est. Cost Basis (per share)'));
    if (fmv != null) a.fmv = fmv; // keep latest lot FMV as display price
    const basis = num(col(row, 'Est. Cost Basis (per share):', 'Est. Cost Basis (per share)', 'Purchase Date FMV'));
    if (basis != null) a.costBasis = basis;

    const vestDate = toISODate(col(row, 'Vest Date'));
    const releaseDate = toISODate(col(row, 'Release Date')) ?? vestDate;
    if (vestDate && net > 0) {
      a.vestLots.push({
        id: uuidv4(),
        grantId: '', // filled after grant id assigned
        vestDate,
        grossShares: net + withheld,
        withholdingShares: withheld,
        netShares: net,
        fmvAtVest: fmv ?? basis ?? 0,
        source: filename,
      });
    }
    void releaseDate;
  }

  for (const row of unvestedRows) {
    const recordType = str(col(row, 'Record Type'));
    if (recordType === 'Grant') {
      const grantId = str(col(row, 'Grant Number'));
      if (!grantId) continue;
      const a = ensure(grantId);
      a.ticker = str(col(row, 'Symbol')) ?? a.ticker;
      a.grantDate = toISODate(col(row, 'Grant Date')) ?? a.grantDate;
      a.granted = num(col(row, 'Granted Qty.', 'Granted Qty')) ?? a.granted;
      a.unvested = num(col(row, 'Unvested Qty.', 'Unvested Qty')) ?? a.unvested;
      a.nextVestDate = toISODate(col(row, 'Next Vest Date')) ?? a.nextVestDate;
      a.taxRouteHint = str(col(row, 'Tax Qualified For Granted Shares')) ?? a.taxRouteHint;
      const type = str(col(row, 'Type'));
      if (type === 'RSU') a.companyName = a.companyName; // keep
    }
    if (recordType === 'Vest Schedule') {
      const grantId = str(col(row, 'Grant Number'));
      if (!grantId) continue;
      const a = ensure(grantId);
      const unvestedQty = num(col(row, 'Unvested Qty.', 'Unvested Qty')) ?? 0;
      const vestDate = toISODate(col(row, 'Vest Date'));
      if (unvestedQty > 0 && vestDate) {
        // Last future vest date ≈ vesting end
        if (!a.vestingEndDate || vestDate > a.vestingEndDate) a.vestingEndDate = vestDate;
      }
    }
  }

  const grants: GrantRecord[] = [];

  for (const a of byId.values()) {
    const granted = a.granted;
    const unvested = a.unvested ?? 0;
    const vested =
      a.vestedFromLots > 0
        ? a.vestedFromLots
        : granted != null
          ? Math.max(0, granted - unvested)
          : 0;
    const sellable = a.sellable;
    const sold = a.soldFromLots > 0 ? a.soldFromLots : Math.max(0, vested - sellable);
    const total = granted ?? vested + unvested;

    const id = uuidv4();
    const vestLots = a.vestLots.map((lot) => ({ ...lot, grantId: id }));

    let taxRoute: GrantRecord['taxRoute'];
    if (a.taxRouteHint?.toLowerCase().includes('capital')) taxRoute = '102b2';
    else if (a.taxRouteHint?.toLowerCase().includes('income')) taxRoute = '102b1';

    const grantType: GrantType = 'RSU';

    grants.push(
      normalizeGrantVesting({
        id,
        grantId: field(a.grantId, 99, filename, a.grantId),
        grantType: field(grantType, 99, filename, 'Rest. Stock / RSU'),
        companyName: a.ticker === 'MBLY' ? field('Mobileye', 90, filename) : undefined,
        tickerSymbol: a.ticker ? field(a.ticker, 99, filename) : undefined,
        grantDate: a.grantDate ? field(a.grantDate, 99, filename) : undefined,
        vestingStartDate: a.grantDate ? field(a.grantDate, 80, filename) : undefined,
        vestingEndDate: a.vestingEndDate ? field(a.vestingEndDate, 90, filename) : undefined,
        totalShares: field(total, 99, filename),
        fairMarketValue: a.fmv != null ? field(a.fmv, 95, filename) : undefined,
        vestedShares: field(vested, 99, filename),
        unvestedShares: field(unvested, 99, filename),
        sellableShares: field(sellable, 99, filename),
        soldShares: sold > 0 ? field(sold, 95, filename) : field(0, 90, filename),
        remainingShares: field(sellable + unvested, 90, filename),
        costBasis: a.costBasis != null ? field(a.costBasis, 90, filename) : undefined,
        currentMarketValue:
          a.fmv != null ? field(+(a.fmv * (sellable + unvested)).toFixed(2), 85, filename) : undefined,
        taxRoute,
        vestingFrequency: field('Annual', 70, filename, '3-year annual vest schedule'),
        vestLots: vestLots.length ? vestLots : undefined,
        sourceFiles: [filename],
        notes: `Morgan Stanley By Status export · sellable ${sellable} · vested ${vested}` +
          (sold > 0 ? ` · sold/transferred ${sold}` : ''),
      }),
    );
  }

  return grants.sort((a, b) =>
    (a.grantDate?.value ?? '').localeCompare(b.grantDate?.value ?? ''),
  );
}

/** Read a File/Blob as By Status grants, or null if not that workbook. */
export async function tryParseMorganStanleyByStatusFile(
  file: File | Blob,
  filename: string,
): Promise<GrantRecord[] | null> {
  const XLSX = await import('xlsx');
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  if (!isMorganStanleyByStatusWorkbook(workbook.SheetNames)) return null;

  const sheets: Record<string, Row[]> = {};
  for (const name of workbook.SheetNames) {
    sheets[name] = XLSX.utils.sheet_to_json<Row>(workbook.Sheets[name], { defval: null, raw: true });
  }
  const grants = grantsFromMorganStanleyByStatus(sheets, filename);
  return grants.length ? grants : null;
}
