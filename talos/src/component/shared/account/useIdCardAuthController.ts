import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AuthFlowError,
  exchangeAuthCode,
  getResetPasswordPreview,
  getAuthBase,
  loginWithEmail,
  logoutUser,
  requestPasswordReset,
  registerWithEmail,
  resetPasswordWithToken,
  sendEmailVerificationOtp,
  startOAuth,
  type SessionUser,
  type OAuthProvider,
  updateProfileNickname,
} from '@/services/auth';
import { getVerificationDigits, resolveErrorCode, type AuthMode, type AuthValues } from '@/component/shared/account/access/authState';
import { normalizeAvatarIndex } from '@/component/shared/account/avatarConfig';
import { OEM_ACCOUNT_OPEN_EVENT, OEM_AUTH_OPEN_EVENT, type OemAuthOpenDetail } from '@/component/shared/account/authEvents';
import { useAuthStore } from '@/store/auth';
import { getCachedSession } from '@/services/cache/backend';
import { pauseSessionRefresh, refreshSessionUser, startSessionRefresh } from '@/services/auth/sessionLifecycle';

const ONCELOGIN = 'onceLogin';
const WIPE_MS = 3333;

const waitForPrtsWipeCycle = async (signal: AbortSignal) => {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const finish = () => {
      window.clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = window.setTimeout(finish, WIPE_MS);
    signal.addEventListener('abort', finish, { once: true });
  });
};

const mapAuthErrorToHint = (error: unknown, options?: { mode?: AuthMode }): string => {
  if (error instanceof AuthFlowError) {
    const mapped = resolveErrorCode({
      backendCode: error.code,
      status: error.status,
    });
    if (mapped !== null) {
      if ((mapped === 0 || mapped === 104) && options?.mode && options.mode !== 'login') {
        return '701';
      }
      return String(mapped);
    }

    return '701';
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes('timeout') || message.includes('timed out')) {
      return '702';
    }
    return '701';
  }

  return '701';
};

const markOnceLogin = () => {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(ONCELOGIN, 'true');
};

const hasOnceLogin = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }

  const raw = window.localStorage.getItem(ONCELOGIN);
  return raw === 'true' || raw === '1';
};

const hasPendingAuthCode = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }

  return Boolean(new URL(window.location.href).searchParams.get('auth_code')?.trim());
};

const buildOAuthCallbackUrl = (): string => {
  const callbackUrl = new URL(window.location.href);
  if (callbackUrl.pathname.endsWith('/intel')) {
    callbackUrl.pathname = `${callbackUrl.pathname}/`;
  }
  callbackUrl.searchParams.delete('auth_code');
  callbackUrl.searchParams.delete('error');
  callbackUrl.searchParams.delete('error_description');
  callbackUrl.searchParams.delete('state');
  callbackUrl.searchParams.delete('code');
  callbackUrl.searchParams.delete('token');
  callbackUrl.searchParams.delete('email');
  return callbackUrl.toString();
};

const cachedSession = getCachedSession();

export const useIdCardAuthController = () => {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTabInner] = useState<AuthMode>('login');
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [resetEmail, setResetEmail] = useState<string>('');
  const sessionUser = useAuthStore((state) => state.sessionUser);
  const setSessionUser = useAuthStore((state) => state.setSessionUser);
  const clearSessionUser = useAuthStore((state) => state.clearSessionUser);

  const [profileOpen, setProfileOpen] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [profileAvatar, setProfileAvatar] = useState(1);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [hasLoggedInBefore, setHasLoggedInBefore] = useState<boolean>(() => hasOnceLogin());
  const [authReady, setAuthReady] = useState(cachedSession.hit);
  const passwordResetRequestInFlightRef = useRef(false);
  const uiOwner = useRef(new AbortController());
  const openRef = useRef(open);
  openRef.current = open;
  const renewUiOwner = useCallback(() => {
    uiOwner.current.abort();
    uiOwner.current = new AbortController();
    passwordResetRequestInFlightRef.current = false;
    setIsSubmitting(false);
  }, []);
  const changeOpen = useCallback((value: boolean) => {
    if (value !== openRef.current) renewUiOwner();
    openRef.current = value;
    setOpen(value);
  }, [renewUiOwner]);
  useEffect(() => {
    if (uiOwner.current.signal.aborted) uiOwner.current = new AbortController();
    const stop = () => uiOwner.current.abort();
    return stop;
  }, []);
  const oauthExchangeRef = useRef<{ code: string; promise: ReturnType<typeof exchangeAuthCode>; version: number } | null>(null);

  const normalizeProfileNameInput = useCallback((value: string): string => {
    return value.replace(/[^A-Za-z0-9_-]/g, '');
  }, []);

  const setActiveTab = useCallback((mode: AuthMode) => {
    activeTabRef.current = mode;
    setActiveTabInner(mode);
    if (mode !== 'passwordReset') {
      setResetToken(null);
      setResetEmail('');
    }
  }, []);
  const changeActiveTab = useCallback((mode: AuthMode) => {
    if (mode === activeTabRef.current) return;
    renewUiOwner();
    setAuthError(null);
    setActiveTab(mode);
  }, [renewUiOwner, setActiveTab]);

  const authBase = useMemo(() => getAuthBase(), []);

  const showProfileSetup = useCallback((user: SessionUser) => {
    if (!user.needsProfileSetup) return;
    setProfileName('');
    setProfileAvatar(normalizeAvatarIndex(user.avatar));
    setProfileError(null);
    setProfileOpen(true);
  }, []);

  const syncSession = useCallback(async (options?: { silent?: boolean; expectedEmail?: string; deferProfileSetup?: boolean }) => {
    const signal = uiOwner.current.signal;
    try {
      const user = await refreshSessionUser(options?.expectedEmail);
      if (!user) {
        if (!options?.silent) throw new AuthFlowError('Session is required.', { code: 'SESSION_REQUIRED', status: 401 });
        return null;
      }
      if (options?.expectedEmail && user.email?.toLowerCase() !== options.expectedEmail.trim().toLowerCase()) {
        throw new AuthFlowError('The browser did not retain the expected session.', { code: 'SESSION_COOKIE_REQUIRED' });
      }

      markOnceLogin();
      setHasLoggedInBefore(true);
      if (!signal.aborted && !options?.deferProfileSetup) showProfileSetup(user);

      return user;
    } catch (error) {
      if (options?.silent) {
        return null;
      }
      throw error;
    } finally {
      setAuthReady(true);
    }
  }, [showProfileSetup]);

  useEffect(() => startSessionRefresh(), []);

  useEffect(() => {
    if (hasPendingAuthCode() || oauthExchangeRef.current) {
      return;
    }

    void syncSession({ silent: true });
  }, [syncSession]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const url = new URL(window.location.href);
    const authCode = url.searchParams.get('auth_code')?.trim() ?? oauthExchangeRef.current?.code ?? '';
    const callbackError = url.searchParams.get('error');
    if (callbackError && !authCode) {
      url.searchParams.delete('error');
      url.searchParams.delete('error_description');
      window.history.replaceState({}, '', url.toString());
      setAuthError(mapAuthErrorToHint(new AuthFlowError('OAuth sign-in failed.', { code: callbackError.toUpperCase() })));
      setAuthReady(true);
      setOpen(true);
      return;
    }
    if (!authCode) {
      return;
    }

    url.searchParams.delete('auth_code');
    window.history.replaceState({}, '', url.toString());

    // Keep one exchange promise across repeated effects. Only session reads retry;
    // an exchange with an unknown outcome requires a fresh OAuth attempt.
    if (!oauthExchangeRef.current) {
      const resume = pauseSessionRefresh();
      oauthExchangeRef.current = { code: authCode, promise: exchangeAuthCode(authCode).finally(resume),
        version: useAuthStore.getState().beginSessionUpdate() };
    }
    let active = true;
    const exchange = oauthExchangeRef.current;
    const signal = uiOwner.current.signal;
    void exchange.promise
      .then((user) => {
        if (!active || useAuthStore.getState().sessionVersion !== exchange.version) return;
        markOnceLogin();
        setHasLoggedInBefore(true);
        setSessionUser(user);
        setAuthReady(true);
        if (signal.aborted) return;
        setOpen(false);
        showProfileSetup(user);
      })
      .catch((error) => {
        if (!active || useAuthStore.getState().sessionVersion !== exchange.version) return;
        setAuthReady(true);
        if (signal.aborted) return;
        setAuthError(mapAuthErrorToHint(error));
        setOpen(true);
      });
    return () => { active = false; };
  }, [setSessionUser, showProfileSetup]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const url = new URL(window.location.href);
    const token = url.searchParams.get('token')?.trim() ?? '';
    if (!token) {
      return;
    }

    const emailFromQuery = url.searchParams.get('email')?.trim() ?? '';
    setResetToken(token);
    setResetEmail(emailFromQuery);
    setAuthError(null);
    setActiveTabInner('passwordReset');
    setOpen(true);
    url.searchParams.delete('token');
    url.searchParams.delete('email');
    window.history.replaceState({}, '', url.toString());
    if (!emailFromQuery) {
      const signal = uiOwner.current.signal;
      void getResetPasswordPreview(token)
        .then((preview) => {
          if (signal.aborted) return;
          setResetEmail(preview.email);
        })
        .catch((error) => {
          if (signal.aborted) return;
          setAuthError(mapAuthErrorToHint(error, { mode: 'passwordReset' }));
        });
    }
  }, []);

  const openAuthModal = useCallback(
    (tab: AuthMode) => {
      renewUiOwner();
      setActiveTab(tab);
      setAuthError(null);
      openRef.current = true;
      setOpen(true);
    },
    [renewUiOwner, setActiveTab]
  );

  const openProfileModal = useCallback(() => {
    if (!sessionUser) {
      openAuthModal('login');
      return;
    }
    renewUiOwner();

    setProfileName(sessionUser.needsProfileSetup ? '' : sessionUser.nickname);
    setProfileAvatar(normalizeAvatarIndex(sessionUser.avatar));
    setProfileError(null);
    setProfileOpen(true);
  }, [openAuthModal, renewUiOwner, sessionUser]);

  const handleProfileNameChange = useCallback((value: string) => {
    setProfileName(normalizeProfileNameInput(value));
  }, [normalizeProfileNameInput]);

  const handleAvatarClick = useCallback(() => {
    if (!authReady) {
      return;
    }
    if (sessionUser) {
      openProfileModal();
      return;
    }
    openAuthModal(hasLoggedInBefore ? 'login' : 'register');
  }, [authReady, hasLoggedInBefore, openAuthModal, openProfileModal, sessionUser]);

  useEffect(() => {
    const handleAuthOpen = (event: Event) => {
      const detail = (event as CustomEvent<OemAuthOpenDetail>).detail;
      openAuthModal(detail?.mode ?? 'login');
    };

    window.addEventListener(OEM_AUTH_OPEN_EVENT, handleAuthOpen);
    window.addEventListener(OEM_ACCOUNT_OPEN_EVENT, handleAvatarClick);
    return () => {
      window.removeEventListener(OEM_AUTH_OPEN_EVENT, handleAuthOpen);
      window.removeEventListener(OEM_ACCOUNT_OPEN_EVENT, handleAvatarClick);
    };
  }, [handleAvatarClick, openAuthModal]);

  const handleOAuthClick = useCallback(async (provider: OAuthProvider) => {
    if (isSubmitting) return;
    const signal = uiOwner.current.signal;

    setAuthError(null);
    setIsSubmitting(true);

    try {
      const callbackURL = buildOAuthCallbackUrl();
      const { redirectUrl } = await startOAuth(provider, callbackURL);
      if (signal.aborted) return;
      window.location.assign(redirectUrl);
    } catch (error) {
      if (signal.aborted) return;
      setAuthError(mapAuthErrorToHint(error));
    } finally {
      if (!signal.aborted) setIsSubmitting(false);
    }
  }, [isSubmitting]);

  const handleRequestVerificationCode = useCallback(async ({
    email,
    mode,
  }: {
    email: string;
    mode: AuthMode;
  }): Promise<boolean> => {
    if (isSubmitting) {
      return false;
    }
    const signal = uiOwner.current.signal;

    setAuthError(null);
    setIsSubmitting(true);

    try {
      await sendEmailVerificationOtp(email, mode === 'register' ? 'register' : 'login');

      return !signal.aborted;
    } catch (error) {
      if (signal.aborted) return false;
      setAuthError(mapAuthErrorToHint(error, { mode }));
      return false;
    } finally {
      if (!signal.aborted) setIsSubmitting(false);
    }
  }, [isSubmitting]);

  const handleAutoSubmit = useCallback(async ({
    mode,
    values,
  }: {
    mode: AuthMode;
    values: AuthValues;
  }) => {
    if (isSubmitting) {
      return;
    }
    const signal = uiOwner.current.signal;

    setAuthError(null);
    setIsSubmitting(true);

    try {
      let successHintCode: '200' | '201' | '202' = '200';
      if (mode === 'login') {
        await loginWithEmail(values.email, values.password);
        successHintCode = '200';
      } else if (mode === 'register') {
        await registerWithEmail(
          values.email,
          values.password,
          getVerificationDigits(values.verificationCode),
        );
        successHintCode = '201';
      } else {
        if (!resetToken) {
          throw new Error('Missing reset token.');
        }
        await resetPasswordWithToken(resetToken, values.password, values.repeatPassword);
        successHintCode = '202';
      }

      const confirmedUser = mode !== 'passwordReset'
        ? await syncSession({ expectedEmail: values.email, deferProfileSetup: true }) : null;
      if (signal.aborted) return;
      setAuthError(successHintCode);
      await waitForPrtsWipeCycle(signal);
      if (signal.aborted) return;
      setOpen(false);
      if (confirmedUser) showProfileSetup(confirmedUser);
      if (mode === 'passwordReset') {
        setResetToken(null);
        setResetEmail('');
        setActiveTab('login');
      }
    } catch (error) {
      if (signal.aborted) return;
      const mappedHint = mapAuthErrorToHint(error, { mode });
      setAuthError(mappedHint);

      if (mode === 'login' && mappedHint === '104') {
        await waitForPrtsWipeCycle(signal);
        if (signal.aborted) return;
        setAuthError(null);
        setActiveTab('register');
      }
    } finally {
      if (!signal.aborted) setIsSubmitting(false);
    }
  }, [isSubmitting, resetToken, setActiveTab, syncSession, showProfileSetup]);

  const handleRequestPasswordReset = useCallback(async ({
    email,
  }: {
    email: string;
  }): Promise<boolean> => {
    if (isSubmitting || passwordResetRequestInFlightRef.current) {
      return false;
    }
    const signal = uiOwner.current.signal;

    setAuthError(null);
    passwordResetRequestInFlightRef.current = true;
    setIsSubmitting(true);

    try {
      const normalizedEmail = email.trim().toLowerCase();
      const callbackUrl = new URL(window.location.href);
      if (callbackUrl.pathname.endsWith('/intel')) {
        callbackUrl.pathname = `${callbackUrl.pathname}/`;
      }
      callbackUrl.search = '';
      callbackUrl.hash = '';
      await requestPasswordReset(normalizedEmail, callbackUrl.toString());
      return !signal.aborted;
    } catch (error) {
      if (signal.aborted) return false;
      setAuthError(mapAuthErrorToHint(error, { mode: 'passwordReset' }));
      return false;
    } finally {
      if (!signal.aborted) {
        passwordResetRequestInFlightRef.current = false;
        setIsSubmitting(false);
      }
    }
  }, [isSubmitting]);

  const handleSaveProfile = useCallback(async () => {
    const trimmed = profileName.trim();
    if (!trimmed) {
      setProfileError('Please enter a nickname.');
      return;
    }

    if (Array.from(trimmed).length > 15) {
      setProfileError('Username must be 15 characters or fewer.');
      return;
    }

    if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) {
      setProfileError('Username can only contain letters, numbers, hyphen, and underscore.');
      return;
    }

    if (isSavingProfile) return;
    setIsSavingProfile(true);
    setProfileError(null);
    const sessionVersion = useAuthStore.getState().sessionVersion;
    const signal = uiOwner.current.signal;

    try {
      const user = await updateProfileNickname(trimmed, profileAvatar);
      // A save started by an earlier session must not restore a logged-out
      // account or overwrite a newer sign-in when its response arrives late.
      if (useAuthStore.getState().sessionVersion !== sessionVersion) return;
      setSessionUser({
        ...sessionUser,
        ...user,
        avatar: user.avatar ?? profileAvatar,
        registeredAt: user.registeredAt ?? sessionUser?.registeredAt,
      });
      if (signal.aborted) return;
      setProfileOpen(false);
      setOpen(false);
    } catch (error) {
      if (signal.aborted || useAuthStore.getState().sessionVersion !== sessionVersion) return;
      setProfileError(error instanceof Error ? error.message : 'Network error while saving profile.');
    } finally {
      setIsSavingProfile(false);
    }
  }, [isSavingProfile, profileAvatar, profileName, sessionUser, setSessionUser]);

  const handleCloseProfile = useCallback(async () => {
    if (isSavingProfile) return;
    if (!sessionUser) {
      setProfileOpen(false);
      return;
    }

    const trimmed = profileName.trim();
    const currentName = sessionUser.needsProfileSetup ? '' : sessionUser.nickname;
    const currentAvatar = normalizeAvatarIndex(sessionUser.avatar);
    const changed = trimmed !== currentName || profileAvatar !== currentAvatar;

    if (!changed) {
      setProfileOpen(false);
      return;
    }

    await handleSaveProfile();
  }, [handleSaveProfile, isSavingProfile, profileAvatar, profileName, sessionUser]);

  const handleLogout = useCallback(async () => {
    const version = useAuthStore.getState().sessionVersion;
    const signal = uiOwner.current.signal;
    try {
      await logoutUser();
      if (useAuthStore.getState().sessionVersion !== version) return;
      clearSessionUser();
      if (signal.aborted) return;
      setProfileOpen(false);
      setOpen(false);
      setProfileName('');
      setProfileAvatar(1);
      setProfileError(null);
      setAuthError(null);
    } catch (error) {
      if (signal.aborted || useAuthStore.getState().sessionVersion !== version) return;
      setProfileError(error instanceof Error ? error.message : 'Network error while logging out.');
    }
  }, [clearSessionUser]);

  return {
    authBase,
    open,
    setOpen: changeOpen,
    activeTab,
    setActiveTab: changeActiveTab,
    isSubmitting,
    authError,
    resetToken,
    resetEmail,
    sessionUser,
    authReady,
    profileOpen,
    setProfileOpen,
    profileName,
    setProfileName: handleProfileNameChange,
    profileAvatar,
    setProfileAvatar,
    hasLoggedInBefore,
    profileError,
    isSavingProfile,
    openAuthModal,
    openProfileModal,
    handleAvatarClick,
    handleCloseProfile,
    handleOAuthClick,
    handleRequestVerificationCode,
    handleRequestPasswordReset,
    handleAutoSubmit,
    handleSaveProfile,
    handleLogout,
    syncSession,
  };
};
