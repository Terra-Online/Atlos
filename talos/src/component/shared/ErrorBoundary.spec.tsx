import { cleanup, render, screen } from '@testing-library/react';
import type { ErrorInfo } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import ErrorBoundary from './ErrorBoundary';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function Panel({ failed = false }: { failed?: boolean }) {
    if (failed) throw new Error('panel failed');
    return <p>Panel ready</p>;
}

it('isolates a failing subtree, reports its error, and leaves its sibling usable', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onError = vi.fn<(error: Error, info: ErrorInfo) => void>();
    render(<><ErrorBoundary onError={onError} fallback={<p role="alert">Try another region</p>}><Panel failed /></ErrorBoundary><button>Map tools</button></>);
    expect(screen.getByRole('alert').textContent).toBe('Try another region');
    expect(screen.getByRole('button', { name: 'Map tools' })).toBeTruthy();
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0].message).toBe('panel failed');
    expect(onError.mock.calls[0][1].componentStack).toContain('Panel');
});

it('retries only after an owning reset key changes, comparing key values rather than array identity', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const view = render(<ErrorBoundary resetKeys={['Valley_4', NaN]}><Panel failed /></ErrorBoundary>);
    expect(screen.queryByText('Panel ready')).toBeNull();
    view.rerender(<ErrorBoundary resetKeys={['Valley_4', NaN]}><Panel /></ErrorBoundary>);
    expect(screen.queryByText('Panel ready')).toBeNull();
    view.rerender(<ErrorBoundary resetKeys={['Wuling', NaN]}><Panel /></ErrorBoundary>);
    expect(screen.getByText('Panel ready')).toBeTruthy();
    view.rerender(<ErrorBoundary resetKeys={['Wuling', NaN]}><Panel failed /></ErrorBoundary>);
    view.rerender(<ErrorBoundary resetKeys={['Wuling']}><Panel /></ErrorBoundary>);
    expect(screen.getByText('Panel ready')).toBeTruthy();
});
