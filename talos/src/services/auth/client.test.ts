import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthFlowError, exchangeAuthCode, fetchSessionUser, logoutUser } from './client';

vi.mock('better-auth/client', () => ({ createAuthClient: () => ({}) }));
vi.mock('@/locale', () => ({ getCurrentLocale: () => 'en' }));

describe('session requests', () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
        vi.useFakeTimers();
        fetchMock.mockReset();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('includes cookies and bypasses caches', async () => {
        fetchMock.mockResolvedValue(new Response(JSON.stringify({ user: { uid: 'user', nickname: 'Tester' } })));
        expect(await fetchSessionUser()).toMatchObject({ uid: 'user', nickname: 'Tester' });
        expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/auth/v1/session'), expect.objectContaining({
            credentials: 'include',
            cache: 'no-store',
        }));
        const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
        expect(requestInit.signal).toBeInstanceOf(AbortSignal);
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each([429, 500, 502, 503])('does not treat HTTP %s as a logout', async (status) => {
        fetchMock.mockResolvedValue(new Response('{}', { status }));
        await expect(fetchSessionUser()).rejects.toBeInstanceOf(AuthFlowError);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('returns null for a confirmed 401', async () => {
        fetchMock.mockResolvedValue(new Response('{}', { status: 401 }));
        expect(await fetchSessionUser()).toBeNull();
    });

    it('confirms the browser cookie and account identity after OAuth exchange', async () => {
        fetchMock
            .mockResolvedValueOnce(new Response(JSON.stringify({ user: { uid: 'verified', nickname: 'Verified' } })))
            .mockResolvedValueOnce(new Response(JSON.stringify({ user: { uid: 'verified', nickname: 'Verified' } })));
        expect(await exchangeAuthCode('test-code')).toMatchObject({ uid: 'verified' });
        expect(fetchMock).toHaveBeenNthCalledWith(1, expect.stringContaining('/session/exchange'), expect.objectContaining({
            method: 'POST', credentials: 'include',
        }));
        expect(fetchMock).toHaveBeenNthCalledWith(2, expect.stringContaining('/auth/v1/session'), expect.objectContaining({
            method: 'GET', credentials: 'include',
        }));
    });

    it('does not report OAuth success for a different account left in an old cookie', async () => {
        fetchMock
            .mockResolvedValueOnce(new Response(JSON.stringify({ user: { uid: 'new-user', nickname: 'New' } })))
            .mockResolvedValueOnce(new Response(JSON.stringify({ user: { uid: 'old-user', nickname: 'Old' } })));
        await expect(exchangeAuthCode('test-code')).rejects.toMatchObject({ code: 'SESSION_COOKIE_REQUIRED' });
    });

    it('silently confirms a migrated cookie with one additional request', async () => {
        const user = { uid: 'user', nickname: 'Tester' };
        fetchMock
            .mockResolvedValueOnce(new Response(JSON.stringify({ user, requiresCookieConfirmation: true })))
            .mockResolvedValueOnce(new Response(JSON.stringify({ user })));
        expect(await fetchSessionUser()).toMatchObject(user);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('does not loop indefinitely when a browser rejects a migrated cookie', async () => {
        const payload = JSON.stringify({ user: { uid: 'user', nickname: 'Tester' }, requiresCookieConfirmation: true });
        fetchMock.mockImplementation(() => Promise.resolve(new Response(payload)));
        await expect(fetchSessionUser()).rejects.toMatchObject({ code: 'SESSION_COOKIE_REQUIRED' });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('does not report OAuth success when partitioned cookies were rejected', async () => {
        fetchMock
            .mockResolvedValueOnce(new Response(JSON.stringify({ user: { uid: 'user', nickname: 'Tester' } })))
            .mockResolvedValueOnce(new Response('{}', { status: 401 }));
        await expect(exchangeAuthCode('test-code')).rejects.toMatchObject({ code: 'SESSION_COOKIE_REQUIRED' });
    });

    it('does not hide a failed cookie confirmation behind an exchanged profile', async () => {
        fetchMock
            .mockResolvedValueOnce(new Response(JSON.stringify({ user: { uid: 'user', nickname: 'Tester' } })))
            .mockRejectedValue(new TypeError('Network error'));
        const result = expect(exchangeAuthCode('test-code')).rejects.toThrow('Network error');
        await vi.advanceTimersByTimeAsync(3000);
        await result;
        expect(fetchMock.mock.calls.filter((call) => (call[1] as RequestInit | undefined)?.method === 'POST')).toHaveLength(1);
        expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it('sends partitioned cookies when signing out', async () => {
        fetchMock.mockResolvedValue(new Response('{}'));
        await logoutUser();
        expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/auth/v1/sign-out'), expect.objectContaining({
            method: 'POST', credentials: 'include',
        }));
    });

    it('does not interpret a malformed successful response as logout', async () => {
        fetchMock.mockResolvedValue(new Response('{}'));
        await expect(fetchSessionUser()).rejects.toThrow('Session payload does not contain user info.');
    });

    it('aborts a stalled request after 15 seconds so later attempts can recover', async () => {
        fetchMock.mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }));
        const rejection = expect(fetchSessionUser()).rejects.toMatchObject({ code: 'TIMEOUT' });
        await vi.advanceTimersByTimeAsync(15_000);
        await rejection;
        expect(vi.getTimerCount()).toBe(0);
    });

    it('retries only session reads and honors Retry-After before confirming the same identity', async () => {
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ user: { uid: 'verified', nickname: 'Verified' } })))
            .mockResolvedValueOnce(new Response('{}', { status: 503, headers: { 'retry-after': '5' } }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ user: { uid: 'verified', nickname: 'Verified' } })));
        const pending = exchangeAuthCode('test-code');
        await vi.advanceTimersByTimeAsync(4999);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(1);
        expect(await pending).toMatchObject({ uid: 'verified' });
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('does not accept a different email after password sign-in', async () => {
        fetchMock.mockResolvedValue(new Response(JSON.stringify({ user: { uid: 'old', nickname: 'Old', email: 'old@example.test' } })));
        await expect(fetchSessionUser({ retry: true, expectedEmail: 'new@example.test' }))
            .rejects.toMatchObject({ code: 'SESSION_COOKIE_REQUIRED' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('cancels a pending confirmation retry without another request', async () => {
        fetchMock.mockResolvedValue(new Response('{}', { status: 503 }));
        const controller = new AbortController();
        const result = expect(fetchSessionUser({ retry: true, signal: controller.signal })).rejects.toBeDefined();
        await vi.advanceTimersByTimeAsync(0);
        controller.abort();
        await result;
        await vi.advanceTimersByTimeAsync(3000);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('never replays an exchange with an unknown network outcome', async () => {
        fetchMock.mockRejectedValue(new TypeError('Network error'));
        await expect(exchangeAuthCode('test-code')).rejects.toThrow('Network error');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('bounds a stalled exchange without replaying it or leaving confirmation paused forever', async () => {
        fetchMock.mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }));
        const result = expect(exchangeAuthCode('test-code')).rejects.toMatchObject({ code: 'TIMEOUT' });
        await vi.advanceTimersByTimeAsync(15_000);
        await result;
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });
});
