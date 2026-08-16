const POINT_SHARE_SHORT_ORIGIN = 'https://oem.re';
const POINT_SHARE_CN_ORIGIN = 'https://opendfieldmap.cn';
const POINT_SHARE_CN_HOSTNAME = 'opendfieldmap.cn';

const isPointShareCnHostname = (hostname: string): boolean => (
    hostname === POINT_SHARE_CN_HOSTNAME || hostname.endsWith(`.${POINT_SHARE_CN_HOSTNAME}`)
);

export const getPointShareOrigin = (): string => {
    if (typeof window !== 'undefined' && isPointShareCnHostname(window.location.hostname)) {
        return POINT_SHARE_CN_ORIGIN;
    }

    return POINT_SHARE_SHORT_ORIGIN;
};

export const getCurrentLocale = (): string | null => {
    try {
        if (typeof localStorage !== 'undefined') {
            return localStorage.getItem('talos:locale');
        }
    } catch {
        // Ignore unavailable storage during startup or SSR.
    }
    return null;
};
