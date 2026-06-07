import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { TrendingUp, Mail, Lock, LogIn, UserPlus } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { Button } from '../ui/Button';
import * as authApi from '../../lib/authApi';

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  google_denied: 'Google sign-in was cancelled.',
  google_failed: 'Google sign-in failed. Try again or use email.',
  google_token: 'Could not complete Google sign-in (token error).',
  google_no_email: 'Google did not return an email for this account.',
  github_denied: 'GitHub sign-in was cancelled.',
  github_failed: 'GitHub sign-in failed. Try again or use email.',
  github_token: 'Could not complete GitHub sign-in (token error).',
  github_no_email: 'GitHub has no verified email on file for this account.',
  email_exists:
    'This email already has a password account. Sign in with email and password, or use another provider account.',
  invalid_state: 'Sign-in session expired. Please try again.',
  google_missing_params: 'Google sign-in was interrupted.',
  github_missing_params: 'GitHub sign-in was interrupted.',
};

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.398 3.003-.403 1.02.005 2.047.137 3.006.403 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

function AppleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M16.365 1.43c0 1.14-.493 2.27-1.177 3.08-.744.9-1.99 1.57-2.975 1.57-.12 0-.23-.02-.3-.03-.01-.06-.04-.22-.04-.39 0-1.15.572-2.27 1.206-2.98.804-.94 2.142-1.64 3.248-1.68.03.13.05.28.05.43zm4.565 15.71c-.03.07-.463 1.58-1.518 3.12-.945 1.34-1.94 2.71-3.43 2.71-1.517 0-1.9-.88-3.63-.88-1.698 0-2.302.91-3.67.91-1.377 0-2.43-1.26-3.428-2.8-1.287-2.07-2.323-4.8-2.323-7.51 0-4.28 2.79-6.55 5.553-6.55 1.472 0 2.698.896 3.628.896.93 0 2.005-.926 3.565-.926 1.284 0 2.697.68 3.59 2.05-3.24 1.78-2.72 6.42.22 7.61z" />
    </svg>
  );
}

export function SignInPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { login, register, authError, clearError } = useAuthStore();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [providers, setProviders] = useState<authApi.OauthProviderFlags>({
    google: false,
    github: false,
    apple: false,
  });
  const [oauthBanner, setOauthBanner] = useState('');

  useEffect(() => {
    void authApi.fetchOauthProviders().then(setProviders);
  }, []);

  const oauthErrKey = searchParams.get('oauth_error');
  useEffect(() => {
    if (!oauthErrKey) return;
    setOauthBanner(OAUTH_ERROR_MESSAGES[oauthErrKey] ?? `Sign-in could not complete (${oauthErrKey}).`);
    navigate('/sign-in', { replace: true });
  }, [oauthErrKey, navigate]);

  const displayError = useMemo(
    () => oauthBanner || formError || authError,
    [oauthBanner, formError, authError],
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    clearError();
    setBusy(true);
    try {
      if (mode === 'login') await login(email, password);
      else await register(email, password);
      navigate('/', { replace: true });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  const hasSocial = providers.google || providers.github;

  return (
    <div className="min-h-screen bg-[#0b0d14] flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 justify-center mb-8">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-white">EquityLens</h1>
            <p className="text-xs text-slate-500">Sign in or create an account</p>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-6 shadow-xl">
          <div className="space-y-3 mb-6">
            <p className="text-xs text-slate-500 text-center uppercase tracking-wide">Continue with</p>
            <div className="grid gap-2">
              {providers.google && (
                <button
                  type="button"
                  onClick={() => authApi.navigateToOAuthStart('google')}
                  className="flex w-full items-center justify-center gap-3 rounded-lg border border-slate-700 bg-white px-4 py-2.5 text-sm font-medium text-slate-900 hover:bg-slate-100 transition-colors">
                  <GoogleIcon className="w-5 h-5 shrink-0" />
                  Google
                </button>
              )}
              {providers.github && (
                <button
                  type="button"
                  onClick={() => authApi.navigateToOAuthStart('github')}
                  className="flex w-full items-center justify-center gap-3 rounded-lg border border-slate-600 bg-slate-800 px-4 py-2.5 text-sm font-medium text-slate-100 hover:bg-slate-700 transition-colors">
                  <GitHubIcon className="w-5 h-5 shrink-0 text-white" />
                  GitHub
                </button>
              )}
              <button
                type="button"
                disabled
                title="Apple Sign In requires extra server configuration"
                className="flex w-full items-center justify-center gap-3 rounded-lg border border-slate-800 bg-slate-900/50 px-4 py-2.5 text-sm font-medium text-slate-500 cursor-not-allowed opacity-60">
                <AppleIcon className="w-5 h-5 shrink-0" />
                Apple <span className="text-[10px] font-normal">(soon)</span>
              </button>
              <button
                type="button"
                disabled
                title="Microsoft sign-in is not enabled yet"
                className="flex w-full items-center justify-center gap-3 rounded-lg border border-slate-800 bg-slate-900/50 px-4 py-2.5 text-sm font-medium text-slate-500 cursor-not-allowed opacity-60">
                Microsoft <span className="text-[10px] font-normal">(soon)</span>
              </button>
            </div>
            <div className="relative py-2">
              <div className="absolute inset-0 flex items-center" aria-hidden>
                <div className="w-full border-t border-slate-800" />
              </div>
              <div className="relative flex justify-center text-xs uppercase tracking-wide">
                <span className="bg-slate-950/80 px-2 text-slate-600">or email</span>
              </div>
            </div>
          </div>

          <div className="flex rounded-lg bg-slate-900/80 p-0.5 mb-6">
            <button
              type="button"
              onClick={() => { setMode('login'); setFormError(''); setOauthBanner(''); clearError(); }}
              className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm rounded-md transition-colors ${
                mode === 'login' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}>
              <LogIn className="w-4 h-4" /> Sign in
            </button>
            <button
              type="button"
              onClick={() => { setMode('register'); setFormError(''); setOauthBanner(''); clearError(); }}
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
              {busy ? 'Please wait…' : mode === 'login' ? 'Sign in with email' : 'Create account'}
            </Button>
          </form>

          {!hasSocial && (
            <p className="text-[11px] text-slate-600 mt-4 text-center">
              Configure <code className="text-slate-500">GOOGLE_CLIENT_ID</code> /{' '}
              <code className="text-slate-500">GITHUB_CLIENT_ID</code> in <code className="text-slate-500">.env</code> to
              enable social sign-in. OAuth callbacks must use <code className="text-slate-500">FRONTEND_PUBLIC_URL</code>{' '}
              (e.g. Vite dev: <code className="text-slate-500">http://localhost:5173</code>).
            </p>
          )}

          <p className="text-[11px] text-slate-600 mt-6 leading-relaxed">
            Session cookie is httpOnly. Vault data is encrypted at rest when the API server is running.
          </p>
        </div>
      </div>
    </div>
  );
}
