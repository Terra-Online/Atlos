import { afterEach, expect, it, vi } from 'vitest';

const startup = vi.hoisted(() => ({ failures: 2, fonts: vi.fn(() => Promise.resolve()) }));
vi.mock('@main/locale/fontLoader', () => ({ switchFontRegion: startup.fonts }));
vi.mock('@main/lib/async/retryLoad', async (original) => {
    const { retryLoad } = await original<typeof import('@main/lib/async/retryLoad')>();
    return { retryLoad: <T>(load: () => Promise<T>, options: Parameters<typeof retryLoad>[1]) => retryLoad(() => startup.failures-- > 0 ? Promise.reject(new Error('catalog unavailable')) : load(), options) };
});

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
it('recovers the user-hub startup catalog after repeated load failures without replaying fonts', async () => {
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
    expect(locale.translateUI('userHub.tabs.profile')).not.toBe('');
    expect(startup.fonts).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledTimes(2);
});
