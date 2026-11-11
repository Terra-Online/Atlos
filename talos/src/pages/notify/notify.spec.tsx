import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import NotifyModal from './notify';
import type { NotificationItem, NotificationListResult, subscribeNotificationLive } from '@/services/notifications/client';
import { useAuthStore } from '@/store/auth';
import { deferred } from '../../../test-support/pages';
import { installResizeObserver } from '../../../test-support/browser';

const api = vi.hoisted(() => ({ live: null as Parameters<typeof subscribeNotificationLive>[0] | null, stop: vi.fn(), subscribe: vi.fn(), list: vi.fn(), read: vi.fn(), readAll: vi.fn(), unread: vi.fn(), navigate: vi.fn(), marker: vi.fn(), auth: vi.fn(),
    t: (key: string) => key.startsWith('notification.types.') ? '<subjectTag>{subject}</subjectTag> <pointTag>{point}</pointTag>' : key === 'notification.guest' ? 'Please sign in with {account}.' : key }));
vi.mock('@/locale', () => ({ useTranslateUI: () => api.t, useTranslateGame: () => api.t, useLocale: () => 'en-US' }));
vi.mock('@/locale/useFontRegion', () => ({ useFontRegion: () => () => {} }));
vi.mock('@/platform/device', () => ({ useDevice: () => ({ isMobile: false }) }));
vi.mock('@/platform/pictureInPicture', () => ({ useAppDocument: () => document, getOpenerDocument: () => document }));
vi.mock('@/component/effects/AdaptiveLinearBlur', () => ({ default: () => null }));
vi.mock('@/store/auth', async () => {
    const { create } = await import('zustand');
    return { useAuthStore: create<{ sessionUser: { uid: string; nickname: string } | null; sessionVersion: number }>(() => ({ sessionUser: null, sessionVersion: 0 })) };
});
vi.mock('@/component/shared/account/authEvents', () => ({ openOemAuthModal: api.auth }));
vi.mock('@/services/map', () => ({ navigateToMarkerId: api.navigate }));
vi.mock('@/data/marker', async (original) => ({ ...await original<typeof import('@/data/marker')>(), findMarkerById: api.marker }));
vi.mock('@/services/notifications/client', async (original) => ({ ...await original<typeof import('@/services/notifications/client')>(),
    subscribeNotificationLive: (callbacks: Parameters<typeof subscribeNotificationLive>[0]) => { api.live = callbacks; api.subscribe(); return api.stop; },
    listNotifications: api.list, markNotificationsRead: api.read, markAllNotificationsRead: api.readAll, getNotificationUnreadCounts: api.unread }));

const counts = (community = 2, system = 1) => ({ community, system, total: community + system });
const item = (id: string, overrides: Partial<NotificationItem> = {}): NotificationItem => ({ id, type: 'community.comment.reply', payload: { kind: 'comment' },
    target: { markerId: null, poiType: null, poiHash: null, parentSubmissionId: null, submissionId: null },
    createdAt: '2026-10-27T00:00:00Z', readAt: null, isMultiMsg: false, messages: [], ...overrides });
const result = (items: NotificationItem[] = [], nextCursor: string | null = null): NotificationListResult => ({ items, nextCursor, unread: counts() });
const flush = async () => act(async () => { await Promise.resolve(); });
beforeEach(() => {
    vi.clearAllMocks(); installResizeObserver(); useAuthStore.setState({ sessionUser: { uid: 'a', nickname: 'A' }, sessionVersion: 0 });
    api.list.mockResolvedValue(result()); api.read.mockResolvedValue(counts(1)); api.readAll.mockResolvedValue(counts(0, 0)); api.unread.mockResolvedValue(counts(0, 0)); api.marker.mockResolvedValue(null); api.navigate.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('avoids authenticated reads for guests and routes the account action through the shared auth flow', () => {
    useAuthStore.setState({ sessionUser: null }); const close = vi.fn(), change = vi.fn();
    render(<NotifyModal open onClose={close} onChange={change} />);
    expect(api.list).not.toHaveBeenCalled();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'notification.markAllRead' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'notification.account' }));
    expect(close).toHaveBeenCalledOnce(); expect(change).toHaveBeenCalledExactlyOnceWith(false); expect(api.auth).toHaveBeenCalledExactlyOnceWith('login');
});

it('loads both feeds on intent, appends pages without duplicate cards and allows category switching', async () => {
    api.list.mockImplementation((category: string, options: { cursor: string | null }) => Promise.resolve(category === 'system'
        ? result([item('system', { type: 'system.submission.approved' })])
        : options.cursor ? result([item('first'), item('second')]) : result([item('first')], 'page-2')));
    const view = render(<NotifyModal open={false} onClose={vi.fn()} />);
    expect(api.list).not.toHaveBeenCalled();
    view.rerender(<NotifyModal open onClose={vi.fn()} />); await flush();
    expect(api.list).toHaveBeenCalledWith('community', { cursor: null, limit: 20 });
    expect(api.list).toHaveBeenCalledWith('system', { cursor: null, limit: 20 });
    expect(document.querySelectorAll('[data-notification-id]')).toHaveLength(1);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'notification.loadMore' })); await Promise.resolve(); });
    expect(api.list).toHaveBeenLastCalledWith('community', { cursor: 'page-2', limit: 20 });
    expect([...document.querySelectorAll('[data-notification-id]')].map((node) => node.getAttribute('data-notification-id'))).toEqual(['first', 'second']);
    fireEvent.click(screen.getByRole('tab', { name: 'notification.tabs.system (1)' }));
    expect(document.querySelector('[data-notification-id="system"]')).toBeTruthy();
    expect(document.querySelector('[data-notification-id="first"]')).toBeNull();
});

it('preserves a live item and its newer unread counts when an older list request resolves', async () => {
    const pending = deferred<NotificationListResult>();
    api.list.mockImplementation((category: string) => category === 'community' ? pending.promise : Promise.resolve(result()));
    const unread = vi.fn(); const close = vi.fn();
    render(<NotifyModal open onClose={close} onUnreadChange={unread} />); await flush();
    const live = { notification: item('live'), unread: counts(7, 4) };
    act(() => { api.live!.onUpdate(live); });
    await act(async () => { pending.resolve(result([item('old')])); await pending.promise; });
    expect([...document.querySelectorAll('[data-notification-id]')].map((node) => node.getAttribute('data-notification-id'))).toEqual(['live', 'old']);
    expect(unread).toHaveBeenLastCalledWith(counts(7, 4));
});

it('batches an explicitly read card and navigates its content without losing the target or duplicating close callbacks', async () => {
    vi.useFakeTimers();
    const target = item('target', { target: { markerId: 'marker', submissionId: ' image ', parentSubmissionId: null, poiType: 'crate', poiHash: null }, payload: { kind: 'image' } });
    api.list.mockResolvedValue(result([target])); const close = vi.fn(), change = vi.fn();
    render(<NotifyModal open onClose={close} onChange={change} />); await flush();
    fireEvent.click(screen.getByRole('button', { name: 'notification.subject.image' }));
    expect(api.navigate).toHaveBeenCalledExactlyOnceWith('marker', { content: { kind: 'image', id: 'image' } });
    expect(close).toHaveBeenCalledOnce(); expect(change).toHaveBeenCalledExactlyOnceWith(false);
    expect(document.querySelector('[data-notification-id="target"]')?.getAttribute('data-unread')).toBe('false');
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(api.read).toHaveBeenCalledExactlyOnceWith('community', ['target']);
});

it('renders load failures and recovers on reopening without treating failures as empty success', async () => {
    api.list.mockRejectedValue(new Error('offline')); const close = vi.fn();
    const view = render(<NotifyModal open onClose={close} />); await flush();
    expect(screen.getByText('notification.loadError')).toBeTruthy();
    expect(screen.queryByText('notification.empty')).toBeNull();
    view.rerender(<NotifyModal open={false} onClose={close} />);
    api.list.mockResolvedValue(result()); view.rerender(<NotifyModal open onClose={close} />); await flush();
    expect(screen.getByText('notification.empty')).toBeTruthy();
});

it('discards old-account list and mark-all completions and releases the next account to act', async () => {
    const list = deferred<NotificationListResult>(), markAll = deferred<unknown>();
    api.list.mockImplementation((category: string) => category === 'community' ? Promise.resolve(result([item('account-a')])) : list.promise);
    api.readAll.mockReturnValue(markAll.promise);
    const close = vi.fn(), unread = vi.fn(); render(<NotifyModal open onClose={close} onUnreadChange={unread} />); await flush();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'notification.markAllRead' })); await Promise.resolve(); });
    api.list.mockResolvedValue(result([item('account-b')]));
    act(() => { useAuthStore.setState({ sessionUser: { uid: 'b', nickname: 'B' } }); }); await flush();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'notification.markAllRead' }).disabled).toBe(false);
    await act(async () => { list.resolve(result([item('secret-a')])); markAll.resolve(counts(0, 0)); await Promise.all([list.promise, markAll.promise]); });
    expect(document.querySelector('[data-notification-id="account-b"]')?.getAttribute('data-unread')).toBe('true');
    expect(document.querySelector('[data-notification-id="secret-a"]')).toBeNull();
    expect(unread).toHaveBeenLastCalledWith(counts());
    expect(api.unread).not.toHaveBeenCalled();
});

it.each(['relogin', 'account-roundtrip'])('reloads and ignores old mark-all results after a batched %s', async (transition) => {
    const pending = deferred<unknown>(); api.readAll.mockReturnValue(pending.promise); api.list.mockResolvedValue(result([item('old-session')]));
    const unread = vi.fn(); render(<NotifyModal open onClose={vi.fn()} onUnreadChange={unread} />); await flush();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'notification.markAllRead' })); await Promise.resolve(); });
    api.list.mockResolvedValue(result([item('new-session')]));
    act(() => {
        useAuthStore.setState({ sessionUser: transition === 'relogin' ? null : { uid: 'b', nickname: 'B' }, sessionVersion: 1 });
        useAuthStore.setState({ sessionUser: { uid: 'a', nickname: 'A' }, sessionVersion: 2 });
    });
    await flush(); expect(screen.getByRole<HTMLButtonElement>('button', { name: 'notification.markAllRead' }).disabled).toBe(false);
    expect(document.querySelector('[data-notification-id="new-session"]')).toBeTruthy();
    await act(async () => { pending.resolve(counts(0, 0)); await pending.promise; });
    expect(api.unread).not.toHaveBeenCalled(); expect(unread).toHaveBeenLastCalledWith(counts());
    expect(document.querySelector('[data-notification-id="new-session"]')?.getAttribute('data-unread')).toBe('true');
});

it('recovers a notification marker label after a rejected lookup instead of caching the rejection', async () => {
    vi.useFakeTimers();
    const target = { markerId: 'retry-marker', poiType: null, poiHash: null, parentSubmissionId: null, submissionId: null };
    api.list.mockResolvedValue(result([item('retry', { target })]));
    api.marker.mockRejectedValueOnce(new Error('temporary shard load')).mockResolvedValueOnce({ id: 'retry-marker', type: 'crate_ii', subregId: 'VL_1', x: 0, y: 0, z: 0, tier: 0, pos: [0, 0] });
    render(<NotifyModal open onClose={vi.fn()} />); await flush();
    expect(api.marker).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(800); await Promise.resolve(); });
    expect(api.marker).toHaveBeenCalledTimes(2);
    expect(screen.getByText('(crate_ii)')).toBeTruthy();
});

it('stops notification marker retries after closing and treats a missing marker as a resolved mismatch', async () => {
    vi.useFakeTimers();
    const target = { markerId: 'cancel-retry-marker', poiType: null, poiHash: null, parentSubmissionId: null, submissionId: null };
    api.list.mockResolvedValue(result([item('cancel-retry', { target })]));
    api.marker.mockRejectedValueOnce(new Error('temporary shard load'));
    const close = vi.fn(); const view = render(<NotifyModal open onClose={close} />); await flush();
    expect(api.marker).toHaveBeenCalledTimes(1);
    view.rerender(<NotifyModal open={false} onClose={close} />);
    await act(async () => { vi.advanceTimersByTime(1000); await Promise.resolve(); });
    expect(api.marker).toHaveBeenCalledTimes(1);
    api.marker.mockResolvedValue(null);
    view.rerender(<NotifyModal open onClose={close} />); await flush();
    expect(api.marker).toHaveBeenCalledTimes(2);
    await act(async () => { vi.advanceTimersByTime(5000); await Promise.resolve(); });
    expect(api.marker).toHaveBeenCalledTimes(2);
});

const readChange = (ids: string[] | null, community = 0) => ({ category: 'community' as const, ids, readAt: '2026-10-28T00:00:00Z', unread: counts(community) });

it('applies every read event in a React batch without additional HTTP requests', async () => {
    api.list.mockImplementation((category: string) => Promise.resolve(result(category === 'community' ? [item('a'), item('b')] : [])));
    const unread = vi.fn(); render(<NotifyModal open onClose={vi.fn()} onUnreadChange={unread} />); await flush();
    const calls = api.list.mock.calls.length;
    act(() => { api.live!.onRead!(readChange(['a'], 1)); api.live!.onRead!(readChange(['b'])); });
    for (const id of ['a', 'b']) expect(document.querySelector(`[data-notification-id="${id}"]`)?.getAttribute('data-unread')).toBe('false');
    expect(unread).toHaveBeenLastCalledWith(counts(0));
    expect(api.list).toHaveBeenCalledTimes(calls);
    expect(api.unread).not.toHaveBeenCalled(); expect(api.read).not.toHaveBeenCalled();
});

it('applies read-all to an older pending page without marking newer notifications read', async () => {
    const pending = deferred<NotificationListResult>();
    api.list.mockImplementation((category: string) => category === 'community' ? pending.promise : Promise.resolve(result()));
    const unread = vi.fn(); render(<NotifyModal open onClose={vi.fn()} onUnreadChange={unread} />); await flush();
    act(() => {
        api.live!.onRead!(readChange(null));
        api.live!.onUpdate({ notification: item('new', { createdAt: '2026-10-29T00:00:00Z' }), unread: counts(1) });
    });
    await act(async () => { pending.resolve(result([item('old')])); await pending.promise; });
    expect(document.querySelector('[data-notification-id="old"]')?.getAttribute('data-unread')).toBe('false');
    expect(document.querySelector('[data-notification-id="new"]')?.getAttribute('data-unread')).toBe('true');
    expect(unread).toHaveBeenLastCalledWith(counts(1));
});

it('updates the closed badge, moves subscriptions with sessions and rejects old callbacks', async () => {
    const unread = vi.fn(); const view = render(<NotifyModal open={false} onClose={vi.fn()} onUnreadChange={unread} />);
    const old = api.live!;
    act(() => { old.onReady!(counts()); old.onRead!(readChange(null)); });
    expect(unread).toHaveBeenLastCalledWith(counts(0)); expect(api.list).not.toHaveBeenCalled();
    act(() => {
        useAuthStore.setState({ sessionUser: null });
        old.onRead!(readChange(null, 99));
    });
    expect(api.stop).toHaveBeenCalledOnce();
    expect(unread).toHaveBeenLastCalledWith(counts(0, 0));
    act(() => { useAuthStore.setState({ sessionUser: { uid: 'b', nickname: 'B' } }); });
    expect(api.subscribe).toHaveBeenCalledTimes(2);
    act(() => { old.onReady!(counts(99)); api.live!.onReady!(counts(4)); });
    expect(unread).toHaveBeenLastCalledWith(counts(4));
    view.rerender(<NotifyModal open onClose={vi.fn()} onUnreadChange={unread} />); await flush();
    const calls = api.list.mock.calls.length;
    act(() => { api.live!.onOpen!(); }); await flush();
    expect(api.list).toHaveBeenCalledTimes(calls + 2);
    view.unmount(); expect(api.stop).toHaveBeenCalledTimes(2);
});

it('does not mark a newer aggregate read when an older read event arrives', async () => {
    api.list.mockResolvedValue(result([item('group')]));
    render(<NotifyModal open onClose={vi.fn()} />); await flush();
    act(() => {
        api.live!.onUpdate({ notification: item('group', { createdAt: '2026-10-29T00:00:00Z', isMultiMsg: true, messages: [item('child')] }), unread: counts(1) });
        api.live!.onRead!(readChange(['group'], 1));
    });
    expect(document.querySelector('[data-notification-id="group"]')?.getAttribute('data-unread')).toBe('true');
});

it('refreshes missed read state even when ready arrives during the inbox reload', async () => {
    api.list.mockImplementation((category: string) => Promise.resolve(result(category === 'community' ? [item('missed')] : [])));
    const close = vi.fn(), unread = vi.fn();
    const view = render(<NotifyModal open onClose={close} onUnreadChange={unread} />); await flush();
    view.rerender(<NotifyModal open={false} onClose={close} onUnreadChange={unread} />);
    const pending = deferred<NotificationListResult>();
    api.list.mockImplementation((category: string) => category === 'community' ? pending.promise : Promise.resolve(result()));
    view.rerender(<NotifyModal open onClose={close} onUnreadChange={unread} />); await flush();
    act(() => { api.live!.onReady!(counts(0, 0)); });
    await act(async () => { pending.resolve(result([item('missed', { readAt: '2026-10-28T00:00:00Z' })])); await pending.promise; });
    expect(document.querySelector('[data-notification-id="missed"]')?.getAttribute('data-unread')).toBe('false');
    expect(unread).toHaveBeenLastCalledWith(counts(0, 0));
});

it('ignores a pre-reconnect page that resolves after the refreshed page', async () => {
    const stale = deferred<NotificationListResult>();
    api.list.mockImplementation((category: string) => category === 'community' ? stale.promise : Promise.resolve(result()));
    render(<NotifyModal open onClose={vi.fn()} />); await flush();
    api.list.mockResolvedValue(result([item('recovered', { readAt: '2026-10-28T00:00:00Z' })]));
    act(() => { api.live!.onOpen!(); }); await flush();
    await act(async () => { stale.resolve(result([item('recovered')])); await stale.promise; });
    expect(document.querySelector('[data-notification-id="recovered"]')?.getAttribute('data-unread')).toBe('false');
});
