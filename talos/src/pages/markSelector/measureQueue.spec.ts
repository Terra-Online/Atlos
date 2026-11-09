import { afterEach, expect, it, vi } from 'vitest';
import { measureSelector } from '@/pages/markSelector/measureQueue';
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
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

it('limits layout reads per frame and completes the reads before any writes', () => {
    const frames: FrameRequestCallback[] = [], log: string[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.push(callback); return frames.length; });
    const cleanup = Array.from({ length: 25 }, (_, index) => measureSelector(() => {
        log.push(`read:${index}`);
        return () => log.push(`write:${index}`);
    }));
    frames.shift()!(0);
    expect(log).toHaveLength(48);
    expect(log.slice(0, 24)).toEqual(Array.from({ length: 24 }, (_, index) => `read:${index}`));
    expect(log.slice(24)).toEqual(Array.from({ length: 24 }, (_, index) => `write:${index}`));
    frames.shift()!(16);
    expect(log.slice(-2)).toEqual(['read:24', 'write:24']);
    cleanup.forEach(cancel => cancel());
});
