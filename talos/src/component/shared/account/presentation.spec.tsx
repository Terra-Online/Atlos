import { useRef } from 'react';
import { act, cleanup, fireEvent, render, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { SessionUser } from '@/services/auth';
import { installResizeObserver } from '../../../../test-support/browser';
import { translate as t } from '../testFixtures';
import { useIdCardProfileViewModel } from './useIdCardProfileViewModel';
import { useIdCardScale } from './useIdCardScale';

vi.mock('@/locale', async () => (await import('../testFixtures')).localeFixture);
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('replaces loading and guest identity with the confirmed account without showing an unassigned UID as final', () => {
    const initialProps: { sessionUser: SessionUser | null; authReady: boolean; hasLoggedInBefore: boolean } = {
        sessionUser: null, authReady: false, hasLoggedInBefore: true,
    };
    const { result, rerender } = renderHook(useIdCardProfileViewModel, { initialProps });
    expect(result.current.displayUid).toBe('...');
    expect(result.current.displayName).toBe(t('common.loading'));
    expect(result.current.showKarma).toBe(false);
    rerender({ ...initialProps, authReady: true });
    expect(result.current.uidLabel).toBe('GID');
    expect(result.current.displayUid).toMatch(/^[A-Z0-9]{10}$/);
    expect(result.current.ageText).toBe(t('idcard.logintip'));
    const user = { uid: '42', nickname: 'Explorer', needsProfileSetup: true, groupCode: 'admin' as const, karma: 9, registeredAt: 'invalid' };
    rerender({ ...initialProps, authReady: true, sessionUser: user });
    expect(result.current.displayUid).toBe(t('idcard.unassigned'));
    expect(result.current.groupText).toContain(t('idcard.admin'));
    expect(result.current.karmaLevel).toBe(5);
    expect(result.current.ageText).toContain('--');
    rerender({ ...initialProps, authReady: true, sessionUser: { ...user, needsProfileSetup: false, karma: Number.NaN } });
    expect(result.current.displayUid).toBe('42');
    expect(result.current.karmaLevel).toBe(0);
    expect(result.current.karmaTooltip).toBe(`${t('idcard.karma')}: 0`);
});

function CardScale() {
    const cardRef = useRef<HTMLDivElement>(null);
    const { shellRef, scale } = useIdCardScale(cardRef);
    return <div ref={shellRef} data-testid="shell" data-scale={scale}><div ref={cardRef} data-testid="card" /></div>;
}

it('fits the card after measured size changes, never enlarges it, and releases both observations', () => {
    const observer = installResizeObserver();
    const { getByTestId, unmount } = render(<CardScale />);
    const shell = getByTestId('shell');
    const card = getByTestId('card');
    const shellWidth = vi.spyOn(shell, 'clientWidth', 'get').mockReturnValue(150);
    const cardWidth = vi.spyOn(card, 'offsetWidth', 'get').mockReturnValue(300);
    act(() => observer.notify(card));
    expect(shell.dataset.scale).toBe('0.5');
    shellWidth.mockReturnValue(600);
    act(() => observer.notify(shell));
    expect(shell.dataset.scale).toBe('1');
    cardWidth.mockReturnValue(0);
    act(() => observer.notify(card));
    expect(shell.dataset.scale).toBe('1');
    expect(observer.observers[0].targets.size).toBe(2);
    unmount();
    expect(observer.observers[0].targets.size).toBe(0);
});

it('uses and removes the resize fallback when ResizeObserver is unavailable', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const remove = vi.spyOn(window, 'removeEventListener');
    const { getByTestId, unmount } = render(<CardScale />);
    const shell = getByTestId('shell');
    vi.spyOn(shell, 'clientWidth', 'get').mockReturnValue(180);
    vi.spyOn(getByTestId('card'), 'offsetWidth', 'get').mockReturnValue(360);
    fireEvent.resize(window);
    expect(shell.dataset.scale).toBe('0.5');
    unmount();
    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
});
