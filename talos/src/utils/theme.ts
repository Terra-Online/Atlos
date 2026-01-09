export type Theme = 'light' | 'dark';
export type ThemeMode = 'light' | 'dark' | 'auto';

interface ThemeManager {
    invertRef: { current: boolean };
    switchingRef: { current: boolean };
    unsubRef: { current: (() => void) | null };
}

const manager: ThemeManager = {
    invertRef: { current: false },
    switchingRef: { current: false },
    unsubRef: { current: null },
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
};
