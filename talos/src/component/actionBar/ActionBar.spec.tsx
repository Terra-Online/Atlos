import { act, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import ActionBar, { FloatingActionBar } from './ActionBar';
import { installPopover } from '../../../test-support/browser';

it.each(['unmount', 'empty items', 'inline mode'] as const)('releases the floating overlay on %s after its element ref is cleared', (mode) => {
    const onFloatingDismiss = vi.fn();
    const popover = installPopover();
    const items = [{ id: 'bold', label: 'Bold', icon: 'B' }];
    const anchor = new DOMRect(40, 80, 100, 20);
    const view = render(<FloatingActionBar selection={anchor} items={items} onDismiss={onFloatingDismiss} />);
    try {
        const toolbar = screen.getByRole('toolbar');
        expect(toolbar.style.zIndex).toBe('1000');
        if (mode === 'unmount') view.unmount();
        else view.rerender(mode === 'inline mode'
            ? <ActionBar items={items} />
            : <FloatingActionBar selection={anchor} items={[]} onDismiss={onFloatingDismiss} />);
        expect(toolbar.style.zIndex).toBe('');
        const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
        document.dispatchEvent(escape);
        expect(escape.defaultPrevented).toBe(false);
        expect(onFloatingDismiss).not.toHaveBeenCalled();
    } finally {
        view.unmount();
        popover.restore();
    }
});

it('isolates a closing toolbar and cancels that close when its selection reopens', async () => {
    vi.useFakeTimers();
    const prototype = HTMLElement.prototype;
    const show = Object.getOwnPropertyDescriptor(prototype, 'showPopover');
    const hide = Object.getOwnPropertyDescriptor(prototype, 'hidePopover');
    Object.defineProperties(prototype, {
        showPopover: { configurable: true, value(this: HTMLElement) { this.dataset.testPopoverOpen = 'true'; } },
        hidePopover: { configurable: true, value(this: HTMLElement) { this.dataset.testPopoverOpen = 'false'; } },
    });
    const matches = Reflect.get(Element.prototype, 'matches');
    const match = vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: HTMLElement, selector: string) {
        return selector === ':popover-open' ? this.dataset.testPopoverOpen === 'true' : matches.call(this, selector);
    });
    const items = [{ id: 'bold', label: 'Bold', icon: 'B', onClick: vi.fn() }];
    const anchor = new DOMRect(40, 80, 100, 20);
    const view = render(<FloatingActionBar selection={anchor} items={items} />);
    try {
        const toolbar = screen.getByRole('toolbar');
        const top = toolbar.style.top;
        view.rerender(<FloatingActionBar selection={null} items={items} />);
        expect(toolbar.hasAttribute('inert')).toBe(true);
        act(() => { window.dispatchEvent(new Event('resize')); });
        await act(() => vi.advanceTimersToNextFrame());
        expect(toolbar.style.top).toBe(top);
        await act(() => vi.advanceTimersByTime(60));
        view.rerender(<FloatingActionBar selection={anchor} items={items} />);
        expect(toolbar.hasAttribute('inert')).toBe(false);
        await act(() => vi.advanceTimersByTime(200));
        expect(toolbar.dataset.open).toBe('true');
    } finally {
        view.unmount(); match.mockRestore(); vi.useRealTimers();
        if (show) Object.defineProperty(prototype, 'showPopover', show);
        else Reflect.deleteProperty(prototype, 'showPopover');
        if (hide) Object.defineProperty(prototype, 'hidePopover', hide);
        else Reflect.deleteProperty(prototype, 'hidePopover');
    }
});
