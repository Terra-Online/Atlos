import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TabView, type TabViewItem } from '.';
import styles from './TabView.module.scss';

const observers = vi.hoisted(() => [] as { callback: ResizeObserverCallback; targets: Element[]; disconnected: boolean }[]);
let frames: FrameRequestCallback[] = [];

beforeEach(() => {
    observers.length = 0;
    frames = [];
    vi.stubGlobal('ResizeObserver', class {
        record: (typeof observers)[number];
        constructor(callback: ResizeObserverCallback) { this.record = { callback, targets: [], disconnected: false }; observers.push(this.record); }
        observe(target: Element) { this.record.targets.push(target); }
        unobserve() {}
        disconnect() { this.record.disconnected = true; }
    });
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => frames.push(callback));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const items: TabViewItem[] = [
    { key: 'all', label: 'All' },
    { key: 'unread', label: 'Unread', description: 'Only unread notices' },
    { key: 'system', label: 'System' },
];

const place = (element: Element, left: number, width: number) => {
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ left, width } as DOMRect);
};

const flushFrames = () => act(() => { frames.splice(0).forEach((frame) => frame(0)); });
const indicator = (container: HTMLElement) => container.querySelector<HTMLElement>(`.${styles.tabIndicator}`);

it('renders accessible tabs and reports the clicked key without selecting it itself', () => {
    const onChange = vi.fn();
    render(<TabView items={items} activeKey="all" onChange={onChange} />);
    expect(screen.getByRole('tablist').dataset.fill).toBe('false');
    expect(screen.getAllByRole('tab').map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    expect(screen.getByRole('tab', { name: 'All' }).classList.contains(styles.activeTab)).toBe(true);

    fireEvent.click(screen.getByRole('tab', { name: 'System' }));
    expect(onChange).toHaveBeenCalledWith('system');
    expect(screen.getByRole('tab', { name: 'All' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getAllByRole('tab').every((tab) => tab.getAttribute('type') === 'button')).toBe(true);
});

it('shows only the active tab description and honors fill and class name', () => {
    const { container, rerender } = render(<TabView items={items} activeKey="all" onChange={vi.fn()} fill className="own" />);
    expect(screen.queryByText('Only unread notices')).toBeNull();
    expect(screen.getByRole('tablist').dataset.fill).toBe('true');
    expect(container.firstElementChild!.classList.contains('own')).toBe(true);
    rerender(<TabView items={items} activeKey="unread" onChange={vi.fn()} />);
    expect(screen.getByText('Only unread notices')).toBeTruthy();
});

it('blocks a disabled tab until the owner enables it without changing the active selection', () => {
    const onChange = vi.fn();
    const view = render(<TabView items={[items[0], { ...items[1], disabled: true }]} activeKey="all" onChange={onChange} />);
    const tab = screen.getByRole<HTMLButtonElement>('tab', { name: 'Unread' });
    expect(tab.disabled).toBe(true);
    fireEvent.click(tab);
    expect(onChange).not.toHaveBeenCalled();
    view.rerender(<TabView items={items} activeKey="all" onChange={onChange} />);
    fireEvent.click(tab);
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith('unread');
    expect(screen.getByRole('tab', { name: 'All' }).getAttribute('aria-selected')).toBe('true');
});

it('centers the indicator under the active tab after layout, scroll and resize', () => {
    const { container, rerender } = render(<TabView items={items} activeKey="unread" onChange={vi.fn()} />);
    const bar = screen.getByRole('tablist');
    place(bar, 10, 300);
    place(screen.getByRole('tab', { name: 'Unread' }), 110, 60);
    expect(indicator(container)).toBeNull();
    flushFrames();
    expect(indicator(container)!.style.left).toBe('130px');

    bar.scrollLeft = 25;
    act(() => { bar.dispatchEvent(new Event('scroll')); });
    expect(indicator(container)!.style.left).toBe('155px');

    place(screen.getByRole('tab', { name: 'Unread' }), 120, 80);
    act(() => { window.dispatchEvent(new Event('resize')); });
    // 120 - 10 + scrollLeft 25 + half of 80.
    expect(indicator(container)!.style.left).toBe('175px');

    // Font or label changes resize the bar or tab without a window resize.
    place(screen.getByRole('tab', { name: 'Unread' }), 100, 40);
    const observer = observers.at(-1)!;
    expect(observer.targets).toEqual([bar, screen.getByRole('tab', { name: 'Unread' })]);
    act(() => { observer.callback([], {} as ResizeObserver); });
    expect(indicator(container)!.style.left).toBe('135px');

    place(screen.getByRole('tab', { name: 'System' }), 200, 50);
    rerender(<TabView items={items} activeKey="system" onChange={vi.fn()} />);
    expect(observer.disconnected).toBe(true);
    flushFrames();
    expect(indicator(container)!.style.left).toBe('240px');
});

it('hides the indicator when the active key has no tab or there are no tabs', () => {
    const { container, rerender } = render(<TabView items={items} activeKey="missing" onChange={vi.fn()} />);
    flushFrames();
    expect(indicator(container)).toBeNull();
    rerender(<TabView items={[]} activeKey="all" onChange={vi.fn()} />);
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(indicator(container)).toBeNull();
});

it('releases its frame, listeners and observer on unmount', () => {
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    const removeWindow = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(<TabView items={items} activeKey="all" onChange={vi.fn()} />);
    const bar = screen.getByRole('tablist');
    const removeBar = vi.spyOn(bar, 'removeEventListener');
    unmount();
    expect(cancel).toHaveBeenCalledWith(1);
    expect(removeWindow).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(removeBar).toHaveBeenCalledWith('scroll', expect.any(Function));
    expect(observers.at(-1)!.disconnected).toBe(true);
});
