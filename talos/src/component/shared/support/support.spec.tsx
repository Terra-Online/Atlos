import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SupportModal from './support';
import SupportAutoPopup from './SupportAutoPopup';
import { SUPPORT_CONFIG } from './supportConfig';
import { translate as t } from '../testFixtures';
import { installResizeObserver } from '../../../../test-support/browser';

const guide = vi.hoisted(() => ({ open: false }));
vi.mock('@/locale', async () => (await import('../testFixtures')).localeFixture);
vi.mock('@/locale/useFontRegion', async () => {
    const { fontRef } = await import('../testFixtures');
    return { useFontRegion: () => fontRef };
});
vi.mock('@/platform/pictureInPicture', async () => (await import('../testFixtures')).pipFixture);
vi.mock('@/store/uiPrefs', () => ({ usePerformanceMode: () => true, useIsUserGuideOpen: () => guide.open }));

beforeEach(() => { guide.open = false; localStorage.clear(); vi.useFakeTimers(); installResizeObserver(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); });
const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

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

it('waits until the guide closes, restarts a cancelled delay, and remembers dismissal for this version', async () => {
    guide.open = true;
    localStorage.setItem(SUPPORT_CONFIG.storageKey, JSON.stringify({ viewedVersions: ['older'] }));
    const view = render(<SupportAutoPopup />);
    await tick(1000);
    expect(screen.queryByRole('dialog')).toBeNull();
    guide.open = false;
    view.rerender(<SupportAutoPopup />);
    await tick(SUPPORT_CONFIG.delayMs - 1);
    expect(screen.queryByRole('dialog')).toBeNull();
    guide.open = true;
    view.rerender(<SupportAutoPopup />);
    await tick(1000);
    expect(screen.queryByRole('dialog')).toBeNull();
    guide.open = false;
    view.rerender(<SupportAutoPopup />);
    await tick(SUPPORT_CONFIG.delayMs);
    expect(screen.getByRole('dialog', { name: t('support.title') })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t('common.close') }));
    expect(JSON.parse(localStorage.getItem(SUPPORT_CONFIG.storageKey)!)).toEqual({ viewedVersions: ['older', SUPPORT_CONFIG.version] });
    await tick(325);
    expect(screen.queryByRole('dialog')).toBeNull();
    view.unmount();
    render(<SupportAutoPopup />);
    await tick(1000);
    expect(screen.queryByRole('dialog')).toBeNull();
});

it.each(['not-json', 'null', '{}', '{"viewedVersions":4}', '{"viewedVersions":[null]}'])('recovers from malformed persisted preferences: %s', async (prefs) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem(SUPPORT_CONFIG.storageKey, prefs);
    expect(() => render(<SupportAutoPopup />)).not.toThrow();
    await tick(SUPPORT_CONFIG.delayMs);
    expect(screen.getByRole('dialog', { name: t('support.title') })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t('common.close') }));
    expect(JSON.parse(localStorage.getItem(SUPPORT_CONFIG.storageKey)!)).toEqual({ viewedVersions: [SUPPORT_CONFIG.version] });
});

it('cancels its pending appearance on unmount', async () => {
    const view = render(<SupportAutoPopup />);
    view.unmount();
    await tick(1000);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
});
