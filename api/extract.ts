import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = {
  maxDuration: 60,
};

type Provider = 'openai' | 'anthropic' | 'grok';

const OPENAI_MODEL = process.env.OPENAI_EXTRACTION_MODEL?.trim() || 'gpt-4o';
const ANTHROPIC_MODEL =
  process.env.ANTHROPIC_EXTRACTION_MODEL?.trim() || 'claude-sonnet-4-20250514';
const GROK_MODEL = process.env.GROK_EXTRACTION_MODEL?.trim() || 'grok-3-latest';

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

type ExtractBody = {
  filename?: string;
  text?: string;
  apiKey?: string;
  provider?: string;
};

type ChatMessage = { role: string; content: string };

function isProvider(v: unknown): v is Provider {
  return v === 'openai' || v === 'anthropic' || v === 'grok';
}

function stripFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function envKeyForProvider(provider: Provider): string {
  if (provider === 'openai') return (process.env.OPENAI_API_KEY ?? '').trim();
  if (provider === 'anthropic') return (process.env.ANTHROPIC_API_KEY ?? '').trim();
  return (process.env.GROK_API_KEY || process.env.XAI_API_KEY || '').trim();
}

function modelForProvider(provider: Provider): string {
  if (provider === 'openai') return OPENAI_MODEL;
  if (provider === 'anthropic') return ANTHROPIC_MODEL;
  return GROK_MODEL;
}

async function callOpenAI(messages: ChatMessage[], apiKey: string, model: string): Promise<string> {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      response_format: { type: 'json_object' },
      temperature: 0,
    }),
  });
  const body = await r.text();
  if (!r.ok) throw Object.assign(new Error(body.slice(0, 400)), { status: r.status });
  const data = JSON.parse(body) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? '';
}

async function callAnthropic(
  messages: ChatMessage[],
  apiKey: string,
  model: string,
): Promise<string> {
  const system = messages.find((m) => m.role === 'system')?.content ?? '';
  const userText = messages
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join('\n\n');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 16384,
      system,
      messages: [{ role: 'user', content: userText }],
    }),
  });
  const body = await r.text();
  if (!r.ok) throw Object.assign(new Error(body.slice(0, 400)), { status: r.status });
  const data = JSON.parse(body) as { content?: Array<{ type?: string; text?: string }> };
  return (data.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('');
}

async function callGrok(messages: ChatMessage[], apiKey: string, model: string): Promise<string> {
  const r = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0,
    }),
  });
  const body = await r.text();
  if (!r.ok) throw Object.assign(new Error(body.slice(0, 400)), { status: r.status });
  const data = JSON.parse(body) as {
    choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((b) => (typeof b === 'object' ? b.text ?? '' : '')).join('');
  }
  return '';
}

async function callProvider(
  provider: Provider,
  messages: ChatMessage[],
  apiKey: string,
  model: string,
): Promise<string> {
  if (provider === 'openai') return callOpenAI(messages, apiKey, model);
  if (provider === 'anthropic') return callAnthropic(messages, apiKey, model);
  return callGrok(messages, apiKey, model);
}

/**
 * Server-side proxy for grant extraction.
 * Honors the user's selected provider (openai | anthropic | grok) and API key from the app.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ detail: 'Method not allowed' });
  }

  let body: ExtractBody;
  try {
    body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {}) as ExtractBody;
  } catch {
    return res.status(400).json({ detail: 'Invalid JSON body' });
  }

  const filename = (body.filename ?? '').trim();
  const text = body.text ?? '';
  const provider: Provider = isProvider(body.provider) ? body.provider : 'openai';
  const apiKey = (body.apiKey ?? '').trim() || envKeyForProvider(provider);
  const model = modelForProvider(provider);

  if (!filename || !text) {
    return res.status(400).json({ detail: 'filename and text are required' });
  }
  if (!apiKey) {
    return res.status(503).json({
      detail: `No ${provider} API key. Save one in the app, or set the matching server env var.`,
    });
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `File: ${filename}\n\n${text}` },
  ];

  try {
    const raw = await callProvider(provider, messages, apiKey, model);
    let parsed: { grants?: unknown[] };
    try {
      parsed = JSON.parse(stripFences(raw)) as { grants?: unknown[] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ detail: `Failed to parse LLM response as JSON: ${msg}` });
    }
    return res.status(200).json({
      grants: parsed.grants ?? [],
      backend: provider,
      model,
    });
  } catch (err) {
    const status =
      typeof err === 'object' && err && 'status' in err
        ? Number((err as { status: number }).status)
        : 502;
    const detail = err instanceof Error ? err.message : String(err);
    const lower = detail.toLowerCase();
    if (
      lower.includes('credit balance') ||
      lower.includes('purchase credits') ||
      lower.includes('plans & billing') ||
      lower.includes('billing')
    ) {
      return res.status(402).json({
        detail:
          `${provider} account has no API credits. A new key still needs billing/credits on the vendor console ` +
          `(Anthropic: https://console.anthropic.com/settings/plans). Or switch to ChatGPT/Grok in Secure vault.`,
      });
    }
    if (status === 429) {
      return res.status(429).json({ detail: `${provider} rate limit / quota exceeded. ${detail}` });
    }
    if (status === 401 || status === 403) {
      return res.status(status).json({ detail: `${provider} authentication failed. ${detail}` });
    }
    return res.status(status >= 400 && status < 600 ? status : 502).json({
      detail: `LLM API error ${status}: ${detail}`,
    });
  }
}
