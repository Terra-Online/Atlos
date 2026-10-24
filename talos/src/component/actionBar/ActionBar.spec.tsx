import { act, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import ActionBar from './ActionBar';

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
    const view = render(<ActionBar variant="floating" anchorRect={anchor} items={items} />);
    try {
        const toolbar = screen.getByRole('toolbar');
        const top = toolbar.style.top;
        view.rerender(<ActionBar variant="floating" anchorRect={null} items={items} />);
        expect(toolbar.hasAttribute('inert')).toBe(true);
        act(() => { window.dispatchEvent(new Event('resize')); });
        await act(() => vi.advanceTimersToNextFrame());
        expect(toolbar.style.top).toBe(top);
        await act(() => vi.advanceTimersByTime(60));
        view.rerender(<ActionBar variant="floating" anchorRect={anchor} items={items} />);
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
