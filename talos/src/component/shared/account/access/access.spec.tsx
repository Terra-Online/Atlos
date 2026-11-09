import { useState, type ComponentProps } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Access from './access';
import type { AuthMode } from './authState';
import { deferred, translate as t } from '../../testFixtures';
import { installResizeObserver } from '../../../../../test-support/browser';

vi.mock('@/locale', async () => (await import('../../testFixtures')).localeFixture);
vi.mock('@/locale/useFontRegion', async () => {
    const { fontRef } = await import('../../testFixtures');
    return { useFontRegion: () => fontRef };
});
vi.mock('@/platform/pictureInPicture', async () => (await import('../../testFixtures')).pipFixture);
vi.mock('@/platform/device', () => ({ useDevice: () => ({ isMobile: false }) }));
vi.mock('@/store/uiPrefs', () => ({ usePerformanceMode: () => true }));

beforeEach(() => { vi.useFakeTimers(); installResizeObserver(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

type Props = ComponentProps<typeof Access>;
function mount(overrides: Partial<Props> = {}) {
    const onAutoSubmit = vi.fn();
    const onRequestVerificationCode = vi.fn().mockResolvedValue(true);
    const onRequestPasswordReset = vi.fn().mockResolvedValue(true);
    const handleOAuthClick = vi.fn().mockResolvedValue(undefined);
    const props = { onAutoSubmit, onRequestVerificationCode, onRequestPasswordReset, handleOAuthClick, ...overrides };
    function Auth() {
        const [open, setOpen] = useState(true);
        const [mode, setMode] = useState<AuthMode>('login');
        return <Access open={open} setOpen={setOpen} activeTab={mode} setActiveTab={setMode} isSubmitting={false} authError={null} {...props} />;
    }
    return { ...render(<Auth />), ...props };
}
const input = (id: string) => document.getElementById(`access-${id}`) as HTMLInputElement;
const change = (id: string, value: string) => fireEvent.change(input(id), { target: { value } });
const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

it('submits one normalized login on Enter and does not let the bubbled form handler submit twice', async () => {
    const { onAutoSubmit } = mount();
    change('email', ' explorer@example.test ');
    change('password', 'existing-password');
    fireEvent.keyDown(input('password'), { key: 'Enter' });
    expect(onAutoSubmit).toHaveBeenCalledOnce();
    expect(onAutoSubmit).toHaveBeenCalledWith({ mode: 'login', values: { email: 'explorer@example.test', password: 'existing-password', verificationCode: '', repeatPassword: '' } });
    await tick(1000);
    expect(onAutoSubmit).toHaveBeenCalledOnce();
});

it('ignores IME Enter, auto-submits only valid touched fields, and deduplicates an unchanged payload', async () => {
    const { onAutoSubmit } = mount();
    change('email', 'explorer@example.test');
    change('password', 'existing-password');
    fireEvent.keyDown(input('password'), { key: 'Enter', isComposing: true });
    expect(onAutoSubmit).not.toHaveBeenCalled();
    await tick(199);
    expect(onAutoSubmit).not.toHaveBeenCalled();
    await tick(1);
    expect(onAutoSubmit).toHaveBeenCalledOnce();
    await tick(1500);
    expect(onAutoSubmit).toHaveBeenCalledOnce();
    change('password', 'changed-password');
    await tick(200);
    expect(onAutoSubmit).toHaveBeenCalledTimes(2);
});

it('shows validation after editing or explicit submission and never submits malformed credentials', async () => {
    const { onAutoSubmit } = mount();
    expect(screen.queryByText(/REQ\(101\)/)).toBeNull();
    fireEvent.submit(input('email').form!);
    expect(screen.getByText(/REQ\(101\)/)).toBeTruthy();
    expect(screen.getByText(/REQ\(111\)/)).toBeTruthy();
    change('email', 'bad-address');
    await tick(499);
    expect(screen.queryByText(/ERR\(102\)/)).toBeNull();
    await tick(1);
    expect(screen.getByText(/ERR\(102\)/)).toBeTruthy();
    expect(onAutoSubmit).not.toHaveBeenCalled();
});

it('formats a pasted OTP, respects registration password rules, and starts cooldown only after a successful send', async () => {
    const send = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const { onAutoSubmit } = mount({ activeTab: 'register', onRequestVerificationCode: send });
    change('email', 'explorer@example.test');
    fireEvent.click(screen.getByRole('button', { name: t('idcard.auth.send') }));
    await act(async () => {});
    expect(screen.getByRole('button', { name: t('idcard.auth.send') }).hasAttribute('disabled')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: t('idcard.auth.send') }));
    await act(async () => {});
    const cooldown = t('idcard.auth.resend').replace('{count}', '100');
    expect(screen.getByRole('button', { name: cooldown }).hasAttribute('disabled')).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
    change('password', 'weak');
    change('verification-code', '12x3456789');
    expect(input('verification-code').value).toBe('123-456');
    await tick(1000);
    expect(onAutoSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/ERR\(112\)/)).toBeTruthy();
    change('password', 'Password123');
    await tick(500);
    await tick(200);
    expect(onAutoSubmit).toHaveBeenCalledWith({ mode: 'register', values: { email: 'explorer@example.test', password: 'Password123', verificationCode: '123-456', repeatPassword: '' } });
});

it('sends one reset link on Enter and locks the target email when completing a reset', async () => {
    const { onRequestPasswordReset, onAutoSubmit } = mount({ activeTab: 'passwordReset', resetEmail: 'explorer@example.test' });
    fireEvent.keyDown(input('email'), { key: 'Enter' });
    await act(async () => {});
    expect(onRequestPasswordReset).toHaveBeenCalledOnce();
    expect(onRequestPasswordReset).toHaveBeenCalledWith({ email: 'explorer@example.test' });
    await tick(1000);
    expect(onAutoSubmit).not.toHaveBeenCalled();
    cleanup();
    const reset = mount({ activeTab: 'passwordReset', resetToken: 'token', resetEmail: 'explorer@example.test' });
    expect(input('email').disabled).toBe(true);
    expect(input('email').value).toBe('explorer@example.test');
    change('password', 'Password123');
    change('repeat-password', 'different');
    fireEvent.submit(input('password').form!);
    expect(screen.getByText(/ERR\(113\)/)).toBeTruthy();
    expect(reset.onAutoSubmit).not.toHaveBeenCalled();
    change('repeat-password', 'Password123');
    fireEvent.keyDown(input('repeat-password'), { key: 'Enter' });
    expect(reset.onAutoSubmit).toHaveBeenCalledOnce();
    expect(reset.onAutoSubmit).toHaveBeenCalledWith(expect.objectContaining({ mode: 'passwordReset' }));
});

it('switches modes without submitting, routes provider choices, and blocks unrelated providers while pending', async () => {
    const oauth = deferred<void>();
    const handleOAuthClick = vi.fn().mockReturnValue(oauth.promise);
    mount({ handleOAuthClick });
    fireEvent.click(screen.getByRole('button', { name: t('idcard.auth.switchToRegisterAction') }));
    expect(screen.getByRole('dialog').getAttribute('aria-labelledby')).toBeTruthy();
    expect(document.querySelector('[data-mode="register"]')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t('idcard.auth.gooRegis') }));
    expect(handleOAuthClick).toHaveBeenCalledWith('google');
    fireEvent.click(screen.getByRole('button', { name: t('idcard.auth.dcRegis') }));
    expect(handleOAuthClick).toHaveBeenCalledOnce();
    await act(async () => { oauth.resolve(); await oauth.promise; });
});

it('blocks submission while saving and cancels delayed submissions when closed or unmounted', async () => {
    const { onAutoSubmit, unmount } = mount({ isSubmitting: true });
    change('email', 'explorer@example.test');
    change('password', 'Password123');
    fireEvent.keyDown(input('password'), { key: 'Enter' });
    await tick(1000);
    expect(onAutoSubmit).not.toHaveBeenCalled();
    unmount();
    const pending = mount();
    change('email', 'explorer@example.test');
    change('password', 'Password123');
    fireEvent.click(screen.getByRole('button', { name: t('common.close') }));
    await tick(1000);
    expect(pending.onAutoSubmit).not.toHaveBeenCalled();
    pending.unmount();
    expect(vi.getTimerCount()).toBe(0);
});
