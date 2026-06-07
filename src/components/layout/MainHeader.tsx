import { LogOut, Menu, Moon, Sun, User } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { useThemeStore } from '../../store/themeStore';
import { Button } from '../ui/Button';

type MainHeaderProps = {
  onMenuClick?: () => void;
  mobileNavOpen?: boolean;
};

/** Top bar: menu (mobile), signed-in identity + sign out. */
export function MainHeader({ onMenuClick, mobileNavOpen = false }: MainHeaderProps) {
  const { user, logout, backendHasAuth } = useAuthStore();
  const appearance = useThemeStore((s) => s.appearance);
  const toggleAppearance = useThemeStore((s) => s.toggleAppearance);
  const day = appearance === 'day';

  if (!backendHasAuth || !user) return null;

  return (
    <header
      className={`sticky top-0 z-20 flex shrink-0 items-center gap-2 border-b px-3 py-2.5 pt-[max(0.625rem,env(safe-area-inset-top,0px))] backdrop-blur-sm sm:gap-3 sm:px-4 ${
        day ? 'border-slate-200 bg-white/90' : 'border-slate-800 bg-slate-950/95'
      }`}>
      <button
        type="button"
        onClick={onMenuClick}
        className={`rounded-lg p-2.5 md:hidden ${
          day ? 'text-slate-600 hover:bg-slate-100 hover:text-slate-900' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
        }`}
        aria-label="Open menu"
        aria-expanded={mobileNavOpen}
        aria-controls="app-sidebar">
        <Menu className="h-5 w-5" strokeWidth={2} />
      </button>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-2 sm:gap-3">
        <button
          type="button"
          onClick={toggleAppearance}
          className={`shrink-0 rounded-lg p-2.5 transition-colors ${
            day
              ? 'text-amber-600 hover:bg-amber-50 hover:text-amber-800'
              : 'text-amber-400/90 hover:bg-slate-800 hover:text-amber-300'
          }`}
          aria-label={day ? 'Switch to night view' : 'Switch to day view'}
          title={day ? 'Night view' : 'Day view'}>
          {day ? <Moon className="h-5 w-5" strokeWidth={2} /> : <Sun className="h-5 w-5" strokeWidth={2} />}
        </button>
        <div
          className={`flex min-w-0 max-w-[min(100%,20rem)] items-center gap-2 rounded-lg border px-2.5 py-1.5 sm:max-w-[min(100%,28rem)] sm:gap-2.5 sm:px-3 ${
            day ? 'border-slate-200 bg-slate-50' : 'border-slate-800/80 bg-slate-900/40'
          }`}>
          <div
            className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md ${
              day ? 'bg-indigo-100 text-indigo-700' : 'bg-indigo-600/25 text-indigo-300'
            }`}>
            <User className="h-4 w-4" aria-hidden />
          </div>
          <div className="min-w-0 text-left">
            <div className={`text-[10px] font-medium uppercase tracking-wide ${day ? 'text-slate-500' : 'text-slate-500'}`}>
              Signed in as
            </div>
            <div
              className={`truncate text-xs font-medium sm:text-sm ${day ? 'text-slate-900' : 'text-slate-100'}`}
              title={user.email}>
              {user.email}
            </div>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={`shrink-0 gap-1.5 px-2 sm:px-3 ${
            day ? 'text-slate-600 hover:bg-slate-100 hover:text-rose-600' : 'text-slate-400 hover:text-rose-300'
          }`}
          onClick={() => void logout()}>
          <LogOut className="h-4 w-4" />
          <span className="hidden sm:inline">Sign out</span>
        </Button>
      </div>
    </header>
  );
}
