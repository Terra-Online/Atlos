import { vi } from 'vitest';
import { act } from 'react';

(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

export const flush = async (update: () => void): Promise<void> => {
    await act(async () => {
        update();
        await Promise.resolve();
    });
};

// jsdom has no layout observer; browser checks cover TabView indicator positioning.
vi.stubGlobal('ResizeObserver', class {
    observe() { return undefined; }
    unobserve() { return undefined; }
    disconnect() { return undefined; }
});
