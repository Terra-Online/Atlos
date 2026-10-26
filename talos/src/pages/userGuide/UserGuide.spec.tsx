import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Props as JoyrideProps, CallBackProps, StepMerged, TooltipRenderProps } from 'react-joyride';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import UserGuide from './UserGuide';
import { GuideTooltip } from './tooltip/tooltip';
import { GuideSpotlight } from './spotlight/spotlight';
import { useUiPrefsStore } from '@/store/uiPrefs';
import { useUserGuideStore } from '@/store/userGuide';
import { setRect } from '../../../test-support/browser';

const driver = vi.hoisted(() => ({ props: null as JoyrideProps | null, mobile: false, target: vi.fn(), t: (key: string) => key }));
vi.mock('react-joyride', async (original) => ({ ...await original<typeof import('react-joyride')>(), default: (props: JoyrideProps) => { driver.props = props; return <div data-testid="tour" data-run={String(props.run)} />; } }));
vi.mock('@/locale', () => ({ useTranslateUI: () => driver.t, i18nInitPromise: Promise.resolve() }));
vi.mock('@/platform/device', () => ({ useDevice: () => ({ isMobile: driver.mobile }), useAppViewport: () => ({ width: 800, height: 600 }) }));
vi.mock('@/data/marker', async (original) => ({ ...await original<typeof import('@/data/marker')>(), findFirstMarkerByType: driver.target }));
const prefs = useUiPrefsStore.getState(), guide = useUserGuideStore.getState();
beforeEach(() => { vi.useFakeTimers(); driver.mobile = false; driver.props = null; driver.target.mockReset(); driver.target.mockResolvedValue(null); useUiPrefsStore.setState({ isUserGuideOpen: false, forceHeadbarExpanded: null }); useUserGuideStore.setState({ stepCompleted: {} }); });
afterEach(() => { cleanup(); useUiPrefsStore.setState(prefs, true); useUserGuideStore.setState(guide, true); document.body.style.overflow = ''; document.documentElement.removeAttribute('data-theme'); vi.useRealTimers(); vi.restoreAllMocks(); });
const emit = (status: CallBackProps['status'], type: CallBackProps['type'] = 'tour:end', index = 0) => act(() => {
    const props = driver.props!;
    props.callback?.({ action: 'next', controlled: true, index, lifecycle: 'complete', origin: null, size: props.steps.length, status, step: props.steps[index], type });
});

it.each([false, true])('auto-opens only the welcome tip on mobile=%s and acknowledges it without completing detailed Help', async (mobile) => {
    driver.mobile = mobile; const ready = vi.fn(); render(<UserGuide onReady={ready} />);
    await act(async () => { await Promise.resolve(); });
    expect(ready).toHaveBeenCalledOnce();
    expect(driver.props?.run).toBe(true);
    expect(driver.props?.steps).toHaveLength(1);
    expect(driver.target).not.toHaveBeenCalled();
    const intro = mobile ? 'MSTEP-0_welcome' : 'STEP-0_welcome';
    emit('finished');
    expect(useUserGuideStore.getState().stepCompleted[intro]).toBe(true);
    expect(Object.entries(useUserGuideStore.getState().stepCompleted).filter(([id]) => id !== intro).every(([, completed]) => !completed)).toBe(true);
    expect(useUiPrefsStore.getState().isUserGuideOpen).toBe(false);
    expect(driver.props?.run).toBe(false);
});

it('resumes detailed Help at the first unfinished step and pauses when UI is hidden without losing progress', async () => {
    useUserGuideStore.setState({ stepCompleted: { 'STEP-0_welcome': true, 'STEP-1_sidebar-toggle': true } });
    const ready = vi.fn(); const view = render(<UserGuide visible onReady={ready} />); await act(async () => { await Promise.resolve(); });
    expect(driver.props?.run).toBe(false);
    act(() => { useUiPrefsStore.getState().setIsUserGuideOpen(true); });
    expect(driver.props?.stepIndex).toBe(1);
    expect(driver.props?.steps[1].content).toBe('guide.search');
    view.rerender(<UserGuide visible={false} onReady={ready} />);
    expect(driver.props?.run).toBe(false);
    expect(useUiPrefsStore.getState().isUserGuideOpen).toBe(true);
    view.rerender(<UserGuide visible onReady={ready} />);
    expect(driver.props?.run).toBe(true);
    expect(driver.props?.stepIndex).toBe(1);
    expect(ready).toHaveBeenCalledOnce();
});

it('releases all temporary guide controls, including mobile headbar expansion, when detailed Help is skipped', async () => {
    driver.mobile = true;
    useUserGuideStore.setState({ stepCompleted: { 'MSTEP-0_welcome': true } });
    render(<UserGuide />); await act(async () => { await Promise.resolve(); });
    act(() => { useUiPrefsStore.setState({ isUserGuideOpen: true, forceHeadbarExpanded: true, forceRegionSubOpen: true, forceLayerSubOpen: true, forceDetailOpen: true, mobileDrawerSnapIndex: 2 }); });
    emit('skipped');
    expect(useUiPrefsStore.getState()).toMatchObject({ isUserGuideOpen: false, forceHeadbarExpanded: null, forceRegionSubOpen: false, forceLayerSubOpen: false, forceDetailOpen: false, mobileDrawerSnapIndex: null, desktopDrawerSnapIndex: null });
});

const tooltipStep = (intro: boolean): StepMerged & { hideProgress: boolean } => ({ target: 'body', content: 'Guide content', hideProgress: intro, disableBeacon: true, disableCloseOnEsc: false, disableOverlay: true, disableOverlayClose: true, disableScrollParentFix: false, disableScrolling: true,
    event: 'click', hideBackButton: false, hideCloseButton: false, hideFooter: false, isFixed: false, locale: {}, offset: 10, placement: 'bottom', showProgress: true, showSkipButton: true, spotlightClicks: false, spotlightPadding: 10,
    styles: { beacon: {}, beaconInner: {}, beaconOuter: {}, buttonBack: {}, buttonClose: {}, buttonNext: {}, buttonSkip: {}, options: {}, overlay: {}, overlayLegacy: {}, overlayLegacyCenter: {}, spotlight: {}, spotlightLegacy: {}, tooltip: {}, tooltipContainer: {}, tooltipContent: {}, tooltipFooter: {}, tooltipFooterSpacer: {}, tooltipTitle: {} } });
const tooltipProps = (intro: boolean, next = vi.fn(), skip = vi.fn()): TooltipRenderProps => {
    const button = (onClick: () => void) => ({ 'aria-label': '', 'data-action': '', role: 'button', title: '', onClick });
    return { continuous: true, index: 0, isLastStep: false, size: 4, step: tooltipStep(intro), backProps: button(vi.fn()), closeProps: button(vi.fn()), primaryProps: button(next), skipProps: button(skip), tooltipProps: { 'aria-modal': true, role: 'dialog', ref: () => {} } };
};

it('keeps the intro tooltip a closeable tip and gives detailed Help progress, skip and first-step back protection', () => {
    const next = vi.fn(), skip = vi.fn(); const view = render(<GuideTooltip {...tooltipProps(true, next, skip)} />);
    expect(screen.getByText('OEM')).toBeTruthy();
    expect(screen.queryByText('25%')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'common.close' })); expect(next).toHaveBeenCalledOnce();
    view.rerender(<GuideTooltip {...tooltipProps(false, next, skip)} />);
    expect(screen.getByText('25%')).toBeTruthy();
    const buttons = screen.getAllByRole('button');
    expect((buttons[0] as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'common.skip' })); expect(skip).toHaveBeenCalledOnce();
});

it('positions and removes the spotlight for a disappearing target and stops advancing when inactive', () => {
    const target = document.createElement('button'); document.body.append(target); setRect(target, 20, 30, 100, 40);
    const advance = vi.fn(); const locate = () => target.isConnected ? target : null;
    const view = render(<GuideSpotlight active getCurrentTarget={locate} onAdvance={advance} padding={10} />);
    expect(view.container.querySelector<HTMLElement>('[style]')?.style.left).toBe('10px');
    fireEvent.click(view.container.firstElementChild!); expect(advance).toHaveBeenCalledOnce();
    target.remove(); act(() => { vi.advanceTimersToNextFrame(); });
    expect(view.container.querySelector('[style]')).toBeNull();
    view.rerender(<GuideSpotlight active={false} getCurrentTarget={locate} onAdvance={advance} />);
    fireEvent.click(view.container.firstElementChild!); expect(advance).toHaveBeenCalledOnce();
});
