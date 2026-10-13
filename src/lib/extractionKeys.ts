import type { ExtractionProvider } from '../types';
import { getSetting, saveSetting } from './storage';

/** Legacy single key (pre-split). Migrated into provider-specific keys on read. */
export const LEGACY_EXTRACTION_KEY = 'extractionKey';
export const EXTRACTION_KEY_OPENAI = 'extractionKeyOpenai';
export const EXTRACTION_KEY_ANTHROPIC = 'extractionKeyAnthropic';
export const EXTRACTION_KEY_GROK = 'extractionKeyGrok';

export const EXTRACTION_PROVIDERS: ExtractionProvider[] = ['openai', 'anthropic', 'grok'];

export function providerDisplayName(provider: ExtractionProvider): string {
  switch (provider) {
    case 'openai':
      return 'ChatGPT (OpenAI)';
    case 'anthropic':
      return 'Claude (Anthropic)';
    case 'grok':
      return 'Grok (xAI)';
  }
}

function settingKeyForProvider(provider: ExtractionProvider): string {
  switch (provider) {
    case 'openai':
      return EXTRACTION_KEY_OPENAI;
    case 'anthropic':
      return EXTRACTION_KEY_ANTHROPIC;
    case 'grok':
      return EXTRACTION_KEY_GROK;
  }
}

/**
 * If the user still has only `extractionKey`, copy it into the matching provider slot once.
 */
export async function migrateLegacyExtractionKey(): Promise<void> {
  const legacy = (await getSetting<string>(LEGACY_EXTRACTION_KEY))?.trim() ?? '';
  if (!legacy) return;
  const openai = (await getSetting<string>(EXTRACTION_KEY_OPENAI))?.trim() ?? '';
  const anthropic = (await getSetting<string>(EXTRACTION_KEY_ANTHROPIC))?.trim() ?? '';
  const grok = (await getSetting<string>(EXTRACTION_KEY_GROK))?.trim() ?? '';
  if (openai || anthropic || grok) {
    await saveSetting(LEGACY_EXTRACTION_KEY, '');
    return;
  }
  if (legacy.startsWith('sk-ant')) {
    await saveSetting(EXTRACTION_KEY_ANTHROPIC, legacy);
  } else if (legacy.startsWith('xai-')) {
    await saveSetting(EXTRACTION_KEY_GROK, legacy);
  } else {
    await saveSetting(EXTRACTION_KEY_OPENAI, legacy);
  }
  await saveSetting(LEGACY_EXTRACTION_KEY, '');
}

export async function getExtractionKeyForProvider(provider: ExtractionProvider): Promise<string> {
  await migrateLegacyExtractionKey();
  return (await getSetting<string>(settingKeyForProvider(provider)))?.trim() ?? '';
}

/** True if at least one vendor key is stored in IndexedDB (app-local). */
export async function hasAnySavedExtractionKey(): Promise<boolean> {
  await migrateLegacyExtractionKey();
  for (const provider of EXTRACTION_PROVIDERS) {
    const key = (await getSetting<string>(settingKeyForProvider(provider)))?.trim() ?? '';
    if (key) return true;
  }
  return false;
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

/** xAI Grok keys typically look like `xai-…`. */
export function isValidGrokExtractionKey(s: string): boolean {
  return /^xai-[a-zA-Z0-9_-]+$/.test(s.trim());
}

export function isValidKeyForProvider(provider: ExtractionProvider, s: string): boolean {
  switch (provider) {
    case 'openai':
      return isValidOpenAIExtractionKey(s);
    case 'anthropic':
      return isValidAnthropicExtractionKey(s);
    case 'grok':
      return isValidGrokExtractionKey(s);
  }
}
