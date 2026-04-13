import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AuthFlowError,
  fetchSessionUser,
  getAuthBase,
  loginWithEmail,
  logoutUser,
  registerWithEmail,
  sendEmailVerificationOtp,
  startDiscordAuth,
  startGoogleAuth,
  updateProfileNickname,
  verifyEmailRegistrationOtp,
} from './authFlow';
import { getVerificationDigits, type AuthMode, type AuthValues } from './access/authState';
import { useAuthStore } from '@/store/auth';

const ONCELOGIN = 'onceLogin';

const AUTH_HINT_BY_BACKEND_CODE: Record<string, string> = {
  INVALID_EMAIL: '102',
  INVALID_PASSWORD: '112',
  INVALID_EMAIL_OR_PASSWORD: '140',
  USER_ALREADY_EXISTS: '103',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: '103',
  INVALID_OTP: '122',
  OTP_EXPIRED: '123',
  TOO_MANY_ATTEMPTS: '430',
};

const ALREADY_REGISTERED_CODES = new Set([
  'USER_ALREADY_EXISTS',
  'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL',
]);

const resolveHintFromBackendCode = (code?: string): string | null => {
  if (!code) {
    return null;
  }

  switch (code) {
    case 'INVALID_EMAIL':
    case 'INVALID_PASSWORD':
    case 'INVALID_EMAIL_OR_PASSWORD':
    case 'USER_ALREADY_EXISTS':
    case 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL':
    case 'INVALID_OTP':
    case 'OTP_EXPIRED':
    case 'TOO_MANY_ATTEMPTS':
      return AUTH_HINT_BY_BACKEND_CODE[code];
    default:
      return null;
  }
};

const mapAuthErrorToHint = (error: unknown): string => {
  if (error instanceof AuthFlowError) {
    const mappedByCode = resolveHintFromBackendCode(error.code);
    if (mappedByCode) {
      return mappedByCode;
    }

    if (error.status === 429) {
      return '429';
    }
    if (error.status === 401) {
      return '140';
    }
    if (error.status === 403) {
      return '430';
    }
    if (error.status && error.status >= 500) {
      return '701';
    }

    if (typeof error.message === 'string' && error.message) {
      return error.message;
    }

    return 'Network error while contacting auth backend.';
  }

  if (error instanceof Error) {
    if (typeof error.message === 'string' && error.message) {
      return error.message;
    }

    return 'Network error while contacting auth backend.';
  }

  return 'Network error while contacting auth backend.';
};

const isAlreadyRegisteredError = (error: unknown): boolean =>
  error instanceof AuthFlowError
  && Boolean(error.code)
  && ALREADY_REGISTERED_CODES.has(error.code as string);

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
  return window.localStorage.getItem(ONCELOGIN) === 'true';
};

export const useIdCardAuthController = () => {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'login' | 'register'>('login');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const sessionUser = useAuthStore((state) => state.sessionUser);
  const setSessionUser = useAuthStore((state) => state.setSessionUser);
  const clearSessionUser = useAuthStore((state) => state.clearSessionUser);

  const [profileOpen, setProfileOpen] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [profileError, setProfileError] = useState<string | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  const authBase = useMemo(() => getAuthBase(), []);

  const syncSession = useCallback(async (options?: { silent?: boolean }) => {
    try {
      const user = await fetchSessionUser();
      if (!user) {
        clearSessionUser();
        return null;
      }

      setSessionUser(user);
      markOnceLogin();
      if (user.needsProfileSetup) {
        setProfileName('');
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

  const openAuthModal = useCallback(
    (tab: 'login' | 'register') => {
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
    setProfileError(null);
    setProfileOpen(true);
  }, [openAuthModal, sessionUser]);

  const handleAvatarClick = useCallback(() => {
    if (sessionUser) {
      openProfileModal();
      return;
    }
    openAuthModal(hasOnceLogin() ? 'login' : 'register');
  }, [openAuthModal, openProfileModal, sessionUser]);

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

  const ensureEmailRegistered = useCallback(async (email: string, password: string) => {
    try {
      await registerWithEmail(email, password);
      return { registeredNow: true };
    } catch (error) {
      if (isAlreadyRegisteredError(error)) {
        return { registeredNow: false };
      }
      throw error;
    }
  }, []);

  const handleRequestVerificationCode = useCallback(async ({
    email,
    password,
  }: {
    email: string;
    password: string;
  }): Promise<boolean> => {
    if (isSubmitting) {
      return false;
    }

    setAuthError(null);
    setIsSubmitting(true);

    try {
      const { registeredNow } = await ensureEmailRegistered(email, password);

      if (!registeredNow) {
        await sendEmailVerificationOtp(email);
      }

      return true;
    } catch (error) {
      setAuthError(mapAuthErrorToHint(error));
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }, [ensureEmailRegistered, isSubmitting]);

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
      if (mode === 'login') {
        await loginWithEmail(values.email, values.password);
      } else {
        await ensureEmailRegistered(values.email, values.password);
        await verifyEmailRegistrationOtp(values.email, getVerificationDigits(values.verificationCode));
      }

      await syncSession();
      setOpen(false);
    } catch (error) {
      setAuthError(mapAuthErrorToHint(error));
    } finally {
      setIsSubmitting(false);
    }
  }, [ensureEmailRegistered, isSubmitting, syncSession]);

  const handleSaveProfile = useCallback(async () => {
    const trimmed = profileName.trim();
    if (!trimmed) {
      setProfileError('Please enter a nickname.');
      return;
    }

    if (isSavingProfile) return;
    setIsSavingProfile(true);
    setProfileError(null);

    try {
      const user = await updateProfileNickname(trimmed);
      setSessionUser({
        ...sessionUser,
        ...user,
        registeredAt: user.registeredAt ?? sessionUser?.registeredAt,
      });
      setProfileOpen(false);
      setOpen(false);
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : 'Network error while saving profile.');
    } finally {
      setIsSavingProfile(false);
    }
  }, [isSavingProfile, profileName, sessionUser, setSessionUser]);

  const handleLogout = useCallback(async () => {
    try {
      await logoutUser();
      clearSessionUser();
      setProfileOpen(false);
      setOpen(false);
      setProfileName('');
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
    sessionUser,
    profileOpen,
    setProfileOpen,
    profileName,
    setProfileName,
    profileError,
    isSavingProfile,
    openAuthModal,
    openProfileModal,
    handleAvatarClick,
    handleDiscordAuthClick,
    handleGoogleAuthClick,
    handleRequestVerificationCode,
    handleAutoSubmit,
    handleSaveProfile,
    handleLogout,
    syncSession,
  };
};
