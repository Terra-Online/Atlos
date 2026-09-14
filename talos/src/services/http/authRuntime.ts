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
    if (envBase) return envBase.replace(/\/$/, '');
    if (import.meta.env.PROD) return PROD_AUTH_BASE;
    return getLocalAuthBase().replace(/\/$/, '');
};

export const getAuthHeaders = (): Record<string, string> => ({});
