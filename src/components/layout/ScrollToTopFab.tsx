import { useCallback, useLayoutEffect, useState } from 'react';
import { ChevronUp } from 'lucide-react';
import { usePortfolioStore } from '../../store/portfolioStore';
import { useThemeStore } from '../../store/themeStore';

const SHOW_AFTER_PX = 280;

type Props = {
  scrollRef: React.RefObject<HTMLElement | null>;
};

/** Appears after scrolling the main content; smooth-scrolls the app scroll region to top. */
export function ScrollToTopFab({ scrollRef }: Props) {
  const [visible, setVisible] = useState(false);
  const currentView = usePortfolioStore((s) => s.currentView);
  const day = useThemeStore((s) => s.appearance) === 'day';

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onScroll = () => {
      setVisible(el.scrollTop > SHOW_AFTER_PX);
    };

    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [scrollRef, currentView]);

  const scrollToTop = useCallback(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [scrollRef]);

  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={scrollToTop}
      className={`fixed z-[60] flex h-11 w-11 items-center justify-center rounded-full border border-indigo-400/30 bg-indigo-600 text-white shadow-lg transition hover:bg-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 max-sm:bottom-[max(1.25rem,env(safe-area-inset-bottom,0px))] max-sm:right-[max(0.75rem,env(safe-area-inset-right,0px))] sm:bottom-6 sm:right-6 ${
        day
          ? 'shadow-slate-400/30 hover:shadow-indigo-400/25 focus-visible:ring-offset-slate-100'
          : 'shadow-black/40 hover:shadow-indigo-900/30 focus-visible:ring-offset-slate-950'
      }`}
      aria-label="Back to top">
      <ChevronUp className="h-5 w-5" strokeWidth={2.5} />
    </button>
  );
}
