import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  LayoutDashboard, Upload, TrendingUp, FileText, FolderOpen,
  Lightbulb, Calculator, Bell, BarChart2, ArrowLeftRight, CandlestickChart, Settings, ChevronRight,
  Lock, X, LineChart,
} from 'lucide-react';
import type { AppView } from '../../types';
import { usePortfolioStore } from '../../store/portfolioStore';
import { useAuthStore } from '../../store/authStore';
import { useThemeStore } from '../../store/themeStore';
import { currentTradingWindow } from '../../lib/tradingWindows';

interface NavItem { id: AppView; label: string; icon: React.ElementType }

const navItems: NavItem[] = [
  { id: 'dashboard',    label: 'Dashboard',        icon: LayoutDashboard },
  { id: 'upload',       label: 'Upload Documents',  icon: Upload },
  { id: 'grants',       label: 'Grant Explorer',    icon: TrendingUp },
  { id: 'documents',    label: 'Documents',         icon: FolderOpen },
  { id: 'insights',     label: 'AI Insights',       icon: Lightbulb },
  { id: 'whatif',       label: 'What-If / Tax',     icon: Calculator },
  { id: 'stocks',       label: 'Stocks',            icon: LineChart },
  { id: 'chart',        label: 'Candle Chart',      icon: CandlestickChart },
  { id: 'analytics',    label: 'Analytics',         icon: BarChart2 },
  { id: 'transactions', label: 'Transactions',      icon: ArrowLeftRight },
  { id: 'reminders',    label: 'Reminders',         icon: Bell },
  { id: 'vault',        label: 'Secure vault',      icon: Lock },
  { id: 'settings',     label: 'Settings',          icon: Settings },
];

export type SidebarProps = {
  /** Drawer open state (mobile only; ignored at `md+`). */
  mobileOpen: boolean;
  onCloseMobile: () => void;
};

export function Sidebar({ mobileOpen, onCloseMobile }: SidebarProps) {
  const { currentView, setView, portfolio, pendingGrants } = usePortfolioStore();
  const { backendHasAuth } = useAuthStore();
  const day = useThemeStore((s) => s.appearance) === 'day';
  const { grants, tradingWindows } = portfolio;

  const visibleNav = useMemo(
    () => navItems.filter((item) => backendHasAuth || item.id !== 'vault'),
    [backendHasAuth],
  );

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

  const go = (id: AppView) => {
    setView(id);
    onCloseMobile();
  };

  return (
    <aside
      id="app-sidebar"
      className={`flex min-h-0 flex-col overflow-hidden border-r shadow-xl transition-transform duration-200 ease-out md:static md:z-0 md:w-56 md:max-w-none md:translate-x-0 md:self-stretch md:shadow-none md:shrink-0
        fixed inset-y-0 left-0 z-50 w-[min(100vw-2.5rem,18rem)] max-w-[288px] md:inset-auto
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
        ${day ? 'border-slate-200 bg-white' : 'border-slate-800 bg-slate-950'}`}
    >
      <div
        className={`flex shrink-0 items-center justify-between gap-2 border-b px-4 py-4 md:py-5 ${
          day ? 'border-slate-200' : 'border-slate-800'
        }`}>
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-indigo-600">
            <TrendingUp className="h-4 w-4 text-white" />
          </div>
          <div className="min-w-0">
            <div className={`text-sm font-semibold ${day ? 'text-slate-900' : 'text-white'}`}>EquityLens</div>
            <div className="text-xs text-slate-500">Portfolio Intelligence</div>
          </div>
        </div>
        <button
          type="button"
          onClick={onCloseMobile}
          className={`rounded-lg p-2 md:hidden ${
            day ? 'text-slate-600 hover:bg-slate-100 hover:text-slate-900' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
          }`}
          aria-label="Close menu">
          <X className="h-5 w-5" />
        </button>
      </div>

      {tradingWindows.length > 0 && (
        <div className={`mx-2 mt-2 shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium ${
          activeTW ? 'border-emerald-800/50 bg-emerald-950/40 text-emerald-400' : 'border-slate-700/50 bg-slate-800/60 text-slate-500'
        } flex items-center gap-1.5`}>
          <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${activeTW ? 'bg-emerald-400' : 'bg-slate-600'}`} />
          {activeTW ? 'Window Open' : 'Window Closed'}
        </div>
      )}

      <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden px-2 py-2 md:py-3" aria-label="Primary">
        {visibleNav.map((item) => {
          const Icon     = item.icon;
          const isActive = currentView === item.id;
          const badge    = badgeFor(item.id);

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => go(item.id)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-3 text-sm transition-colors md:py-2 ${
                isActive
                  ? day
                    ? 'border border-indigo-200 bg-indigo-50 text-indigo-700'
                    : 'border border-indigo-700/50 bg-indigo-600/20 text-indigo-400'
                  : day
                    ? 'border border-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    : 'border border-transparent text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}>
              <Icon className="h-4 w-4 flex-shrink-0" />
              <span className="min-w-0 flex-1 text-left">{item.label}</span>
              {badge !== undefined && (
                <span
                  className={`rounded-full px-1.5 py-0.5 font-mono text-xs ${
                    isActive
                      ? day
                        ? 'bg-indigo-100 text-indigo-700'
                        : 'bg-indigo-600/30 text-indigo-300'
                      : day
                        ? 'bg-slate-200 text-slate-600'
                        : 'bg-slate-700 text-slate-400'
                  }`}>
                  {badge}
                </span>
              )}
              {isActive && <ChevronRight className="h-3 w-3 flex-shrink-0 opacity-50" />}
            </button>
          );
        })}
      </nav>

      {pendingGrants.length > 0 && (
        <div className="shrink-0 px-2 pb-2 md:pb-3">
          <button
            type="button"
            onClick={() => go('review')}
            className="flex w-full items-center gap-2.5 rounded-lg border border-amber-800/50 bg-amber-900/30 px-3 py-3 text-sm text-amber-400 transition-colors hover:bg-amber-900/50 md:py-2">
            <FileText className="h-4 w-4 flex-shrink-0" />
            <span className="min-w-0 flex-1 text-left">Review Extraction</span>
            <span className="rounded-full bg-amber-700/50 px-1.5 py-0.5 font-mono text-xs">{pendingGrants.length}</span>
          </button>
        </div>
      )}

      <div className={`shrink-0 space-y-2 border-t px-4 py-3 ${day ? 'border-slate-200' : 'border-slate-800'}`}>
        {!backendHasAuth && (
          <Link
            to="/sign-in"
            onClick={onCloseMobile}
            className="flex items-center gap-2 rounded-lg border border-amber-900/40 px-2 py-2 text-xs text-amber-500/90 hover:bg-amber-950/30 hover:text-amber-400 md:py-1.5">
            <Lock className="h-3.5 w-3.5 flex-shrink-0" />
            <span>Sign-in / API server</span>
          </Link>
        )}
        <div className="text-xs text-slate-600">
          {portfolio.grants.length} grants · {portfolio.documents.length} docs
        </div>
      </div>
    </aside>
  );
                             }
