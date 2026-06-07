import { create } from 'zustand';

const STORAGE_KEY = 'equitylens-appearance';

export type Appearance = 'day' | 'night';

function readStored(): Appearance {
  if (typeof window === 'undefined') return 'night';
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'day' || v === 'night') return v;
  } catch {
    /* ignore */
  }
  return 'night';
}

/** Syncs `<html data-appearance>` for global CSS (body, scrollbars). */
export function syncAppearanceDom(appearance: Appearance) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.appearance = appearance;
}

interface ThemeState {
  appearance: Appearance;
  setAppearance: (appearance: Appearance) => void;
  toggleAppearance: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  appearance: readStored(),
  setAppearance: (appearance) => {
    try {
      localStorage.setItem(STORAGE_KEY, appearance);
    } catch {
      /* ignore */
    }
    syncAppearanceDom(appearance);
    set({ appearance });
  },
  toggleAppearance: () => {
    const next = get().appearance === 'night' ? 'day' : 'night';
    get().setAppearance(next);
  },
}));

syncAppearanceDom(useThemeStore.getState().appearance);
