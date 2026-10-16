import { expect, it, vi } from 'vitest';
import { getAuthGate, loadAuthGate } from './authEntry';

const loader = vi.hoisted(() => {
    let release!: () => void;
    return {
        ready: new Promise<void>((resolve) => {
            release = resolve;
        }),
        release: () => release(),
        loads: vi.fn(),
        Gate: () => null,
    };
});
vi.mock('./authGate', async () => {
    loader.loads();
    await loader.ready;
    return { default: loader.Gate };
});

it('keeps auth conditional, shares an in-flight load, and makes a loaded gate available on remount', async () => {
    expect(loader.loads).not.toHaveBeenCalled();
    expect(getAuthGate()).toBeNull();
    const prefetched = loadAuthGate();
    const mounted = loadAuthGate();
    expect(mounted).toBe(prefetched);
    await vi.waitFor(() => expect(loader.loads).toHaveBeenCalledOnce());
    expect(getAuthGate()).toBeNull();
    loader.release();
    expect(await mounted).toBe(loader.Gate);
    expect(getAuthGate()).toBe(loader.Gate);
    expect(await loadAuthGate()).toBe(loader.Gate);
    expect(loader.loads).toHaveBeenCalledOnce();
});
