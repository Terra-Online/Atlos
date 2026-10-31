import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionUser } from './types';
import { SESSION_REVALIDATE_EVENT } from './sessionEvents';

const fetchSessionUserMock = vi.hoisted(() => vi.fn());
vi.mock('./client', () => ({ fetchSessionUser: fetchSessionUserMock }));

const user: SessionUser = { uid: 'session-user', nickname: 'Tester' };
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

describe('session lifecycle', () => {
    let lifecycle: typeof import('./sessionLifecycle');
    let store: typeof import('@/store/auth').useAuthStore;
    let stop: (() => void) | undefined;

    beforeEach(async () => {
        vi.resetModules();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-05T00:00:00.000Z'));
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
        window.history.replaceState({}, '', '/');
        fetchSessionUserMock.mockReset().mockResolvedValue(user);
        store = (await import('@/store/auth')).useAuthStore;
        lifecycle = await import('./sessionLifecycle');
    });

    afterEach(() => {
        stop?.();
        stop = undefined;
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('deduplicates concurrent checks and updates the store', async () => {
        const first = lifecycle.refreshSessionUser();
        const second = lifecycle.refreshSessionUser();
        expect(first).toBe(second);
        await first;
        expect(fetchSessionUserMock).toHaveBeenCalledTimes(1);
        expect(store.getState().sessionUser).toEqual(user);
    });

    it('keeps the same account owner across background session refreshes', async () => {
        store.getState().setSessionUser(user);
        const ownerVersion = store.getState().sessionOwnerVersion;
        await lifecycle.refreshSessionUser();
        expect(store.getState().sessionOwnerVersion).toBe(ownerVersion);
        expect(store.getState().sessionVersion).toBeGreaterThan(0);
    });

    it('clears the user only when the session endpoint confirms no session', async () => {
        store.getState().setSessionUser(user);
        fetchSessionUserMock.mockResolvedValue(null);
        await lifecycle.refreshSessionUser();
        expect(store.getState().sessionUser).toBeNull();
    });

    it('preserves the user on transient errors and allows another attempt', async () => {
        store.getState().setSessionUser(user);
        fetchSessionUserMock.mockRejectedValueOnce(new Error('Temporary failure'));
        await expect(lifecycle.refreshSessionUser()).rejects.toThrow('Temporary failure');
        expect(store.getState().sessionUser).toEqual(user);
        await lifecycle.refreshSessionUser();
        expect(fetchSessionUserMock).toHaveBeenCalledTimes(2);
    });

    it('does not restore a logged-out user from a stale response', async () => {
        store.getState().setSessionUser(user);
        let resolveRequest!: (result: SessionUser | null) => void;
        fetchSessionUserMock.mockReturnValue(new Promise<SessionUser | null>((resolve) => {
            resolveRequest = resolve;
        }));
        const pending = lifecycle.refreshSessionUser();
        store.getState().clearSessionUser();
        resolveRequest(user);
        expect(await pending).toBeNull();
        expect(store.getState().sessionUser).toBeNull();
    });

    it('does not clear a newer login when an older request returns 401', async () => {
        let resolveRequest!: (result: SessionUser | null) => void;
        fetchSessionUserMock.mockReturnValue(new Promise<SessionUser | null>((resolve) => {
            resolveRequest = resolve;
        }));
        const pending = lifecycle.refreshSessionUser();
        store.getState().setSessionUser(user);
        resolveRequest(null);
        expect(await pending).toEqual(user);
        expect(store.getState().sessionUser).toEqual(user);
    });

    it('does not poll even when a page stays visible for 40 days', async () => {
        await lifecycle.refreshSessionUser();
        stop = lifecycle.startSessionRefresh();
        expect(vi.getTimerCount()).toBe(0);
        await vi.advanceTimersByTimeAsync(40 * DAY_MS);
        expect(fetchSessionUserMock).toHaveBeenCalledTimes(1);
    });

    it('does not check a healthy session again for 24 hours despite repeated activity', async () => {
        await lifecycle.refreshSessionUser();
        stop = lifecycle.startSessionRefresh();
        for (let hour = 1; hour < 24; hour += 1) {
            await vi.advanceTimersByTimeAsync(60 * MINUTE_MS);
            window.dispatchEvent(new Event('focus'));
            document.dispatchEvent(new Event('visibilitychange'));
            window.dispatchEvent(new Event('online'));
            window.dispatchEvent(new Event('pointerdown'));
            window.dispatchEvent(new Event('keydown'));
            window.dispatchEvent(new Event('wheel'));
        }
        expect(fetchSessionUserMock).toHaveBeenCalledTimes(1);
    });

    it.each(['pointerdown', 'keydown', 'wheel', 'focus', 'online', 'visibilitychange'])(
        'checks once on %s after 24 hours, even if events arrive in a burst',
        async (eventType) => {
            await lifecycle.refreshSessionUser();
            stop = lifecycle.startSessionRefresh();
            await vi.advanceTimersByTimeAsync(DAY_MS);
            const target = eventType === 'visibilitychange' ? document : window;
            for (let index = 0; index < 10; index += 1) {
                target.dispatchEvent(new Event(eventType));
            }
            await vi.advanceTimersByTimeAsync(0);
            expect(fetchSessionUserMock).toHaveBeenCalledTimes(2);
            expect(vi.getTimerCount()).toBe(0);
        },
    );

    it('does not automatically check confirmed guests, including after business 401 events', async () => {
        fetchSessionUserMock.mockResolvedValue(null);
        await lifecycle.refreshSessionUser();
        stop = lifecycle.startSessionRefresh();
        await vi.advanceTimersByTimeAsync(40 * DAY_MS);
        for (const eventType of ['focus', 'online', 'pointerdown', 'keydown', 'wheel', SESSION_REVALIDATE_EVENT]) {
            window.dispatchEvent(new Event(eventType));
        }
        document.dispatchEvent(new Event('visibilitychange'));
        expect(fetchSessionUserMock).toHaveBeenCalledTimes(1);
        fetchSessionUserMock.mockResolvedValue(user);
        await lifecycle.refreshSessionUser();
        expect(fetchSessionUserMock).toHaveBeenCalledTimes(2);
        expect(store.getState().sessionUser).toEqual(user);
    });

    it('revalidates on return after 40 days and does not poll hidden or offline pages', async () => {
        await lifecycle.refreshSessionUser();
        stop = lifecycle.startSessionRefresh();
        const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        await vi.advanceTimersByTimeAsync(30 * MINUTE_MS);
        expect(fetchSessionUserMock).toHaveBeenCalledTimes(1);
        vi.setSystemTime(Date.now() + 40 * 24 * 60 * MINUTE_MS);
        visibility.mockReturnValue('visible');
        const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
        document.dispatchEvent(new Event('visibilitychange'));
        expect(fetchSessionUserMock).toHaveBeenCalledTimes(1);
        online.mockReturnValue(true);
        window.dispatchEvent(new Event('online'));
        await vi.advanceTimersByTimeAsync(0);
        expect(fetchSessionUserMock).toHaveBeenCalledTimes(2);
        expect(store.getState().sessionUser).toEqual(user);
    });

    it('retries a failed initial check on subsequent activity, with a one-minute cooldown', async () => {
        fetchSessionUserMock.mockRejectedValueOnce(new Error('Offline'));
        await expect(lifecycle.refreshSessionUser()).rejects.toThrow('Offline');
        stop = lifecycle.startSessionRefresh();
        window.dispatchEvent(new Event('online'));
        window.dispatchEvent(new Event('pointerdown'));
        expect(fetchSessionUserMock).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(MINUTE_MS);
        expect(fetchSessionUserMock).toHaveBeenCalledTimes(1);
        window.dispatchEvent(new Event('online'));
        await vi.advanceTimersByTimeAsync(0);
        expect(fetchSessionUserMock).toHaveBeenCalledTimes(2);
        expect(store.getState().sessionUser).toEqual(user);
    });

    it('skips automatic checks while an OAuth exchange code is pending', () => {
        window.history.replaceState({}, '', '/?auth_code=pending');
        lifecycle.revalidateSession();
        expect(fetchSessionUserMock).not.toHaveBeenCalled();
    });

    it('does not run background checks during an exchange after the code leaves the URL', () => {
        const resume = lifecycle.pauseSessionRefresh();
        lifecycle.revalidateSession();
        expect(fetchSessionUserMock).not.toHaveBeenCalled();
        resume();
        resume();
        lifecycle.revalidateSession();
        expect(fetchSessionUserMock).toHaveBeenCalledTimes(1);
    });

    it('ignores a stale pre-login response while confirming a newly signed-in email', async () => {
        let finishOld!: (user: SessionUser | null) => void;
        fetchSessionUserMock.mockReturnValueOnce(new Promise((resolve) => { finishOld = resolve; }));
        const old = lifecycle.refreshSessionUser();
        const signedIn = { ...user, email: 'new@example.test' };
        fetchSessionUserMock.mockResolvedValueOnce(signedIn);
        await lifecycle.refreshSessionUser('new@example.test');
        finishOld(null);
        await old;
        expect(store.getState().sessionUser).toEqual(signedIn);
        expect(fetchSessionUserMock).toHaveBeenLastCalledWith({ retry: true, expectedEmail: 'new@example.test' });
    });

    it('removes all activity and resume listeners on cleanup', async () => {
        const cleanup = lifecycle.startSessionRefresh();
        cleanup();
        await vi.advanceTimersByTimeAsync(30 * MINUTE_MS);
        window.dispatchEvent(new Event('focus'));
        window.dispatchEvent(new Event('online'));
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event('pointerdown'));
        window.dispatchEvent(new Event('keydown'));
        window.dispatchEvent(new Event('wheel'));
        store.getState().setSessionUser(user);
        window.dispatchEvent(new Event(SESSION_REVALIDATE_EVENT));
        expect(fetchSessionUserMock).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('revalidates a business 401 without replaying a mutation', async () => {
        await lifecycle.refreshSessionUser();
        stop = lifecycle.startSessionRefresh();
        await vi.advanceTimersByTimeAsync(MINUTE_MS);
        const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }));
        vi.stubGlobal('fetch', fetchMock);
        const { requestJson } = await import('@/services/http/request');
        await expect(requestJson('https://api.example.com', '/mutation', {
            method: 'POST',
            body: '{}',
        })).rejects.toThrow('HTTP 401');
        await vi.advanceTimersByTimeAsync(0);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchSessionUserMock).toHaveBeenCalledTimes(2);
        expect(store.getState().sessionUser).toEqual(user);
    });

    it('remembers a throttled business 401 and checks on later activity instead of waiting 24 hours', async () => {
        await lifecycle.refreshSessionUser();
        stop = lifecycle.startSessionRefresh();
        window.dispatchEvent(new Event(SESSION_REVALIDATE_EVENT));
        expect(fetchSessionUserMock).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(MINUTE_MS);
        expect(fetchSessionUserMock).toHaveBeenCalledTimes(1);
        window.dispatchEvent(new Event('pointerdown'));
        await vi.advanceTimersByTimeAsync(0);
        expect(fetchSessionUserMock).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(MINUTE_MS);
        window.dispatchEvent(new Event('pointerdown'));
        expect(fetchSessionUserMock).toHaveBeenCalledTimes(2);
    });
});
