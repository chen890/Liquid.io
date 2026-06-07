import { useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Trash2, AlertTriangle, Key, Eye, EyeOff, Check, Server, Link, RefreshCw, ExternalLink, Calendar, Shield, Plus } from 'lucide-react';
import type { GrantRecord, TaxRoute, TradingWindow, ExtractionProvider } from '../../types';
import { usePortfolioStore } from '../../store/portfolioStore';
import { trusteReleaseDate } from '../../lib/tradingWindows';
import { Button } from '../ui/Button';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { saveSetting, getSetting } from '../../lib/storage';
import { checkServerHealth } from '../../lib/ai/extractor';
import type { ServerHealth } from '../../lib/ai/extractor';

type OAuthStep = 'idle' | 'started' | 'verifying' | 'connected' | 'error';

function ETRADECard() {
  const [consumerKey, setConsumerKey]       = useState('');
  const [consumerSecret, setConsumerSecret] = useState('');
  const [sandbox, setSandbox]               = useState(false);
  const [step, setStep]                     = useState<OAuthStep>('idle');
  const [authUrl, setAuthUrl]               = useState('');
  const [oauthToken, setOauthToken]         = useState('');
  const [oauthTokenSecret, setOauthTokenSecret] = useState('');
  const [verifier, setVerifier]             = useState('');
  const [error, setError]                   = useState('');
  const [syncing, setSyncing]               = useState(false);
  const [syncResult, setSyncResult]         = useState<{ positions: number; grants: number } | null>(null);

  const { setPendingGrants, setPendingSession, setView } = usePortfolioStore();

  async function handleStart() {
    setError('');
    try {
      const r = await fetch('/api/etrade/auth/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consumerKey, consumerSecret, sandbox }),
      });
      const d = await r.json() as { ok: boolean; authUrl?: string; oauthToken?: string; oauthTokenSecret?: string; detail?: string };
      if (!d.ok) throw new Error(d.detail ?? 'Start failed');
      setAuthUrl(d.authUrl!);
      setOauthToken(d.oauthToken!);
      setOauthTokenSecret(d.oauthTokenSecret!);
      setStep('started');
      window.open(d.authUrl, '_blank', 'noopener');
    } catch (e) {
      setError((e as Error).message);
      setStep('error');
    }
  }

  async function handleVerify() {
    setStep('verifying');
    setError('');
    try {
      const r = await fetch('/api/etrade/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consumerKey, consumerSecret, oauthToken, oauthTokenSecret, verifier, sandbox }),
      });
      const d = await r.json() as { ok: boolean; detail?: string };
      if (!d.ok) throw new Error(d.detail ?? 'Verify failed');
      setStep('connected');
    } catch (e) {
      setError((e as Error).message);
      setStep('error');
    }
  }

  async function handleSync() {
    setSyncing(true);
    setError('');
    try {
      const r = await fetch('/api/etrade/portfolio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consumerKey }),
      });
      const d = await r.json() as { ok: boolean; positions?: unknown[]; grants?: unknown[]; detail?: string };
      if (!d.ok) throw new Error(d.detail ?? 'Sync failed');
      setSyncResult({ positions: d.positions?.length ?? 0, grants: d.grants?.length ?? 0 });
      if (d.grants && d.grants.length > 0) {
        // Convert to GrantRecord format using the extractor's rawToGrantRecord
        const [provider, extractionKey] = await Promise.all([
          getSetting<ExtractionProvider>('extractionProvider'),
          getSetting<string>('extractionKey'),
        ]);
        const res = await fetch('/api/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: 'E*TRADE Portfolio Sync',
            text: JSON.stringify(d.grants),
            apiKey: extractionKey ?? '',
            provider: provider ?? 'openai',
          }),
        });
        const extracted = await res.json() as { grants?: GrantRecord[] };
        if (extracted.grants?.length) {
          setPendingGrants(extracted.grants);
          setPendingSession({ id: uuidv4(), createdAt: new Date().toISOString(), documentIds: [], grantIds: [], status: 'review' });
          setView('review');
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <Card padding="md">
      <CardHeader>
        <CardTitle>E*TRADE / Morgan Stanley at Work</CardTitle>
        <div className="flex items-center gap-2">
          {step === 'connected' && <span className="text-xs text-emerald-400">Connected</span>}
          <Link className="w-4 h-4 text-slate-600" />
        </div>
      </CardHeader>

      <div className="space-y-3 text-sm">
        {step === 'idle' || step === 'error' ? (
          <>
            <p className="text-xs text-slate-500">
              Connect your E*TRADE account to automatically sync your equity positions.
              Requires an API key from{' '}
              <a href="https://developer.etrade.com" target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline inline-flex items-center gap-0.5">
                developer.etrade.com <ExternalLink className="w-2.5 h-2.5" />
              </a>
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Consumer Key</label>
                <input value={consumerKey} onChange={(e) => setConsumerKey(e.target.value)}
                  placeholder="from developer.etrade.com"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono" />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Consumer Secret</label>
                <input type="password" value={consumerSecret} onChange={(e) => setConsumerSecret(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono" />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button variant="primary" size="sm" onClick={handleStart} disabled={!consumerKey || !consumerSecret}>
                Connect E*TRADE
              </Button>
              <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer">
                <input type="checkbox" checked={sandbox} onChange={(e) => setSandbox(e.target.checked)} className="w-3 h-3" />
                Use sandbox
              </label>
            </div>
            {error && <p className="text-xs text-red-400">{error}</p>}
            <div className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-500 space-y-1">
              <p className="font-medium text-slate-400">Or: export from E*TRADE and upload</p>
              <p>Go to <strong>Accounts → Stock Plan → Documents</strong> and export your equity grants as CSV or PDF, then upload through the Upload page. The AI will parse E*TRADE-specific formats automatically.</p>
            </div>
          </>
        ) : step === 'started' ? (
          <>
            <div className="bg-indigo-950/40 border border-indigo-800/50 rounded-xl px-3 py-2.5 text-xs text-indigo-300">
              <p className="font-medium mb-1">Authorization page opened in a new tab.</p>
              <p>Sign in to E*TRADE, authorize the app, and copy the <strong>PIN code</strong> shown. Paste it below.</p>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">PIN / Verifier Code</label>
              <div className="flex gap-2">
                <input value={verifier} onChange={(e) => setVerifier(e.target.value)}
                  placeholder="Paste PIN from E*TRADE"
                  className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono" />
                <Button variant="primary" size="sm" onClick={handleVerify} disabled={!verifier}>
                  Verify
                </Button>
              </div>
            </div>
            <button onClick={() => window.open(authUrl, '_blank', 'noopener')}
              className="text-xs text-indigo-400 hover:underline flex items-center gap-1">
              <ExternalLink className="w-3 h-3" /> Re-open authorization page
            </button>
          </>
        ) : step === 'verifying' ? (
          <p className="text-xs text-slate-400 flex items-center gap-2">
            <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25"/>
              <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" className="opacity-75"/>
            </svg>
            Verifying with E*TRADE…
          </p>
        ) : step === 'connected' ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs text-emerald-400">
              <Check className="w-3.5 h-3.5" />
              Connected to E*TRADE
            </div>
            {syncResult && (
              <p className="text-xs text-slate-400">
                Last sync: {syncResult.positions} positions · {syncResult.grants} equity grants found
              </p>
            )}
            <div className="flex gap-2">
              <Button variant="primary" size="sm" loading={syncing} onClick={handleSync}>
                <RefreshCw className="w-3.5 h-3.5" />
                Sync Portfolio
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setStep('idle')}>
                Disconnect
              </Button>
            </div>
            {error && <p className="text-xs text-red-400">{error}</p>}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

export function SettingsView() {
  const { clearAllData, portfolio } = usePortfolioStore();
  const [confirmClear, setConfirmClear] = useState(false);
  const [extractionProvider, setExtractionProvider] = useState<ExtractionProvider>('openai');
  const [extractionKey, setExtractionKey] = useState('');
  const [keyVisible, setKeyVisible] = useState(false);
  const [saved, setSaved] = useState(false);
  const [serverHealth, setServerHealth] = useState<ServerHealth | null>(null);

  useEffect(() => {
    getSetting<ExtractionProvider>('extractionProvider').then((p) => setExtractionProvider(p ?? 'openai'));
    getSetting<string>('extractionKey').then((k) => setExtractionKey(k ?? ''));
    checkServerHealth().then(setServerHealth);
  }, []);

  const handleSaveKey = async () => {
    await saveSetting('extractionProvider', extractionProvider);
    await saveSetting('extractionKey', extractionKey.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleProviderChange = (p: ExtractionProvider) => {
    setExtractionProvider(p);
    setSaved(false);
  };

  const keyTrim = extractionKey.trim();
  const keyValidOpenAI = /^sk-[a-zA-Z0-9_-]+$/.test(keyTrim);
  const keyValidAnthropic = /^sk-ant-[a-zA-Z0-9_-]+$/.test(keyTrim);
  const keyValid = extractionProvider === 'openai' ? keyValidOpenAI : keyValidAnthropic;

  const handleClearAll = async () => {
    if (confirmClear) {
      await clearAllData();
      setConfirmClear(false);
    } else {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 5000);
    }
  };

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6 max-w-2xl">
      <div>
        <h1 className="text-xl font-semibold text-white">Settings</h1>
        <p className="text-sm text-slate-500 mt-0.5">Manage your EquityLens preferences and data.</p>
      </div>

      {/* AI extraction provider + API key */}
      <Card padding="md">
        <CardHeader>
          <CardTitle>AI grant extraction</CardTitle>
          <Key className="w-4 h-4 text-slate-600" />
        </CardHeader>
        <div className="space-y-4">
          <p className="text-xs text-slate-500">
            Choose ChatGPT (OpenAI) or Claude (Anthropic). The API key below applies to the selected provider and is stored only in this browser.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => handleProviderChange('openai')}
              className={`rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                extractionProvider === 'openai'
                  ? 'border-indigo-500 bg-indigo-950/40 text-white'
                  : 'border-slate-700 bg-slate-900/50 text-slate-400 hover:border-slate-600'
              }`}>
              <div className="font-medium">ChatGPT</div>
              <div className="text-[11px] text-slate-500 mt-0.5">OpenAI · {serverHealth?.openaiModel ?? 'gpt-4o'}</div>
            </button>
            <button
              type="button"
              onClick={() => handleProviderChange('anthropic')}
              className={`rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                extractionProvider === 'anthropic'
                  ? 'border-indigo-500 bg-indigo-950/40 text-white'
                  : 'border-slate-700 bg-slate-900/50 text-slate-400 hover:border-slate-600'
              }`}>
              <div className="font-medium">Claude</div>
              <div className="text-[11px] text-slate-500 mt-0.5">Anthropic · {serverHealth?.anthropicModel ?? 'claude-sonnet-4'}</div>
            </button>
          </div>

          <div>
            <label className="text-xs text-slate-500 block mb-1.5">
              {extractionProvider === 'openai' ? 'OpenAI API key' : 'Anthropic API key'}
            </label>
            <div className="flex gap-2">
              <input
                type={keyVisible ? 'text' : 'password'}
                value={extractionKey}
                onChange={(e) => { setExtractionKey(e.target.value); setSaved(false); }}
                placeholder={extractionProvider === 'openai' ? 'sk-…' : 'sk-ant-…'}
                className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono"
              />
              <button
                type="button"
                onClick={() => setKeyVisible((v) => !v)}
                className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-400 hover:text-white transition-colors"
              >
                {keyVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {keyTrim && !keyValid && (
            <p className="text-xs text-amber-400">
              {extractionProvider === 'openai' ? (
                <>OpenAI keys look like <code className="font-mono">sk-…</code>. Create one at platform.openai.com/api-keys.</>
              ) : (
                <>Anthropic keys look like <code className="font-mono">sk-ant-…</code>. Create one at console.anthropic.com/settings/keys.</>
              )}
            </p>
          )}

          <div className="flex items-center gap-3 flex-wrap">
            <Button variant="primary" size="sm" onClick={handleSaveKey} disabled={!keyTrim || !keyValid}>
              {saved ? <><Check className="w-3.5 h-3.5" /> Saved</> : 'Save provider & key'}
            </Button>
            {serverHealth?.online && (
              <span className="text-xs text-emerald-500 flex items-center gap-1">
                <Server className="w-3.5 h-3.5" />
                Extraction server online
                {serverHealth.openaiEnvConfigured && extractionProvider === 'openai' && (
                  <span className="text-slate-500">· server has OPENAI_API_KEY fallback</span>
                )}
                {serverHealth.anthropicEnvConfigured && extractionProvider === 'anthropic' && (
                  <span className="text-slate-500">· server has ANTHROPIC_API_KEY fallback</span>
                )}
              </span>
            )}
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-xs text-slate-500">
            {extractionProvider === 'openai' ? (
              <>
                OpenAI:{' '}
                <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline">
                  platform.openai.com/api-keys
                </a>
              </>
            ) : (
              <>
                Anthropic:{' '}
                <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline">
                  console.anthropic.com/settings/keys
                </a>
                {' '}· Claude extraction requires the local server when running from the browser only.
              </>
            )}
          </div>
        </div>
      </Card>

      {/* Data Summary */}
      <Card padding="md">
        <CardHeader>
          <CardTitle>Local Data</CardTitle>
        </CardHeader>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-2xl font-semibold text-white">{portfolio.grants.length}</div>
            <div className="text-xs text-slate-500">Grants</div>
          </div>
          <div>
            <div className="text-2xl font-semibold text-white">{portfolio.documents.length}</div>
            <div className="text-xs text-slate-500">Documents</div>
          </div>
          <div>
            <div className="text-2xl font-semibold text-white">{portfolio.sessions.length}</div>
            <div className="text-xs text-slate-500">Sessions</div>
          </div>
        </div>
      </Card>

      {/* E*TRADE Integration */}
      <ETRADECard />

      {/* Danger Zone */}
      <Card padding="md" className="border-red-900/50">
        <CardHeader>
          <CardTitle className="text-red-500">Danger Zone</CardTitle>
          <AlertTriangle className="w-4 h-4 text-red-600" />
        </CardHeader>
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            Clears all grants, documents, and sessions from the browser. Cannot be undone.
          </p>
          <Button variant="danger" size="sm" onClick={handleClearAll}>
            <Trash2 className="w-3.5 h-3.5" />
            {confirmClear ? 'Click again to confirm — this cannot be undone' : 'Clear All Data'}
          </Button>
        </div>
      </Card>

      {/* Extraction Backend */}
      <Card padding="md">
        <CardHeader>
          <CardTitle>Extraction Backend</CardTitle>
          <Server className="w-4 h-4 text-slate-600" />
        </CardHeader>
        <div className="space-y-2 text-xs">
          {serverHealth === null && (
            <p className="text-slate-500">Checking server status...</p>
          )}
          {serverHealth?.online ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
                <span className="text-slate-300 font-medium">Local extraction server online</span>
              </div>
              <ul className="text-slate-500 ml-4 list-disc space-y-0.5">
                <li>
                  OpenAI: {serverHealth.openaiEnvConfigured ? 'server key configured' : 'no server key'} · model{' '}
                  <span className="text-slate-400 font-mono">{serverHealth.openaiModel ?? '—'}</span>
                </li>
                <li>
                  Anthropic: {serverHealth.anthropicEnvConfigured ? 'server key configured' : 'no server key'} · model{' '}
                  <span className="text-slate-400 font-mono">{serverHealth.anthropicModel ?? '—'}</span>
                </li>
              </ul>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-slate-600 flex-shrink-0" />
                <span className="text-slate-500">Server not running</span>
              </div>
              <div className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-300">
                npm start
              </div>
              <p className="text-slate-600">
                Start the server for Claude extraction and for using <code className="font-mono text-[11px]">.env</code> API keys.
                Without it, ChatGPT can still run from the browser if you saved an OpenAI key in Settings.
              </p>
            </div>
          )}
        </div>
      </Card>

      {/* Section 102 tax routes */}
      <Section102Card />

      {/* Trading windows */}
      <TradingWindowCard />

      {/* About */}
      <Card padding="md">
        <CardHeader>
          <CardTitle>About</CardTitle>
        </CardHeader>
        <div className="space-y-1 text-xs text-slate-500">
          <p><span className="text-slate-400">EquityLens</span> — Document Intelligence & Equity Portfolio Dashboard</p>
          <p>Local-first · All data stored in browser IndexedDB</p>
          <p>Supported files: PDF, DOCX, XLSX, CSV, XML, HTML, TXT</p>
          <p>Grant extraction: ChatGPT (OpenAI) or Claude (Anthropic), chosen in Settings</p>
        </div>
      </Card>
    </div>
  );
}

// ── Section 102 per-grant tax route ──────────────────────────────────────────
function Section102Card() {
  const { portfolio, updateGrant } = usePortfolioStore();
  const { grants } = portfolio;

  const handleRoute = async (grant: GrantRecord, route: TaxRoute) => {
    const updated: GrantRecord = {
      ...grant,
      taxRoute: route,
      trusteeReleaseDate: route === '102b2' && grant.grantDate?.value
        ? trusteReleaseDate(grant.grantDate.value)
        : undefined,
    };
    await updateGrant(updated);
  };

  return (
    <Card padding="md">
      <CardHeader>
        <CardTitle>Israeli Section 102 Tax Routes</CardTitle>
        <Shield className="w-4 h-4 text-slate-600" />
      </CardHeader>
      <div className="space-y-2 text-xs">
        <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-slate-500 space-y-1">
          <p><span className="text-slate-300">102(b)(2) Capital gains route</span> — 24-month trustee lock-up from grant date. All proceeds taxed at 25% CGT. No income tax at vest.</p>
          <p><span className="text-slate-300">102(b)(1) Regular income route</span> — Income tax at vest (marginal rate) + 25% CGT on post-vest appreciation.</p>
        </div>
        {grants.length === 0 ? (
          <p className="text-slate-600">No grants imported yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="text-left px-2 py-2 text-slate-500 font-medium">Grant</th>
                  <th className="text-left px-2 py-2 text-slate-500 font-medium">Grant Date</th>
                  <th className="text-left px-2 py-2 text-slate-500 font-medium">Tax Route</th>
                  <th className="text-left px-2 py-2 text-slate-500 font-medium">Trustee Release</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {grants.map((g) => (
                  <tr key={g.id} className="hover:bg-slate-800/20">
                    <td className="px-2 py-2 font-mono text-white">{g.grantId?.value ?? g.id.slice(0, 8)}</td>
                    <td className="px-2 py-2 text-slate-400">
                      {g.grantDate?.value
                        ? new Date(g.grantDate.value).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
                        : '—'}
                    </td>
                    <td className="px-2 py-2">
                      <select
                        value={g.taxRoute ?? ''}
                        onChange={(e) => handleRoute(g, (e.target.value as TaxRoute) || undefined as unknown as TaxRoute)}
                        className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 focus:outline-none"
                      >
                        <option value="">— not set —</option>
                        <option value="102b2">102(b)(2) — CGT route</option>
                        <option value="102b1">102(b)(1) — Income route</option>
                        <option value="us">US taxable</option>
                        <option value="other">Other</option>
                      </select>
                    </td>
                    <td className="px-2 py-2 font-mono text-slate-400">
                      {g.trusteeReleaseDate
                        ? new Date(g.trusteeReleaseDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}

// ── Trading windows ───────────────────────────────────────────────────────────
function TradingWindowCard() {
  const { portfolio, addTradingWindow, deleteTradingWindow } = usePortfolioStore();
  const { tradingWindows } = portfolio;
  const [form, setForm] = useState({ label: '', openDate: '', closeDate: '' });
  const [showForm, setShowForm] = useState(false);

  const handleAdd = async () => {
    if (!form.label || !form.openDate || !form.closeDate) return;
    const w: TradingWindow = { id: uuidv4(), ...form };
    await addTradingWindow(w);
    setForm({ label: '', openDate: '', closeDate: '' });
    setShowForm(false);
  };

  return (
    <Card padding="md">
      <CardHeader>
        <CardTitle>Trading Windows</CardTitle>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowForm((v) => !v)}
            className="text-xs px-2 py-1 rounded bg-indigo-700/30 border border-indigo-700/50 text-indigo-400 hover:bg-indigo-700/50 flex items-center gap-1">
            <Plus className="w-3 h-3" /> Add Window
          </button>
          <Calendar className="w-4 h-4 text-slate-600" />
        </div>
      </CardHeader>
      <div className="space-y-3 text-xs">
        <p className="text-slate-500">
          Configure your company's quarterly trading open periods.
          The Reminders view will show when windows are open/closing.
        </p>
        {showForm && (
          <div className="grid grid-cols-3 gap-2 bg-slate-950 border border-slate-800 rounded-lg p-3">
            {[
              { label: 'Label',      key: 'label',     type: 'text', placeholder: 'Q2 2026 window' },
              { label: 'Opens',      key: 'openDate',  type: 'date', placeholder: '' },
              { label: 'Closes',     key: 'closeDate', type: 'date', placeholder: '' },
            ].map(({ label, key, type, placeholder }) => (
              <div key={key}>
                <label className="block text-slate-500 mb-1">{label}</label>
                <input type={type} placeholder={placeholder} value={form[key as keyof typeof form]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-white focus:outline-none focus:border-indigo-500" />
              </div>
            ))}
            <div className="col-span-3 flex gap-2">
              <Button variant="primary" size="sm" onClick={handleAdd}>Save</Button>
              <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </div>
        )}
        {tradingWindows.length > 0 ? (
          <div className="space-y-1">
            {[...tradingWindows].sort((a, b) => new Date(a.openDate).getTime() - new Date(b.openDate).getTime()).map((w) => {
              const now   = new Date();
              const open  = new Date(w.openDate);
              const close = new Date(w.closeDate);
              const isActive = now >= open && now <= close;
              return (
                <div key={w.id} className={`flex items-center gap-3 rounded-lg px-3 py-2 border ${isActive ? 'bg-emerald-950/30 border-emerald-800/50' : 'bg-slate-900 border-slate-800'}`}>
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isActive ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                  <div className="flex-1">
                    <span className="text-slate-300 font-medium">{w.label}</span>
                    <span className="text-slate-600 ml-2">
                      {open.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {close.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                  </div>
                  {isActive && <span className="text-xs text-emerald-400 font-medium">OPEN</span>}
                  <button onClick={() => deleteTradingWindow(w.id)} className="text-slate-700 hover:text-red-400 p-1">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-slate-600">No trading windows configured.</p>
        )}
      </div>
    </Card>
  );
}
