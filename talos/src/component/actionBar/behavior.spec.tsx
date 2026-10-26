import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installPointerCapture, installPopover } from '../../../test-support/browser';
import ActionBar from './ActionBar';

vi.mock('@/locale/fontLoader', () => ({ registerFontRegion: () => ({ update() {}, stop() {} }) }));
vi.mock('@/platform/pictureInPicture', () => ({ getAppDocument: () => document, subscribePictureInPictureState: () => () => {} }));
let popover: ReturnType<typeof installPopover>;
let restorePointer: () => void;
beforeEach(() => {
    vi.useFakeTimers(); popover = installPopover(); restorePointer = installPointerCapture();
    // No layout hit-testing in jsdom; these cases use event.target ownership.
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => null });
});
afterEach(() => { cleanup(); Reflect.deleteProperty(document, 'elementFromPoint'); popover.restore(); restorePointer(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it.each(['separate', 'grouped'] as const)('exposes action state and isolates %s actions from the card click', (variant) => {
    const clicked = vi.fn(), parent = vi.fn();
    render(<div onClick={parent}><ActionBar variant={variant} items={[
        { id: 'like', label: 'Like', icon: '+', active: true, confirming: true, onClick: clicked },
        { id: 'remove', label: 'Remove', icon: '-', disabled: true, onClick: clicked },
    ]} /></div>);
    const like = screen.getByRole('button', { name: 'Like', pressed: true });
    expect(like.dataset.confirming).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(clicked).not.toHaveBeenCalled();
    fireEvent.click(like);
    expect(clicked).toHaveBeenCalledOnce();
    expect(parent).not.toHaveBeenCalled();
    expect(screen.getByRole('toolbar').getAttribute('aria-label')).toBe('Actions');
});

it('preserves editor focus for floating selection actions and dismisses only its own layer', () => {
    const clicked = vi.fn(), dismissed = vi.fn();
    render(<><input aria-label="Editor" /><ActionBar variant="floating" anchorRect={new DOMRect(40, 80, 100, 20)} items={[{ id: 'bold', label: 'Bold', icon: 'B', onClick: clicked }]} onFloatingDismiss={dismissed} /></>);
    const input = screen.getByRole('textbox');
    act(() => input.focus());
    const action = screen.getByRole('button', { name: 'Bold' });
    const pointer = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
    fireEvent(action, pointer);
    expect(pointer.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input);
    fireEvent.click(action);
    expect(clicked).toHaveBeenCalledOnce();
    expect(dismissed).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(dismissed).toHaveBeenCalledOnce();
    expect(popover.isOpen(screen.getByRole('toolbar'))).toBe(false);
    expect(document.activeElement).toBe(input);
});

it('opens on root hover or touch and cancels closing when the pointer returns', async () => {
    render(<div data-short-actions-root="true" data-testid="card"><ActionBar variant="floating" items={[{ id: 'share', label: 'Share', icon: 'S' }]} /></div>);
    const card = screen.getByTestId('card'), toolbar = screen.getByRole('toolbar');
    fireEvent(card, new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    expect(popover.isOpen(toolbar)).toBe(true);
    fireEvent(card, new PointerEvent('pointerleave', { pointerType: 'mouse' }));
    await act(() => vi.advanceTimersByTime(60));
    fireEvent(card, new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    await act(() => vi.advanceTimersByTime(200));
    expect(popover.isOpen(toolbar)).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(popover.isOpen(toolbar)).toBe(false);
    fireEvent(card, new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
    expect(popover.isOpen(toolbar)).toBe(true);
    fireEvent(window, new Event('blur'));
    expect(popover.isOpen(toolbar)).toBe(false);
});
