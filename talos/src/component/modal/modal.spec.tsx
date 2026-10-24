import { StrictMode, useRef, useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import Modal, { ModalTabs } from './modal';
import Viewer from '@/component/viewer/viewer';

vi.mock('@/locale', () => ({ useTranslateUI: () => (key: string) => key, useLocale: () => 'en' }));
vi.mock('@/locale/useFontRegion', () => ({ useFontRegion: () => () => {} }));
vi.mock('@/platform/pictureInPicture', () => ({ useAppDocument: () => document, getOpenerDocument: () => document, getAppDocument: () => document, subscribePictureInPictureState: () => () => {} }));
vi.mock('@/component/effects/AdaptiveLinearBlur', () => ({ default: () => null }));
vi.mock('@/assets/images/UI/upvote.svg?react', () => ({ default: () => null }));
vi.mock('@/assets/images/UI/flag.svg?react', () => ({ default: () => null }));
vi.mock('@/assets/images/UI/share.svg?react', () => ({ default: () => null }));
vi.mock('@/assets/images/UI/recall.svg?react', () => ({ default: () => null }));

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('mounts closed before entering and preserves the portal when an exit is interrupted', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    const afterClose = vi.fn();
    const view = (open: boolean) => <StrictMode><Modal open={open} onAfterClose={afterClose}>content</Modal></StrictMode>;
    const { rerender } = render(view(false));
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(view(true));
    const dialog = screen.getByRole('dialog');
    expect(dialog.dataset.state).toBe('closed');
    await act(() => vi.advanceTimersToNextFrame());
    expect(dialog.dataset.state).toBe('closed');
    await act(() => vi.advanceTimersToNextFrame());
    expect(dialog.dataset.state).toBe('open');
    rerender(view(false));
    expect(dialog.parentElement?.hasAttribute('inert')).toBe(true);
    await act(() => vi.advanceTimersByTime(100));
    rerender(view(true));
    await act(() => vi.advanceTimersByTime(400));
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(dialog.dataset.state).toBe('open');
    expect(afterClose).not.toHaveBeenCalled();
    rerender(view(false));
    await act(() => vi.advanceTimersByTime(325));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(afterClose).toHaveBeenCalledOnce();
});

it('waits for viewer content before starting its entry', async () => {
    vi.useFakeTimers();
    const view = (imageUrl: string) => <Viewer open imageUrl={imageUrl} alt="preview" onClose={() => {}} />;
    const { rerender } = render(view(''));
    await act(() => vi.advanceTimersByTime(100));
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(view('/preview.webp'));
    const dialog = screen.getByRole('dialog');
    expect(dialog.dataset.state).toBe('closed');
    await act(() => vi.advanceTimersToNextFrame());
    expect(dialog.dataset.state).toBe('closed');
    await act(() => vi.advanceTimersToNextFrame());
    expect(dialog.dataset.state).toBe('open');
});

it('positions the tab indicator in local coordinates while its dialog is scaled', () => {
    const { getByRole } = render(<ModalTabs items={[{ key: 'a', title: 'A', icon: null }, { key: 'b', title: 'B', icon: null }]} activeKey="b" onChange={() => {}} />);
    const tabs = getByRole('tablist');
    const tab = getByRole('tab', { name: 'B' });
    Object.defineProperties(tab, { offsetLeft: { value: 100 }, offsetWidth: { value: 100 } });
    vi.spyOn(tabs, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 10, 184, 36));
    vi.spyOn(tab, 'getBoundingClientRect').mockReturnValue(new DOMRect(102, 10, 92, 36));
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(tabs.style.getPropertyValue('--modal-tab-indicator-left')).toBe('150px');
});

function renderTouchTabs() {
    function Tabs() {
        const [active, setActive] = useState('a');
        const target = useRef<HTMLDivElement>(null);
        return (
            <div ref={target}>
                <ModalTabs
                    items={[{ key: 'a', title: 'A', icon: null }, { key: 'b', title: 'B', icon: null }]}
                    activeKey={active}
                    onChange={(key) => setActive(key)}
                    swipeTargetRef={target}
                />
            </div>
        );
    }
    const { getByRole } = render(<Tabs />);
    const tabs = getByRole('tablist');
    const first = getByRole('tab', { name: 'A' });
    const second = getByRole('tab', { name: 'B' });
    for (const [index, tab] of [first, second].entries()) {
        Object.defineProperties(tab, { offsetLeft: { value: index * 100 }, offsetWidth: { value: 100 } });
    }
    act(() => { window.dispatchEvent(new Event('resize')); });
    return { tabs, first, second };
}

const touch = (target: HTMLElement, type: string, x: number, y = 100) => {
    // jsdom's TouchEvent exposes arrays rather than the browser's TouchList.
    const point = { identifier: 1, clientX: x, clientY: y };
    const list = { length: 1, item: () => point };
    const event = new Event(type, { bubbles: true });
    Object.defineProperties(event, {
        touches: { value: type === 'touchend' || type === 'touchcancel' ? { length: 0, item: () => null } : list },
        changedTouches: { value: list },
    });
    fireEvent(target, event);
};

it('keeps the indicator on the selected tab after a touch tap settles', () => {
    vi.useFakeTimers();
    const { tabs, second } = renderTouchTabs();
    touch(second, 'touchstart', 150);
    touch(second, 'touchend', 150);
    fireEvent.click(second);
    act(() => { vi.advanceTimersByTime(500); });
    expect(second.getAttribute('aria-selected')).toBe('true');
    expect(tabs.style.getPropertyValue('--modal-tab-indicator-left')).toBe('150px');
});

it('continues a swipe across indicator renders with inline items and callbacks', () => {
    const { tabs, second } = renderTouchTabs();
    touch(tabs, 'touchstart', 180);
    touch(tabs, 'touchmove', 150);
    expect(tabs.style.getPropertyValue('--modal-tab-indicator-left')).toBe('80px');
    touch(tabs, 'touchmove', 90);
    expect(tabs.style.getPropertyValue('--modal-tab-indicator-left')).toBe('140px');
    touch(tabs, 'touchend', 90);
    expect(second.getAttribute('aria-selected')).toBe('true');
    expect(tabs.style.getPropertyValue('--modal-tab-indicator-left')).toBe('150px');
});

it('preserves the active tab on vertical scroll and restores its indicator on cancellation', () => {
    const { tabs, first } = renderTouchTabs();
    touch(tabs, 'touchstart', 180);
    touch(tabs, 'touchmove', 170, 200);
    touch(tabs, 'touchend', 170, 200);
    expect(first.getAttribute('aria-selected')).toBe('true');
    expect(tabs.style.getPropertyValue('--modal-tab-indicator-left')).toBe('50px');

    touch(tabs, 'touchstart', 180);
    touch(tabs, 'touchmove', 80);
    touch(tabs, 'touchcancel', 80);
    expect(first.getAttribute('aria-selected')).toBe('true');
    expect(tabs.dataset.swiping).toBe('false');
    expect(tabs.style.getPropertyValue('--modal-tab-indicator-left')).toBe('50px');
});
