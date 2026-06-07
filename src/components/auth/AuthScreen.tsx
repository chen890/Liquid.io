import { useState } from 'react';
import { TrendingUp, Mail, Lock, LogIn, UserPlus } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { Button } from '../ui/Button';

export function AuthScreen() {
  const { login, register, authError, clearError } = useAuthStore();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    clearError();
    setBusy(true);
    try {
      if (mode === 'login') await login(email, password);
      else await register(email, password);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  const displayError = formError || authError;

  return (
    <div className="min-h-screen bg-[#0b0d14] flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 justify-center mb-8">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-white">EquityLens</h1>
            <p className="text-xs text-slate-500">Sign in to continue</p>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-6 shadow-xl">
          <div className="flex rounded-lg bg-slate-900/80 p-0.5 mb-6">
            <button
              type="button"
              onClick={() => { setMode('login'); setFormError(''); clearError(); }}
              className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm rounded-md transition-colors ${
                mode === 'login' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}>
              <LogIn className="w-4 h-4" /> Sign in
            </button>
            <button
              type="button"
              onClick={() => { setMode('register'); setFormError(''); clearError(); }}
              className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm rounded-md transition-colors ${
                mode === 'register' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}>
              <UserPlus className="w-4 h-4" /> Register
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" />
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(ev) => setEmail(ev.target.value)}
                  className="w-full pl-10 pr-3 py-2.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-600/50"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" />
                <input
                  type="password"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  required
                  minLength={mode === 'register' ? 10 : 1}
                  value={password}
                  onChange={(ev) => setPassword(ev.target.value)}
                  className="w-full pl-10 pr-3 py-2.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-600/50"
                />
              </div>
              {mode === 'register' && (
                <p className="text-[11px] text-slate-600 mt-1.5">At least 10 characters.</p>
              )}
            </div>

            {displayError && (
              <p className="text-xs text-rose-400 bg-rose-950/30 border border-rose-900/50 rounded-lg px-3 py-2">
                {displayError}
              </p>
            )}

            <Button type="submit" variant="primary" disabled={busy} className="w-full justify-center">
              {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
            </Button>
          </form>

          <p className="text-[11px] text-slate-600 mt-6 leading-relaxed">
            Your session uses an httpOnly cookie. API keys and files you store in the vault are encrypted at rest on the server.
            Run the Python API locally (<code className="text-slate-500">npm run start</code>) so the app can reach{' '}
            <code className="text-slate-500">/api</code>.
          </p>
        </div>
      </div>
    </div>
  );
}
