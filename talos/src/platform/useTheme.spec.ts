import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { useTheme } from './useTheme';
import { applyTheme, toggleTheme } from './theme';

(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

it('reflects actual theme through transition debounce and external changes', async () => {
    const node = document.createElement('div');
    const root = createRoot(node);
    const Label = () => createElement('span', null, useTheme());
    try {
        applyTheme('light', false);
        await act(async () => { root.render(createElement(Label)); await Promise.resolve(); });
        expect(node.textContent).toBe('light');
        await act(async () => {
            toggleTheme();
            toggleTheme();
            await Promise.resolve();
        });
        expect(node.textContent).toBe('dark');
        await act(async () => {
            applyTheme('light', false);
            await Promise.resolve();
        });
        expect(node.textContent).toBe('light');
    } finally {
        await act(async () => { root.unmount(); await Promise.resolve(); });
    }
});
