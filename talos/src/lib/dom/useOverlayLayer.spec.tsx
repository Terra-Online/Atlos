import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useOverlayLayer } from './useOverlayLayer';

it('moves document listeners and scroll locks when a portal changes documents', () => {
    const other = document.implementation.createHTMLDocument();
    const first = document.createElement('div');
    const second = other.createElement('div');
    document.body.append(first);
    other.body.append(second);
    const ref = { current: first };
    const dismiss = vi.fn();
    const hook = renderHook(({ ownerDocument }) => useOverlayLayer({ present: true, ownerDocument, elementRef: ref, modal: true, onDismiss: dismiss }), { initialProps: { ownerDocument: document } });
    try {
        expect(document.body.style.overflow).toBe('hidden');
        act(() => { ref.current = second; hook.rerender({ ownerDocument: other }); });
        expect(document.body.style.overflow).toBe('');
        expect(other.body.style.overflow).toBe('hidden');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
        expect(dismiss).not.toHaveBeenCalled();
        other.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
        expect(dismiss).toHaveBeenCalledOnce();
    } finally { hook.unmount(); first.remove(); }
    expect(other.body.style.overflow).toBe('');
});
