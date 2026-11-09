import type { ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type Language from '@main/component/shared/language/language';
import IntelHeadBar from './intelHeadBar';
import { flush } from '../../fixtures';

const runtime = vi.hoisted(() => ({ dark: false, init: vi.fn(), cleanup: vi.fn(), toggle: vi.fn(), prepare: vi.fn(), commit: vi.fn(), fonts: vi.fn() }));
vi.mock('@main/platform/useTheme', () => ({ useTheme: () => runtime.dark ? 'dark' : 'light' }));
vi.mock('@main/platform/theme', () => ({ initTheme: runtime.init, cleanupTheme: runtime.cleanup, toggleTheme: runtime.toggle }));
vi.mock('@main/locale', () => ({ useTranslateUI: () => (key: string) => key, getFontRegionForLocale: (locale: string) => locale === 'ja-JP' ? 'jp' : undefined }));
vi.mock('@main/locale/fontLoader', () => ({ preloadFontRegion: runtime.fonts }));
vi.mock('@intel/locale', () => ({ preloadLocale: runtime.prepare, applyLocaleData: runtime.commit }));
// The common language chooser is tested by its owner; this contract checks
// that Intel wires the chooser to its own catalog rather than main-site data.
vi.mock('@main/component/shared/language/language', () => ({ default: (props: ComponentProps<typeof Language>) => props.open ? <button onClick={() => { props.preloadFonts?.('ja-JP'); props.commitLocale?.('ja-JP', { fixture: true }); props.onChange?.(false); }}>Choose Japanese</button> : null }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });
it('owns theme lifecycle and commits language changes to the independent Intel catalog', async () => {
    const view = render(<IntelHeadBar />);
    expect(runtime.init).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'headbar.darkmode' }));
    expect(runtime.toggle).toHaveBeenCalledOnce();
    expect(screen.queryByText('Choose Japanese')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'headbar.language' }));
    await flush(() => { fireEvent.click(screen.getByRole('button', { name: 'Choose Japanese' })); });
    expect(runtime.commit).toHaveBeenCalledWith('ja-JP', { fixture: true });
    expect(runtime.fonts).toHaveBeenCalledWith('jp');
    expect(screen.queryByText('Choose Japanese')).toBeNull();
    view.unmount();
    expect(runtime.cleanup).toHaveBeenCalledOnce();
});
