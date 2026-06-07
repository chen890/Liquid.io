import type { ExtractionProvider } from '../types';
import { getSetting, saveSetting } from './storage';

/** Legacy single key (pre-split). Migrated into provider-specific keys on read. */
export const LEGACY_EXTRACTION_KEY = 'extractionKey';
export const EXTRACTION_KEY_OPENAI = 'extractionKeyOpenai';
export const EXTRACTION_KEY_ANTHROPIC = 'extractionKeyAnthropic';

/**
 * If the user still has only `extractionKey`, copy it into the matching provider slot once.
 */
export async function migrateLegacyExtractionKey(): Promise<void> {
  const legacy = (await getSetting<string>(LEGACY_EXTRACTION_KEY))?.trim() ?? '';
  if (!legacy) return;
  const openai = (await getSetting<string>(EXTRACTION_KEY_OPENAI))?.trim() ?? '';
  const anthropic = (await getSetting<string>(EXTRACTION_KEY_ANTHROPIC))?.trim() ?? '';
  if (openai || anthropic) {
    await saveSetting(LEGACY_EXTRACTION_KEY, '');
    return;
  }
  if (legacy.startsWith('sk-ant')) {
    await saveSetting(EXTRACTION_KEY_ANTHROPIC, legacy);
  } else {
    await saveSetting(EXTRACTION_KEY_OPENAI, legacy);
  }
  await saveSetting(LEGACY_EXTRACTION_KEY, '');
}

export async function getExtractionKeyForProvider(provider: ExtractionProvider): Promise<string> {
  await migrateLegacyExtractionKey();
  if (provider === 'openai') {
    return (await getSetting<string>(EXTRACTION_KEY_OPENAI))?.trim() ?? '';
  }
  return (await getSetting<string>(EXTRACTION_KEY_ANTHROPIC))?.trim() ?? '';
}

/** OpenAI keys are `sk-…` but Anthropic uses `sk-ant-…` (also matches a naive `sk-` prefix). */
export function isValidOpenAIExtractionKey(s: string): boolean {
  const t = s.trim();
  if (!/^sk-[a-zA-Z0-9_-]+$/.test(t)) return false;
  return !t.startsWith('sk-ant');
}

export function isValidAnthropicExtractionKey(s: string): boolean {
  return /^sk-ant-[a-zA-Z0-9_-]+$/.test(s.trim());
}
