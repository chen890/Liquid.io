/**
 * RemindersView — persistent in-app reminder feed.
 * Shows upcoming vesting events, trading windows, and market events
 * sorted by urgency. Users can dismiss individual reminders.
 */

import { useMemo, useState, useEffect } from 'react';
import { Bell, CheckCircle, Calendar, TrendingUp, AlertTriangle, Clock } from 'lucide-react';
import { usePortfolioStore } from '../../store/portfolioStore';
import { getAllVestingEvents } from '../../lib/vestingSchedule';
import { currentTradingWindow, nextTradingWindow } from '../../lib/tradingWindows';
import { getSetting, saveSetting } from '../../lib/storage';
import { Button } from '../ui/Button';

interface Reminder {
  id: string;
  type: 'vest' | 'window_open' | 'window_close' | 'event' | 'trustee';
  title: string;
  detail: string;
  date: Date;
  urgency: 'critical' | 'high' | 'medium' | 'low';
  ticker?: string;
}

function daysUntil(d: Date) { return Math.ceil((d.getTime() - Date.now()) / 86_400_000); }

function urgencyFromDays(days: number): Reminder['urgency'] {
  if (days <= 3)  return 'critical';
  if (days <= 14) return 'high';
  if (days <= 45) return 'medium';
  return 'low';
}

const URGENCY_STYLES: Record<Reminder['urgency'], string> = {
  critical: 'bg-red-950/40 border-red-800/60 text-red-400',
  high:     'bg-amber-950/30 border-amber-800/50 text-amber-400',
  medium:   'bg-blue-950/30 border-blue-800/50 text-blue-400',
  low:      'bg-slate-900 border-slate-800 text-slate-500',
};

const TYPE_ICONS: Record<Reminder['type'], typeof Bell> = {
  vest:         TrendingUp,
  window_open:  CheckCircle,
  window_close: AlertTriangle,
  event:        Calendar,
  trustee:      Clock,
};

export function RemindersView() {
  const { portfolio, setView } = usePortfolioStore();
  const { grants, tradingWindows } = portfolio;
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  // Load dismissed list from IndexedDB
  useEffect(() => {
    getSetting<string[]>('dismissedReminders').then((ids) => {
      if (ids) setDismissed(new Set(ids));
    });
  }, []);

  const dismiss = async (id: string) => {
    const next = new Set([...dismissed, id]);
    setDismissed(next);
    await saveSetting('dismissedReminders', [...next]);
  };

  const clearDismissed = async () => {
    setDismissed(new Set());
    await saveSetting('dismissedReminders', []);
  };

  const reminders = useMemo((): Reminder[] => {
    const list: Reminder[] = [];

    // 1. Upcoming vesting events (next 90 days)
    const vestEvents = getAllVestingEvents(grants);
    vestEvents.filter((ev) => {
      const d = daysUntil(ev.vestDate);
      return d > 0 && d <= 90;
    }).forEach((ev) => {
      const days = daysUntil(ev.vestDate);
      list.push({
        id: `vest-${ev.key}`,
        type: 'vest',
        title: `${ev.shares.toLocaleString()} ${ev.ticker} shares vest`,
        detail: `Grant ${ev.grantId} · ${ev.shares.toLocaleString()} ${ev.grantType} shares · ${ev.vestDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
        date: ev.vestDate,
        urgency: urgencyFromDays(days),
        ticker: ev.ticker,
      });
    });

    // 2. Section 102(b)(2) trustee release dates (next 180 days)
    grants.forEach((g) => {
      if (!g.taxRoute || g.taxRoute !== '102b2' || !g.trusteeReleaseDate) return;
      const releaseDate = new Date(g.trusteeReleaseDate);
      const days = daysUntil(releaseDate);
      if (days > 0 && days <= 180) {
        list.push({
          id: `trustee-${g.id}`,
          type: 'trustee',
          title: `102(b)(2) trustee lock-up ends`,
          detail: `Grant ${g.grantId?.value ?? g.id.slice(0, 8)} · shares eligible to sell on ${releaseDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · ${days} days`,
          date: releaseDate,
          urgency: urgencyFromDays(days),
          ticker: g.tickerSymbol?.value,
        });
      }
    });

    // 3. Trading windows (openings and closings, next 60 days)
    tradingWindows.forEach((w) => {
      const open  = new Date(w.openDate);
      const close = new Date(w.closeDate);
      const dOpen  = daysUntil(open);
      const dClose = daysUntil(close);
      if (dOpen > 0 && dOpen <= 60) {
        list.push({
          id: `wopen-${w.id}`,
          type: 'window_open',
          title: `Trading window opens`,
          detail: `${w.label} · opens ${open.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · closes ${close.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
          date: open,
          urgency: urgencyFromDays(dOpen),
        });
      }
      if (dClose > 0 && dClose <= 14) {
        list.push({
          id: `wclose-${w.id}`,
          type: 'window_close',
          title: `Trading window closing soon`,
          detail: `${w.label} closes on ${close.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — ${dClose} day${dClose !== 1 ? 's' : ''} left`,
          date: close,
          urgency: dClose <= 3 ? 'critical' : 'high',
        });
      }
    });

    return list
      .filter((r) => !dismissed.has(r.id))
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [grants, tradingWindows, dismissed]);

  // Current trading window status
  const activeTW   = currentTradingWindow(tradingWindows);
  const nextTW     = nextTradingWindow(tradingWindows);
  const inWindow   = !!activeTW;

  const criticalCount = reminders.filter((r) => r.urgency === 'critical').length;
  const highCount     = reminders.filter((r) => r.urgency === 'high').length;

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white flex items-center gap-2">
            <Bell className="w-5 h-5 text-indigo-400" />
            Reminders
            {(criticalCount + highCount) > 0 && (
              <span className="text-xs bg-red-600 text-white px-1.5 py-0.5 rounded-full">
                {criticalCount + highCount}
              </span>
            )}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Upcoming vest events, trustee releases, and trading windows
          </p>
        </div>
        {dismissed.size > 0 && (
          <Button variant="ghost" size="sm" onClick={clearDismissed}>
            Restore {dismissed.size} dismissed
          </Button>
        )}
      </div>

      {/* Trading window status */}
      <div className={`flex items-center gap-3 rounded-xl px-4 py-3 border ${
        inWindow
          ? 'bg-emerald-950/30 border-emerald-800/50'
          : 'bg-slate-900 border-slate-800'
      }`}>
        <CheckCircle className={`w-5 h-5 flex-shrink-0 ${inWindow ? 'text-emerald-400' : 'text-slate-600'}`} />
        <div>
          {inWindow ? (
            <>
              <div className="text-sm font-medium text-emerald-300">Trading window is OPEN</div>
              <div className="text-xs text-emerald-600">
                {activeTW!.label} · closes {new Date(activeTW!.closeDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </div>
            </>
          ) : (
            <>
              <div className="text-sm font-medium text-slate-400">Outside trading window — sales may be restricted</div>
              {nextTW && (
                <div className="text-xs text-slate-600">
                  Next: {nextTW.label} opens {new Date(nextTW.openDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · {daysUntil(new Date(nextTW.openDate))} days
                </div>
              )}
              {!nextTW && (
                <div className="text-xs text-slate-600">
                  No upcoming trading windows configured — add them in{' '}
                  <button onClick={() => setView('settings')} className="text-indigo-400 hover:underline">Settings</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Reminder list */}
      {reminders.length === 0 ? (
        <div className="text-center py-16 space-y-3">
          <Bell className="w-10 h-10 text-slate-700 mx-auto" />
          <p className="text-slate-500 text-sm">No upcoming reminders in the next 90 days.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {reminders.map((r) => {
            const Icon  = TYPE_ICONS[r.type];
            const days  = daysUntil(r.date);
            const style = URGENCY_STYLES[r.urgency];
            return (
              <div key={r.id} className={`flex items-start gap-3 rounded-xl px-4 py-3 border ${style}`}>
                <Icon className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white">{r.title}</span>
                    {r.ticker && <span className="text-xs text-slate-500 font-mono">{r.ticker}</span>}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">{r.detail}</div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className={`text-xs font-medium ${
                    days <= 3 ? 'text-red-400' : days <= 14 ? 'text-amber-400' : 'text-slate-500'
                  }`}>
                    {days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `${days}d`}
                  </span>
                  <button onClick={() => dismiss(r.id)}
                    className="text-slate-700 hover:text-slate-400 transition-colors p-0.5"
                    title="Dismiss">
                    <CheckCircle className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
