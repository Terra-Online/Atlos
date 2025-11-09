export type Theme = 'light' | 'dark';

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
    localStorage.removeItem('theme');
    if (!manager.unsubRef.current) startSystemFollow(false);
    manager.invertRef.current = !manager.invertRef.current;
    const sys = getSystemTheme();
    applyTheme(manager.invertRef.current ? (sys === 'dark' ? 'light' : 'dark') : sys);
};

export const initTheme = () => {
    const saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark') {
        applyTheme(saved, false);
    } else {
        startSystemFollow();
    }
};

export const cleanupTheme = () => {
    manager.unsubRef.current?.();
};
