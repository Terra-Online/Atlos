import { useRef, useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TabView, type TabViewItem } from '.';

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

const place = (tab: HTMLElement, left: number, width: number) => {
    Object.defineProperties(tab, {
        offsetLeft: { configurable: true, value: left },
        offsetWidth: { configurable: true, value: width },
    });
};

const flushFrames = () => act(() => { frames.splice(0).forEach((frame) => frame(0)); });
const position = (container: HTMLElement) =>
    container.querySelector<HTMLElement>('[data-tab-indicator]')?.style.getPropertyValue('--tab-center');
const resize = () => {
    const observer = observers.at(-1)!;
    act(() => { observer.callback([], {} as ResizeObserver); });
    flushFrames();
};

it('renders accessible tabs and reports the clicked key without selecting it itself', () => {
    const onChange = vi.fn();
    render(<TabView items={items} activeKey="all" onChange={onChange} />);
    expect(screen.getByRole('tablist').dataset.fill).toBe('false');
    expect(screen.getAllByRole('tab').map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);

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

it.each(['strip', 'panel'] as const)('aligns the %s indicator in local coordinates across scroll, resize and selection', (appearance) => {
    const view = (activeKey: string) => <TabView items={items} appearance={appearance} activeKey={activeKey} onChange={vi.fn()} />;
    const { rerender } = render(view('unread'));
    const bar = screen.getByRole('tablist');
    const unread = screen.getByRole('tab', { name: 'Unread' });
    const system = screen.getByRole('tab', { name: 'System' });
    place(unread, 100, 60);
    const screenRect = vi.spyOn(unread, 'getBoundingClientRect');
    resize();
    expect(position(bar)).toBe('130px');
    expect(screenRect).not.toHaveBeenCalled();

    bar.scrollLeft = 25;
    fireEvent.scroll(bar);
    expect(position(bar)).toBe('130px');
    expect(frames).toHaveLength(0);

    place(unread, 90, 40);
    const observer = observers.at(-1)!;
    expect(observer.targets).toEqual([bar, ...screen.getAllByRole('tab')]);
    act(() => {
        observer.callback([], {} as ResizeObserver);
        observer.callback([], {} as ResizeObserver);
    });
    expect(frames).toHaveLength(1);
    flushFrames();
    expect(position(bar)).toBe('110px');

    place(system, 200, 50);
    rerender(view('system'));
    expect(observer.disconnected).toBe(false);
    expect(position(bar)).toBe('225px');
});

it('hides the indicator when the active key has no tab or there are no tabs', () => {
    const { container, rerender } = render(<TabView items={items} activeKey="missing" onChange={vi.fn()} />);
    expect(position(container)).toBeUndefined();
    rerender(<TabView items={[]} activeKey="all" onChange={vi.fn()} />);
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(position(container)).toBeUndefined();
});

it('releases a pending frame and its observer on unmount', () => {
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    const { unmount } = render(<TabView items={items} activeKey="all" onChange={vi.fn()} />);
    const observer = observers.at(-1)!;
    act(() => { observer.callback([], {} as ResizeObserver); });
    unmount();
    expect(cancel).toHaveBeenCalledWith(1);
    expect(observer.disconnected).toBe(true);
});

it('keeps disabled tabs and quick actions inert and delegates enabled tab changes to the owner', () => {
    const change = vi.fn(), quick = vi.fn();
    const items = [{ key: 'a', label: 'A', icon: null }, { key: 'b', label: 'B', icon: null, disabled: true }];
    const view = render(<TabView appearance="panel" items={items} activeKey="a" onChange={change} quickAction={{ icon: null, label: 'Reset', onClick: quick, disabled: true }} />);
    fireEvent.click(screen.getByRole('tab', { name: 'B' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(change).not.toHaveBeenCalled();
    expect(quick).not.toHaveBeenCalled();
    view.rerender(<TabView appearance="panel" items={items.map((item) => ({ ...item, disabled: false }))} activeKey="a" onChange={change} quickAction={{ icon: null, label: 'Reset', onClick: quick, active: true }} />);
    fireEvent.click(screen.getByRole('tab', { name: 'B' }));
    expect(change).toHaveBeenCalledExactlyOnceWith('b');
    expect(screen.getByRole('tab', { name: 'A' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(quick).toHaveBeenCalledOnce();
});

function renderTouchTabs() {
    function Tabs() {
        const [active, setActive] = useState('a');
        const target = useRef<HTMLDivElement>(null);
        return (
            <div ref={target}>
                <TabView appearance="panel"
                    items={[{ key: 'a', label: 'A', icon: null }, { key: 'b', label: 'B', icon: null }]}
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
    resize();
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
    expect(position(tabs)).toBe('150px');
});

it('keeps a swipe aligned and selects the adjacent tab with inline items and callbacks', () => {
    const { tabs, second } = renderTouchTabs();
    touch(tabs, 'touchstart', 180);
    touch(tabs, 'touchmove', 150);
    expect(position(tabs)).toBe('80px');
    touch(tabs, 'touchmove', 90);
    expect(position(tabs)).toBe('140px');
    touch(tabs, 'touchend', 90);
    expect(second.getAttribute('aria-selected')).toBe('true');
    expect(position(tabs)).toBe('150px');
});

it('preserves the active tab on vertical scroll and restores its indicator on cancellation', () => {
    const { tabs, first } = renderTouchTabs();
    touch(tabs, 'touchstart', 180);
    touch(tabs, 'touchmove', 170, 200);
    touch(tabs, 'touchend', 170, 200);
    expect(first.getAttribute('aria-selected')).toBe('true');
    expect(position(tabs)).toBe('50px');

    touch(tabs, 'touchstart', 180);
    touch(tabs, 'touchmove', 80);
    touch(tabs, 'touchcancel', 80);
    expect(first.getAttribute('aria-selected')).toBe('true');
    expect(tabs.hasAttribute('data-swiping')).toBe(false);
    expect(position(tabs)).toBe('50px');
});
