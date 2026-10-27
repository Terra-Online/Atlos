import { useRef, useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installPointerCapture, setRect, setScrollMetrics } from '../../../test-support/browser';
import { useScopedBoxSelection } from './useScopedBoxSelection';
import { useSelectionVisibility } from './useSelectionVisibility';
import { useBoxSelectionEngine } from './useBoxSelectionEngine';

const platform = vi.hoisted(() => ({ document: null as Document | null }));
vi.mock('@/platform/pictureInPicture', () => ({ useAppDocument: () => platform.document ?? document }));

let restoreCapture: () => void;
beforeEach(() => { platform.document = null; vi.useFakeTimers(); restoreCapture = installPointerCapture(); });
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

function MixedSelection({ onChange }: { onChange: (keys: string[]) => void }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const selectionBoxRef = useRef<HTMLDivElement>(null);
    const [keys, setKeys] = useState(['a', 'unrelated']);
    useBoxSelectionEngine({
        containerRef, selectionBoxRef, getInitialKeys: () => keys,
        onChange: (next) => { setKeys(next); onChange(next); },
        canStart: (target) => target.hasAttribute('data-blank'),
        // Toggle comes first in DOM order; activation still owns overlapping keys.
        collectTargets: ({ container, elementToContentRect }) => [...container.querySelectorAll<HTMLElement>('[data-mode]')].map((element) => ({
            element, keys: element.dataset.keys!.split(','), rect: elementToContentRect(element),
            mode: element.dataset.mode === 'activate' ? 'activate' : 'toggle',
        })),
        syncTarget: ({ element }, active) => { element?.setAttribute('aria-pressed', String(active)); },
    });
    return <div ref={containerRef} data-testid="mixed">
        <div data-blank>Mixed blank</div>
        <div data-mode="toggle" data-keys="a,b,c">Toggle targets</div>
        <div data-mode="activate" data-keys="a,b">Activate targets</div>
        <div ref={selectionBoxRef} />
        <output data-testid="mixed-keys">{keys.join(',')}</output>
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

it('lets activation win overlapping toggles while retaining the existing selection outside the box', () => {
    const onChange = vi.fn<(keys: string[]) => void>();
    render(<MixedSelection onChange={onChange} />);
    const container = screen.getByTestId('mixed');
    setRect(container, 0, 0, 300, 300); setScrollMetrics(container, 300, 300);
    for (const target of container.querySelectorAll<HTMLElement>('[data-mode]')) setRect(target, 30, 30, 30, 30);
    const blank = screen.getByText('Mixed blank');
    const select = () => {
        pointer(blank, 'pointerdown', 0, 0);
        pointer(window, 'pointermove', 100, 100);
        act(() => { vi.advanceTimersToNextFrame(); });
        expect(screen.getByText('Activate targets').getAttribute('aria-pressed')).toBe('true');
        pointer(window, 'pointerup', 100, 100);
    };
    select();
    expect(onChange).toHaveBeenCalledExactlyOnceWith(['a', 'unrelated', 'b', 'c']);
    expect(screen.getByTestId('mixed-keys').textContent).toBe('a,unrelated,b,c');
    select();
    // Already selected a/b stay active; only ordinary c toggles back off.
    expect(onChange).toHaveBeenLastCalledWith(['a', 'unrelated', 'b']);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('mixed-keys').textContent).toBe('a,unrelated,b');
});

it('auto-scrolls in both directions within browser bounds, selects offscreen content and stops on cancellation', () => {
    const { container, blank, onChange } = fixture([]);
    let scrollTop = 0;
    // jsdom does not clamp scrolling. Model the browser's legal range, without
    // encoding the engine's velocity or acceleration into the fixture.
    Object.defineProperty(container, 'scrollTop', {
        configurable: true, get: () => scrollTop,
        set: (value: number) => { scrollTop = Math.max(0, Math.min(300, value)); },
    });
    const offscreen = container.querySelector<HTMLElement>('[data-item="a"]')!;
    vi.spyOn(offscreen, 'getBoundingClientRect').mockImplementation(() => new DOMRect(30, 350 - scrollTop, 15, 15));
    const visible = container.querySelector<HTMLElement>('[data-item="b"]')!;
    vi.spyOn(visible, 'getBoundingClientRect').mockImplementation(() => new DOMRect(50, 70 - scrollTop, 15, 15));
    pointer(blank, 'pointerdown', 10, 50);
    pointer(window, 'pointermove', 100, 295);
    act(() => { vi.advanceTimersToNextFrame(); });
    expect(offscreen.getAttribute('aria-pressed')).toBe('false');
    act(() => { vi.advanceTimersByTime(1000); });
    expect(container.scrollTop).toBe(300);
    expect(offscreen.getAttribute('aria-pressed')).toBe('true');
    expect(container.hasPointerCapture(1)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    pointer(window, 'pointermove', 100, 5);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(container.scrollTop).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    pointer(window, 'pointermove', 100, 295);
    act(() => { vi.advanceTimersByTime(80); });
    expect(container.scrollTop).toBeGreaterThan(0);
    expect(container.scrollTop).toBeLessThan(300);
    pointer(window, 'pointercancel', 100, 295);
    const cancelledAt = container.scrollTop;
    const callbacks = onChange.mock.calls.length;
    expect(container.hasPointerCapture(1)).toBe(false);
    expect(container.style.scrollBehavior).toBe('smooth');
    expect(document.body.style.userSelect).not.toBe('none');
    act(() => { vi.advanceTimersByTime(500); });
    expect(container.scrollTop).toBe(cancelledAt);
    expect(onChange).toHaveBeenCalledTimes(callbacks);
    expect(vi.getTimerCount()).toBe(0);
});

it('moves pointer, frame and text-selection ownership with the app document', () => {
    const view = fixture([]);
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const otherDocument = frame.contentDocument!;
    const otherWindow = frame.contentWindow!;
    otherWindow.requestAnimationFrame = window.requestAnimationFrame.bind(window);
    otherWindow.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
    const requestFrame = vi.spyOn(otherWindow, 'requestAnimationFrame');
    document.body.style.userSelect = 'text';
    otherDocument.body.style.userSelect = 'auto';
    try {
        pointer(view.blank, 'pointerdown', 10, 50);
        pointer(window, 'pointermove', 100);
        expect(view.container.hasPointerCapture(1)).toBe(true);
        // PiP adopts the existing application root rather than remounting it.
        otherDocument.body.append(view.baseElement.querySelector('[data-testid="selection"]')!.parentElement!);
        platform.document = otherDocument;
        view.rerender(<Selection initial={[]} onChange={view.onChange} />);
        expect(view.container.dataset.selecting).toBe('false');
        expect(view.container.hasPointerCapture(1)).toBe(false);
        expect(document.body.style.userSelect).toBe('text');
        expect(view.onChange).not.toHaveBeenCalled();
        pointer(view.blank, 'pointerdown', 10, 50);
        pointer(otherWindow, 'pointermove', 100);
        expect(view.container.dataset.selecting).toBe('true');
        expect(otherDocument.body.style.userSelect).toBe('none');
        expect(document.body.style.userSelect).toBe('text');
        expect(requestFrame).toHaveBeenCalled();
        pointer(otherWindow, 'pointerup', 100);
        expect(view.onChange).toHaveBeenCalledExactlyOnceWith(['a', 'b']);
        expect(view.container.hasPointerCapture(1)).toBe(false);
        expect(otherDocument.body.style.userSelect).toBe('auto');
    } finally {
        view.unmount();
        frame.remove();
        document.body.style.userSelect = '';
    }
});
