import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { SignInPage } from './components/auth/SignInPage';
import { Sidebar } from './components/layout/Sidebar';
import { Dashboard } from './components/views/Dashboard';
import { UploadView } from './components/views/UploadView';
import { ReviewView } from './components/views/ReviewView';
import { GrantsView } from './components/views/GrantsView';
import { DocumentsView } from './components/views/DocumentsView';
import { InsightsView } from './components/views/InsightsView';
import { WhatIfView } from './components/views/WhatIfView';
import { TransactionsView } from './components/views/TransactionsView';
import { RemindersView } from './components/views/RemindersView';
import { PortfolioAnalyticsView } from './components/views/PortfolioAnalyticsView';
import { CandleChartView } from './components/views/CandleChartView';
import { SettingsView } from './components/views/SettingsView';
import { VaultView } from './components/views/VaultView';
import { useAuthStore } from './store/authStore';
import { usePortfolioStore } from './store/portfolioStore';

function ViewRouter() {
  const { currentView } = usePortfolioStore();
  const backendHasAuth = useAuthStore((s) => s.backendHasAuth);
  const view = !backendHasAuth && currentView === 'vault' ? 'dashboard' : currentView;

  switch (view) {
    case 'dashboard': return <Dashboard />;
    case 'upload': return <UploadView />;
    case 'review': return <ReviewView />;
    case 'grants': return <GrantsView />;
    case 'documents': return <DocumentsView />;
    case 'insights':     return <InsightsView />;
    case 'whatif':       return <WhatIfView />;
    case 'transactions': return <TransactionsView />;
    case 'reminders':    return <RemindersView />;
    case 'analytics':    return <PortfolioAnalyticsView />;
    case 'chart':        return <CandleChartView />;
    case 'settings':     return <SettingsView />;
    case 'vault':        return <VaultView />;
    default: return <Dashboard />;
  }
}

function MainLayout() {
  const { loadPortfolio, isLoading } = usePortfolioStore();
  const { user, backendHasAuth } = useAuthStore();

  useEffect(() => {
    if (user || !backendHasAuth) void loadPortfolio();
  }, [user, backendHasAuth, loadPortfolio]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-950">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-slate-500">Loading portfolio...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[#0b0d14]">
      <Sidebar />
      <main className="flex-1 flex flex-col min-h-screen overflow-hidden">
        <ViewRouter />
      </main>
    </div>
  );
}

function SignInRoute() {
  const { backendHasAuth, user } = useAuthStore();
  if (!backendHasAuth) return <Navigate to="/" replace />;
  if (user) return <Navigate to="/" replace />;
  return <SignInPage />;
}

function AppShell() {
  const { authChecked, authError, backendHasAuth, user, initAuth } = useAuthStore();

  useEffect(() => {
    void initAuth();
  }, [initAuth]);

  if (!authChecked) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-950">
        <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (authError && backendHasAuth) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-950 p-6 gap-4">
        <p className="text-slate-300 text-center max-w-md">{authError}</p>
        <p className="text-sm text-slate-500 text-center max-w-md">
          Start the API server from the project root: <code className="text-indigo-400">npm run server</code> or{' '}
          <code className="text-indigo-400">npm run start</code>
        </p>
        <button
          type="button"
          onClick={() => void initAuth()}
          className="text-sm text-indigo-400 hover:underline">
          Retry
        </button>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/sign-in" element={<SignInRoute />} />
      <Route
        path="/*"
        element={
          backendHasAuth && !user ? <Navigate to="/sign-in" replace /> : <MainLayout />
        }
      />
    </Routes>
  );
}

export default function App() {
  return <AppShell />;
}
