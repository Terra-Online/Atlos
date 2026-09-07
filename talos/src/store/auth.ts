import { create } from 'zustand';
import type { SessionUser } from '@/services/auth';
import { getCachedSession, setCachedSession } from '@/services/cache/backend';

interface AuthState {
  sessionUser: SessionUser | null;
  sessionVersion: number;
  setSessionUser: (user: SessionUser | null) => void;
  clearSessionUser: () => void;
}

const cachedSession = getCachedSession();

export const useAuthStore = create<AuthState>((set) => ({
  sessionUser: cachedSession.hit ? cachedSession.value : null,
  sessionVersion: 0,
  setSessionUser: (user) => {
    setCachedSession(user);
    set((state) => ({ sessionUser: user, sessionVersion: state.sessionVersion + 1 }));
  },
  clearSessionUser: () => {
    setCachedSession(null);
    set((state) => ({ sessionUser: null, sessionVersion: state.sessionVersion + 1 }));
  },
}));
