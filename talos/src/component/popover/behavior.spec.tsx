import { createRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installPointerCapture, installPopover, installResizeObserver, setRect } from '../../../test-support/browser';
import PopoverTooltip from './popover';
import OverflowPopoverText from './OverflowPopoverText';

vi.mock('@/locale/fontLoader', () => ({ registerFontRegion: () => ({ update() {}, stop() {} }) }));
let popover: ReturnType<typeof installPopover>;
let observer: ReturnType<typeof installResizeObserver>;
let restorePointer: () => void;
beforeEach(() => { vi.useFakeTimers(); popover = installPopover(); observer = installResizeObserver(); restorePointer = installPointerCapture(); });
afterEach(() => { cleanup(); popover.restore(); restorePointer(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('merges child refs and event handlers through a tooltip and clears the ref on unmount', () => {
    const ref = createRef<HTMLButtonElement>();
    const callbackRef = vi.fn();
    const click = vi.fn(), focus = vi.fn(), enter = vi.fn();
    const view = render(<PopoverTooltip content="Help"><button ref={ref} onClick={click} onFocus={focus} onPointerEnter={enter}>Action</button></PopoverTooltip>);
    const button = screen.getByRole('button');
    expect(ref.current).toBe(button);
    fireEvent.pointerEnter(button);
    expect(enter).toHaveBeenCalledOnce();
    const tooltip = screen.getByRole('tooltip');
    expect(popover.isOpen(tooltip)).toBe(true);
    act(() => popover.focusVisible(button));
    expect(focus).toHaveBeenCalledOnce();
    fireEvent.click(button);
    expect(click).toHaveBeenCalledOnce();
    expect(popover.isOpen(tooltip)).toBe(false);
    view.rerender(<PopoverTooltip content="Help"><button ref={callbackRef}>Action</button></PopoverTooltip>);
    expect(ref.current).toBeNull();
    expect(callbackRef).toHaveBeenLastCalledWith(button);
    view.unmount();
    expect(callbackRef).toHaveBeenLastCalledWith(null);
});

it.each(['top', 'bottom', 'left', 'right'] as const)('clamps a %s tooltip to the viewport and remeasures after resize', async (placement) => {
    render(<PopoverTooltip content="Hint" placement={placement}><button>Action</button></PopoverTooltip>);
    const button = screen.getByRole('button'), tooltip = screen.getByRole('tooltip');
    setRect(button, -100, -100, 30, 20);
    setRect(tooltip, 0, 0, 80, 40);
    fireEvent.pointerEnter(button);
    const coordinates = ['left', 'right', 'top', 'bottom'].map((name) => Number.parseFloat(tooltip.style.getPropertyValue(name))).filter(Number.isFinite);
    expect(coordinates).toHaveLength(2);
    expect(coordinates.every((value) => value >= 4)).toBe(true);
    const before = tooltip.style.cssText;
    setRect(button, 200, 200, 30, 20);
    fireEvent(window, new Event('resize'));
    await act(() => vi.advanceTimersToNextFrame());
    expect(tooltip.style.cssText).not.toBe(before);
});

it('shows real overflow tooltips only beyond the one-pixel tolerance and closes them after text fits', () => {
    render(<OverflowPopoverText id="title" text="Long archive title" />);
    const text = screen.getByText('Long archive title');
    Object.defineProperties(text, { clientWidth: { configurable: true, value: 100 }, scrollWidth: { configurable: true, value: 101 } });
    act(() => observer.notify(text));
    fireEvent.pointerEnter(text);
    expect(screen.queryByRole('tooltip')).toBeNull();
    Object.defineProperty(text, 'scrollWidth', { configurable: true, value: 140 });
    act(() => observer.notify(text));
    fireEvent.pointerEnter(text);
    const tooltip = screen.getByRole('tooltip');
    expect(popover.isOpen(tooltip)).toBe(true);
    expect(text.id).toBe('title');
    Object.defineProperty(text, 'scrollWidth', { configurable: true, value: 80 });
    act(() => observer.notify(text));
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(popover.isOpen(tooltip)).toBe(false);
});

it('reclamps an open tooltip when its font or content size changes, and stops observing after close', async () => {
    const view = render(<PopoverTooltip content="Late font"><button>Action</button></PopoverTooltip>);
    const button = screen.getByRole('button'), tooltip = screen.getByRole('tooltip');
    setRect(button, window.innerWidth - 40, 100, 30, 20);
    setRect(tooltip, 0, 0, 80, 40);
    fireEvent.pointerEnter(button);
    await act(() => vi.advanceTimersToNextFrame());
    setRect(tooltip, 0, 0, 160, 40);
    act(() => observer.notify(tooltip));
    await act(() => vi.advanceTimersToNextFrame());
    expect(parseFloat(tooltip.style.left) + 160).toBeLessThanOrEqual(window.innerWidth - 4);
    setRect(button, 100, 200, 30, 20);
    fireEvent(button, new Event('fontregionchange', { bubbles: true }));
    await act(() => vi.advanceTimersToNextFrame());
    expect(parseFloat(tooltip.style.left)).toBe(142);
    fireEvent.click(button);
    expect(observer.observers.every((entry) => entry.targets.size === 0)).toBe(true);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
});
