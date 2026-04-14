import { createAuthClient } from 'better-auth/client';
import type { SessionUser } from './authTypes';
import { getCurrentLocale } from '@/locale';

export class AuthFlowError extends Error {
  status?: number;
  code?: string;

  constructor(message: string, options?: { status?: number; code?: string }) {
    super(message);
    this.name = 'AuthFlowError';
    this.status = options?.status;
    this.code = options?.code;
  }
}

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

const pickApiErrorCode = (payload: unknown): string | undefined => {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  const data = payload as {
    code?: string;
    error?: {
      code?: string;
    };
  };

  if (typeof data.code === 'string' && data.code) {
    return data.code;
  }

  if (typeof data.error?.code === 'string' && data.error.code) {
    return data.error.code;
  }

  return undefined;
};

async function postAuthJson<TResponse>(
  path: string,
  body: Record<string, unknown>,
): Promise<TResponse> {
  const locale = getCurrentLocale();
  const requestBody = {
    ...body,
    locale,
  };

  const response = await fetch(`${authBase}/auth/v1${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-oem-locale': locale,
    },
    body: JSON.stringify(requestBody),
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new AuthFlowError(
      pickApiErrorMessage(
        payload,
        `Auth request failed (${response.status ?? 'unknown'})`,
      ),
      {
        status: response.status,
        code: pickApiErrorCode(payload),
      },
    );
  }

  return payload as TResponse;
}

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

const deriveDisplayName = (email: string): string => {
  const local = email.split('@')[0]?.trim() ?? '';
  const normalized = local.replace(/[^A-Za-z0-9_-]/g, '');
  if (normalized.length >= 2) {
    return normalized.slice(0, 26);
  }
  return 'Traveler';
};

export const registerWithEmail = async (
  email: string,
  password: string,
  otp: string,
): Promise<void> => {
  const normalizedEmail = email.trim().toLowerCase();
  await postAuthJson('/register', {
    email: normalizedEmail,
    password,
    otp,
    name: deriveDisplayName(normalizedEmail),
  });
};

export const sendEmailVerificationOtp = async (email: string): Promise<void> => {
  const normalizedEmail = email.trim().toLowerCase();
  await postAuthJson('/email-otp/send-verification-otp', {
    email: normalizedEmail,
    type: 'sign-in',
  });
};

export const loginWithEmail = async (
  email: string,
  password: string,
): Promise<void> => {
  const normalizedEmail = email.trim().toLowerCase();
  await postAuthJson('/sign-in/email', {
    email: normalizedEmail,
    password,
  });
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