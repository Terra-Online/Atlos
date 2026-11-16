import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useFontRegion } from './useFontRegion';
import { registerFontRegion, type FontScope } from './fontLoader';
const { stop } = vi.hoisted(() => ({ stop: vi.fn() }));
vi.mock('./fontLoader', () => ({
    registerFontRegion: vi.fn(() => ({ update: vi.fn(), stop })),
}));
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});
function Region({ scope }: { scope: FontScope }) {
    const ref = useFontRegion([], { scope });
    return <div ref={ref} />;
}
it('replaces ownership with the newly selected scope', () => {
    const view = render(<Region scope='critical' />);
    expect(vi.mocked(registerFontRegion).mock.lastCall?.[2]).toEqual({
        scope: 'critical',
    });
    view.rerender(<Region scope='background' />);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(vi.mocked(registerFontRegion).mock.lastCall?.[2]).toEqual({
        scope: 'background',
    });
});
