import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HeadBar, HeadItem } from './headBar';
import styles from './headbar.module.scss';
import { useUiPrefsStore } from '@/store/uiPrefs';

const device = vi.hoisted(() => ({ isMobile: false }));
vi.mock('@/platform/device', () => ({ useDevice: () => device }));
vi.mock('liquid-glass-react-positioning', () => ({ default: ({ children }: { children: ReactNode }) => <div data-testid="glass">{children}</div> }));
vi.mock('@/locale/fontLoader', () => ({ registerFontRegion: () => ({ update: () => {}, stop: () => {} }) }));

beforeEach(() => { device.isMobile = false; useUiPrefsStore.setState({ forceHeadbarExpanded: null, prefsPerformanceModeEnabled: true }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const Icon = () => <svg />;

it.each([true, false])('preserves mobile expand, outside dismissal and forced state in performance mode=%s', (performance) => {
    device.isMobile = true;
    useUiPrefsStore.setState({ prefsPerformanceModeEnabled: performance });
    const view = render(<HeadBar><HeadItem icon={Icon} ariaLabel="Language" /></HeadBar>);
    const bar = view.container.querySelector('[data-guide="headbar"]')!;
    const toggle = view.container.querySelector('button')!;
    expect(bar.classList.contains(styles.collapsed)).toBe(true);
    fireEvent.click(toggle);
    expect(bar.classList.contains(styles.expanded)).toBe(true);
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Language' }));
    expect(bar.classList.contains(styles.expanded)).toBe(true);
    fireEvent.touchStart(document.body);
    expect(bar.classList.contains(styles.collapsed)).toBe(true);
    act(() => useUiPrefsStore.setState({ forceHeadbarExpanded: true }));
    expect(toggle.disabled).toBe(true);
    expect(bar.classList.contains(styles.expanded)).toBe(true);
    fireEvent.mouseDown(document.body);
    expect(bar.classList.contains(styles.expanded)).toBe(true);
    act(() => useUiPrefsStore.setState({ forceHeadbarExpanded: false }));
    expect(bar.classList.contains(styles.collapsed)).toBe(true);
});

it.each([false, true])('keeps only the visibility action reachable in compact mode on mobile=%s', (mobile) => {
    device.isMobile = mobile;
    const action = vi.fn();
    render(<HeadBar compact><HeadItem icon={Icon} tooltip="Language" guideKey="language" onClick={action} /><HeadItem icon={Icon} tooltip="Show interface" guideKey="hide-ui" onClick={action} /></HeadBar>);
    expect(screen.queryByRole('button', { name: 'Language' })).toBeNull();
    const hidden = document.querySelector<HTMLElement>('[aria-label="Language"]')!;
    expect(hidden.tabIndex).toBe(-1);
    expect(hidden.hasAttribute('aria-describedby')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Show interface' }));
    expect(action).toHaveBeenCalledOnce();
});

it('keeps desktop actions available through both rendering branches and blocks disabled actions', () => {
    const action = vi.fn();
    const view = render(<HeadBar><HeadItem icon={Icon} ariaLabel="Notifications" active disabled badge guideKey="notice" onClick={action} /></HeadBar>);
    const button = screen.getByRole('button', { name: 'Notifications', pressed: true });
    expect(button.querySelector('[data-badge="notice"]')).toBeTruthy();
    fireEvent.click(button);
    expect(action).not.toHaveBeenCalled();
    expect(view.queryByTestId('glass')).toBeNull();
    act(() => useUiPrefsStore.setState({ prefsPerformanceModeEnabled: false }));
    expect(view.getByTestId('glass')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Notifications', pressed: true })).toBeTruthy();
});

it('releases outside-dismissal listeners on unmount', () => {
    device.isMobile = true;
    const remove = vi.spyOn(document, 'removeEventListener');
    const view = render(<HeadBar><HeadItem icon={Icon} ariaLabel="Language" /></HeadBar>);
    fireEvent.click(view.container.querySelector('button')!);
    view.unmount();
    expect(remove).toHaveBeenCalledWith('mousedown', expect.any(Function));
    expect(remove).toHaveBeenCalledWith('touchstart', expect.any(Function));
});
