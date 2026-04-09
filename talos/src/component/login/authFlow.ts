export interface SessionUser {
  uid: string;
  nickname: string;
  email?: string;
  role?: string;
  needsProfileSetup?: boolean;
}

const LOCAL_AUTH_PORT = '8787';

const getLocalAuthBase = (): string => {
  if (typeof window === 'undefined') {
    return `http://127.0.0.1:${LOCAL_AUTH_PORT}`;
  }
  const { protocol, hostname } = window.location;
  return `${protocol}//${hostname}:${LOCAL_AUTH_PORT}`;
};

export const getAuthBase = (): string => {
  const envBase = (import.meta.env.VITE_AUTH_BASE as string | undefined)?.trim();
  return (envBase || getLocalAuthBase()).replace(/\/$/, '');
};

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

const readJsonSafely = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    return null;
  }
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

export const fetchSessionUser = async (authBase: string): Promise<SessionUser | null> => {
  const response = await fetch(`${authBase}/auth/v1/session`, {
    method: 'GET',
    headers: { accept: 'application/json' },
    credentials: 'include',
  });

  if (response.status === 401) {
    return null;
  }

  const payload = await readJsonSafely(response);
  if (!response.ok) {
    throw new Error(pickApiErrorMessage(payload, `Session request failed (${response.status})`));
  }

  const user = pickSessionUser(payload);
  if (!user) {
    throw new Error('Session payload does not contain user info.');
  }

  return user;
};

export const startDiscordAuth = async (
  authBase: string,
  callbackURL: string
): Promise<{ redirectUrl: string }> => {
  const response = await fetch(`${authBase}/auth/v1/sign-in/social`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    credentials: 'include',
    redirect: 'manual',
    body: JSON.stringify({
      provider: 'discord',
      callbackURL,
    }),
  });

  const locationHeader = response.headers.get('location');
  if (locationHeader) {
    return { redirectUrl: locationHeader };
  }

  const payload = await readJsonSafely(response);
  const redirectUrl = pickRedirectUrl(payload);
  if (redirectUrl) {
    return { redirectUrl };
  }

  if (!response.ok) {
    throw new Error(pickApiErrorMessage(payload, `Auth request failed (${response.status})`));
  }

  throw new Error('Backend did not return an OAuth redirect URL.');
};

export const updateProfileNickname = async (
  authBase: string,
  nickname: string
): Promise<SessionUser> => {
  const response = await fetch(`${authBase}/auth/v1/profile`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({ nickname }),
  });

  const payload = await readJsonSafely(response);
  if (!response.ok) {
    throw new Error(pickApiErrorMessage(payload, `Profile update failed (${response.status})`));
  }

  const user = pickSessionUser(payload);
  if (!user) {
    throw new Error('Profile updated, but server did not return latest user data.');
  }

  return user;
};

export const logoutUser = async (authBase: string): Promise<void> => {
  const response = await fetch(`${authBase}/auth/v1/logout`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
    },
    credentials: 'include',
  });

  const payload = await readJsonSafely(response);
  if (!response.ok) {
    throw new Error(pickApiErrorMessage(payload, `Logout failed (${response.status})`));
  }
};
