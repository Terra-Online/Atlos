import { useIdCardAuthController } from './useIdCardAuthController';
import { useIdCardHoverAngle } from './useIdCardHoverAngle';
import { useIdCardProfileViewModel } from './useIdCardProfileViewModel';
import { Access } from './access';
import ProfileModal from './profile/profile';
import styles from './idcard.module.scss';

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
    profileError,
    isSavingProfile,
    handleAvatarClick,
    handleDiscordAuthClick,
    handleSaveProfile,
    handleLogout,
  } = useIdCardAuthController();

  const cardProfile = useIdCardProfileViewModel({
    sessionUser,
    fallbackUsername: username,
    fallbackUid: id,
  });

  return (
    <>
      <div className={styles.idCard} ref={cardRef} onMouseMove={handleCardMouseMove} onMouseLeave={handleCardMouseLeave}>
        <div className={styles.idCardWrap}>
          <button
            type="button"
            className={styles.avatarContainer}
            onClick={handleAvatarClick}
            aria-label="Open login dialog"
          >
            <div className={styles.avatar}></div>
          </button>
          <span className={styles.usrName}>{cardProfile.displayName}</span>
          <span className={styles.usrId}>
            {cardProfile.uidLabel}: {cardProfile.displayUid}
          </span>
          <div className={styles.metaGrid}>
            <span className={styles.usrGroup}>{cardProfile.groupText}</span>
            {cardProfile.showAge && <span className={styles.usrAge}>{cardProfile.ageText}</span>}
            <span className={styles.usrTitle}>{cardProfile.titleLetter}</span>
            {cardProfile.showKarma && (
              <span
                className={styles.usrKarma}
                data-karma={cardProfile.karmaLevel}
                aria-label={cardProfile.karmaTooltip}
              ></span>
            )}
          </div>
        </div>
      </div>

      <Access
        open={open}
        setOpen={setOpen}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isSubmitting={isSubmitting}
        authError={authError}
        handleDiscordAuthClick={handleDiscordAuthClick}
      />

      <ProfileModal
        profileOpen={profileOpen}
        setProfileOpen={setProfileOpen}
        profileName={profileName}
        setProfileName={setProfileName}
        profileError={profileError}
        isSavingProfile={isSavingProfile}
        sessionUser={sessionUser}
        handleSaveProfile={handleSaveProfile}
        handleLogout={handleLogout}
      />
    </>
  );
};

export default IDCard;