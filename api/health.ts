import type { VercelRequest, VercelResponse } from '@vercel/node';

const OPENAI_MODEL = process.env.OPENAI_EXTRACTION_MODEL?.trim() || 'gpt-4o';
const ANTHROPIC_MODEL =
  process.env.ANTHROPIC_EXTRACTION_MODEL?.trim() || 'claude-sonnet-4-20250514';
const GROK_MODEL = process.env.GROK_EXTRACTION_MODEL?.trim() || 'grok-3-latest';

/**
 * Lightweight liveness + which server-side env keys exist.
 * Client keys in IndexedDB are the primary auth; env keys are optional fallbacks.
 */
export default function handler(_req: VercelRequest, res: VercelResponse) {
  const openai = Boolean((process.env.OPENAI_API_KEY ?? '').trim());
  const anthropic = Boolean((process.env.ANTHROPIC_API_KEY ?? '').trim());
  const grok = Boolean(
    (process.env.GROK_API_KEY ?? '').trim() || (process.env.XAI_API_KEY ?? '').trim(),
  );

  res.status(200).json({
    ok: true,
    backend: 'vercel-proxy',
    openaiEnvConfigured: openai,
    anthropicEnvConfigured: anthropic,
    grokEnvConfigured: grok,
    openaiModel: OPENAI_MODEL,
    anthropicModel: ANTHROPIC_MODEL,
    grokModel: GROK_MODEL,
  });
}
