import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installPointerCapture, installPopover } from '../../../test-support/browser';
import ActionBar, { FloatingActionBar, type ActionBarItem } from './ActionBar';

vi.mock('@/locale/fontLoader', () => ({ registerFontRegion: () => ({ update() {}, stop() {} }) }));
vi.mock('@/platform/pictureInPicture', () => ({ useAppDocument: () => document }));
let popover: ReturnType<typeof installPopover>;
let restorePointer: () => void;
beforeEach(() => {
    vi.useFakeTimers(); popover = installPopover(); restorePointer = installPointerCapture();
    // No layout hit-testing in jsdom; these cases use event.target ownership.
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => null });
});
afterEach(() => { cleanup(); Reflect.deleteProperty(document, 'elementFromPoint'); popover.restore(); restorePointer(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('exposes action state and isolates inline actions from the card click', () => {
    const clicked = vi.fn(), parent = vi.fn();
    render(<div onClick={parent}><ActionBar items={[
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
    render(<><input aria-label="Editor" /><FloatingActionBar selection={new DOMRect(40, 80, 100, 20)} items={[{ id: 'bold', label: 'Bold', icon: 'B', onClick: clicked }]} onDismiss={dismissed} /></>);
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

function Card({ items }: { items: ActionBarItem[] }) {
    const ref = useRef<HTMLDivElement>(null);
    return <div ref={ref} data-testid="card">
        <button>Anchor</button>
        <FloatingActionBar targetRef={ref} items={items} />
    </div>;
}

it('opens on root hover or touch and cancels closing when the pointer returns', async () => {
    render(<Card items={[{ id: 'share', label: 'Share', icon: 'S' }]} />);
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

it('does not let an old root blur close a toolbar that acquired a controlled selection', async () => {
    const items = [{ id: 'bold', label: 'Bold', icon: 'B' }];
    const page = (controlled: boolean) => <>
        {controlled ? <FloatingActionBar selection={new DOMRect(40, 80, 100, 20)} items={items} /> : <Card items={items} />}
        <button>Outside</button>
    </>;
    const view = render(page(false));
    act(() => screen.getByRole('button', { name: 'Anchor' }).focus());
    act(() => screen.getByRole('button', { name: 'Outside' }).focus());
    view.rerender(page(true));
    await act(() => vi.advanceTimersByTime(200));
    expect(popover.isOpen(screen.getByRole('toolbar'))).toBe(true);
});

it('cancels deferred focus checks when the floating toolbar unmounts', () => {
    // This teardown case owns focus events; native focus/selectionchange is
    // exercised by the controlled-selection regression above.
    const view = render(<><Card items={[{ id: 'bold', label: 'Bold', icon: 'B' }]} /><button>Outside</button></>);
    fireEvent.focusIn(screen.getByRole('button', { name: 'Anchor' }));
    fireEvent.focusOut(screen.getByRole('button', { name: 'Anchor' }), { relatedTarget: screen.getByRole('button', { name: 'Outside' }) });
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
});
