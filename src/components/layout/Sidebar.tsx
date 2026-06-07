import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  LayoutDashboard, Upload, TrendingUp, FileText, FolderOpen,
  Lightbulb, Calculator, Bell, BarChart2, ArrowLeftRight, CandlestickChart, Settings, ChevronRight,
  Lock, LogOut,
} from 'lucide-react';
import type { AppView } from '../../types';
import { usePortfolioStore } from '../../store/portfolioStore';
import { useAuthStore } from '../../store/authStore';
import { currentTradingWindow } from '../../lib/tradingWindows';

interface NavItem { id: AppView; label: string; icon: React.ElementType }

const navItems: NavItem[] = [
  { id: 'dashboard',    label: 'Dashboard',        icon: LayoutDashboard },
  { id: 'upload',       label: 'Upload Documents',  icon: Upload },
  { id: 'grants',       label: 'Grant Explorer',    icon: TrendingUp },
  { id: 'documents',    label: 'Documents',         icon: FolderOpen },
  { id: 'insights',     label: 'AI Insights',       icon: Lightbulb },
  { id: 'whatif',       label: 'What-If / Tax',     icon: Calculator },
  { id: 'chart',        label: 'Candle Chart',      icon: CandlestickChart },
  { id: 'analytics',    label: 'Analytics',         icon: BarChart2 },
  { id: 'transactions', label: 'Transactions',      icon: ArrowLeftRight },
  { id: 'reminders',    label: 'Reminders',         icon: Bell },
  { id: 'vault',        label: 'Secure vault',      icon: Lock },
  { id: 'settings',     label: 'Settings',          icon: Settings },
];

export function Sidebar() {
  const { currentView, setView, portfolio, pendingGrants } = usePortfolioStore();
  const { user, logout, backendHasAuth } = useAuthStore();
  const { grants, tradingWindows } = portfolio;

  const visibleNav = useMemo(
    () => navItems.filter((item) => backendHasAuth || item.id !== 'vault'),
    [backendHasAuth],
  );

  // Upcoming reminders count (next 30 days)
  const reminderCount = useMemo(() => {
    const now = Date.now();
    const cutoff = now + 30 * 86_400_000;
    return grants.reduce((n, g) => {
      if (g.trusteeReleaseDate) {
        const t = new Date(g.trusteeReleaseDate).getTime();
        if (t > now && t < cutoff) n++;
      }
      return n;
    }, 0);
  }, [grants]);

  const activeTW = currentTradingWindow(tradingWindows);

  const badgeFor = (id: AppView): number | undefined => {
    if (id === 'grants')       return portfolio.grants.length || undefined;
    if (id === 'documents')    return portfolio.documents.length || undefined;
    if (id === 'transactions') return portfolio.transactions.length || undefined;
    if (id === 'reminders')    return reminderCount || undefined;
    return undefined;
  };

  return (
    <aside className="w-56 flex-shrink-0 bg-slate-950 border-r border-slate-800 flex flex-col min-h-screen">
      <div className="px-4 py-5 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center flex-shrink-0">
            <TrendingUp className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="text-sm font-semibold text-white">EquityLens</div>
            <div className="text-xs text-slate-500">Portfolio Intelligence</div>
          </div>
        </div>
      </div>

      {/* Trading window status pill */}
      {tradingWindows.length > 0 && (
        <div className={`mx-2 mt-2 px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 ${
          activeTW ? 'bg-emerald-950/40 text-emerald-400 border border-emerald-800/50' : 'bg-slate-800/60 text-slate-500 border border-slate-700/50'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${activeTW ? 'bg-emerald-400' : 'bg-slate-600'}`} />
          {activeTW ? 'Window Open' : 'Window Closed'}
        </div>
      )}

      <nav className="flex-1 px-2 py-3 space-y-0.5">
        {visibleNav.map((item) => {
          const Icon     = item.icon;
          const isActive = currentView === item.id;
          const badge    = badgeFor(item.id);

          return (
            <button key={item.id} onClick={() => setView(item.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive
                  ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-700/50'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}>
              <Icon className="w-4 h-4 flex-shrink-0" />
              <span className="flex-1 text-left">{item.label}</span>
              {badge !== undefined && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-mono ${isActive ? 'bg-indigo-600/30 text-indigo-300' : 'bg-slate-700 text-slate-400'}`}>
                  {badge}
                </span>
              )}
              {isActive && <ChevronRight className="w-3 h-3 opacity-50" />}
            </button>
          );
        })}
      </nav>

      {pendingGrants.length > 0 && (
        <div className="px-2 pb-3">
          <button onClick={() => setView('review')}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm bg-amber-900/30 text-amber-400 border border-amber-800/50 hover:bg-amber-900/50 transition-colors">
            <FileText className="w-4 h-4" />
            <span className="flex-1 text-left">Review Extraction</span>
            <span className="text-xs bg-amber-700/50 px-1.5 py-0.5 rounded-full font-mono">{pendingGrants.length}</span>
          </button>
        </div>
      )}

      <div className="px-4 py-3 border-t border-slate-800 space-y-2">
        {!backendHasAuth && (
          <Link
            to="/sign-in"
            className="flex items-center gap-2 text-xs text-amber-500/90 hover:text-amber-400 border border-amber-900/40 rounded-lg px-2 py-1.5 hover:bg-amber-950/30 transition-colors">
            <Lock className="w-3.5 h-3.5 flex-shrink-0" />
            <span>Sign-in / API server</span>
          </Link>
        )}
        {backendHasAuth && user && (
          <div className="flex items-center gap-2 text-xs text-slate-400 min-w-0">
            <span className="truncate flex-1" title={user.email}>{user.email}</span>
            <button
              type="button"
              onClick={() => void logout()}
              className="flex-shrink-0 p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-slate-800"
              title="Sign out">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
        <div className="text-xs text-slate-600">
          {portfolio.grants.length} grants · {portfolio.documents.length} docs
        </div>
      </div>
    </aside>
  );
}
