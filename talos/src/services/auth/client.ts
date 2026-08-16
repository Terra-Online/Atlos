import { createAuthClient } from 'better-auth/client';
import type { SessionUser } from './types';
import { parseTimestamp, type TimestampInput } from '@/lib/format/time';
import { getCurrentLocale } from '@/locale';
import { getAuthBase, getAuthHeaders } from '@/services/http/authRuntime';

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
  if (!(value instanceof Date) && typeof value !== 'number' && typeof value !== 'string') {
    return undefined;
  }
  const date = parseTimestamp(value as TimestampInput);
  return date ? String(Math.floor(date.getTime())) : undefined;
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

  const parseAvatar = (value: unknown): number | undefined => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.max(1, Math.floor(value));
    }

    if (typeof value === 'string' && value.trim()) {
      const num = Number(value);
      if (Number.isFinite(num)) {
        return Math.max(1, Math.floor(num));
      }
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
  const avatar = parseAvatar(u.avatar ?? u.avt);

  return {
    uid,
    nickname,
    avatar,
    groupCode,
    registeredAt,
    karma,
    titleCode,
    email: typeof u.email === 'string' ? u.email : undefined,
    role,
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
  const response = await fetch(`${authBase}/auth/v1/session`, {
    method: 'GET',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      ...getAuthHeaders(),
    },
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    if (response.status === 401) {
      return null;
    }
    throw new AuthFlowError(
      pickApiErrorMessage(
        payload,
        `Session request failed (${response.status ?? 'unknown'})`
      ),
      {
        status: response.status,
        code: pickApiErrorCode(payload),
      },
    );
  }

  const user = pickSessionUser(payload);
  if (!user) {
    throw new Error('Session payload does not contain user info.');
  }

  return user;
};

export const exchangeAuthCode = async (code: string): Promise<SessionUser> => {
  const payload = await postAuthJson<unknown>('/session/exchange', {
    code: code.trim(),
  });

  const user = pickSessionUser(payload);
  if (!user) {
    throw new Error('Session exchange payload does not contain user info.');
  }

  return user;
};

export type OAuthProvider = 'discord' | 'github' | 'google';

export const startOAuth = async (
  provider: OAuthProvider,
  callbackURL: string,
): Promise<{ redirectUrl: string }> => {
  const response = await authClient.signIn.social({
    provider,
    callbackURL,
    disableRedirect: true,
  });

  if (response.error) {
    throw new AuthFlowError(
      pickApiErrorMessage(
        response.error,
        `Auth request failed (${response.error.status ?? 'unknown'})`
      ),
      {
        status: response.error.status,
        code: pickApiErrorCode(response.error),
      }
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

export const sendEmailVerificationOtp = async (
  email: string,
  mode: 'login' | 'register' = 'register',
): Promise<void> => {
  const normalizedEmail = email.trim().toLowerCase();
  void mode;
  const otpType = 'sign-in';

  await postAuthJson('/email-otp/send-verification-otp', {
    email: normalizedEmail,
    type: otpType,
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

export const requestPasswordReset = async (
  email: string,
  redirectTo: string,
): Promise<void> => {
  const normalizedEmail = email.trim().toLowerCase();
  await postAuthJson('/forget-password', {
    email: normalizedEmail,
    redirectTo,
  });
};

export const resetPasswordWithToken = async (
  token: string,
  newPassword: string,
  repeatPassword: string,
): Promise<void> => {
  await postAuthJson('/reset-password', {
    token: token.trim(),
    newPassword,
    repeatPassword,
  });
};

export const getResetPasswordPreview = async (
  token: string,
): Promise<{ email: string }> => {
  const response = await fetch(`${authBase}/auth/v1/reset-password-preview?token=${encodeURIComponent(token.trim())}`, {
    method: 'GET',
    credentials: 'include',
    headers: {
      accept: 'application/json',
    },
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

  const email = (payload as { email?: unknown })?.email;
  if (typeof email !== 'string' || !email.trim()) {
    throw new Error('Reset preview payload does not contain email.');
  }

  return { email: email.trim() };
};

const patchProfile = async (payloadBody: Record<string, unknown>): Promise<SessionUser> => {
  const response = await fetch(`${authBase}/auth/v1/profile`, {
    method: 'PATCH',
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(payloadBody),
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
        `Profile update failed (${response.status ?? 'unknown'})`
      ),
      {
        status: response.status,
        code: pickApiErrorCode(payload),
      },
    );
  }

  const user = pickSessionUser(payload);
  if (!user) {
    throw new Error('Profile updated, but server did not return latest user data.');
  }

  return user;
};

export const updateProfileNickname = async (
  nickname: string,
  avatar?: number,
): Promise<SessionUser> => {
  const normalizedAvatar = Number.isFinite(avatar) ? Math.max(1, Math.floor(avatar as number)) : undefined;

  if (normalizedAvatar === undefined) {
    return patchProfile({ nickname });
  }

  try {
    return await patchProfile({ nickname, avatar: normalizedAvatar });
  } catch (error) {
    if (!(error instanceof AuthFlowError) || (error.status !== 400 && error.status !== 422)) {
      throw error;
    }

    // Backward compatibility: if backend doesn't support avatar yet, fallback to nickname-only update.
    return patchProfile({ nickname });
  }
};

export const logoutUser = async (): Promise<void> => {
  const response = await fetch(`${authBase}/auth/v1/sign-out`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: '{}',
  });

  if (!response.ok) {
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    throw new Error(
      pickApiErrorMessage(
        payload,
        `Logout failed (${response.status ?? 'unknown'})`
      )
    );
  }
};
