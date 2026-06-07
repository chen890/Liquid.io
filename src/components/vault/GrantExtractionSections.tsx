import { useEffect, useState } from 'react';
import { Key, Sparkles, Eye, EyeOff, Check, Server } from 'lucide-react';
import type { ExtractionProvider } from '../../types';
import { saveSetting, getSetting } from '../../lib/storage';
import {
  migrateLegacyExtractionKey,
  EXTRACTION_KEY_OPENAI,
  EXTRACTION_KEY_ANTHROPIC,
  isValidOpenAIExtractionKey,
  isValidAnthropicExtractionKey,
} from '../../lib/extractionKeys';
import { checkServerHealth } from '../../lib/ai/extractor';
import type { ServerHealth } from '../../lib/ai/extractor';
import { Button } from '../ui/Button';
import { Card, CardHeader, CardTitle } from '../ui/Card';

/**
 * Secure vault: pick which agent runs extractions, then configure each vendor's API key separately.
 */
export function GrantExtractionSections() {
  const [activeAgent, setActiveAgent] = useState<ExtractionProvider>('openai');
  const [openaiKey, setOpenaiKey] = useState('');
  const [anthropicKey, setAnthropicKey] = useState('');
  const [showOpenai, setShowOpenai] = useState(false);
  const [showAnthropic, setShowAnthropic] = useState(false);
  const [agentSaved, setAgentSaved] = useState(false);
  const [openaiSaved, setOpenaiSaved] = useState(false);
  const [anthropicSaved, setAnthropicSaved] = useState(false);
  const [serverHealth, setServerHealth] = useState<ServerHealth | null>(null);

  useEffect(() => {
    void (async () => {
      await migrateLegacyExtractionKey();
      const [p, o, a] = await Promise.all([
        getSetting<ExtractionProvider>('extractionProvider'),
        getSetting<string>(EXTRACTION_KEY_OPENAI),
        getSetting<string>(EXTRACTION_KEY_ANTHROPIC),
      ]);
      setActiveAgent(p ?? 'openai');
      setOpenaiKey(o ?? '');
      setAnthropicKey(a ?? '');
      checkServerHealth().then(setServerHealth);
    })();
  }, []);

  async function handleAgentChange(next: ExtractionProvider) {
    setActiveAgent(next);
    setAgentSaved(false);
    await saveSetting('extractionProvider', next);
    setAgentSaved(true);
    setTimeout(() => setAgentSaved(false), 2000);
  }

  async function handleSaveOpenai() {
    await saveSetting(EXTRACTION_KEY_OPENAI, openaiKey.trim());
    setOpenaiSaved(true);
    setTimeout(() => setOpenaiSaved(false), 2000);
  }

  async function handleSaveAnthropic() {
    await saveSetting(EXTRACTION_KEY_ANTHROPIC, anthropicKey.trim());
    setAnthropicSaved(true);
    setTimeout(() => setAnthropicSaved(false), 2000);
  }

  const openaiTrim = openaiKey.trim();
  const anthropicTrim = anthropicKey.trim();

  return (
    <>
      <Card padding="md">
        <CardHeader>
          <CardTitle>Active extraction agent</CardTitle>
          <Sparkles className="w-4 h-4 text-slate-600" />
        </CardHeader>
        <div className="space-y-4">
          <p className="text-xs text-slate-500">
            Uploads and E*TRADE sync use <strong className="text-slate-400">one</strong> backend at a time. Keys for both vendors are stored separately below—switching agent does not overwrite the other key.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => void handleAgentChange('openai')}
              className={`rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                activeAgent === 'openai'
                  ? 'border-indigo-500 bg-indigo-950/40 text-white'
                  : 'border-slate-700 bg-slate-900/50 text-slate-400 hover:border-slate-600'
              }`}>
              <div className="font-medium">Use ChatGPT (OpenAI)</div>
              <div className="text-[11px] text-slate-500 mt-0.5">Model · {serverHealth?.openaiModel ?? 'gpt-4o'}</div>
            </button>
            <button
              type="button"
              onClick={() => void handleAgentChange('anthropic')}
              className={`rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                activeAgent === 'anthropic'
                  ? 'border-indigo-500 bg-indigo-950/40 text-white'
                  : 'border-slate-700 bg-slate-900/50 text-slate-400 hover:border-slate-600'
              }`}>
              <div className="font-medium">Use Claude (Anthropic)</div>
              <div className="text-[11px] text-slate-500 mt-0.5">Model · {serverHealth?.anthropicModel ?? 'claude-sonnet-4'}</div>
            </button>
          </div>

          {serverHealth?.online && (
            <p className="text-xs text-emerald-500/90 flex items-center gap-1.5 flex-wrap">
              <Server className="w-3.5 h-3.5 shrink-0" />
              <span>Extraction server online</span>
              {serverHealth.openaiEnvConfigured && (
                <span className="text-slate-500">· OPENAI_API_KEY in .env</span>
              )}
              {serverHealth.anthropicEnvConfigured && (
                <span className="text-slate-500">· ANTHROPIC_API_KEY in .env</span>
              )}
            </p>
          )}

          {agentSaved && (
            <p className="text-xs text-emerald-400 flex items-center gap-1">
              <Check className="w-3.5 h-3.5" /> Active agent saved
            </p>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card padding="md">
          <CardHeader>
            <CardTitle>OpenAI (ChatGPT)</CardTitle>
            <Key className="w-4 h-4 text-slate-600" />
          </CardHeader>
          <div className="space-y-4">
            <p className="text-xs text-slate-500">
              Used when <strong className="text-slate-400">ChatGPT</strong> is the active agent, or for direct browser calls to OpenAI. Stored in IndexedDB.
            </p>
            <div>
              <label className="text-xs text-slate-500 block mb-1.5">OpenAI API key</label>
              <div className="flex gap-2">
                <input
                  type={showOpenai ? 'text' : 'password'}
                  value={openaiKey}
                  onChange={(e) => {
                    setOpenaiKey(e.target.value);
                    setOpenaiSaved(false);
                  }}
                  placeholder="sk-…"
                  autoComplete="off"
                  className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowOpenai((v) => !v)}
                  className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-400 hover:text-white transition-colors"
                >
                  {showOpenai ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            {openaiTrim && !isValidOpenAIExtractionKey(openaiKey) && (
              <p className="text-xs text-amber-400">
                OpenAI keys look like <code className="font-mono">sk-…</code> (not <code className="font-mono">sk-ant-…</code>).
              </p>
            )}
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleSaveOpenai()}
              disabled={!openaiTrim || !isValidOpenAIExtractionKey(openaiKey)}>
              {openaiSaved ? (
                <>
                  <Check className="w-3.5 h-3.5" /> OpenAI key saved
                </>
              ) : (
                'Save OpenAI key'
              )}
            </Button>
            <div className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-xs text-slate-500">
              <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline">
                platform.openai.com/api-keys
              </a>
            </div>
          </div>
        </Card>

        <Card padding="md">
          <CardHeader>
            <CardTitle>Anthropic (Claude)</CardTitle>
            <Key className="w-4 h-4 text-slate-600" />
          </CardHeader>
          <div className="space-y-4">
            <p className="text-xs text-slate-500">
              Used when <strong className="text-slate-400">Claude</strong> is the active agent. Stored in IndexedDB. Browser extraction still needs the local API server (CORS).
            </p>
            <div>
              <label className="text-xs text-slate-500 block mb-1.5">Anthropic API key</label>
              <div className="flex gap-2">
                <input
                  type={showAnthropic ? 'text' : 'password'}
                  value={anthropicKey}
                  onChange={(e) => {
                    setAnthropicKey(e.target.value);
                    setAnthropicSaved(false);
                  }}
                  placeholder="sk-ant-…"
                  autoComplete="off"
                  className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowAnthropic((v) => !v)}
                  className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-400 hover:text-white transition-colors"
                >
                  {showAnthropic ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            {anthropicTrim && !isValidAnthropicExtractionKey(anthropicKey) && (
              <p className="text-xs text-amber-400">
                Anthropic keys look like <code className="font-mono">sk-ant-…</code> (not plain <code className="font-mono">sk-…</code>).
              </p>
            )}
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleSaveAnthropic()}
              disabled={!anthropicTrim || !isValidAnthropicExtractionKey(anthropicKey)}>
              {anthropicSaved ? (
                <>
                  <Check className="w-3.5 h-3.5" /> Anthropic key saved
                </>
              ) : (
                'Save Anthropic key'
              )}
            </Button>
            <div className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-xs text-slate-500">
              <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline">
                console.anthropic.com/settings/keys
              </a>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
