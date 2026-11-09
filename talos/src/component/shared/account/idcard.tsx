import { type CSSProperties } from 'react';
import { useIdCardAuthController } from '@/component/shared/account/useIdCardAuthController';
import { normalizeAvatarIndex } from '@/component/shared/account/avatarConfig';
import { useIdCardHoverAngle } from '@/component/shared/account/useIdCardHoverAngle';
import { useIdCardScale } from '@/component/shared/account/useIdCardScale';
import { useIdCardProfileViewModel } from '@/component/shared/account/useIdCardProfileViewModel';
import { Access } from '@/component/shared/account/access';
import { notifyOemAuthModalDismissed } from '@/component/shared/account/authEvents';
import IdCardView from '@/component/shared/account/idcardView';
import ProfileModal from '@/component/shared/account/profile/profile';
import styles from '@/component/shared/account/idcard.module.scss';

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
  } = useIdCardAuthController();

  const cardProfile = useIdCardProfileViewModel({
    sessionUser,
    fallbackUsername: username,
    fallbackUid: id,
    hasLoggedInBefore,
    authReady,
  });
  const sidebarAvatarIndex = sessionUser ? normalizeAvatarIndex(sessionUser.avatar) : undefined;

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
