import type { EndfieldSession } from './types';

const SESSION_STORAGE_KEY = 'endfield.session';

export const saveEndfieldSession = (session: EndfieldSession): void => {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
};

export const readEndfieldSession = (): EndfieldSession | null => {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;

    try {
        const parsed = JSON.parse(raw) as Partial<EndfieldSession>;
        if (!parsed.cred || !parsed.token) {
            return null;
        }
        return {
            accountToken: parsed.accountToken ?? null,
            cred: parsed.cred,
            token: parsed.token,
        };
    } catch {
        return null;
    }
};

export const clearEndfieldSession = (): void => {
    localStorage.removeItem(SESSION_STORAGE_KEY);
};
