import { fireEvent, render, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useDividerDrag } from './useDividerDrag';
const owner = vi.hoisted(() => ({ document: null as Document | null }));
vi.mock('@/platform/pictureInPicture', () => ({ useAppDocument: () => owner.document ?? document }));

beforeEach(() => { owner.document = null; vi.stubGlobal('PointerEvent', class extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 0; }
}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it.each(['pointerup', 'pointercancel', 'blur', 'unmount', 'disable', 'restart', 'document'])('cleans a divider drag on %s', (end) => {
    const move = vi.fn(), finish = vi.fn();
    function Separator({ enabled = true }) {
        const start = useDividerDrag(enabled);
        return <div data-testid="separator" onPointerDown={event => start(event, move, finish)} />;
    }
    const view = render(<Separator />);
    const start = () => fireEvent.pointerDown(view.getByTestId('separator'), { pointerId: 1 });
    start();
    fireEvent.pointerMove(window, { pointerId: 2 });
    fireEvent.pointerUp(window, { pointerId: 2 });
    expect(move).not.toHaveBeenCalled();
    fireEvent.pointerMove(window, { pointerId: 1 });
    expect(move).toHaveBeenCalledTimes(1);
    if (end === 'unmount') view.unmount();
    else if (end === 'document') { owner.document = document.implementation.createHTMLDocument(); view.rerender(<Separator />); }
    else if (end === 'disable') view.rerender(<Separator enabled={false} />);
    else if (end === 'restart') { start(); fireEvent.pointerUp(window, { pointerId: 1 }); }
    else fireEvent(window, end === 'blur' ? new Event('blur') : new PointerEvent(end, { pointerId: 1 }));
    fireEvent.pointerMove(window, { pointerId: 1 });
    fireEvent.pointerCancel(window, { pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(move).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledTimes(['unmount', 'disable', 'document'].includes(end) ? 0 : 1);
});
