import { useCallback, useEffect, useState } from 'react';
import { Lock, Trash2, Upload, Download, RefreshCw, Eye, EyeOff } from 'lucide-react';
import * as vault from '../../lib/authApi';
import type { VaultFileMeta, VaultSecretMeta } from '../../lib/authApi';
import { Button } from '../ui/Button';
import { Card, CardHeader, CardTitle } from '../ui/Card';

export function VaultView() {
  const [secrets, setSecrets] = useState<VaultSecretMeta[]>([]);
  const [files, setFiles] = useState<VaultFileMeta[]>([]);
  const [plainByName, setPlainByName] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');
  const [newValue, setNewValue] = useState('');

  const load = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const [s, f] = await Promise.all([vault.vaultListSecrets(), vault.vaultListFiles()]);
      setSecrets(s);
      setFiles(f);
      setPlainByName({});
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load vault');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleAddSecret(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setError('');
    try {
      await vault.vaultPutSecret(newName.trim(), newValue);
      setNewName('');
      setNewValue('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  }

  async function handleDeleteSecret(name: string) {
    if (!confirm(`Delete secret “${name}”?`)) return;
    setError('');
    try {
      await vault.vaultDeleteSecret(name);
      setPlainByName((p) => {
        const n = { ...p };
        delete n[name];
        return n;
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  async function toggleReveal(name: string) {
    if (plainByName[name] !== undefined) {
      setPlainByName((p) => {
        const n = { ...p };
        delete n[name];
        return n;
      });
      return;
    }
    setError('');
    try {
      const v = await vault.vaultGetSecret(name);
      setPlainByName((p) => ({ ...p, [name]: v }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read secret');
    }
  }

  async function handleUpload(ev: React.ChangeEvent<HTMLInputElement>) {
    const f = ev.target.files?.[0];
    ev.target.value = '';
    if (!f) return;
    setError('');
    try {
      await vault.vaultUploadFile(f);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    }
  }

  async function handleDeleteFile(id: number) {
    if (!confirm('Delete this file from your vault?')) return;
    setError('');
    try {
      await vault.vaultDeleteFile(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6 max-w-4xl mx-auto w-full">
      <div>
        <h1 className="text-xl font-semibold text-white flex items-center gap-2">
          <Lock className="w-6 h-6 text-indigo-400" />
          Secure vault
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Encrypted secrets and files, scoped to your account. Values are not written to application logs.
        </p>
      </div>

      {error && (
        <div className="text-sm text-rose-400 bg-rose-950/30 border border-rose-900/50 rounded-lg px-4 py-3">{error}</div>
      )}

      <div className="flex gap-2">
        <Button type="button" variant="secondary" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <Card padding="md">
        <CardHeader>
          <CardTitle>Secrets & API keys</CardTitle>
        </CardHeader>
        <form onSubmit={handleAddSecret} className="space-y-3 mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500">Name (e.g. openai, etrade_consumer)</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-sm text-slate-200"
                placeholder="my_api_key"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500">Value</label>
              <input
                type="password"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-sm text-slate-200"
                placeholder="sk-…"
              />
            </div>
          </div>
          <Button type="submit" size="sm" variant="primary">Save secret</Button>
        </form>

        {secrets.length === 0 ? (
          <p className="text-sm text-slate-600">No secrets yet.</p>
        ) : (
          <ul className="space-y-2">
            {secrets.map((s) => (
              <li
                key={s.name}
                className="flex flex-wrap items-center gap-2 justify-between py-2 px-3 rounded-lg bg-slate-900/50 border border-slate-800">
                <div>
                  <span className="text-sm font-mono text-indigo-300">{s.name}</span>
                  <span className="text-xs text-slate-600 ml-2">{s.updated_at}</span>
                </div>
                <div className="flex items-center gap-1">
                  {plainByName[s.name] !== undefined && (
                    <code className="text-xs text-slate-400 max-w-[220px] truncate mr-1" title={plainByName[s.name]}>
                      {plainByName[s.name]}
                    </code>
                  )}
                  <button
                    type="button"
                    onClick={() => void toggleReveal(s.name)}
                    className="p-1.5 rounded text-slate-500 hover:text-slate-300 hover:bg-slate-800"
                    title={plainByName[s.name] !== undefined ? 'Hide' : 'Reveal'}>
                    {plainByName[s.name] !== undefined ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteSecret(s.name)}
                    className="p-1.5 rounded text-rose-500/80 hover:bg-rose-950/50">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card padding="md">
        <CardHeader>
          <CardTitle>Files</CardTitle>
        </CardHeader>
        <div className="mb-4">
          <label className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600/20 text-indigo-300 border border-indigo-700/50 cursor-pointer hover:bg-indigo-600/30 text-sm">
            <Upload className="w-4 h-4" />
            Upload file
            <input type="file" className="hidden" onChange={(e) => void handleUpload(e)} />
          </label>
        </div>
        {files.length === 0 ? (
          <p className="text-sm text-slate-600">No files in vault.</p>
        ) : (
          <ul className="space-y-2">
            {files.map((f) => (
              <li
                key={f.id}
                className="flex items-center justify-between py-2 px-3 rounded-lg bg-slate-900/50 border border-slate-800 gap-2">
                <div className="min-w-0">
                  <div className="text-sm text-slate-200 truncate">{f.filename}</div>
                  <div className="text-xs text-slate-600">
                    {(f.size_plain / 1024).toFixed(1)} KB · {f.mime}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <a
                    href={vault.vaultDownloadUrl(f.id)}
                    download={f.filename}
                    className="p-1.5 rounded text-indigo-400 hover:bg-slate-800"
                    title="Download">
                    <Download className="w-4 h-4" />
                  </a>
                  <button
                    type="button"
                    onClick={() => void handleDeleteFile(f.id)}
                    className="p-1.5 rounded text-rose-500/80 hover:bg-rose-950/50">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
