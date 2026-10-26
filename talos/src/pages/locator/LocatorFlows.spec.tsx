import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import LocationBinding from './LocationBinding';
import LocationAuth from './LocationAuth';
import LocationConfig from './LocationConfig';
import LocatorBanner from './LocatorBanner';
import EndfieldBindingHost from './EndfieldBindingHost';
import { requestEndfieldBinding, useLocatorStore } from '@/store/locator';
import { useUiPrefsStore } from '@/store/uiPrefs';
import { type EFBindingSummary, type EFRoleOption, type EFTrackerConf } from '@/services/endfield';
import { installResizeObserver } from '../../../test-support/browser';
import { deferred } from '../../../test-support/pages';
import { useAuthStore } from '@/store/auth';

const api = vi.hoisted(() => ({ exchange: vi.fn(), bind: vi.fn(), status: vi.fn(), agree: vi.fn(), unlink: vi.fn(), cache: vi.fn(), apply: vi.fn(), disable: vi.fn(), mobile: false,
    t: (key: string) => key, config: null as EFTrackerConf | null }));
vi.mock('@/locale', () => ({ useTranslateUI: () => api.t, useLocale: () => 'en-US' }));
vi.mock('@/locale/useFontRegion', () => ({ useFontRegion: () => () => {} }));
vi.mock('@/platform/device', () => ({ useDevice: () => ({ isMobile: api.mobile }) }));
vi.mock('@/platform/pictureInPicture', () => ({ useAppDocument: () => document, getOpenerDocument: () => document }));
vi.mock('@/component/effects/AdaptiveLinearBlur', () => ({ default: () => null }));
vi.mock('@/store/auth', async () => {
    const { create } = await import('zustand');
    return { useAuthStore: create<{ sessionUser: { uid: string; nickname: string } | null; sessionVersion: number }>(() => ({ sessionUser: { uid: 'fixture-user', nickname: 'Fixture' }, sessionVersion: 0 })) };
});
vi.mock('@/services/cache/backend', () => ({ getCachedBinding: () => ({ hit: false, value: null }), setCachedBinding: api.cache }));
vi.mock('@/services/endfield', () => ({ exchangeEFToken: api.exchange, bindEFRole: api.bind, getEFBindingStatus: api.status, agreePolicy: api.agree, unlinkEFBinding: api.unlink,
    readEFTrackerConf: () => api.config, saveEFTrackerConf: (config: EFTrackerConf) => { api.config = config; } }));
vi.mock('./session', async (original) => ({ ...await original<typeof import('./session')>(), applyRole: api.apply, disableSession: api.disable, currentMode: () => 'skport' }));
const role = (id: string, isDefault = false): EFRoleOption => ({ roleId: id, serverId: 2, nickname: `Role ${id}`, serverName: 'Europe', serverType: 'official', level: 20, isDefault });
const binding: EFBindingSummary = { bound: true, enabled: true, provider: 'skport', roleId: 'role-b', serverId: 2, nickname: 'Bound role', serverName: 'Europe' };
const initialLocator = useLocatorStore.getState(), initialPrefs = useUiPrefsStore.getState();
beforeEach(() => {
    vi.clearAllMocks(); vi.useFakeTimers(); installResizeObserver(); api.mobile = false;
    useAuthStore.setState({ sessionUser: { uid: 'fixture-user', nickname: 'Fixture' }, sessionVersion: 0 });
    api.config = { enabled: false, locatorSync: false, baseUrl: 'skport', roleId: 'old', serverId: 2, scope: ['balanced'], trackPoints: true, centerOnPosition: false };
    api.status.mockResolvedValue({ binding }); api.agree.mockResolvedValue({ ok: true }); api.unlink.mockResolvedValue({ binding: { bound: false, enabled: false } });
    api.bind.mockResolvedValue({ binding }); api.exchange.mockResolvedValue({ flowId: 'flow', roles: [role('role-a'), role('role-b', true)] });
    useLocatorStore.setState({ authOpen: false, bannerKey: null, lastPosition: null });
});
afterEach(() => { cleanup(); useLocatorStore.setState(initialLocator, true); useUiPrefsStore.setState(initialPrefs, true); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const advanceCountdown = () => act(() => { vi.advanceTimersByTime(5000); });
const inputToken = () => fireEvent.change(screen.getByRole('textbox'), { target: { value: '{"code":0,"data":{"content":"account-token"}}' } });

it('enforces the countdown, extracts a token, selects the default role, and binds only after role confirmation', async () => {
    const close = vi.fn(), bound = vi.fn();
    render(<LocationBinding open onClose={close} onBound={bound} />);
    inputToken();
    fireEvent.click(screen.getByRole('button', { name: 'locator.binding.bindWithCountdown' }));
    expect(api.exchange).not.toHaveBeenCalled();
    advanceCountdown();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'locator.binding.bind' })); await Promise.resolve(); });
    expect(api.exchange).toHaveBeenCalledExactlyOnceWith('skport', 'account-token');
    expect(api.bind).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Role role-b/ })).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'locator.binding.bind' })); await Promise.resolve(); });
    expect(api.bind).toHaveBeenCalledExactlyOnceWith('flow', role('role-b', true));
    expect(api.apply).toHaveBeenCalledExactlyOnceWith('skport', role('role-b', true));
    expect(api.cache).toHaveBeenCalledWith('fixture-user', binding);
    expect(bound).toHaveBeenCalledExactlyOnceWith(binding);
    expect(close).toHaveBeenCalledOnce();
});

it('binds a single role without enabling tracking for the import-only flow', async () => {
    api.exchange.mockResolvedValue({ flowId: 'single', roles: [role('only')] });
    const close = vi.fn();
    render(<LocationBinding open enableLocatorOnBound={false} onClose={close} />);
    advanceCountdown(); inputToken();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'locator.binding.bindOnly' })); await Promise.resolve(); });
    expect(api.bind).toHaveBeenCalledExactlyOnceWith('single', role('only'));
    expect(api.apply).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
});

it('rejects an empty token and an empty role list without binding, then permits retry', async () => {
    render(<LocationBinding open onClose={vi.fn()} />); advanceCountdown();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'locator.binding.bind' })); await Promise.resolve(); });
    expect(screen.getByText('locator.errors.tokenRequired')).toBeTruthy();
    expect(api.exchange).not.toHaveBeenCalled();
    api.exchange.mockResolvedValueOnce({ flowId: 'empty', roles: [] }); inputToken();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'locator.binding.bind' })); await Promise.resolve(); });
    expect(screen.getByText('locator.errors.noRole')).toBeTruthy();
    expect(api.bind).not.toHaveBeenCalled();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'locator.binding.bind' }).disabled).toBe(false);
});

it('blocks dismissal and provider changes until the in-flight request settles, restoring them after failure', async () => {
    const pending = deferred<never>(); api.exchange.mockReturnValue(pending.promise);
    const close = vi.fn(); render(<LocationBinding open onClose={close} />); advanceCountdown(); inputToken();
    fireEvent.click(screen.getByRole('button', { name: 'locator.binding.bind' }));
    expect(screen.queryByRole('button', { name: 'common.close' })).toBeNull();
    const china = screen.getByRole('tab', { name: 'locator.binding.chinaTab' });
    expect((china as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(china);
    fireEvent.click(screen.getByRole('dialog').parentElement!);
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })); });
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByRole('tab', { name: 'locator.binding.globalTab' }).getAttribute('aria-selected')).toBe('true');
    await act(async () => { pending.reject(new Error('exchange unavailable')); await pending.promise.catch(() => {}); });
    expect(screen.getByText('exchange unavailable')).toBeTruthy();
    expect((china as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(china);
    expect(screen.getByRole('tab', { name: 'locator.binding.chinaTab' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'common.close' }));
    expect(close).toHaveBeenCalledOnce();
});

it('keeps failed policy authorization open and enables tracking only after agreement succeeds', async () => {
    useLocatorStore.setState({ authOpen: true, bannerKey: 'locator.policy.required' });
    api.agree.mockRejectedValueOnce(new Error('policy unavailable'));
    render(<LocationAuth />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'locator.binding.authAndSync' })); await Promise.resolve(); });
    expect(screen.getByText('policy unavailable')).toBeTruthy();
    expect(useLocatorStore.getState().authOpen).toBe(true);
    expect(api.config?.enabled).toBe(false);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'locator.binding.authAndSync' })); await Promise.resolve(); });
    expect(api.agree).toHaveBeenLastCalledWith({ roleId: 'old', serverId: 2 });
    expect(api.config).toMatchObject({ enabled: true, locatorSync: true });
    expect(useLocatorStore.getState()).toMatchObject({ authOpen: false, bannerKey: null, viewMode: 'tracking' });
});

it('persists tracking options without losing the binding and keeps scope actions disabled when reminders are off', async () => {
    const close = vi.fn(); render(<LocationConfig open onClose={close} onChangeBinding={vi.fn()} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText('Bound role')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'locator.config.trackPoints' }));
    expect(api.config).toMatchObject({ roleId: 'old', trackPoints: false, enabled: false });
    const scope = screen.getByRole('button', { name: /locator.config.scope.balanced.title/ });
    expect((scope as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'locator.config.centerOnPosition' }));
    expect(api.config?.centerOnPosition).toBe(true);
    api.unlink.mockRejectedValueOnce(new Error('unlink unavailable'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'locator.binding.unlink' })); await Promise.resolve(); });
    expect(screen.getByText('unlink unavailable')).toBeTruthy();
    expect(close).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'locator.binding.unlink' })); await Promise.resolve(); });
    expect(api.disable).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce();
});

it('dismisses the locator banner outside without clearing it on an inside pointer and removes its listener', () => {
    useLocatorStore.setState({ bannerKey: 'locator.connectionLost' });
    const view = render(<LocatorBanner />);
    fireEvent.pointerDown(screen.getByText('locator.connectionLost'));
    expect(useLocatorStore.getState().bannerKey).toBe('locator.connectionLost');
    fireEvent.pointerDown(document.body);
    expect(useLocatorStore.getState().bannerKey).toBeNull();
    view.unmount(); useLocatorStore.setState({ bannerKey: 'new' });
    fireEvent.pointerDown(document.body);
    expect(useLocatorStore.getState().bannerKey).toBe('new');
});

it('loads binding only on a request and propagates the host request options to the real binding flow', async () => {
    const bound = vi.fn(); const view = render(<EndfieldBindingHost />);
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => { requestEndfieldBinding({ enableLocator: false, onBound: bound }); await Promise.resolve(); });
    advanceCountdown(); inputToken();
    api.exchange.mockResolvedValue({ flowId: 'host', roles: [role('host')] });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'locator.binding.bindOnly' })); await Promise.resolve(); });
    expect(bound).toHaveBeenCalledOnce(); expect(api.apply).not.toHaveBeenCalled();
    view.unmount();
    act(() => { requestEndfieldBinding({ enableLocator: true }); });
    expect(screen.queryByRole('dialog')).toBeNull();
});

it('does not continue an exchanged token into a role-binding mutation after the binding host unmounts', async () => {
    const pending = deferred<{ flowId: string; roles: EFRoleOption[] }>(); api.exchange.mockReturnValue(pending.promise);
    const bound = vi.fn(); const view = render(<EndfieldBindingHost />);
    await act(async () => { requestEndfieldBinding({ enableLocator: true, onBound: bound }); await Promise.resolve(); });
    advanceCountdown(); inputToken(); fireEvent.click(screen.getByRole('button', { name: 'locator.binding.bind' }));
    view.unmount();
    await act(async () => { pending.resolve({ flowId: 'obsolete', roles: [role('old')] }); await pending.promise; });
    expect(api.bind).not.toHaveBeenCalled(); expect(api.apply).not.toHaveBeenCalled(); expect(bound).not.toHaveBeenCalled();
});

it.each(['unmount', 'relogin', 'account-roundtrip'])('ignores a pending bind completion after %s', async (transition) => {
    api.exchange.mockResolvedValue({ flowId: 'old', roles: [role('old')] });
    const pending = deferred<{ binding: EFBindingSummary }>(); api.bind.mockReturnValue(pending.promise);
    const close = vi.fn(), bound = vi.fn(); const view = render(<LocationBinding open onClose={close} onBound={bound} />);
    advanceCountdown(); inputToken();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'locator.binding.bind' })); await Promise.resolve(); });
    expect(api.bind).toHaveBeenCalledOnce();
    if (transition === 'unmount') view.unmount();
    else act(() => {
        useAuthStore.setState({ sessionUser: transition === 'relogin' ? null : { uid: 'b', nickname: 'B' }, sessionVersion: 1 });
        useAuthStore.setState({ sessionUser: { uid: 'fixture-user', nickname: 'Fixture' }, sessionVersion: 2 });
    });
    await act(async () => { pending.resolve({ binding }); await pending.promise; });
    expect(api.apply).not.toHaveBeenCalled(); expect(api.cache).not.toHaveBeenCalled(); expect(bound).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
});
