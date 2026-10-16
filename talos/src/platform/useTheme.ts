import { useSyncExternalStore } from 'react';
import type { Theme } from './theme';

const subscribe = (onChange: () => void) => {
    const observer = new MutationObserver(onChange);
    observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
};
const getTheme = (): Theme =>
    document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';

export const useTheme = (): Theme =>
    useSyncExternalStore(subscribe, getTheme, () => 'light');
