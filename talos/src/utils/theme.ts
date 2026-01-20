export type Theme = 'light' | 'dark';
export type ThemeMode = 'light' | 'dark' | 'auto';

interface ThemeManager {
    invertRef: { current: boolean };
    switchingRef: { current: boolean };
    unsubRef: { current: (() => void) | null };
    faviconUnsubRef: { current: (() => void) | null };
}

const manager: ThemeManager = {
    invertRef: { current: false },
    switchingRef: { current: false },
    unsubRef: { current: null },
    faviconUnsubRef: { current: null },
};

// Get stored theme preference from uiPrefs localStorage
const getStoredThemePreference = (): ThemeMode => {
    try {
        const stored = localStorage.getItem('ui-prefs');
        if (stored) {
            const parsed: unknown = JSON.parse(stored);
            if (parsed && typeof parsed === 'object' && 'state' in parsed) {
                const state = (parsed as { state?: unknown }).state;
                if (state && typeof state === 'object' && 'theme' in state) {
                    const theme = (state as { theme?: unknown }).theme;
                    if (theme === 'light' || theme === 'dark' || theme === 'auto') {
                        return theme;
                    }
                }
            }
        }
    } catch {
        // ignore parse errors
    }
    return 'auto';
};

const updateFavicons = (mode: Theme) => {
    const selectors = ['link[rel="icon"]', 'link[rel="apple-touch-icon"]'];
    
    selectors.forEach(sel => {
        document.querySelectorAll(sel).forEach((el) => {
            const link = el as HTMLLinkElement;
            const originalHref = link.getAttribute('href');
            if (!originalHref) return;

            // Remove _dark if present to get base name (e.g., favicon_dark.svg -> favicon.svg)
            let newHref = originalHref.replace(/_dark(\.[a-z0-9]+)$/i, '$1');
            
            if (mode === 'dark') {
                // Add _dark suffix (e.g., favicon.svg -> favicon_dark.svg)
                newHref = newHref.replace(/(\.[a-z0-9]+)$/i, '_dark$1');
            }
            
            // Only update if changed to avoid flickering
            if (newHref !== link.getAttribute('href')) {
                link.href = newHref;
            }
        });
    });
};

// Favicons should ALWAYS follow browser/system preference (prefers-color-scheme),
// independent from in-app theme switching (data-theme).
const startFaviconSystemFollow = () => {
    manager.faviconUnsubRef.current?.();

    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = (isDark: boolean) => updateFavicons(isDark ? 'dark' : 'light');

    // Apply once immediately
    apply(mql.matches);

    const listener = (e: MediaQueryListEvent) => {
        apply(e.matches);
    };

    if (mql.addEventListener) {
        mql.addEventListener('change', listener);
        manager.faviconUnsubRef.current = () => mql.removeEventListener('change', listener);
    } else if ('onchange' in mql) {
        mql.onchange = listener;
        manager.faviconUnsubRef.current = () => {
            mql.onchange = null;
        };
    }
};

export const applyTheme = (mode: Theme, withTransition = true) => {
    const root = document.documentElement;
    if (withTransition) {
        const dur = getComputedStyle(root).getPropertyValue('--theme-transition-duration').trim();
        const ms = /ms$/i.test(dur) ? parseFloat(dur) || 350 : 350;
        manager.switchingRef.current = true;
        root.setAttribute('data-theme-switching', '');
        setTimeout(() => {
            root.removeAttribute('data-theme-switching');
            manager.switchingRef.current = false;
        }, ms);
    }
    root.setAttribute('data-theme', mode);
};

export const getSystemTheme = (): Theme =>
    window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

export const startSystemFollow = (immediate = true) => {
    manager.unsubRef.current?.();
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
        const sys = mql.matches ? 'dark' : 'light';
        const theme = manager.invertRef.current ? (sys === 'dark' ? 'light' : 'dark') : sys;
        applyTheme(theme);
    };
    const listener = (e: MediaQueryListEvent) => {
        manager.invertRef.current = false; // reset invert on system change
        applyTheme(e.matches ? 'dark' : 'light');
    };
    if (immediate) apply();
    if (mql.addEventListener) {
        mql.addEventListener('change', listener);
        manager.unsubRef.current = () => mql.removeEventListener('change', listener);
    } else if ('onchange' in mql) {
        mql.onchange = listener;
        manager.unsubRef.current = () => { mql.onchange = null; };
    }
};

export const toggleTheme = () => {
    if (manager.switchingRef.current) return; // debounce: prevent interrupting animation
    // Toggle between light and dark, update store preference
    const current = document.documentElement.getAttribute('data-theme') as Theme;
    const next: Theme = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    // Update uiPrefs store (will be persisted)
    try {
        const stored = localStorage.getItem('ui-prefs');
        if (stored) {
            const parsed: unknown = JSON.parse(stored);
            if (parsed && typeof parsed === 'object' && 'state' in parsed) {
                const state = (parsed as { state?: unknown }).state;
                if (state && typeof state === 'object') {
                    (state as { theme: ThemeMode }).theme = next;
                    localStorage.setItem('ui-prefs', JSON.stringify(parsed));
                }
            }
        }
    } catch {
        // ignore
    }
};

export const initTheme = () => {
    // Always keep favicons synced to browser/system preference.
    // This is intentionally independent from in-app theme mode.
    startFaviconSystemFollow();

    const preference = getStoredThemePreference();
    if (preference === 'light' || preference === 'dark') {
        // User has a fixed preference, apply it directly
        applyTheme(preference, false);
    } else {
        // Auto mode: follow system
        startSystemFollow();
    }
};

export const cleanupTheme = () => {
    manager.unsubRef.current?.();
    manager.faviconUnsubRef.current?.();
};
