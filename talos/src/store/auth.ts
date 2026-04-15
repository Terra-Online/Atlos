import { create } from 'zustand';
import type { SessionUser } from '@/component/login/authTypes';

interface AuthState {
  sessionUser: SessionUser | null;
  setSessionUser: (user: SessionUser | null) => void;
  clearSessionUser: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  sessionUser: null,
  setSessionUser: (user) => set({ sessionUser: user }),
  clearSessionUser: () => set({ sessionUser: null }),
}));
