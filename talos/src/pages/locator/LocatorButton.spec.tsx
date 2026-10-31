import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import LocatorButton from './LocatorButton';
import { useAuthStore } from '@/store/auth';
import { useLocatorStore } from '@/store/locator';
import { deferred } from '../../../test-support/pages';
import { installResizeObserver } from '../../../test-support/browser';
import { OEM_AUTH_DISMISS_EVENT, openOemAuthModal } from '@/component/shared/account/authEvents';
import type { EFBindingSummary } from '@/services/endfield';

const api = vi.hoisted(() => ({ status: vi.fn(), cache: vi.fn(), enable: vi.fn(), cachedBinding: { bound: true } as EFBindingSummary | null }));

vi.mock('@/locale', () => ({ useTranslateUI: () => (key: string) => key }));
vi.mock('@/store/auth', async () => {
    const { create } = await import('zustand');
    return { useAuthStore: create<{ sessionUser: { uid: string; nickname: string } | null; sessionVersion: number }>(() => ({ sessionUser: { uid: 'test', nickname: 'Test' }, sessionVersion: 0 })) };
});
vi.mock('@/component/shared/account/authEvents', () => ({ OEM_AUTH_DISMISS_EVENT: 'oem:auth-dismiss', openOemAuthModal: vi.fn() }));
vi.mock('@/services/cache/backend', () => ({ getCachedBinding: () => ({ hit: api.cachedBinding !== null, value: api.cachedBinding }), setCachedBinding: api.cache }));
vi.mock('@/services/endfield', () => ({ getEFBindingStatus: api.status }));
vi.mock('@/pages/locator/session', () => ({ disableSession: vi.fn(), enableSession: api.enable }));
vi.mock('@/assets/images/UI/config.svg?react', () => ({ default: () => null }));
vi.mock('@/assets/images/UI/locateclose.svg?react', () => ({ default: () => null }));
vi.mock('@/assets/images/UI/locateopen.svg?react', () => ({ default: () => null }));
vi.mock('@/assets/images/UI/locatecurrent.svg?react', () => ({ default: () => null }));

const locator = useLocatorStore.getState();
beforeEach(() => {
    installResizeObserver();
    api.status.mockReset(); api.cache.mockClear(); api.enable.mockReset(); api.cachedBinding = { bound: true, enabled: true }; vi.mocked(openOemAuthModal).mockClear();
    api.status.mockResolvedValue({ binding: { bound: true } }); api.enable.mockResolvedValue(true);
    useAuthStore.setState({ sessionUser: { uid: 'test', nickname: 'Test' }, sessionVersion: 0 });
    useLocatorStore.setState({ viewMode: 'off', bindReq: 0 });
});
afterEach(() => { cleanup(); useLocatorStore.setState(locator, true); vi.useRealTimers(); vi.unstubAllGlobals(); });
it('opens bound locator settings only on intent and retains inert content for the exit fade', async () => {
    vi.useFakeTimers();
    render(<LocatorButton />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole('button', { name: 'locator.config.title' })).toBeNull();
    const main = screen.getByRole('button', { name: 'mapControls.locationTracking' });
    fireEvent.pointerOver(main, { pointerType: 'mouse' });
    const config = screen.getByRole('button', { name: 'locator.config.title' });
    const panel = config.closest('[data-state]')!;
    act(() => { vi.advanceTimersByTime(50); });
    expect(panel.getAttribute('data-state')).toBe('open');
    fireEvent.pointerOut(main, { pointerType: 'mouse' });
    expect(panel.getAttribute('data-state')).toBe('exiting');
    expect(panel.hasAttribute('inert')).toBe(true);
    expect(panel.isConnected).toBe(true);
    fireEvent.pointerOver(main, { pointerType: 'mouse' });
    act(() => { vi.advanceTimersByTime(100); });
    expect(screen.getByRole('button', { name: 'locator.config.title' })).toBe(config);
    fireEvent.pointerOut(main, { pointerType: 'mouse' });
    act(() => { vi.advanceTimersByTime(200); });
    expect(panel.isConnected).toBe(false);
    await act(async () => { fireEvent.click(main); await Promise.resolve(); });
    expect(screen.queryByRole('button', { name: 'locator.config.title' })).not.toBeNull();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('button', { name: 'locator.config.title' })).toBeNull();
});

it('ignores a status response belonging to the earlier account', async () => {
    const pending = deferred<{ binding: EFBindingSummary }>(); api.status.mockReturnValueOnce(pending.promise);
    render(<LocatorButton />);
    await act(async () => { await Promise.resolve(); });
    expect(api.status).toHaveBeenCalledOnce();
    await act(async () => { useAuthStore.setState({ sessionUser: { uid: 'b', nickname: 'B' }, sessionVersion: 1 }); await Promise.resolve(); });
    api.cache.mockClear();
    await act(async () => { pending.resolve({ binding: { bound: true, enabled: true, roleId: 'old', serverId: 1 } }); await pending.promise; });
    expect(api.cache).not.toHaveBeenCalled();
});

it('does not open binding from an activation that outlives the authentication session', async () => {
    const pending = deferred<boolean>(); api.enable.mockReturnValueOnce(pending.promise);
    render(<LocatorButton />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getByRole('button', { name: 'mapControls.locationTracking' }));
    act(() => { useAuthStore.setState({ sessionVersion: 1 }); });
    await act(async () => { pending.resolve(false); await pending.promise; });
    expect(screen.queryByRole('dialog')).toBeNull();
});


it('does not clear a known binding after background status failure and retries', async () => {
    vi.useFakeTimers();
    api.status.mockRejectedValueOnce(new Error('offline'));
    render(<LocatorButton />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.pointerOver(screen.getByRole('button', { name: 'mapControls.locationTracking' }), { pointerType: 'mouse' });
    expect(screen.getByRole('button', { name: 'locator.config.title' })).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(api.status).toHaveBeenCalledTimes(2);
});

it('deduplicates pending activation clicks and sends unauthorized activation to login', async () => {
    const pending = deferred<boolean>(); api.enable.mockReturnValueOnce(pending.promise);
    render(<LocatorButton />);
    await act(async () => { await Promise.resolve(); });
    const main = screen.getByRole('button', { name: 'mapControls.locationTracking' });
    fireEvent.click(main); fireEvent.click(main);
    expect(api.enable).toHaveBeenCalledOnce();
    await act(async () => { pending.reject(Object.assign(new Error('session expired'), { status: 401 })); await pending.promise.catch(() => {}); });
    expect(openOemAuthModal).toHaveBeenCalledExactlyOnceWith('login');
    expect(screen.queryByRole('dialog')).toBeNull();
});

it('does not open binding from an unknown mobile status failure and stops retries on unmount', async () => {
    vi.useFakeTimers(); api.cachedBinding = null; api.status.mockRejectedValue(new Error('offline'));
    const view = render(<LocatorButton variant="mobile" />);
    await act(async () => { await Promise.resolve(); });
    const primary = screen.getByRole('button', { name: 'locator.title' });
    fireEvent.click(primary); fireEvent.click(primary);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.status.mock.calls.length).toBeLessThanOrEqual(2);
    view.unmount();
    const calls = api.status.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(2400); });
    expect(api.status).toHaveBeenCalledTimes(calls);
});


it('allows an anonymous user to reopen login after dismissing it', () => {
    useAuthStore.setState({ sessionUser: null, sessionVersion: 1 });
    render(<LocatorButton />);
    const main = screen.getByRole('button', { name: 'mapControls.locationTracking' });
    fireEvent.click(main);
    expect(openOemAuthModal).toHaveBeenCalledOnce();
    act(() => { window.dispatchEvent(new Event(OEM_AUTH_DISMISS_EVENT)); });
    fireEvent.click(main);
    expect(openOemAuthModal).toHaveBeenCalledTimes(2);
});
