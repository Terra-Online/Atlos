import ProfileIcon from '@/assets/logos/profile.svg?react';
import Modal from '@/component/modal/modal';
import { useTranslateUI } from '@/locale';
import IdCardView, { type IdCardRenderModel } from '../idcardView';
import { useIdCardHoverAngle } from '../useIdCardHoverAngle';
import styles from './profile.module.scss';

interface ProfileModalProps {
  profileOpen: boolean;
  setProfileOpen: (open: boolean) => void;
  profileName: string;
  setProfileName: (name: string) => void;
  profileError: string | null;
  isSavingProfile: boolean;
  cardProfile: IdCardRenderModel;
  profileAvatar: number;
  onAvatarCycle: () => void;
  handleSaveProfile: () => Promise<void>;
  handleLogout: () => Promise<void>;
}

const ProfileModal = ({
  profileOpen,
  setProfileOpen,
  profileName,
  setProfileName,
  profileError,
  isSavingProfile,
  cardProfile,
  profileAvatar,
  onAvatarCycle,
  handleSaveProfile,
  handleLogout,
}: ProfileModalProps) => {
  const t = useTranslateUI();
  const { cardRef, handleCardMouseMove, handleCardMouseLeave } = useIdCardHoverAngle();

  return (
    <Modal
      open={profileOpen}
      size="m"
      title={t('idcard.profile.modalTitle') || 'profile'}
      icon={<ProfileIcon />}
      iconScale={0.78}
      onClose={() => setProfileOpen(false)}
      onChange={setProfileOpen}
    >
      <div className={styles.profileModal}>
        <IdCardView
          embedded
          profile={cardProfile}
          cardRef={cardRef}
          onCardMouseMove={handleCardMouseMove}
          onCardMouseLeave={handleCardMouseLeave}
          onAvatarClick={onAvatarCycle}
          avatarAriaLabel={t('idcard.profile.avatarHint') || 'Open profile actions'}
          avatarIndex={profileAvatar}
          editableName
          nameValue={profileName}
          onNameValueChange={setProfileName}
          namePlaceholder={t('idcard.profile.namePlaceholder') || 'e.g. jacychan'}
          nameAriaLabel={t('idcard.profile.nameEditorLabel') || 'Edit username'}
          nameMaxLength={15}
        />

        <div className={styles.profileDivider} data-label={t('idcard.profile.noteLabel') || 'Note'}></div>

        <div className={styles.profileNote}>
          <p>{t('idcard.profile.noteLine1') || 'You can use letters, numbers, and underscores in your username.'}</p>
          <p>
            {t('idcard.profile.noteLine2') ||
              'UID is assigned on first setup and cannot be changed. You can update your username any time.'}
          </p>
        </div>

        {profileError && <p className={styles.profileError}>{profileError}</p>}

        <div className={styles.profileDivider} data-label={t('idcard.profile.auditLabel') || 'Audit'}></div>

        <div className={styles.profileActions}>
          <button
            type="button"
            className={styles.profileSaveButton}
            onClick={() => {
              void handleSaveProfile();
            }}
            disabled={isSavingProfile}
          >
            {isSavingProfile
              ? t('idcard.profile.saving') || 'Saving...'
              : t('idcard.profile.save') || 'Save Changes'}
          </button>
          <button
            type="button"
            className={styles.profileLogoutButton}
            onClick={() => {
              void handleLogout();
            }}
            disabled={isSavingProfile}
          >
            {t('idcard.profile.logout') || 'Sign Out'}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default ProfileModal;
