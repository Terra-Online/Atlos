import { createAuthClient } from 'better-auth/client';
import type { SessionUser } from './authTypes';

const LOCAL_AUTH_PORT = '8787';
const PROD_AUTH_BASE = 'https://api.opendfieldmap.org';

const getLocalAuthBase = (): string => {
  if (typeof window === 'undefined') {
    return `http://127.0.0.1:${LOCAL_AUTH_PORT}`;
  }
  const { protocol, hostname } = window.location;
  return `${protocol}//${hostname}:${LOCAL_AUTH_PORT}`;
};

export const getAuthBase = (): string => {
  const envBase = (import.meta.env.VITE_AUTH_BASE as string | undefined)?.trim();
  if (envBase) {
    return envBase.replace(/\/$/, '');
  }

  if (import.meta.env.PROD) {
    return PROD_AUTH_BASE;
  }

  return getLocalAuthBase().replace(/\/$/, '');
};

const authBase = getAuthBase();

export const authClient = createAuthClient({
  baseURL: `${authBase}/auth/v1`,
  fetchOptions: {
    credentials: 'include',
  },
});

const pickRedirectUrl = (payload: unknown): string | null => {
  if (!payload || typeof payload !== 'object') return null;
  const data = payload as Record<string, unknown>;

  const direct = data.url;
  if (typeof direct === 'string' && direct) return direct;

  const nestedData = data.data;
  if (nestedData && typeof nestedData === 'object') {
    const nestedUrl = (nestedData as Record<string, unknown>).url;
    if (typeof nestedUrl === 'string' && nestedUrl) return nestedUrl;
  }

  return null;
};

const pickSessionUser = (payload: unknown): SessionUser | null => {
  if (!payload || typeof payload !== 'object') return null;
  const root = payload as Record<string, unknown>;
  const user = root.user;
  if (!user || typeof user !== 'object') return null;

  const u = user as Record<string, unknown>;
  const uid = typeof u.uid === 'string' ? u.uid : '';
  const nickname = typeof u.nickname === 'string' ? u.nickname : '';

  if (!uid || !nickname) return null;

  return {
    uid,
    nickname,
    email: typeof u.email === 'string' ? u.email : undefined,
    role: typeof u.role === 'string' ? u.role : undefined,
    needsProfileSetup: Boolean(u.needsProfileSetup),
  };
};

const pickApiErrorMessage = (payload: unknown, fallback: string): string => {
  if (payload && typeof payload === 'object') {
    const data = payload as {
      message?: string;
      error?: { message?: string };
    };

    if (typeof data.message === 'string' && data.message) {
      return data.message;
    }
    if (typeof data.error?.message === 'string' && data.error.message) {
      return data.error.message;
    }
  }

  return fallback;
};

export const fetchSessionUser = async (): Promise<SessionUser | null> => {
  const sdkSession = await authClient.getSession();
  if (sdkSession.error?.status === 401 || !sdkSession.data) {
    return null;
  }

  const { data, error } = await authClient.$fetch('/session', {
    method: 'GET',
    headers: { accept: 'application/json' },
  });

  if (error) {
    if ((error as { status?: number }).status === 401) {
      return null;
    }
    throw new Error(
      pickApiErrorMessage(
        error,
        `Session request failed (${(error as { status?: number }).status ?? 'unknown'})`
      )
    );
  }

  const user = pickSessionUser(data);
  if (!user) {
    throw new Error('Session payload does not contain user info.');
  }

  return user;
};

export const startDiscordAuth = async (
  callbackURL: string
): Promise<{ redirectUrl: string }> => {
  const response = await authClient.signIn.social({
    provider: 'discord',
    callbackURL,
    disableRedirect: true,
  });

  if (response.error) {
    throw new Error(
      pickApiErrorMessage(
        response.error,
        `Auth request failed (${response.error.status ?? 'unknown'})`
      )
    );
  }

  const redirectUrl = pickRedirectUrl(response.data);
  if (redirectUrl) {
    return { redirectUrl };
  }

  throw new Error('Backend did not return an OAuth redirect URL.');
};

export const updateProfileNickname = async (
  nickname: string
): Promise<SessionUser> => {
  const { data, error } = await authClient.$fetch('/profile', {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: {
      nickname,
    },
  });

  if (error) {
    throw new Error(
      pickApiErrorMessage(
        error,
        `Profile update failed (${(error as { status?: number }).status ?? 'unknown'})`
      )
    );
  }

  const user = pickSessionUser(data);
  if (!user) {
    throw new Error('Profile updated, but server did not return latest user data.');
  }

  return user;
};

export const logoutUser = async (): Promise<void> => {
  const response = await authClient.signOut();
  if (response.error) {
    throw new Error(
      pickApiErrorMessage(
        response.error,
        `Logout failed (${response.error.status ?? 'unknown'})`
      )
    );
  }
};
