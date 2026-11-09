import { create } from 'zustand';
import type { SessionUser } from '@/services/auth';
import { getCachedSession, setCachedSession } from '@/services/cache/backend';

interface AuthState {
  sessionUser: SessionUser | null;
  // sessionVersion invalidates in-flight work; the owner version only releases
  // UI state that must not cross an authentication boundary.
  sessionVersion: number;
  sessionOwnerVersion: number;
  setSessionUser: (user: SessionUser | null) => void;
  updateSessionUser: (user: SessionUser | null) => void;
  clearSessionUser: () => void;
  beginSessionUpdate: () => number;
}

const cachedSession = getCachedSession();

export const useAuthStore = create<AuthState>((set) => ({
  sessionUser: cachedSession.hit ? cachedSession.value : null,
  sessionVersion: 0,
  sessionOwnerVersion: 0,
  beginSessionUpdate: () => {
    let version = 0;
    set((state) => {
      version = state.sessionVersion + 1;
      return { sessionVersion: version };
    });
    return version;
  },
  setSessionUser: (user) => {
    setCachedSession(user);
    set((state) => ({
      sessionUser: user,
      sessionVersion: state.sessionVersion + 1,
      sessionOwnerVersion: state.sessionOwnerVersion + 1,
    }));
  },
  updateSessionUser: (user) => {
    setCachedSession(user);
    set((state) => ({ sessionUser: user, sessionVersion: state.sessionVersion + 1 }));
  },
  clearSessionUser: () => {
    setCachedSession(null);
    set((state) => ({
      sessionUser: null,
      sessionVersion: state.sessionVersion + 1,
      sessionOwnerVersion: state.sessionOwnerVersion + 1,
    }));
  },
}));
