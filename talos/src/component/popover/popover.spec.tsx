import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import PopoverTooltip from './popover';

const { stop } = vi.hoisted(() => ({ stop: vi.fn() }));
vi.mock('@/locale/fontLoader', () => ({ registerFontRegion: () => ({ update: vi.fn(), stop }) }));

beforeEach(() => {
    vi.useFakeTimers();
    stop.mockClear();
    vi.spyOn(HTMLElement.prototype, 'matches').mockImplementation(function (this: HTMLElement, selector) {
        if (selector === ':popover-open') return this.dataset.open === 'true';
        if (selector === ':focus-visible') return this.dataset.keyboard === 'true';
        return Element.prototype.matches.call(this, selector);
    });
    Object.defineProperties(HTMLElement.prototype, {
        showPopover: { configurable: true, value(this: HTMLElement) { this.dataset.open = 'true'; } },
        hidePopover: { configurable: true, value(this: HTMLElement) { this.dataset.open = 'false'; } },
    });
});

afterEach(() => {
    cleanup();
    Reflect.deleteProperty(HTMLElement.prototype, 'showPopover');
    Reflect.deleteProperty(HTMLElement.prototype, 'hidePopover');
    vi.restoreAllMocks();
    vi.useRealTimers();
});

function pointer(element: HTMLElement, type: string, pointerType = 'mouse') {
    const event = new MouseEvent(type, { bubbles: true });
    Object.defineProperty(event, 'pointerType', { value: pointerType });
    fireEvent(element, event);
}

it('ignores touch hover and pointer focus and dismisses on activation without losing the click', () => {
    const onClick = vi.fn();
    render(<PopoverTooltip content="Hint"><button onClick={onClick}>Action</button></PopoverTooltip>);
    const button = screen.getByRole('button');
    const tooltip = screen.getByRole('tooltip');
    pointer(button, 'pointerover', 'touch');
    fireEvent.mouseEnter(button);
    act(() => button.focus());
    expect(tooltip.dataset.open).not.toBe('true');
    pointer(button, 'pointerover');
    expect(tooltip.dataset.open).toBe('true');
    fireEvent.click(button);
    expect(tooltip.dataset.open).toBe('false');
    expect(onClick).toHaveBeenCalledOnce();
    button.dataset.keyboard = 'true';
    fireEvent.focus(button);
    expect(tooltip.dataset.open).toBe('true');
    pointer(document.body, 'pointerdown', 'touch');
    expect(tooltip.dataset.open).toBe('false');
});

it.each(['unmount', 'empty content', 'disabled'] as const)('releases overlay ownership after %s even when React has cleared the element ref', async (mode) => {
    const view = render(<PopoverTooltip content="Hint"><button>Action</button></PopoverTooltip>);
    pointer(screen.getByRole('button'), 'pointerover');
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.style.zIndex).toBe('1000');
    if (mode === 'unmount') view.unmount();
    else view.rerender(<PopoverTooltip content={mode === 'empty content' ? null : 'Hint'} disabled={mode === 'disabled'}><button>Action</button></PopoverTooltip>);
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(stop).toHaveBeenCalledOnce();
    expect(tooltip.style.zIndex).toBe('');
    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    document.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(false);
    await act(() => vi.runAllTimers());
});

it('cancels an interrupted close and keeps explicitly controlled visibility under caller control', async () => {
    const view = render(<PopoverTooltip content="Hint"><button>Action</button></PopoverTooltip>);
    const button = screen.getByRole('button');
    const tooltip = screen.getByRole('tooltip');
    pointer(button, 'pointerover');
    pointer(button, 'pointerout');
    await act(() => vi.advanceTimersByTime(60));
    pointer(button, 'pointerover');
    await act(() => vi.advanceTimersByTime(200));
    expect(tooltip.dataset.open).toBe('true');
    expect(tooltip.hasAttribute('inert')).toBe(false);
    view.rerender(<PopoverTooltip content="Hint" visible><button>Action</button></PopoverTooltip>);
    fireEvent.click(button);
    expect(tooltip.dataset.open).toBe('true');
    view.rerender(<PopoverTooltip content="Hint" visible={false}><button>Action</button></PopoverTooltip>);
    await act(() => vi.advanceTimersByTime(120));
    expect(tooltip.dataset.open).toBe('false');
});
