import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AuthFlowError,
  fetchSessionUser,
  getResetPasswordPreview,
  getAuthBase,
  loginWithEmail,
  logoutUser,
  requestPasswordReset,
  registerWithEmail,
  resetPasswordWithToken,
  sendEmailVerificationOtp,
  startDiscordAuth,
  startGoogleAuth,
  updateProfileNickname,
} from './authFlow';
import { getVerificationDigits, resolveErrorCode, type AuthMode, type AuthValues } from './access/authState';
import { getNextAvatarIndex, normalizeAvatarIndex } from './avatarConfig';
import { useAuthStore } from '@/store/auth';

const ONCELOGIN = 'onceLogin';
const WIPE_MS = 3333;

const waitForPrtsWipeCycle = async () => {
  await new Promise<void>((resolve) => {
    window.setTimeout(() => resolve(), WIPE_MS);
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

export const useIdCardAuthController = () => {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTabInner] = useState<AuthMode>('login');
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

  const setActiveTab = useCallback((mode: AuthMode) => {
    setActiveTabInner(mode);
    if (mode !== 'passwordReset') {
      setResetToken(null);
      setResetEmail('');
    }
  }, []);

  const authBase = useMemo(() => getAuthBase(), []);

  const syncSession = useCallback(async (options?: { silent?: boolean }) => {
    try {
      const user = await fetchSessionUser();
      if (!user) {
        clearSessionUser();
        return null;
      }

      markOnceLogin();
      setHasLoggedInBefore(true);
      setSessionUser(user);
      if (user.needsProfileSetup) {
        setProfileName('');
        setProfileAvatar(normalizeAvatarIndex(user.avatar));
        setProfileError(null);
        setProfileOpen(true);
      }

      return user;
    } catch {
      if (options?.silent) {
        return null;
      }
      throw new Error('Failed to refresh session after auth.');
    }
  }, [clearSessionUser, setSessionUser]);

  useEffect(() => {
    void syncSession({ silent: true });
  }, [syncSession]);

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
      void getResetPasswordPreview(token)
        .then((preview) => {
          setResetEmail(preview.email);
        })
        .catch((error) => {
          setAuthError(mapAuthErrorToHint(error, { mode: 'passwordReset' }));
        });
    }
  }, []);

  const openAuthModal = useCallback(
    (tab: AuthMode) => {
      setActiveTab(tab);
      setAuthError(null);
      setOpen(true);
    },
    []
  );

  const openProfileModal = useCallback(() => {
    if (!sessionUser) {
      openAuthModal('login');
      return;
    }

    setProfileName(sessionUser.needsProfileSetup ? '' : sessionUser.nickname);
    setProfileAvatar(normalizeAvatarIndex(sessionUser.avatar));
    setProfileError(null);
    setProfileOpen(true);
  }, [openAuthModal, sessionUser]);

  const handleAvatarClick = useCallback(() => {
    if (sessionUser) {
      openProfileModal();
      return;
    }
    openAuthModal(hasLoggedInBefore ? 'login' : 'register');
  }, [hasLoggedInBefore, openAuthModal, openProfileModal, sessionUser]);

  const handleCycleProfileAvatar = useCallback(() => {
    setProfileAvatar((current) => getNextAvatarIndex(current));
  }, []);

  const handleDiscordAuthClick = useCallback(async () => {
    if (isSubmitting) return;

    setAuthError(null);
    setIsSubmitting(true);

    try {
      const callbackURL = window.location.href;
      const { redirectUrl } = await startDiscordAuth(callbackURL);
      window.location.assign(redirectUrl);
    } catch (error) {
      setAuthError(mapAuthErrorToHint(error));
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting]);

  const handleGoogleAuthClick = useCallback(async () => {
    if (isSubmitting) return;

    setAuthError(null);
    setIsSubmitting(true);

    try {
      const callbackURL = window.location.href;
      const { redirectUrl } = await startGoogleAuth(callbackURL);
      window.location.assign(redirectUrl);
    } catch (error) {
      setAuthError(mapAuthErrorToHint(error));
    } finally {
      setIsSubmitting(false);
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

    setAuthError(null);
    setIsSubmitting(true);

    try {
      await sendEmailVerificationOtp(email, mode === 'register' ? 'register' : 'login');

      return true;
    } catch (error) {
      setAuthError(mapAuthErrorToHint(error, { mode }));
      return false;
    } finally {
      setIsSubmitting(false);
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

    setAuthError(null);
    setIsSubmitting(true);

    try {
      let successHintCode: '200' | '201' = '200';
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
        markOnceLogin();
        setHasLoggedInBefore(true);
      } else {
        if (!resetToken) {
          throw new Error('Missing reset token.');
        }
        await resetPasswordWithToken(resetToken, values.password, values.repeatPassword);
        successHintCode = '200';
      }

      setAuthError(successHintCode);
      await waitForPrtsWipeCycle();
      if (mode !== 'passwordReset') {
        await syncSession();
      }
      setOpen(false);
      if (mode === 'passwordReset') {
        setResetToken(null);
        setResetEmail('');
        setActiveTab('login');
      }
    } catch (error) {
      const mappedHint = mapAuthErrorToHint(error, { mode });
      setAuthError(mappedHint);

      if (mode === 'login' && mappedHint === '104') {
        await waitForPrtsWipeCycle();
        setAuthError(null);
        setActiveTab('register');
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, resetToken, setActiveTab, syncSession]);

  const handleRequestPasswordReset = useCallback(async ({
    email,
  }: {
    email: string;
  }): Promise<boolean> => {
    if (isSubmitting) {
      return false;
    }

    setAuthError(null);
    setIsSubmitting(true);

    try {
      const callbackUrl = new URL(window.location.href);
      callbackUrl.search = '';
      callbackUrl.hash = '';
      await requestPasswordReset(email, callbackUrl.toString());
      return true;
    } catch (error) {
      setAuthError(mapAuthErrorToHint(error, { mode: 'passwordReset' }));
      return false;
    } finally {
      setIsSubmitting(false);
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

    if (isSavingProfile) return;
    setIsSavingProfile(true);
    setProfileError(null);

    try {
      const user = await updateProfileNickname(trimmed, profileAvatar);
      setSessionUser({
        ...sessionUser,
        ...user,
        avatar: user.avatar ?? profileAvatar,
        registeredAt: user.registeredAt ?? sessionUser?.registeredAt,
      });
      setProfileOpen(false);
      setOpen(false);
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : 'Network error while saving profile.');
    } finally {
      setIsSavingProfile(false);
    }
  }, [isSavingProfile, profileAvatar, profileName, sessionUser, setSessionUser]);

  const handleLogout = useCallback(async () => {
    try {
      await logoutUser();
      clearSessionUser();
      setProfileOpen(false);
      setOpen(false);
      setProfileName('');
      setProfileAvatar(1);
      setProfileError(null);
      setAuthError(null);
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : 'Network error while logging out.');
    }
  }, [clearSessionUser]);

  return {
    authBase,
    open,
    setOpen,
    activeTab,
    setActiveTab,
    isSubmitting,
    authError,
    resetToken,
    resetEmail,
    sessionUser,
    profileOpen,
    setProfileOpen,
    profileName,
    setProfileName,
    profileAvatar,
    setProfileAvatar,
    hasLoggedInBefore,
    profileError,
    isSavingProfile,
    openAuthModal,
    openProfileModal,
    handleAvatarClick,
    handleCycleProfileAvatar,
    handleDiscordAuthClick,
    handleGoogleAuthClick,
    handleRequestVerificationCode,
    handleRequestPasswordReset,
    handleAutoSubmit,
    handleSaveProfile,
    handleLogout,
    syncSession,
  };
};
