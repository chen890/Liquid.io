import { create } from 'zustand';
import type { AuthUser } from '../lib/authApi';
import * as authApi from '../lib/authApi';

interface AuthState {
  user: AuthUser | null;
  /** True when /api/auth/me exists (local FastAPI). False on static-only deploys (e.g. Vercel SPA). */
  backendHasAuth: boolean;
  authChecked: boolean;
  authError: string | null;
  initAuth: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  backendHasAuth: false,
  authChecked: false,
  authError: null,

  initAuth: async () => {
    set({ authError: null });
    const probe = await authApi.probeSession();
    switch (probe.status) {
      case 'authenticated':
        set({ user: probe.user, authChecked: true, backendHasAuth: true, authError: null });
        break;
      case 'anonymous':
        set({ user: null, authChecked: true, backendHasAuth: true, authError: null });
        break;
      case 'no_backend':
        set({ user: null, authChecked: true, backendHasAuth: false, authError: null });
        break;
      case 'error':
        set({
          user: null,
          authChecked: true,
          backendHasAuth: true,
          authError: probe.message,
        });
        break;
      default:
        set({ user: null, authChecked: true, backendHasAuth: false, authError: null });
    }
  },

  login: async (email, password) => {
    set({ authError: null });
    const { user } = await authApi.authLogin(email, password);
    set({ user, backendHasAuth: true });
  },

  register: async (email, password) => {
    set({ authError: null });
    const { user } = await authApi.authRegister(email, password);
    set({ user, backendHasAuth: true });
  },

  logout: async () => {
    await authApi.authLogout();
    set({ user: null });
  },

  clearError: () => set({ authError: null }),
}));
