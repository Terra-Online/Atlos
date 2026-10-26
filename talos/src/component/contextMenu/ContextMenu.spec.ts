import { createElement } from 'react';
import { AnimatePresence } from 'motion/react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ContextMenu from './ContextMenu';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const props = {
    ownerDocument: document, position: { x: -100, y: -100 },
    groups: [{ id: 'history', layout: 'row' as const, items: [
        { id: 'undo', label: 'Undo', onSelect: vi.fn() },
        { id: 'disabled', label: 'Disabled', disabled: true, onSelect: vi.fn() },
        { id: 'redo', label: 'Redo', onSelect: vi.fn() },
    ] }],
};

describe('ContextMenu', () => {
    it('runs enabled actions, keeps opted-in actions open and dismisses ordinary selections', () => {
        const select = vi.fn();
        const onDismiss = vi.fn();
        render(createElement(ContextMenu, { ...props, onDismiss, groups: [{ id: 'actions', items: [
            { id: 'keep', label: 'Keep open', closeOnSelect: false, onSelect: select },
            { id: 'disabled', label: 'Disabled', disabled: true, onSelect: select },
            { id: 'close', label: 'Close after', onSelect: select },
        ] }] }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Disabled' }));
        expect(select).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('menuitem', { name: 'Keep open' }));
        expect(select).toHaveBeenCalledOnce();
        expect(onDismiss).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('menuitem', { name: 'Close after' }));
        expect(select).toHaveBeenCalledTimes(2);
        expect(onDismiss).toHaveBeenCalledOnce();
    });

    it('wraps keyboard navigation, supports Home/End and dismisses on Tab or resize', () => {
        const onDismiss = vi.fn();
        const view = render(createElement(ContextMenu, { ...props, onDismiss }));
        const undo = screen.getByText('Undo'), redo = screen.getByText('Redo');
        fireEvent.keyDown(undo, { key: 'ArrowUp' });
        expect(document.activeElement).toBe(redo);
        fireEvent.keyDown(redo, { key: 'ArrowDown' });
        expect(document.activeElement).toBe(undo);
        fireEvent.keyDown(undo, { key: 'End' });
        expect(document.activeElement).toBe(redo);
        fireEvent.keyDown(redo, { key: 'Home' });
        expect(document.activeElement).toBe(undo);
        fireEvent.keyDown(undo, { key: 'Tab' });
        expect(onDismiss).toHaveBeenCalledOnce();
        fireEvent(window, new Event('resize'));
        expect(onDismiss).toHaveBeenCalledTimes(2);
        view.unmount();
        fireEvent(window, new Event('resize'));
        expect(onDismiss).toHaveBeenCalledTimes(2);
    });

    it('falls back when native top-layer entry throws and tolerates an empty action list', () => {
        const show = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'showPopover');
        const hide = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'hidePopover');
        Object.defineProperties(HTMLElement.prototype, {
            showPopover: { configurable: true, value: () => { throw new Error('Inactive document'); } },
            hidePopover: { configurable: true, value: () => {} },
        });
        try {
            render(createElement(ContextMenu, { ...props, groups: [], onDismiss: vi.fn() }));
            const menu = screen.getByRole('menu');
            expect(menu.dataset.popoverMode).toBe('fallback');
            expect(menu.hasAttribute('popover')).toBe(false);
            expect(() => fireEvent.keyDown(menu, { key: 'ArrowDown' })).not.toThrow();
        } finally {
            cleanup();
            if (show) Object.defineProperty(HTMLElement.prototype, 'showPopover', show);
            else Reflect.deleteProperty(HTMLElement.prototype, 'showPopover');
            if (hide) Object.defineProperty(HTMLElement.prototype, 'hidePopover', hide);
            else Reflect.deleteProperty(HTMLElement.prototype, 'hidePopover');
        }
    });

    it('clamps to the viewport and navigates the compact row, skipping disabled actions', () => {
        const onDismiss = vi.fn();
        render(createElement(ContextMenu, { ...props, onDismiss }));
        const menu = screen.getByRole('menu');
        expect(menu.style.left).toBe('8px');
        expect(menu.style.top).toBe('8px');
        expect(menu.getAttribute('data-popover-mode')).toBe('fallback');
        expect(menu.hasAttribute('popover')).toBe(false);
        expect(document.activeElement).toBe(screen.getByText('Undo'));
        fireEvent.keyDown(screen.getByText('Undo'), { key: 'ArrowRight' });
        expect(document.activeElement).toBe(screen.getByText('Redo'));
        fireEvent.keyDown(screen.getByText('Redo'), { key: 'Escape' });
        expect(onDismiss).toHaveBeenCalledOnce();
    });

    it('uses the native Popover API when the document supports it', () => {
        const prototype = HTMLElement.prototype as HTMLElement & {
            showPopover?: () => void;
            hidePopover?: () => void;
        };
        const originalShow = Object.getOwnPropertyDescriptor(prototype, 'showPopover');
        const originalHide = Object.getOwnPropertyDescriptor(prototype, 'hidePopover');
        const showPopover = vi.fn();
        const hidePopover = vi.fn();
        prototype.showPopover = showPopover;
        prototype.hidePopover = hidePopover;

        const frame = document.createElement('iframe');
        document.body.append(frame);
        const other = frame.contentDocument!;
        Object.assign(other.defaultView!.HTMLElement.prototype, { showPopover, hidePopover });
        try {
            const view = render(createElement(ContextMenu, { ...props, onDismiss: vi.fn() }));
            const menu = screen.getByRole('menu');
            expect(menu.getAttribute('popover')).toBe('manual');
            expect(menu.getAttribute('data-popover-mode')).toBe('native');
            expect(showPopover).toHaveBeenCalledOnce();
            view.rerender(createElement(ContextMenu, { ...props, ownerDocument: other, onDismiss: vi.fn() }));
            expect(showPopover).toHaveBeenCalledTimes(2);
            expect(other.activeElement?.textContent).toBe('Undo');
            view.unmount();
            expect(hidePopover).toHaveBeenCalledTimes(2);
        } finally {
            frame.remove();
            if (originalShow) Object.defineProperty(prototype, 'showPopover', originalShow);
            else Reflect.deleteProperty(prototype, 'showPopover');
            if (originalHide) Object.defineProperty(prototype, 'hidePopover', originalHide);
            else Reflect.deleteProperty(prototype, 'hidePopover');
        }
    });

    it('dismisses outside and keeps an inert menu until its exit animation completes', async () => {
        const onDismiss = vi.fn();
        const view = render(createElement(AnimatePresence, {}, createElement(ContextMenu, { ...props, onDismiss, key: 'menu' })));
        fireEvent.pointerDown(document.body);
        expect(onDismiss).toHaveBeenCalledOnce();
        const menu = screen.getByRole('menu');
        view.rerender(createElement(AnimatePresence));
        expect(menu.isConnected).toBe(true);
        expect(menu.hasAttribute('inert')).toBe(true);
        expect(menu.style.pointerEvents).toBe('none');
        await waitFor(() => expect(menu.isConnected).toBe(false));
    });
});
