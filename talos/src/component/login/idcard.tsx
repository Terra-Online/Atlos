import Modal from '@/component/modal/modal';
import DiscordIcon from '@/assets/images/UI/media/discordicon.svg?react';
import { useIdCardAuthController } from './useIdCardAuthController';
import { useIdCardHoverAngle } from './useIdCardHoverAngle';
import { useIdCardProfileViewModel } from './useIdCardProfileViewModel';
import styles from './idcard.module.scss';

const IDCard = ({ username, id }: { username?: string; id?: string }) => {
  const { cardRef, handleCardMouseMove, handleCardMouseLeave } = useIdCardHoverAngle();

  const {
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

      <Modal
        open={open}
        size="m"
        title="Account"
        onClose={() => setOpen(false)}
        onChange={setOpen}
      >
        <div className={styles.authModal}>
          <div className={styles.authTabs}>
            <button
              type="button"
              className={`${styles.authTab} ${activeTab === 'login' ? styles.active : ''}`}
              onClick={() => setActiveTab('login')}
            >
              Login
            </button>
            <button
              type="button"
              className={`${styles.authTab} ${activeTab === 'register' ? styles.active : ''}`}
              onClick={() => setActiveTab('register')}
            >
              Register
            </button>
          </div>

          <div className={styles.authBody}>
            <p className={styles.authTitle}>
              {activeTab === 'login' ? 'Login with Discord' : 'Register with Discord'}
            </p>
            <p className={styles.authHint}>
              Email/password and verification-code auth are disabled. Use Discord OAuth only.
            </p>

            <button
              type="button"
              className={styles.discordButton}
              onClick={() => {
                void handleDiscordAuthClick();
              }}
              disabled={isSubmitting}
            >
              <DiscordIcon />
              <span>
                {isSubmitting
                  ? 'Connecting...'
                  : activeTab === 'login'
                    ? 'Continue with Discord'
                    : 'Create account with Discord'}
              </span>
            </button>

            {authError && <p className={styles.authError}>{authError}</p>}

            <p className={styles.backendHint}>Auth API: {authBase}</p>
          </div>
        </div>
      </Modal>

      <Modal
        open={profileOpen}
        size="m"
        title={sessionUser?.needsProfileSetup ? 'Complete Profile' : 'Edit Profile'}
        onClose={() => setProfileOpen(false)}
        onChange={setProfileOpen}
      >
        <div className={styles.profileModal}>
          <p className={styles.profileTitle}>Nickname</p>
          <p className={styles.profileHint}>
            UID is assigned once and cannot be changed. Nickname can be updated at any time.
          </p>

          <label className={styles.profileField}>
            <span>Name</span>
            <input
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              maxLength={26}
              className={styles.profileInput}
              placeholder="e.g. jacychan"
            />
          </label>

          <p className={styles.profileUid}>
            Current UID: {sessionUser?.needsProfileSetup ? 'Will be assigned after first save' : sessionUser?.uid}
          </p>

          {profileError && <p className={styles.authError}>{profileError}</p>}

          <div className={styles.profileActions}>
            {!sessionUser?.needsProfileSetup && (
              <button
                type="button"
                className={styles.profileLogout}
                onClick={() => {
                  void handleLogout();
                }}
                disabled={isSavingProfile}
              >
                Logout
              </button>
            )}
            <button
              type="button"
              className={styles.profileCancel}
              onClick={() => setProfileOpen(false)}
              disabled={isSavingProfile}
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles.profileSave}
              onClick={() => {
                void handleSaveProfile();
              }}
              disabled={isSavingProfile}
            >
              {isSavingProfile ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
};

export default IDCard;