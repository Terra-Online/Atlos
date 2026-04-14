import { useIdCardAuthController } from './useIdCardAuthController';
import { normalizeAvatarIndex } from './avatarConfig';
import { useIdCardHoverAngle } from './useIdCardHoverAngle';
import { useIdCardProfileViewModel } from './useIdCardProfileViewModel';
import { Access } from './access';
import IdCardView from './idcardView';
import ProfileModal from './profile/profile';

const IDCard = ({ username, id }: { username?: string; id?: string }) => {
  const { cardRef, handleCardMouseMove, handleCardMouseLeave } = useIdCardHoverAngle();

  const {
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
    profileAvatar,
    profileError,
    isSavingProfile,
    handleAvatarClick,
    handleCycleProfileAvatar,
    handleDiscordAuthClick,
    handleGoogleAuthClick,
    handleRequestVerificationCode,
    handleAutoSubmit,
    handleSaveProfile,
    handleLogout,
  } = useIdCardAuthController();

  const cardProfile = useIdCardProfileViewModel({
    sessionUser,
    fallbackUsername: username,
    fallbackUid: id,
  });
  const sidebarAvatarIndex = sessionUser ? normalizeAvatarIndex(sessionUser.avatar) : undefined;

  return (
    <>
      <IdCardView
        profile={cardProfile}
        cardRef={cardRef}
        onCardMouseMove={handleCardMouseMove}
        onCardMouseLeave={handleCardMouseLeave}
        onAvatarClick={handleAvatarClick}
        avatarAriaLabel="Open profile dialog"
        avatarIndex={sidebarAvatarIndex}
      />

      <Access
        open={open}
        setOpen={setOpen}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isSubmitting={isSubmitting}
        authError={authError}
        handleDiscordAuthClick={handleDiscordAuthClick}
        handleGoogleAuthClick={handleGoogleAuthClick}
        onRequestVerificationCode={handleRequestVerificationCode}
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