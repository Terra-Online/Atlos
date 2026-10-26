import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import NotifyModal from './notify';
import type { NotificationItem, NotificationListResult } from '@/services/notifications/client';
import { useAuthStore } from '@/store/auth';
import { deferred } from '../../../test-support/pages';
import { installResizeObserver } from '../../../test-support/browser';

const api = vi.hoisted(() => ({ list: vi.fn(), read: vi.fn(), readAll: vi.fn(), unread: vi.fn(), navigate: vi.fn(), marker: vi.fn(), auth: vi.fn(),
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
    const view = render(<NotifyModal open onClose={close} onUnreadChange={unread} />); await flush();
    const live = { notification: item('live'), unread: counts(7, 4) };
    view.rerender(<NotifyModal open onClose={close} onUnreadChange={unread} liveUpdate={live} />);
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
