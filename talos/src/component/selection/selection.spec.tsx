import { useRef, useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installPointerCapture, setRect, setScrollMetrics } from '../../../test-support/browser';
import { useScopedBoxSelection } from './useScopedBoxSelection';
import { useSelectionVisibility } from './useSelectionVisibility';

let restoreCapture: () => void;
beforeEach(() => { vi.useFakeTimers(); restoreCapture = installPointerCapture(); });
afterEach(() => { cleanup(); restoreCapture(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

function Selection({ initial = ['a'], onChange = () => {} }: { initial?: string[]; onChange?: (keys: string[]) => void }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const selectionBoxRef = useRef<HTMLDivElement>(null);
    const [keys, setKeys] = useState(initial);
    const { isSelecting } = useScopedBoxSelection({ containerRef, selectionBoxRef, itemSelector: '[data-item]', keyAttribute: 'data-item', activeAttribute: 'data-active', getInitialKeys: () => keys, onChange: (next) => { setKeys(next); onChange(next); } });
    const { visible, fading } = useSelectionVisibility(isSelecting, 250);
    return <div ref={containerRef} data-testid="selection" data-selecting={isSelecting} style={{ scrollBehavior: 'smooth' }}>
        <div data-testid="blank">Drag here</div>
        <button>Action</button>
        <input aria-label="Search" />
        <div data-drag-handle>Handle</div>
        {['a', 'b', 'hidden'].map((key) => <div key={key} data-item={key} hidden={key === 'hidden'} aria-pressed={keys.includes(key)}>{key}</div>)}
        <div ref={selectionBoxRef} data-testid="box" data-visible={visible} data-fading={fading} />
        <output>{keys.join(',')}</output>
    </div>;
}

function fixture(initial?: string[]) {
    const onChange = vi.fn();
    const view = render(<Selection initial={initial} onChange={onChange} />);
    const container = screen.getByTestId('selection');
    setRect(container, 0, 0, 300, 300);
    setScrollMetrics(container, 300, 600);
    for (const [index, item] of [...container.querySelectorAll<HTMLElement>('[data-item]')].entries()) {
        setRect(item, 30 + index * 20, 70, 15, 15);
        Object.defineProperty(item, 'checkVisibility', { configurable: true, value: () => !item.hidden });
    }
    return { ...view, container, onChange, blank: screen.getByTestId('blank'), box: screen.getByTestId('box') };
}

const pointer = (target: Element | Window, type: string, clientX: number, clientY = 100, options: PointerEventInit = {}) => fireEvent(target, new PointerEvent(type, { bubbles: true, cancelable: true, clientX, clientY, ...options }));

it('toggles intersected visible items against initial keys, then flushes the batch on release and fades', async () => {
    const { container, onChange, blank, box } = fixture();
    pointer(blank, 'pointerdown', 10, 50);
    pointer(window, 'pointermove', 100);
    await act(() => vi.advanceTimersToNextFrame());
    expect(container.dataset.selecting).toBe('true');
    expect(box.dataset.visible).toBe('true');
    expect(container.hasPointerCapture(1)).toBe(true);
    expect(container.querySelector('[data-item="a"]')?.getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector('[data-item="b"]')?.getAttribute('data-active')).toBe('true');
    expect(container.querySelector('[data-item="hidden"]')?.getAttribute('aria-pressed')).toBe('false');
    expect(onChange).not.toHaveBeenCalled();
    pointer(window, 'pointerup', 100);
    expect(onChange).toHaveBeenCalledExactlyOnceWith(['b']);
    expect(container.hasPointerCapture(1)).toBe(false);
    expect(box.dataset.fading).toBe('true');
    await act(() => vi.advanceTimersByTime(250));
    expect(box.dataset.visible).toBe('false');
    // A second gesture starts from the owner's latest keys, rather than mount-time keys.
    pointer(blank, 'pointerdown', 10, 50);
    pointer(window, 'pointermove', 100);
    pointer(window, 'pointerup', 100);
    expect(onChange).toHaveBeenLastCalledWith(['a']);
});

it('does not start from controls, cards or drag handles, from secondary buttons, or before the threshold', () => {
    const { blank, container, onChange } = fixture([]);
    const targets = [screen.getByRole('button'), screen.getByRole('textbox'), screen.getByText('Handle'), container.querySelector('[data-item="a"]')!];
    for (const target of targets) {
        pointer(target, 'pointerdown', 10, 50);
        pointer(window, 'pointermove', 100);
        pointer(window, 'pointerup', 100);
    }
    pointer(blank, 'pointerdown', 10, 50, { button: 2 });
    pointer(window, 'pointermove', 100);
    pointer(window, 'pointerup', 100);
    pointer(blank, 'pointerdown', 10, 50);
    pointer(window, 'pointermove', 12, 51);
    pointer(window, 'pointerup', 12, 51);
    expect(onChange).not.toHaveBeenCalled();
    expect(container.dataset.selecting).toBe('false');
    expect(container.hasPointerCapture(1)).toBe(false);
});

it('ignores a different pointer and restores scroll/text policies after cancellation or unmount', () => {
    document.body.style.userSelect = 'text';
    const { blank, container, onChange, unmount } = fixture([]);
    pointer(blank, 'pointerdown', 10, 50);
    pointer(window, 'pointermove', 100, 100, { pointerId: 2 });
    expect(container.dataset.selecting).toBe('false');
    pointer(window, 'pointermove', 100);
    expect(document.body.style.userSelect).toBe('none');
    expect(container.style.scrollBehavior).toBe('auto');
    pointer(window, 'pointercancel', 100);
    expect(onChange).toHaveBeenCalledExactlyOnceWith(['a', 'b']);
    expect(document.body.style.userSelect).toBe('text');
    expect(container.style.scrollBehavior).toBe('smooth');
    pointer(blank, 'pointerdown', 10, 50);
    pointer(window, 'pointermove', 100);
    unmount();
    pointer(window, 'pointerup', 100);
    expect(onChange).toHaveBeenCalledOnce();
    expect(document.body.style.userSelect).toBe('text');
    expect(container.hasPointerCapture(1)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    document.body.style.userSelect = '';
});
