import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchSessionUser,
  getAuthBase,
  logoutUser,
  startDiscordAuth,
  updateProfileNickname,
} from './authFlow';
import { useAuthStore } from '@/store/auth';

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

  const syncSession = useCallback(async () => {
    try {
      const user = await fetchSessionUser();
      if (!user) {
        clearSessionUser();
        return;
      }

      setSessionUser(user);
      if (user.needsProfileSetup) {
        setProfileName('');
        setProfileError(null);
        setProfileOpen(true);
      }
    } catch {
      // Ignore transient network errors during startup.
    }
  }, [clearSessionUser, setSessionUser]);

  useEffect(() => {
    void syncSession();
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
    openAuthModal('login');
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
      setAuthError(error instanceof Error ? error.message : 'Network error while contacting auth backend.');
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
    handleSaveProfile,
    handleLogout,
    syncSession,
  };
};
