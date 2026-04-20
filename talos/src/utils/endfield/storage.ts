import type { EndfieldSession } from './types';

const SESSION_STORAGE_KEY = 'endfield.session';
const ACCOUNT_TOKEN_COOKIE_KEY = 'endfield_account_token';
const CRED_COOKIE_KEY = 'endfield_cred';

const setCookie = (key: string, value: string): void => {
    const secure = typeof window !== 'undefined' && window.location.protocol === 'https:';
    const secureAttr = secure ? '; Secure' : '';
    document.cookie = `${key}=${encodeURIComponent(value)}; Path=/; SameSite=Lax${secureAttr}`;
};

const readCookie = (key: string): string | null => {
    const encodedKey = `${key}=`;
    const cookies = document.cookie ? document.cookie.split(';') : [];

    for (const cookie of cookies) {
        const trimmed = cookie.trim();
        if (!trimmed.startsWith(encodedKey)) continue;
        return decodeURIComponent(trimmed.slice(encodedKey.length));
    }

    return null;
};

const clearCookie = (key: string): void => {
    const secure = typeof window !== 'undefined' && window.location.protocol === 'https:';
    const secureAttr = secure ? '; Secure' : '';
    document.cookie = `${key}=; Max-Age=0; Path=/; SameSite=Lax${secureAttr}`;
};

export const hasEndfieldSessionCookies = (): boolean => {
    const cred = readCookie(CRED_COOKIE_KEY);
    return Boolean(cred);
};

export const saveEndfieldSession = (session: EndfieldSession): void => {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    setCookie(CRED_COOKIE_KEY, session.cred);
    setCookie(ACCOUNT_TOKEN_COOKIE_KEY, session.accountToken ?? '');
};

export const readEndfieldSession = (): EndfieldSession | null => {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;

    try {
        const parsed = JSON.parse(raw) as Partial<EndfieldSession>;
        const cookieCred = readCookie(CRED_COOKIE_KEY);
        const cookieAccountToken = readCookie(ACCOUNT_TOKEN_COOKIE_KEY);

        if (!cookieCred) {
            return null;
        }

        if (!parsed.cred || !parsed.token) {
            return null;
        }

        if (parsed.accountToken && !cookieAccountToken) {
            return null;
        }

        return {
            accountToken: cookieAccountToken || parsed.accountToken || null,
            cred: cookieCred,
            token: parsed.token,
        };
    } catch {
        return null;
    }
};

export const clearEndfieldSession = (): void => {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    clearCookie(CRED_COOKIE_KEY);
    clearCookie(ACCOUNT_TOKEN_COOKIE_KEY);
};
