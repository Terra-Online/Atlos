import { afterEach, expect, it, vi } from 'vitest';

const startup = vi.hoisted(() => ({ failures: 2, fonts: vi.fn(() => Promise.resolve()) }));
vi.mock('./fontLoader', () => ({ switchFontRegion: startup.fonts }));
vi.mock('@/lib/async/retryLoad', async (original) => {
    const { retryLoad } = await original<typeof import('@/lib/async/retryLoad')>();
    return { retryLoad: <T>(load: () => Promise<T>, options: Parameters<typeof retryLoad>[1]) => retryLoad(() => startup.failures-- > 0 ? Promise.reject(new Error('catalog unavailable')) : load(), options) };
});

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
it('recovers initial catalog loading without replaying fonts or rejecting the startup gate', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const locale = await import('./index');
    let ready = false;
    void locale.i18nInitPromise.then(() => { ready = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(ready).toBe(false);
    expect(startup.fonts).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1600);
    await locale.i18nInitPromise;
    expect(ready).toBe(true);
    expect(locale.translateUI('common.close')).not.toBe('');
    expect(startup.fonts).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledTimes(2);
});
