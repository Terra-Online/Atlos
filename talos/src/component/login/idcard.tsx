import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { useIdCardAuthController } from './useIdCardAuthController';
import { normalizeAvatarIndex } from './avatarConfig';
import { useIdCardHoverAngle } from './useIdCardHoverAngle';
import { useIdCardProfileViewModel } from './useIdCardProfileViewModel';
import { Access } from './access';
import IdCardView from './idcardView';
import ProfileModal from './profile/profile';
import styles from './idcard.module.scss';

const FALLBACK_CARD_WIDTH_PX = 336;

const IDCard = ({ username, id }: { username?: string; id?: string }) => {
  const { cardRef, handleCardMouseMove, handleCardMouseLeave } = useIdCardHoverAngle();
  const responsiveShellRef = useRef<HTMLDivElement | null>(null);
  const [cardScale, setCardScale] = useState(1);

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
    profileOpen,
    setProfileOpen,
    profileName,
    setProfileName,
    profileAvatar,
    hasLoggedInBefore,
    profileError,
    isSavingProfile,
    handleAvatarClick,
    handleCycleProfileAvatar,
    handleDiscordAuthClick,
    handleGoogleAuthClick,
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
  });
  const sidebarAvatarIndex = sessionUser ? normalizeAvatarIndex(sessionUser.avatar) : undefined;

  useEffect(() => {
    const shell = responsiveShellRef.current;
    if (!shell) return;

    const updateScale = () => {
      const cardNaturalWidth = cardRef.current?.offsetWidth ?? FALLBACK_CARD_WIDTH_PX;
      if (!cardNaturalWidth) return;

      const nextScale = Math.min(1, shell.clientWidth / cardNaturalWidth);
      setCardScale((prevScale) => (Math.abs(prevScale - nextScale) < 0.001 ? prevScale : nextScale));
    };

    updateScale();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateScale);
      return () => window.removeEventListener('resize', updateScale);
    }

    const observer = new ResizeObserver(() => {
      updateScale();
    });

    observer.observe(shell);
    if (cardRef.current) {
      observer.observe(cardRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, [cardRef]);

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
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        resetToken={resetToken}
        resetEmail={resetEmail}
        isSubmitting={isSubmitting}
        authError={authError}
        handleDiscordAuthClick={handleDiscordAuthClick}
        handleGoogleAuthClick={handleGoogleAuthClick}
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
        onAvatarCycle={handleCycleProfileAvatar}
        handleSaveProfile={handleSaveProfile}
        handleLogout={handleLogout}
      />
    </>
  );
};

export default IDCard;
