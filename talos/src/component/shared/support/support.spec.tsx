import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SupportModal from './support';
import { translate as t } from '../testFixtures';
import { installResizeObserver } from '../../../../test-support/browser';

vi.mock('@/locale', async () => (await import('../testFixtures')).localeFixture);
vi.mock('@/locale/useFontRegion', async () => {
    const { fontRef } = await import('../testFixtures');
    return { useFontRegion: () => fontRef };
});
vi.mock('@/platform/pictureInPicture', async () => (await import('../testFixtures')).pipFixture);
vi.mock('@/store/uiPrefs', () => ({ usePerformanceMode: () => true }));

beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); installResizeObserver(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); });

it('renders the support content, opens the selected destination securely, and delegates closing', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const onClose = vi.fn();
    const onChange = vi.fn();
    render(<SupportModal open onClose={onClose} onChange={onChange} />);
    for (const [key, url] of [['support.patreon', 'https://www.patreon.com/cirisus/'], ['support.kofi', 'https://ko-fi.com/cirisus'], ['support.afdian', 'https://afdian.com/a/cirisus']]) {
        fireEvent.click(screen.getByRole('button', { name: t(key) }));
        expect(open).toHaveBeenLastCalledWith(url, '_blank', 'noopener,noreferrer');
    }
    fireEvent.click(screen.getByRole('button', { name: t('common.close') }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith(false);
});
