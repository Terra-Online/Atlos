import { afterEach, expect, it, vi } from 'vitest';
import { measureSelector } from './measureQueue';
afterEach(() => vi.unstubAllGlobals());
it('completes every layout read before publishing component state', () => {
    const frames: FrameRequestCallback[] = [], order: string[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    measureSelector(() => { order.push('read a'); return () => { order.push('write a'); }; });
    const cancel = measureSelector(() => { order.push('cancelled'); return undefined; });
    measureSelector(() => { order.push('read b'); return () => { order.push('write b'); }; });
    cancel(); frames.shift()?.(0); frames.shift()?.(16);
    expect(order).toEqual(['read a', 'read b', 'write a', 'write b']);
});
