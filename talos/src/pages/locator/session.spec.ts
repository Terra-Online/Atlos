import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/store/auth';
import { useUiPrefsStore } from '@/store/uiPrefs';
import { useLocatorStore } from '@/store/locator';
import type { EFBindingSummary, EFTrackerConf } from '@/services/endfield';
import { deferred } from '../../../test-support/pages';
import { enableSession, disableSession } from './session';

const api = vi.hoisted(() => ({ status: vi.fn(), cache: vi.fn(), config: null as EFTrackerConf | null }));
vi.mock('@/services/endfield', () => ({ getEFBindingStatus: api.status, readEFTrackerConf: () => api.config, saveEFTrackerConf: (next: EFTrackerConf) => { api.config = next; } }));
vi.mock('@/services/cache/backend', () => ({ getCachedSession: () => ({ hit: false, value: null }), setCachedSession: vi.fn(), setCachedBinding: api.cache }));
const initial = { auth: useAuthStore.getState(), prefs: useUiPrefsStore.getState(), locator: useLocatorStore.getState() };
const binding: EFBindingSummary = { bound: true, enabled: true, roleId: 'old-role', serverId: 1, provider: 'skport' };
beforeEach(() => {
    vi.useFakeTimers(); api.status.mockReset(); api.cache.mockClear();
    useAuthStore.setState({ sessionUser: { uid: 'a', nickname: 'A' }, sessionVersion: 0 });
    useUiPrefsStore.setState({ prefsLocatorSyncEnabled: false }); useLocatorStore.setState({ viewMode: 'off' });
    api.config = { enabled: false, locatorSync: false, baseUrl: 'skport', roleId: 'old-role', serverId: 1, scope: ['balanced'] };
});
afterEach(() => { useAuthStore.setState(initial.auth, true); useUiPrefsStore.setState(initial.prefs, true); useLocatorStore.setState(initial.locator, true); vi.useRealTimers(); });

it.each(['relogin', 'account-roundtrip', 'disable'] as const)('does not enable tracking from an old status after %s', async (boundary) => {
    const pending = deferred<{ binding: EFBindingSummary }>(); api.status.mockReturnValue(pending.promise);
    const enable = enableSession();
    if (boundary === 'disable') disableSession();
    else {
        useAuthStore.setState({ sessionUser: boundary === 'relogin' ? null : { uid: 'b', nickname: 'B' }, sessionVersion: 1 });
        useAuthStore.setState({ sessionUser: { uid: 'a', nickname: 'A' }, sessionVersion: 2 });
    }
    pending.resolve({ binding });
    expect(await enable).toBeUndefined();
    expect(api.cache).not.toHaveBeenCalled();
    expect(api.config?.enabled).toBe(false);
    expect(useUiPrefsStore.getState().prefsLocatorSyncEnabled).toBe(false);
    expect(useLocatorStore.getState().viewMode).toBe('off');
});

it('uses current preferences and the valid binding when enabling succeeds', async () => {
    const pending = deferred<{ binding: EFBindingSummary }>(); api.status.mockReturnValue(pending.promise);
    const enable = enableSession();
    api.config = { ...api.config!, scope: ['collection'], centerOnPosition: true };
    pending.resolve({ binding });
    expect(await enable).toBe(true);
    expect(api.cache).toHaveBeenCalledWith('a', binding);
    expect(api.config).toMatchObject({ enabled: true, scope: ['collection'], centerOnPosition: true });
    expect(useLocatorStore.getState().viewMode).toBe('tracking');
});

it('does not activate after the initiating UI owner disappears', async () => {
    const pending = deferred<{ binding: EFBindingSummary }>(); api.status.mockReturnValue(pending.promise);
    let current = true;
    const enable = enableSession(() => current);
    current = false;
    pending.resolve({ binding });
    expect(await enable).toBeUndefined();
    expect(api.cache).not.toHaveBeenCalled();
    expect(api.config?.enabled).toBe(false);
});

it('reports an unbound current account separately from cancellation', async () => {
    api.status.mockResolvedValue({ binding: { bound: false, enabled: false } });
    expect(await enableSession()).toBe(false);
    expect(useLocatorStore.getState().viewMode).toBe('off');
});


it('retries status errors without changing tracking until a valid binding is known', async () => {
    api.status.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ binding });
    const pending = enableSession();
    await vi.advanceTimersByTimeAsync(0);
    expect(useLocatorStore.getState().viewMode).toBe('off');
    expect(api.cache).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(800);
    expect(await pending).toBe(true);
    expect(api.status).toHaveBeenCalledTimes(2);
    expect(useLocatorStore.getState().viewMode).toBe('tracking');
});

it.each(['disable', 'account-switch', 'owner-close'] as const)('stops status retries after %s', async (boundary) => {
    api.status.mockRejectedValue(new Error('offline'));
    const controller = new AbortController();
    const pending = enableSession(() => true, controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    if (boundary === 'disable') disableSession();
    else if (boundary === 'account-switch') useAuthStore.getState().setSessionUser({ uid: 'b', nickname: 'B' });
    else controller.abort();
    expect(await pending).toBeUndefined();
    await vi.advanceTimersByTimeAsync(2400);
    expect(api.status).toHaveBeenCalledOnce();
    expect(api.config?.enabled).toBe(false);
});
