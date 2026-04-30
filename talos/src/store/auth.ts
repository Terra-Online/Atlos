import { create } from 'zustand';
import type { SessionUser } from '@/component/login/authTypes';
import { getCachedSession, setCachedSession } from '@/utils/backendCache';

interface AuthState {
  sessionUser: SessionUser | null;
  setSessionUser: (user: SessionUser | null) => void;
  clearSessionUser: () => void;
}

const cachedSession = getCachedSession();

export const useAuthStore = create<AuthState>((set) => ({
  sessionUser: cachedSession.hit ? cachedSession.value : null,
  setSessionUser: (user) => {
    setCachedSession(user);
    set({ sessionUser: user });
  },
  clearSessionUser: () => {
    setCachedSession(null);
    set({ sessionUser: null });
  },
}));
