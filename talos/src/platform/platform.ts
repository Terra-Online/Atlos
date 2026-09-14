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
    if (platform === 'macOS') return !_isIOS;  // iPadOS reports macOS but has touch
    if (platform === 'iOS') return false;
    // Fallback: UA contains Mac but NOT a mobile iOS token
    return /Mac/i.test(getUserAgent()) && !/iPod|iPhone|iPad/i.test(getUserAgent());
})();

// True on any Apple platform that uses the Meta (⌘ / Command) modifier key.
// Use this instead of isMac() when deciding keyboard modifier behaviour.
const _isApplePlatform = _isMac || _isIOS;

const _isTouchDevice = ((): boolean => {
    if (!isBrowser) return false;    
    return ( navigator.maxTouchPoints > 0 );
})();

/** True when running on macOS desktop (not iOS / iPadOS). */
export const isMac = (): boolean => _isMac;

/** True when running on iOS (iPhone / iPad / iPod). */
export const isIOS = (): boolean => _isIOS;

/**
 * True on any Apple platform (macOS or iOS) that uses the Meta (⌘) modifier key.
 * Prefer this over `isMac()` when choosing between Meta and Ctrl for keyboard shortcuts.
 */
export const isApplePlatform = (): boolean => _isApplePlatform;

export const isTouchDevice = (): boolean => _isTouchDevice;