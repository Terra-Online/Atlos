import ProfileIcon from '@/assets/logos/profile.svg?react';
import Modal from '@/component/modal/modal';
import { useTranslateUI } from '@/locale';
import { AccessButton } from '../access';
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
  const profileErrorText = profileError ?? '';
  const shouldShowProfileError = profileOpen && Boolean(profileErrorText);
  const isProfileErrorRemoved = !shouldShowProfileError;

  return (
    <Modal
      open={profileOpen}
      size="m"
      title={t('idcard.profile.title')}
      icon={<ProfileIcon />}
      iconScale={0.8}
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
          avatarAriaLabel={t('idcard.profile.avatarHint')}
          avatarIndex={profileAvatar}
          editableName
          nameValue={profileName}
          onNameValueChange={setProfileName}
          nickName={t('idcard.profile.nickName')}
          nameAriaLabel={t('idcard.profile.nameEditHint')}
          nameMaxLength={15}
        />

        <div className={styles.profileDivider} data-label={t('idcard.profile.note') || 'Note'}></div>

        <div className={styles.profileNote}>
          <p>{t('idcard.profile.noteNickname') || 'You can use letters, numbers, and underscores in your username.'}</p>
          <p>
            {t('idcard.profile.noteUID') ||
              'UID is assigned on first setup and cannot be changed. You can update your username any time.'}
          </p>
        </div>

        <div
          className={styles.profileError}
          data-removed={isProfileErrorRemoved ? 'true' : 'false'}
          data-text={profileErrorText}
          aria-live="polite"
        >
          {profileErrorText}
        </div>

        <div className={styles.profileDivider} data-label={t('idcard.profile.auditLabel') || 'Audit'}></div>

        <div className={styles.profileActions}>
          <AccessButton
            onClick={() => {
              void handleSaveProfile();
            }}
            disabled={isSavingProfile}
            label={isSavingProfile
              ? t('idcard.profile.saving') || 'Saving...'
              : t('idcard.profile.save') || 'Save Changes'}
          />
          <AccessButton
            onClick={() => {
              void handleLogout();
            }}
            disabled={isSavingProfile}
            label={t('idcard.profile.logout') || 'Sign Out'}
          />
        </div>
      </div>
    </Modal>
  );
};

export default ProfileModal;
