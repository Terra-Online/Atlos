import { useRef, useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installPointerCapture, setRect, setScrollMetrics } from '../../../../test-support/browser';
import { archives, deferred, flush } from '../fixtures';
import CategoryFilter from './categoryFilter/categoryFilter';
import ArchiveSummary from './archiveSummary/archiveSummary';
import IntelSidebarBrand from './intelSidebarBrand/intelSidebarBrand';
import BoxSelection from './boxSelection/boxSelection';

vi.mock('@intel/data/types', async () => ({ intelArchives: (await import('../fixtures')).archives }));
vi.mock('@intel/locale', async () => {
    const { translate } = await import('../fixtures');
    return { useTranslateUI: () => translate };
});
vi.mock('@main/locale', () => ({ useTranslateUI: () => (key: string) => key }));

let restorePointer: (() => void) | undefined;
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); restorePointer?.(); restorePointer = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('keeps category selection controlled, names completion progress, and supports keyboard activation', () => {
    const toggle = vi.fn();
    const props = { categoryId: 'paper' as const, label: 'Paper', statusLabel: 'Collecting', collected: 1, total: 2, active: false, onToggle: toggle };
    const { rerender } = render(<CategoryFilter {...props} />);
    const button = screen.getByRole('button', { pressed: false });
    fireEvent.click(button);
    for (const key of ['Enter', ' ']) {
        const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
        fireEvent(button, event);
        expect(event.defaultPrevented).toBe(true);
    }
    fireEvent.keyDown(button, { key: 'ArrowDown' });
    expect(toggle.mock.calls).toEqual([['paper'], ['paper'], ['paper']]);
    expect(button.getAttribute('aria-pressed')).toBe('false');
    rerender(<CategoryFilter {...props} active collected={2} statusLabel="Complete" />);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.dataset.intelCategory).toBe('paper');
    expect(screen.getByText('Complete 2/2').getAttribute('data-complete')).toBe('true');
});

it('renders the local archive count while version discovery runs and aborts it on unmount', async () => {
    const response = deferred<Response>();
    const fetch = vi.fn<typeof globalThis.fetch>().mockReturnValue(response.promise);
    vi.stubGlobal('fetch', fetch);
    const view = render(<><ArchiveSummary /><IntelSidebarBrand /></>);
    expect(view.container.querySelector('p')?.textContent).toBe(`${archives.length} archives`);
    expect(screen.getByAltText('sidebar.alt.supportedBy').getAttribute('draggable')).toBe('false');
    const signal = (fetch.mock.calls[0][1] as RequestInit).signal!;
    view.unmount();
    expect(signal.aborted).toBe(true);
    await flush(() => response.reject(new DOMException('Aborted', 'AbortError')));
});

it('validates the SDK manifest origin and includes both version and build in its tooltip', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(new Response(JSON.stringify({ manifest: { path: '/manifests/stable.json' } })))
        .mockResolvedValueOnce(new Response(JSON.stringify({ gameVersion: '1_5_3', gameBuild: 'build-123' })));
    vi.stubGlobal('fetch', fetch);
    let view!: ReturnType<typeof render>;
    await flush(() => { view = render(<ArchiveSummary />); });
    expect(screen.getByRole('tooltip').textContent).toBe('1.5.3 (build-123)');
    expect((fetch.mock.calls[1][0] as URL).href).toBe('https://data.opendfieldmap.org/manifests/stable.json');
    cleanup();
    fetch.mockReset().mockResolvedValueOnce(new Response(JSON.stringify({ manifest: { path: 'https://untrusted.example/a.json' } })));
    await flush(() => { view = render(<ArchiveSummary />); });
    expect(fetch).toHaveBeenCalledOnce();
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(view.container.querySelector('p')?.textContent).toBe(`${archives.length} archives`);
});

it('toggles intersected categories from the initial selection and flushes before the selection fade', async () => {
    restorePointer = installPointerCapture();
    const change = vi.fn();
    function Selectable() {
        const containerRef = useRef<HTMLDivElement>(null);
        const [selected, setSelected] = useState(['a']);
        return <div ref={containerRef} data-testid="selection">
            <BoxSelection containerRef={containerRef} itemSelector="[data-category]" keyAttribute="data-category" activeAttribute="data-active" getInitialKeys={() => selected} onChange={(keys) => { change(keys); setSelected(keys); }} />
            {['a', 'b'].map((key) => <CategoryFilter key={key} categoryId={key === 'a' ? 'paper' : 'digital'} label={key} collected={0} total={1} statusLabel="Collecting" active={selected.includes(key)} onToggle={() => {}} />)}
            <span data-category="a" data-testid="a" /><span data-category="b" data-testid="b" />
        </div>;
    }
    render(<Selectable />);
    const container = screen.getByTestId('selection');
    setRect(container, 0, 0, 300, 300);
    setScrollMetrics(container, 300, 300);
    for (const [i, key] of ['a', 'b'].entries()) {
        const target = screen.getByTestId(key);
        setRect(target, 40 + i * 50, 60, 30, 30);
        Object.defineProperty(target, 'offsetParent', { configurable: true, value: container });
    }
    // Start on background, not on either category button or selection target.
    fireEvent.pointerDown(container, { clientX: 20, clientY: 40, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 140, clientY: 120, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 140, clientY: 120, pointerId: 1 });
    expect(change).toHaveBeenLastCalledWith(['b']);
    expect(screen.getByTestId('a').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('b').getAttribute('aria-pressed')).toBe('true');
    expect(document.body.style.userSelect).toBe('');
    expect(container.hasPointerCapture(1)).toBe(false);
    await act(() => vi.advanceTimersByTime(250));
});
