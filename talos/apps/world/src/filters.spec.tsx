import {
    fireEvent,
    render,
    screen,
    within,
    cleanup,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Viewer } from '@endfield-noclip/viewer/host';
import type { PhotoFilter } from '@endfield-noclip/package-format/photo-filters';
import { PanelProvider } from '../../../.cache/noclip/packages/viewer/src/ui/panel';
import { PhotoFiltersPanel } from '../../../.cache/noclip/packages/viewer/src/ui/photo-filters';
import { SettingsPanel } from '../../../.cache/noclip/packages/viewer/src/ui/settings-panel';
import { DEFAULT_OPTIONS } from '../../../.cache/noclip/packages/viewer/src/viewer/options';
import { Panel } from './panel';

vi.mock('@/locale/fontLoader', () => ({
    registerFontRegion: () => ({ update() {}, stop() {} }),
}));

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

it('puts game looks in Filters and keeps renderer controls in Display with the host panel shell', async () => {
    const listeners = new Set<() => void>();
    let revision = 0;
    const state = {
        options: { ...DEFAULT_OPTIONS },
        photoFilters: [] as PhotoFilter[],
        environmentName: null,
        environmentRevision: 0,
        appliedVolumes: [],
        environmentPhases: () => [],
        get stateRevision() {
            return revision;
        },
        subscribe: (listener: () => void) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        setOptions: vi.fn((patch: Partial<Viewer['options']>) => {
            Object.assign(state.options, patch);
            revision++;
            listeners.forEach((listener) => listener());
        }),
        setPhotoFilters: (filters: PhotoFilter[]) => {
            state.photoFilters = filters;
            revision++;
            listeners.forEach((listener) => listener());
        },
    };
    const viewer = state as unknown as Viewer;
    const fetch = vi.fn(() =>
        Promise.resolve({
            ok: true,
            json: () =>
                Promise.resolve({
                    format: 'endfield-noclip.photo-filters',
                    version: 4,
                    filters: [
                        {
                            id: 'test-look',
                            name: 'Test look',
                            unsupported: [],
                            grading: null,
                            vignette: null,
                            lut: {
                                size: 4,
                                format: 'bc7-rgba-unorm',
                                data: btoa('\0'.repeat(64)),
                                contribution: 1,
                            },
                        },
                    ],
                }),
        }),
    );
    vi.stubGlobal('fetch', fetch);
    render(
        <PanelProvider component={Panel}>
            <PhotoFiltersPanel viewer={viewer} source='/filter-library.json' />
            <SettingsPanel viewer={viewer} />
        </PanelProvider>,
    );
    const picker = await screen.findByRole('combobox', { name: 'filter' });
    const filters = screen.getByRole('region', { name: 'filters' });
    const display = within(
        screen.getByRole('region', { name: 'display settings' }),
    );
    const anySignal: unknown = expect.any(AbortSignal);
    expect(fetch).toHaveBeenCalledWith('/filter-library.json', {
        signal: anySignal,
    });
    expect(
        within(filters).getByRole('button', { name: 'Filters' }),
    ).toBeDefined();
    expect(within(filters).queryByLabelText('exposure')).toBeNull();
    expect(display.getByRole('combobox', { name: 'tonemapper' })).toBeDefined();
    for (const name of ['auto exposure', 'bloom', 'vignette']) {
        expect(display.getByRole('checkbox', { name })).toBeDefined();
    }
    fireEvent.change(display.getByRole('slider', { name: 'exposure' }), {
        target: { value: '1.5' },
    });
    expect(state.options.exposure).toBe(1.5);
    fireEvent.change(picker, { target: { value: 'test-look' } });
    expect(state.options.photoFilter).toBe('test-look');
    fireEvent.change(
        within(filters).getByRole('slider', { name: 'LUT contribution' }),
        {
            target: { value: '0.5' },
        },
    );
    expect(state.options.photoLutStrength).toBe(0.5);
    expect(state.options.exposure).toBe(1.5);
    const heading = within(filters).getByRole('button', { name: 'Filters' });
    fireEvent.click(heading);
    expect(heading.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(heading);
    expect(screen.getByRole('combobox', { name: 'filter' })).toBe(picker);
    fireEvent.change(picker, { target: { value: '' } });
    expect(state.options.photoFilter).toBeNull();
});
