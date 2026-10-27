import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SESSION_REVALIDATE_EVENT } from '@/services/auth/sessionEvents';

let loadStatus: typeof import('./bindingStatus').loadBindingStatus;
const network = vi.fn<typeof fetch>();
const binding = { bound: true, enabled: true, roleId: 'current', serverId: 1 };

beforeEach(async () => {
    vi.resetModules(); vi.useFakeTimers(); network.mockReset();
    vi.stubGlobal('fetch', network);
    const { useAuthStore } = await import('@/store/auth');
    useAuthStore.getState().setSessionUser({ uid: 'current', nickname: 'Current' });
    ({ loadBindingStatus: loadStatus } = await import('./bindingStatus'));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it('retries a real decoded HTTP failure and returns the eventual binding without caching the rejection', async () => {
    network.mockResolvedValueOnce(Response.json({ message: 'unavailable' }, { status: 503 }))
        .mockResolvedValueOnce(Response.json({ binding }));
    const pending = loadStatus(new AbortController().signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(network).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(799);
    expect(network).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ binding });
    expect(network).toHaveBeenCalledTimes(2);
    const [url, options] = network.mock.calls[1];
    expect(url).toContain('/binding/v1/endfield/status');
    expect(options?.credentials).toBe('include');
});

it('cancels the real status retry after its owner closes', async () => {
    network.mockRejectedValue(new TypeError('offline'));
    const controller = new AbortController();
    const pending = loadStatus(controller.signal);
    const result = pending.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    expect(await result).toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(2400);
    expect(network).toHaveBeenCalledOnce();
});

it('preserves the real 401 error and requests session revalidation without retrying it', async () => {
    network.mockResolvedValue(Response.json({ error: { code: 'SESSION_REQUIRED', message: 'Sign in' } }, { status: 401 }));
    const revalidate = vi.fn(); window.addEventListener(SESSION_REVALIDATE_EVENT, revalidate);
    try {
        const failure = loadStatus(new AbortController().signal).catch((error: unknown) => error);
        await vi.advanceTimersByTimeAsync(2400);
        expect(await failure).toMatchObject({ status: 401, code: 'SESSION_REQUIRED', message: 'Sign in' });
        expect(network).toHaveBeenCalledOnce();
        expect(revalidate).toHaveBeenCalledOnce();
    } finally {
        window.removeEventListener(SESSION_REVALIDATE_EVENT, revalidate);
    }
});
