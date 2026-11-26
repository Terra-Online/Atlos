import { createRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Feed from './Feed';
import styles from './Feed.module.scss';

const blur = vi.hoisted(() => ({ props: [] as { visible: boolean; side: string; strength: number; targetRef: { current: unknown }; className: string }[] }));
vi.mock('@/component/effects/AdaptiveLinearBlur', () => ({
    default: (props: (typeof blur.props)[number]) => { blur.props.push(props); return null; },
}));

const observers: { callback: ResizeObserverCallback; disconnected: boolean; targets: Element[] }[] = [];
let frames: FrameRequestCallback[] = [];
beforeEach(() => {
    blur.props = [];
    observers.length = 0;
    frames = [];
    vi.stubGlobal('ResizeObserver', class {
        record: (typeof observers)[number] = {
            callback: () => {},
            disconnected: false,
            targets: [],
        };
        constructor(callback: ResizeObserverCallback) { this.record.callback = callback; observers.push(this.record); }
        observe(target: Element) { this.record.targets.push(target); }
        disconnect() { this.record.disconnected = true; }
    });
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => frames.push(callback));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const lastBlur = () => blur.props.at(-1)!;
const flushFrames = () => act(() => { frames.splice(0).forEach((frame) => frame(0)); });
const notifyResize = () => act(() => { observers.at(-1)!.callback([], {} as ResizeObserver); });
const setMetrics = (list: HTMLElement, scrollTop: number, clientHeight: number, scrollHeight: number) => {
    Object.defineProperties(list, {
        clientHeight: { configurable: true, value: clientHeight },
        scrollHeight: { configurable: true, value: scrollHeight },
    });
    list.scrollTop = scrollTop;
};

it('renders children in a scrollable tab panel with a bottom fade bound to it', () => {
    render(<Feed><p>Notice</p></Feed>);
    const panel = screen.getByRole('tabpanel');
    expect(panel.classList.contains(styles.notificationList)).toBe(true);
    expect(panel.contains(screen.getByText('Notice'))).toBe(true);
    expect(lastBlur()).toMatchObject({ side: 'bottom', strength: 6, visible: false });
    expect(lastBlur().targetRef.current).toBe(panel);
});

it('shows the fade while more content is below and hides it at the bottom', () => {
    render(<Feed><p>Notice</p></Feed>);
    const panel = screen.getByRole('tabpanel');
    setMetrics(panel, 0, 100, 300);
    const content = screen.getByText('Notice').parentElement;
    expect(observers.at(-1)!.targets).toEqual([panel, content]);
    notifyResize();
    flushFrames();
    expect(lastBlur().visible).toBe(true);
    expect(lastBlur().className).toContain(styles.visible);

    // One pixel of rounding slack still counts as the bottom.
    setMetrics(panel, 199, 100, 300);
    for (let event = 0; event < 20; event += 1) fireEvent.scroll(panel);
    expect(frames).toHaveLength(1);
    flushFrames();
    expect(lastBlur().visible).toBe(false);
    expect(lastBlur().className).not.toContain(styles.visible);

    setMetrics(panel, 150, 100, 300);
    fireEvent.scroll(panel);
    flushFrames();
    expect(lastBlur().visible).toBe(true);

    setMetrics(panel, 150, 100, 250);
    notifyResize();
    flushFrames();
    expect(lastBlur().visible).toBe(false);
});

it('keeps the same observer when children change', () => {
    const { rerender } = render(<Feed><p>One</p></Feed>);
    const first = observers.at(-1)!;
    rerender(<Feed><p>Two</p></Feed>);
    expect(first.disconnected).toBe(false);
    expect(observers).toEqual([first]);
});

it('uses a caller-provided list ref', () => {
    const listRef = createRef<HTMLDivElement>();
    render(<Feed listRef={listRef}><p>Notice</p></Feed>);
    expect(listRef.current).toBe(screen.getByRole('tabpanel'));
    expect(lastBlur().targetRef).toBe(listRef);
});

it('scrolls back to the top only when an explicit reset key changes', () => {
    const { rerender } = render(<Feed resetKey="all"><p>Notice</p></Feed>);
    const panel = screen.getByRole('tabpanel');
    panel.scrollTop = 80;
    rerender(<Feed resetKey="all"><p>Notice again</p></Feed>);
    expect(panel.scrollTop).toBe(80);
    rerender(<Feed resetKey="unread"><p>Notice again</p></Feed>);
    expect(panel.scrollTop).toBe(0);

    const { rerender: rerenderPlain } = render(<Feed><p>Plain</p></Feed>);
    const plain = screen.getAllByRole('tabpanel')[1];
    plain.scrollTop = 40;
    rerenderPlain(<Feed><p>Plain changed</p></Feed>);
    expect(plain.scrollTop).toBe(40);
});

it('keeps the scroll position when the list ref changes without a reset key', () => {
    const first = createRef<HTMLDivElement>();
    const { rerender } = render(<Feed listRef={first}><p>Notice</p></Feed>);
    const panel = screen.getByRole('tabpanel');
    panel.scrollTop = 60;
    const next = createRef<HTMLDivElement>();
    rerender(<Feed listRef={next}><p>Notice</p></Feed>);
    expect(next.current).toBe(panel);
    expect(panel.scrollTop).toBe(60);
});

it('stops listening after unmount', () => {
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    const { unmount } = render(<Feed><p>Notice</p></Feed>);
    const panel = screen.getByRole('tabpanel');
    const remove = vi.spyOn(panel, 'removeEventListener');
    fireEvent.scroll(panel);
    unmount();
    expect(cancel).toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function));
    expect(observers.at(-1)!.disconnected).toBe(true);
});
