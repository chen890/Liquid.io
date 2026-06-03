import type { GrantRecord, ExtractedField, GrantType, VestingFrequency } from '../../types';
import { v4 as uuidv4 } from 'uuid';
import { getSetting } from '../storage';

// ──────────────────────────────────────────────────────────────────────────────
// Raw types returned by the AI (both OpenAI and Sofia use the same schema)
// ──────────────────────────────────────────────────────────────────────────────
interface RawField<T> { value: T | null; confidence: number }
interface RawSnippet { field: string; snippet: string }
interface RawGrantData {
  grantId?: RawField<string>;
  grantType?: RawField<string>;
  companyName?: RawField<string>;
  tickerSymbol?: RawField<string>;
  grantDate?: RawField<string>;
  vestingStartDate?: RawField<string>;
  vestingEndDate?: RawField<string>;
  totalShares?: RawField<number>;
  strikePrice?: RawField<number>;
  exercisePrice?: RawField<number>;
  fairMarketValue?: RawField<number>;
  cliffDuration?: RawField<number>;
  vestingFrequency?: RawField<string>;
  vestedShares?: RawField<number>;
  unvestedShares?: RawField<number>;
  exercisedShares?: RawField<number>;
  cancelledShares?: RawField<number>;
  soldShares?: RawField<number>;
  remainingShares?: RawField<number>;
  currentMarketValue?: RawField<number>;
  costBasis?: RawField<number>;
  estimatedTaxBasis?: RawField<number>;
  sourceSnippets?: RawSnippet[];
}

// ──────────────────────────────────────────────────────────────────────────────
// System prompt (identical for both backends)
// ──────────────────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an expert equity compensation analyst. Extract ALL stock grants, RSUs, stock options, and equity awards from the document provided.

The document may be a brokerage statement (Morgan Stanley, Fidelity, E*TRADE, Schwab, Carta, etc.) with tables like:

  Grant Date | Number   | Type | Symbol | Quantity  | Grant Price | Market Price | Total Est Mkt Value
  01/31/24   | 00005895 | RSU  | MBLY   | 454.000   | $0.00       | $6.87        | $3,118.98

Column mappings:
  Number / Grant #      → grantId
  Type                  → grantType
  Symbol / CUSIP        → tickerSymbol
  Grant Date            → grantDate  (→ YYYY-MM-DD)
  Quantity / Shares     → totalShares
  Grant Price           → strikePrice
  Market Price          → fairMarketValue
  Total Est Mkt Value   → currentMarketValue
  Vested rows           → vestedShares
  Unvested rows         → unvestedShares

Also look for: "Stock Plan Details", "Equity Awards", "Restricted Stock Units",
"Potential Restricted Stock", "Vesting Schedule".

Respond with ONLY valid JSON, no markdown fences:
{
  "grants": [{
    "grantId":            { "value": "<string|null>", "confidence": <0-100> },
    "grantType":          { "value": "<RSU|ISO|NSO|ESPP|RestrictedShares|PerformanceShares|null>", "confidence": <0-100> },
    "companyName":        { "value": "<string|null>", "confidence": <0-100> },
    "tickerSymbol":       { "value": "<string|null>", "confidence": <0-100> },
    "grantDate":          { "value": "<YYYY-MM-DD|null>", "confidence": <0-100> },
    "vestingStartDate":   { "value": "<YYYY-MM-DD|null>", "confidence": <0-100> },
    "vestingEndDate":     { "value": "<YYYY-MM-DD|null>", "confidence": <0-100> },
    "totalShares":        { "value": <number|null>, "confidence": <0-100> },
    "strikePrice":        { "value": <number|null>, "confidence": <0-100> },
    "exercisePrice":      { "value": <number|null>, "confidence": <0-100> },
    "fairMarketValue":    { "value": <number|null>, "confidence": <0-100> },
    "cliffDuration":      { "value": <months|null>, "confidence": <0-100> },
    "vestingFrequency":   { "value": "<Monthly|Quarterly|Annual|Custom|null>", "confidence": <0-100> },
    "vestedShares":       { "value": <number|null>, "confidence": <0-100> },
    "unvestedShares":     { "value": <number|null>, "confidence": <0-100> },
    "exercisedShares":    { "value": <number|null>, "confidence": <0-100> },
    "cancelledShares":    { "value": <number|null>, "confidence": <0-100> },
    "soldShares":         { "value": <number|null>, "confidence": <0-100> },
    "remainingShares":    { "value": <number|null>, "confidence": <0-100> },
    "currentMarketValue": { "value": <number|null>, "confidence": <0-100> },
    "costBasis":          { "value": <number|null>, "confidence": <0-100> },
    "estimatedTaxBasis":  { "value": <number|null>, "confidence": <0-100> },
    "sourceSnippets":     [ { "field": "<fieldName>", "snippet": "<exact quote>" } ]
  }]
}

Rules: Extract EVERY grant row. Dates → YYYY-MM-DD. Numbers → strip $, commas.
Confidence 95-100: explicitly stated. 70-94: inferred. 0-69: uncertain. No grants → {"grants":[]}`;

// ──────────────────────────────────────────────────────────────────────────────
// Map raw AI response → typed GrantRecord
// ──────────────────────────────────────────────────────────────────────────────
function makeField<T>(
  raw: RawField<T> | undefined,
  filename: string,
  snippets: RawSnippet[],
  fieldName: string,
): ExtractedField<T> | undefined {
  if (!raw || raw.value === null) return undefined;
  const matching = snippets.filter((s) => s.field === fieldName);
  return {
    value: raw.value,
    confidence: raw.confidence,
    sources: matching.length > 0
      ? matching.map((s) => ({ file: filename, snippet: s.snippet }))
      : [{ file: filename, snippet: '' }],
  };
}

function rawToGrantRecord(raw: RawGrantData, filename: string): GrantRecord {
  const snip = raw.sourceSnippets ?? [];
  const f = <T>(field: RawField<T> | undefined, name: string) =>
    makeField(field, filename, snip, name);

  return {
    id: uuidv4(),
    grantId: f(raw.grantId, 'grantId'),
    grantType: raw.grantType?.value != null
      ? { value: raw.grantType.value as GrantType, confidence: raw.grantType.confidence, sources: [{ file: filename, snippet: '' }] }
      : undefined,
    companyName: f(raw.companyName, 'companyName'),
    tickerSymbol: f(raw.tickerSymbol, 'tickerSymbol'),
    grantDate: f(raw.grantDate, 'grantDate'),
    vestingStartDate: f(raw.vestingStartDate, 'vestingStartDate'),
    vestingEndDate: f(raw.vestingEndDate, 'vestingEndDate'),
    totalShares: f(raw.totalShares, 'totalShares'),
    strikePrice: f(raw.strikePrice, 'strikePrice'),
    exercisePrice: f(raw.exercisePrice, 'exercisePrice'),
    fairMarketValue: f(raw.fairMarketValue, 'fairMarketValue'),
    cliffDuration: f(raw.cliffDuration, 'cliffDuration'),
    vestingFrequency: raw.vestingFrequency?.value != null
      ? { value: raw.vestingFrequency.value as VestingFrequency, confidence: raw.vestingFrequency.confidence, sources: [{ file: filename, snippet: '' }] }
      : undefined,
    vestedShares: f(raw.vestedShares, 'vestedShares'),
    unvestedShares: f(raw.unvestedShares, 'unvestedShares'),
    exercisedShares: f(raw.exercisedShares, 'exercisedShares'),
    cancelledShares: f(raw.cancelledShares, 'cancelledShares'),
    soldShares: f(raw.soldShares, 'soldShares'),
    remainingShares: f(raw.remainingShares, 'remainingShares'),
    currentMarketValue: f(raw.currentMarketValue, 'currentMarketValue'),
    costBasis: f(raw.costBasis, 'costBasis'),
    estimatedTaxBasis: f(raw.estimatedTaxBasis, 'estimatedTaxBasis'),
    sourceFiles: [filename],
  };
}

function chunkText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  const lines = text.split('\n');
  let current = '';
  for (const line of lines) {
    if (current.length + line.length > maxChars && current.length > 0) {
      chunks.push(current);
      current = line;
    } else {
      current += (current ? '\n' : '') + line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function stripFences(s: string): string {
  return s.replace(/^```(?:json)?\s*/im, '').replace(/\s*```\s*$/m, '').trim();
}

// ──────────────────────────────────────────────────────────────────────────────
// Server health check
// ──────────────────────────────────────────────────────────────────────────────
export interface ServerHealth {
  online: boolean;
  backend: 'sofia' | 'openai' | 'none';
  meezehConfigured: boolean;
}

export async function checkServerHealth(): Promise<ServerHealth> {
  try {
    const r = await fetch('/api/health', { signal: AbortSignal.timeout(2000) });
    if (!r.ok) return { online: false, backend: 'none', meezehConfigured: false };
    const d = await r.json() as { backend?: string; meezehConfigured?: boolean };
    return {
      online: true,
      backend: (d.backend as 'sofia' | 'openai') ?? 'openai',
      meezehConfigured: d.meezehConfigured ?? false,
    };
  } catch {
    return { online: false, backend: 'none', meezehConfigured: false };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Main export
//
// Strategy:
//   1. Try the local server (POST /api/extract) — it handles Sofia via Meezeh
//      and falls back to OpenAI using the browser key.
//   2. If the server is not running, fall back to calling OpenAI directly from
//      the browser using the stored extractionKey.
// ──────────────────────────────────────────────────────────────────────────────
export async function extractGrantsFromText(
  text: string,
  filename: string,
  apiKey: string,
  onProgress?: (msg: string) => void,
): Promise<GrantRecord[]> {
  const chunks = chunkText(text, 12_000);
  const allGrants: GrantRecord[] = [];

  // Check if local server is running
  const health = await checkServerHealth();

  if (health.online) {
    // ── Path A: server handles everything (Sofia or OpenAI) ──────────────────
    for (let i = 0; i < chunks.length; i++) {
      const label = chunks.length > 1 ? `${filename} (part ${i + 1}/${chunks.length})` : filename;
      onProgress?.(`Analyzing ${label} via ${health.backend === 'sofia' ? 'Sofia' : 'OpenAI'}...`);

      const res = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: label, text: chunks[i], apiKey }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? `Server error ${res.status}`);
      }

      const data = await res.json() as { grants: RawGrantData[] };
      const grants = (data.grants ?? []).map((g) => rawToGrantRecord(g, filename));
      onProgress?.(`  Found ${grants.length} grant(s)`);
      allGrants.push(...grants);
    }
    return allGrants;
  }

  // ── Path B: server not running — call OpenAI directly from browser ─────────
  const key = apiKey || (await getSetting<string>('extractionKey')) || '';
  if (!key) {
    throw new Error(
      'No API key available. Enter your OpenAI key in Settings, or start the extraction server with: npm start',
    );
  }

  for (let i = 0; i < chunks.length; i++) {
    const label = chunks.length > 1 ? `${filename} (part ${i + 1}/${chunks.length})` : filename;
    onProgress?.(`Analyzing ${label} via OpenAI (direct)...`);

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `File: ${label}\n\n${chunks[i]}` },
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
      throw new Error(err.error?.message ?? `OpenAI error ${res.status}`);
    }

    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content ?? '';
    const parsed = JSON.parse(stripFences(content)) as { grants?: RawGrantData[] };
    const grants = (parsed.grants ?? []).map((g) => rawToGrantRecord(g, filename));
    onProgress?.(`  Found ${grants.length} grant(s)`);
    allGrants.push(...grants);
  }

  return allGrants;
}
