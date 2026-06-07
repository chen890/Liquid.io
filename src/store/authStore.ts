import { create } from 'zustand';
import type { AuthUser } from '../lib/authApi';
import * as authApi from '../lib/authApi';

interface AuthState {
  user: AuthUser | null;
  authChecked: boolean;
  authError: string | null;
  /** Session check (cookie). */
  initAuth: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  authChecked: false,
  authError: null,

  initAuth: async () => {
    set({ authError: null });
    try {
      const d = await authApi.authMe();
      set({ user: d.user, authChecked: true });
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 401) {
        set({ user: null, authChecked: true });
        return;
      }
      set({
        user: null,
        authChecked: true,
        authError: e instanceof Error ? e.message : 'Could not reach server',
      });
    }
  },

  login: async (email, password) => {
    set({ authError: null });
    const { user } = await authApi.authLogin(email, password);
    set({ user });
  },

  register: async (email, password) => {
    set({ authError: null });
    const { user } = await authApi.authRegister(email, password);
    set({ user });
  },

  logout: async () => {
    await authApi.authLogout();
    set({ user: null });
  },

  clearError: () => set({ authError: null }),
}));
