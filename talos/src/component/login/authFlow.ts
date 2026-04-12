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

const normalizeTimestampMs = (value: unknown): string | undefined => {
  if (value instanceof Date) {
    const ms = value.getTime();
    if (!Number.isFinite(ms)) return undefined;
    return String(Math.floor(ms));
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value < 1_000_000_000_000 ? value * 1000 : value;
    return String(Math.floor(ms));
  }

  if (typeof value === 'string' && value.trim()) {
    const raw = value.trim();

    if (/^\d+$/.test(raw)) {
      const numeric = Number(raw);
      if (!Number.isFinite(numeric)) return undefined;
      const ms = numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
      return String(Math.floor(ms));
    }

    const parsedMs = Date.parse(raw);
    if (Number.isFinite(parsedMs)) {
      return String(Math.floor(parsedMs));
    }
  }

  return undefined;
};

const mapRoleToGroupCode = (role?: string): SessionUser['groupCode'] => {
  if (!role) return undefined;
  const normalized = role.trim().toLowerCase();
  if (normalized === 'a') return 'admin';
  if (normalized === 'p') return 'pioneer';
  if (normalized === 's') return 'suspend';
  if (normalized === 'r') return 'robot';
  if (normalized === 'n') return 'normal';
  return undefined;
};

const pickSessionUser = (payload: unknown): SessionUser | null => {
  if (!payload || typeof payload !== 'object') return null;
  const root = payload as Record<string, unknown>;

  const rootData =
    root.data && typeof root.data === 'object'
      ? (root.data as Record<string, unknown>)
      : null;

  const user =
    root.user ??
    rootData?.user;

  if (!user || typeof user !== 'object') return null;

  const u = user as Record<string, unknown>;

  const parseKarma = (value: unknown): number | undefined => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const num = Number(value);
      return Number.isFinite(num) ? num : undefined;
    }
    return undefined;
  };

  const uid = typeof u.uid === 'string' ? u.uid : '';
  const nickname = typeof u.nickname === 'string' ? u.nickname : '';

  if (!uid || !nickname) return null;

  const role = typeof u.role === 'string' ? u.role : undefined;
  const groupCode = mapRoleToGroupCode(role);
  const titleCode = role;
  const registeredAt = normalizeTimestampMs(u.registeredAt ?? u.createdAt);
  const karma = parseKarma(
    u.karma ??
      u.karmaLevel
  );

  return {
    uid,
    nickname,
    groupCode,
    registeredAt,
    karma,
    titleCode,
    email: typeof u.email === 'string' ? u.email : undefined,
    role,
    needsProfileSetup: Boolean(u.needsProfileSetup),
  };
};

const pickSdkSessionFallback = (payload: unknown): Partial<SessionUser> => {
  if (!payload || typeof payload !== 'object') return {};

  const root = payload as Record<string, unknown>;
  const data =
    root.data && typeof root.data === 'object'
      ? (root.data as Record<string, unknown>)
      : root;

  const sdkUser =
    data.user && typeof data.user === 'object'
      ? (data.user as Record<string, unknown>)
      : null;
  const registeredAt = normalizeTimestampMs(sdkUser?.createdAt);

  return {
    registeredAt,
    email: typeof sdkUser?.email === 'string' ? sdkUser.email : undefined,
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
  const [sessionResult, sdkSession] = await Promise.all([
    authClient.$fetch('/session', {
      method: 'GET',
      headers: { accept: 'application/json' },
    }),
    authClient.getSession(),
  ]);

  const { data, error } = sessionResult;

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

  const sdkFallback = sdkSession.data
    ? pickSdkSessionFallback(sdkSession.data)
    : {};

  return {
    ...user,
    registeredAt: user.registeredAt ?? sdkFallback.registeredAt,
    email: user.email ?? sdkFallback.email,
  };
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

export const startGoogleAuth = async (
  callbackURL: string
): Promise<{ redirectUrl: string }> => {
  const response = await authClient.signIn.social({
    provider: 'google',
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
  const response = await fetch(`${authBase}/auth/v1/profile`, {
    method: 'PATCH',
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ nickname }),
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(
      pickApiErrorMessage(
        payload,
        `Profile update failed (${response.status ?? 'unknown'})`
      )
    );
  }

  const user = pickSessionUser(payload);
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