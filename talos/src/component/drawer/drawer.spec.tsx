import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import Drawer from './drawer';

afterEach(() => { cleanup(); vi.restoreAllMocks(); document.documentElement.style.fontSize = ''; });

it('preserves an open drawer while search changes its collapsed height', async () => {
    const view = render(<Drawer snapPoints={[64, 450, 700]} snapIndex={2} />);
    const drawer = view.container.firstElementChild as HTMLDivElement;
    await waitFor(() => expect(drawer.style.getPropertyValue('--drawer-size')).toBe('700px'));
    for (const height of [136, 58]) {
        view.rerender(<Drawer snapPoints={[height, 450, 700]} snapIndex={2} />);
        expect(drawer.style.getPropertyValue('--drawer-size')).toBe('700px');
        expect(drawer.dataset.snap).toBe('2');
    }
    view.rerender(<Drawer snapPoints={[58, 450, 700]} snapIndex={1} />);
    await waitFor(() => expect(drawer.style.getPropertyValue('--drawer-size')).toBe('450px'));
});

it('cycles normalized snaps, reports each choice once and ignores disabled activation', async () => {
    const onSnapChange = vi.fn();
    const view = render(<Drawer snapPoints={[300, 0, 100, 100]} onSnapChange={onSnapChange}>Content</Drawer>);
    const drawer = view.container.firstElementChild as HTMLElement;
    const handle = screen.getByRole('button', { name: 'Drawer drag handle' });
    expect(handle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(handle);
    await waitFor(() => expect(drawer.style.getPropertyValue('--drawer-size')).toBe('100px'));
    expect(drawer.dataset.snap).toBe('1');
    expect(onSnapChange).toHaveBeenLastCalledWith(1);
    fireEvent.click(handle);
    await waitFor(() => expect(drawer.dataset.snap).toBe('2'));
    await waitFor(() => expect(drawer.style.getPropertyValue('--drawer-size')).toBe('300px'));
    fireEvent.click(handle);
    await waitFor(() => expect(drawer.dataset.snap).toBe('0'));
    await waitFor(() => expect(drawer.style.getPropertyValue('--drawer-size')).toBe('0px'));
    view.rerender(<Drawer snapPoints={[300, 0, 100]} disabled />);
    expect(handle.hasAttribute('disabled')).toBe(true);
    fireEvent.click(handle);
    expect(drawer.style.getPropertyValue('--drawer-size')).toBe('0px');
    expect(onSnapChange.mock.calls).toEqual([[1], [2], [0]]);
});

it('resolves rem lengths and reapplies an active snap when the dimensions change', async () => {
    document.documentElement.style.fontSize = '20px';
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        return new DOMRect(0, 0, this.style.width === '1rem' ? 20 : 0, this.style.height === '1rem' ? 20 : 0);
    });
    const view = render(<Drawer snapPoints={['2rem', '10rem']} handleSize="1rem" snapIndex={1} />);
    const drawer = view.container.firstElementChild as HTMLElement;
    expect(screen.getByRole('button', { name: 'Drawer drag handle' }).getAttribute('aria-expanded')).toBe('true');
    expect(drawer.style.getPropertyValue('--handle-size')).toBe('1rem');
    await waitFor(() => expect(drawer.style.getPropertyValue('--drawer-size')).toBe('200px'));
    view.rerender(<Drawer snapPoints={[40, 250]} handleSize={24} snapIndex={1} />);
    await waitFor(() => expect(drawer.style.getPropertyValue('--drawer-size')).toBe('250px'));
    view.unmount();
    document.documentElement.style.fontSize = '';
});

function touch(target: HTMLElement, type: string, y: number) {
    const point: Touch = { identifier: 1, target, clientX: 80, clientY: y, pageX: 80, pageY: y, screenX: 80, screenY: y, radiusX: 1, radiusY: 1, rotationAngle: 0, force: 1 };
    fireEvent(target, new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [point], changedTouches: [point], targetTouches: type === 'touchend' ? [] : [point] }));
}

it('handles a real touch drag and gives scrollable content and controls priority', async () => {
    const view = render(<Drawer defaultSnapIndex={1} snapPoints={[0, 100, 300]}><div data-testid="surface">Content</div><div data-testid="scroll" style={{ overflowY: 'auto' }}>Scroll</div><button>Action</button></Drawer>);
    const drawer = view.container.firstElementChild as HTMLElement;
    const surface = screen.getByTestId('surface');
    touch(surface, 'touchstart', 400);
    touch(surface, 'touchmove', 180);
    touch(surface, 'touchend', 180);
    await waitFor(() => expect(drawer.style.getPropertyValue('--drawer-size')).toBe('300px'));
    const scroll = screen.getByTestId('scroll');
    Object.defineProperties(scroll, { clientHeight: { configurable: true, value: 100 }, scrollHeight: { configurable: true, value: 500 } });
    scroll.scrollTop = 100;
    touch(scroll, 'touchstart', 200);
    touch(scroll, 'touchmove', 400);
    touch(scroll, 'touchend', 400);
    expect(drawer.style.getPropertyValue('--drawer-size')).toBe('300px');
    const action = screen.getByRole('button', { name: 'Action' });
    touch(action, 'touchstart', 200);
    touch(action, 'touchmove', 400);
    touch(action, 'touchend', 400);
    expect(drawer.style.getPropertyValue('--drawer-size')).toBe('300px');
    expect(screen.getByRole('button', { name: 'Drawer drag handle' }).hasAttribute('data-dragging')).toBe(false);
    expect(drawer.style.overscrollBehavior).toBe('');
});

it('releases an active gesture when dragging becomes disabled and allows the next gesture', async () => {
    const content = <div data-testid="surface">Content</div>;
    const view = render(<Drawer defaultSnapIndex={1} snapPoints={[0, 100, 300]}>{content}</Drawer>);
    const drawer = view.container.firstElementChild as HTMLElement;
    drawer.style.touchAction = 'pan-y';
    drawer.style.overscrollBehavior = 'auto';
    const surface = screen.getByTestId('surface'), handle = screen.getByRole('button', { name: 'Drawer drag handle' });
    touch(surface, 'touchstart', 400);
    touch(surface, 'touchmove', 300);
    expect(handle.hasAttribute('data-dragging')).toBe(true);
    view.rerender(<Drawer defaultSnapIndex={1} snapPoints={[0, 100, 300]} disabled>{content}</Drawer>);
    touch(surface, 'touchend', 300);
    expect(handle.hasAttribute('data-dragging')).toBe(false);
    expect(drawer.style.overscrollBehavior).toBe('auto');
    expect(drawer.style.touchAction).toBe('pan-y');
    view.rerender(<Drawer defaultSnapIndex={1} snapPoints={[0, 100, 300]}>{content}</Drawer>);
    touch(surface, 'touchstart', 300);
    touch(surface, 'touchmove', 80);
    touch(surface, 'touchend', 80);
    await waitFor(() => expect(drawer.style.getPropertyValue('--drawer-size')).toBe('300px'));
});

it('releases an accepted drag when reversing direction gives the scrollable content priority', async () => {
    const view = render(<Drawer defaultSnapIndex={1} snapPoints={[0, 100, 300]}><div data-testid="scroll" style={{ overflowY: 'auto' }}>Scroll</div><div data-testid="surface">Content</div></Drawer>);
    const drawer = view.container.firstElementChild as HTMLElement;
    drawer.style.touchAction = 'pan-y';
    drawer.style.overscrollBehavior = 'auto';
    const scroll = screen.getByTestId('scroll'), handle = screen.getByRole('button', { name: 'Drawer drag handle' });
    Object.defineProperties(scroll, { clientHeight: { configurable: true, value: 100 }, scrollHeight: { configurable: true, value: 500 } });
    scroll.scrollTop = 0;
    touch(scroll, 'touchstart', 200);
    touch(scroll, 'touchmove', 300);
    expect(handle.hasAttribute('data-dragging')).toBe(true);
    // At the top, down belongs to the drawer; reversing past the start lets
    // the content scroll down. Cancellation must release the accepted owner.
    touch(scroll, 'touchmove', 100);
    expect(handle.hasAttribute('data-dragging')).toBe(false);
    expect(drawer.style.touchAction).toBe('pan-y');
    expect(drawer.style.overscrollBehavior).toBe('auto');
    touch(scroll, 'touchend', 100);
    await waitFor(() => expect(drawer.style.getPropertyValue('--drawer-size')).toBe('100px'));
    expect(drawer.dataset.snap).toBe('1');
    const surface = screen.getByTestId('surface');
    touch(surface, 'touchstart', 400);
    touch(surface, 'touchmove', 80);
    touch(surface, 'touchend', 80);
    await waitFor(() => expect(drawer.style.getPropertyValue('--drawer-size')).toBe('300px'));
    expect(drawer.style.touchAction).toBe('pan-y');
    expect(drawer.style.overscrollBehavior).toBe('auto');
});

it('lets a touch drag take ownership from an unfinished snap animation', async () => {
    const view = render(<Drawer snapPoints={[0, 100, 300]}><div data-testid="surface">Content</div></Drawer>);
    const drawer = view.container.firstElementChild as HTMLElement;
    fireEvent.click(screen.getByRole('button', { name: 'Drawer drag handle' }));
    await waitFor(() => {
        const size = parseFloat(drawer.style.getPropertyValue('--drawer-size'));
        expect(size).toBeGreaterThan(0);
        expect(size).toBeLessThan(100);
    });
    const surface = screen.getByTestId('surface');
    touch(surface, 'touchstart', 400);
    touch(surface, 'touchmove', 120);
    const held = drawer.style.getPropertyValue('--drawer-size');
    expect(parseFloat(held)).toBeGreaterThan(200);
    // The pending snap must not continue moving beneath the held pointer.
    await act(() => new Promise<void>((resolve) => window.setTimeout(resolve, 300)));
    expect(drawer.style.getPropertyValue('--drawer-size')).toBe(held);
    touch(surface, 'touchend', 120);
    await waitFor(() => expect(drawer.style.getPropertyValue('--drawer-size')).toBe('300px'));
});

it('applies a controlled stop requested during a drag after releasing the pointer', async () => {
    const content = <div data-testid="surface">Content</div>;
    const onSnapChange = vi.fn();
    const view = render(<Drawer snapPoints={[0, 100, 300]} snapIndex={1} onSnapChange={onSnapChange}>{content}</Drawer>);
    const drawer = view.container.firstElementChild as HTMLElement;
    const surface = screen.getByTestId('surface');
    touch(surface, 'touchstart', 200);
    touch(surface, 'touchmove', 260);
    const held = drawer.style.getPropertyValue('--drawer-size');
    view.rerender(<Drawer snapPoints={[0, 100, 300]} snapIndex={2} onSnapChange={onSnapChange}>{content}</Drawer>);
    expect(drawer.style.getPropertyValue('--drawer-size')).toBe(held);
    touch(surface, 'touchend', 260);
    await waitFor(() => expect(drawer.dataset.snap).toBe('2'));
    expect(drawer.style.getPropertyValue('--drawer-size')).toBe('300px');
    expect(onSnapChange).not.toHaveBeenCalled();
});
