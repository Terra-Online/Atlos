import { type CSSProperties, useEffect } from 'react';
import { useIdCardAuthController } from './useIdCardAuthController';
import { normalizeAvatarIndex } from './avatarConfig';
import { useIdCardHoverAngle } from './useIdCardHoverAngle';
import { useIdCardScale } from './useIdCardScale';
import { useIdCardProfileViewModel } from './useIdCardProfileViewModel';
import { Access } from './access';
import {
  OEM_AUTH_OPEN_EVENT,
  notifyOemAuthModalDismissed,
  type OemAuthOpenDetail,
} from './authEvents';
import IdCardView from './idcardView';
import ProfileModal from './profile/profile';
import styles from './idcard.module.scss';

const IDCard = ({ username, id }: { username?: string; id?: string }) => {
  const { cardRef, handleCardMouseMove, handleCardMouseLeave } = useIdCardHoverAngle();
  const { shellRef: responsiveShellRef, scale: cardScale } = useIdCardScale(cardRef);

  const {
    open,
    setOpen,
    activeTab,
    setActiveTab,
    isSubmitting,
    authError,
    resetToken,
    resetEmail,
    sessionUser,
    authReady,
    profileOpen,
    setProfileOpen,
    profileName,
    setProfileName,
    profileAvatar,
    hasLoggedInBefore,
    profileError,
    isSavingProfile,
    handleAvatarClick,
    handleCloseProfile,
    handleOAuthClick,
    handleRequestVerificationCode,
    handleRequestPasswordReset,
    handleAutoSubmit,
    handleSaveProfile,
    handleLogout,
    openAuthModal,
  } = useIdCardAuthController();

  const cardProfile = useIdCardProfileViewModel({
    sessionUser,
    fallbackUsername: username,
    fallbackUid: id,
    hasLoggedInBefore,
    authReady,
  });
  const sidebarAvatarIndex = sessionUser ? normalizeAvatarIndex(sessionUser.avatar) : undefined;

  useEffect(() => {
    const handleAuthOpen = (event: Event) => {
      const detail = (event as CustomEvent<OemAuthOpenDetail>).detail;
      openAuthModal(detail?.mode ?? 'login');
    };

    window.addEventListener(OEM_AUTH_OPEN_EVENT, handleAuthOpen);
    return () => {
      window.removeEventListener(OEM_AUTH_OPEN_EVENT, handleAuthOpen);
    };
  }, [openAuthModal]);

  return (
    <>
      <div
        ref={responsiveShellRef}
        className={styles.idCardResponsiveShell}
        style={{ '--idcard-scale': cardScale.toString() } as CSSProperties}
      >
        <div className={styles.idCardResponsiveScale}>
          <IdCardView
            profile={cardProfile}
            cardRef={cardRef}
            onCardMouseMove={handleCardMouseMove}
            onCardMouseLeave={handleCardMouseLeave}
            onAvatarClick={handleAvatarClick}
            avatarAriaLabel="Open profile dialog"
            avatarIndex={sidebarAvatarIndex}
          />
        </div>
      </div>

      <Access
        open={open}
        setOpen={setOpen}
        onDismiss={notifyOemAuthModalDismissed}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        resetToken={resetToken}
        resetEmail={resetEmail}
        isSubmitting={isSubmitting}
        authError={authError}
        handleOAuthClick={handleOAuthClick}
        onRequestVerificationCode={handleRequestVerificationCode}
        onRequestPasswordReset={handleRequestPasswordReset}
        onAutoSubmit={handleAutoSubmit}
      />

      <ProfileModal
        profileOpen={profileOpen}
        setProfileOpen={setProfileOpen}
        profileName={profileName}
        setProfileName={setProfileName}
        profileError={profileError}
        isSavingProfile={isSavingProfile}
        cardProfile={cardProfile}
        profileAvatar={profileAvatar}
        handleCloseProfile={handleCloseProfile}
        handleSaveProfile={handleSaveProfile}
        handleLogout={handleLogout}
      />
    </>
  );
};

export default IDCard;
