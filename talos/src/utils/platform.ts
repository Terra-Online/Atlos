/**
 * Platform detection utilities.
 *
 * General-purpose helpers for OS/browser feature detection.
 * Used across the app for keyboard shortcut display, touch handling, etc.
 */
interface NavigatorUAData {
    platform: string;
    mobile: boolean;
    brands: Array<{ brand: string; version: string }>;
}

// expansion of the standard Navigator interface to include userAgentData
interface NavigatorWithUAData extends Navigator {
    userAgentData?: NavigatorUAData;
}

// 1. ENV check: Ensure we're in a browser context before accessing navigator or window
const isBrowser = typeof window !== 'undefined' && typeof navigator !== 'undefined';

// 2. Platform detection with layered fallbacks
const getPlatformData = (): string => {
    if (!isBrowser) return '';
    const nav = navigator as NavigatorWithUAData;
    return nav.userAgentData?.platform || '';
};

// 3. Memoized platform checks (evaluated once at module load)
const getUserAgent = (): string => {
    return isBrowser ? navigator.userAgent : '';
};

// Load judgments at module initialization
const _isIOS = ((): boolean => {
    if (!isBrowser) return false;
    
    const ua = getUserAgent();
    const platform = getPlatformData();
    
    if (/iPod|iPhone|iPad/i.test(ua) || platform === 'iOS') {
        return true;
    }
    
    // patch for modern iPadOS which reports as Mac
    const isMacLike = platform === 'macOS' || /Mac/i.test(ua);
    return isMacLike && navigator.maxTouchPoints > 1;
})();
const _isMac = ((): boolean => {
    if (!isBrowser) return false;
    
    const platform = getPlatformData();
    if (platform === 'macOS' || platform === 'iOS') return true;
    // fallback to userAgent check for older browsers or if userAgentData is unavailable
    return /Mac|iPod|iPhone|iPad/i.test(getUserAgent());
})();

const _isTouchDevice = ((): boolean => {
    if (!isBrowser) return false;    
    return ( navigator.maxTouchPoints > 0 );
})();

export const isMac = (): boolean => _isMac;
export const isIOS = (): boolean => _isIOS;
export const isTouchDevice = (): boolean => _isTouchDevice;