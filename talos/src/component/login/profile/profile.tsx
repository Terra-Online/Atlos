import { useEffect, useRef, useState } from 'react';
import ProfileIcon from '@/assets/logos/profile.svg?react';
import Modal from '@/component/modal/modal';
import { requestEndfieldBinding } from '@/component/locator';
import SyncConflictModal, { type SyncConflictChoice } from '@/component/sync/conflict';
import { useLocale, useTranslateUI } from '@/locale';
import { formatIcuText } from '@/locale/messageFormat';
import { useProgressSyncStore } from '@/store/progressSync';
import { useUserRecordStore } from '@/store/userRecord';
import { useDevice } from '@/platform/device';
import { EFBackendError, getEFBindingStatus } from '@/services/endfield';
import {
  applyOfficialMarks,
  hasOfficialMarksConflict,
  loadOfficialMarksSnapshot,
  type OfficialMarksSnapshot,
} from '@/services/endfield';
import { formatElapsedShort, parseTimestamp } from '@/lib/format/time';
import ProgressSyncHost from '@/component/progressSync/ProgressSyncHost';
import { requestProgressSyncNow } from '@/component/progressSync/progressSyncController';
import { areLocalPointsSynced } from '@/services/progress/pointState';
import { AccessButton } from '../access';
import IdCardView, { type IdCardRenderModel } from '../idcardView';
import { useIdCardHoverAngle } from '../useIdCardHoverAngle';
import styles from './profile.module.scss';

const MODAL_EXIT_DURATION_MS = 325;
const SYNC_HINT_BUSY_STATUSES = new Set(['checking', 'dirty', 'syncing']);
const SYNC_HINT_FAILED_STATUSES = new Set(['error', 'offline', 'conflict']);

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
  handleCloseProfile: () => Promise<void>;
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
  handleCloseProfile,
  handleSaveProfile,
  handleLogout,
}: ProfileModalProps) => {
  const t = useTranslateUI();
  const locale = useLocale();
  const { isMobile } = useDevice();
  const { cardRef, handleCardMouseMove, handleCardMouseLeave } = useIdCardHoverAngle();
  const [isImportingOfficialMarks, setIsImportingOfficialMarks] = useState(false);
  const [conflictSnapshot, setConflictSnapshot] = useState<OfficialMarksSnapshot | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [syncHintNow, setSyncHintNow] = useState(Date.now());
  const conflictCleanupTimerRef = useRef<number | null>(null);
  const conflictOpenTimerRef = useRef<number | null>(null);
  const progressSync = useProgressSyncStore();
  const activePoints = useUserRecordStore((state) => state.activePoints);
  const profileErrorText = profileError ?? '';
  const shouldShowProfileError = profileOpen && Boolean(profileErrorText);
  const isProfileErrorRemoved = !shouldShowProfileError;
  const modalSize = isMobile ? 'full' : 'm';
  const syncedAtDate = parseTimestamp(progressSync.lastSyncedAt);
  const syncedAgo = syncedAtDate ? formatElapsedShort(syncedAtDate.getTime(), syncHintNow) : '';
  const syncPointCount = Math.max(progressSync.localPointCount, progressSync.remotePointCount);
  const isProgressSyncing = progressSync.status === 'checking' || progressSync.status === 'syncing';
  const isLocalCloudSynced = progressSync.status === 'synced'
    && progressSync.conflict === null
    && areLocalPointsSynced(activePoints, progressSync.baseline);
  const syncButtonLabel = isProgressSyncing
    ? t('common.loading')
    : isLocalCloudSynced
      ? t('sync.already')
      : t('sync.now');
  const syncFailureReason = progressSync.status === 'offline'
    ? t('sync.offline')
    : progressSync.status === 'conflict'
      ? t('sync.dataConflict')
      : progressSync.error || t('sync.unknown');
  const syncHint = SYNC_HINT_FAILED_STATUSES.has(progressSync.status)
    ? t('sync.failed').replace('{reason}', syncFailureReason)
    : SYNC_HINT_BUSY_STATUSES.has(progressSync.status)
      ? formatIcuText({
          template: t('sync.syncing'),
          locale,
          values: { count: syncPointCount },
        })
      : syncedAgo
        ? t('sync.done').replace('{times}', syncedAgo)
        : '';

  useEffect(() => () => {
    if (conflictCleanupTimerRef.current !== null) {
      window.clearTimeout(conflictCleanupTimerRef.current);
    }
    if (conflictOpenTimerRef.current !== null) {
      window.clearTimeout(conflictOpenTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (!profileOpen || !progressSync.lastSyncedAt) return undefined;
    const timer = window.setInterval(() => setSyncHintNow(Date.now()), 1000);
    setSyncHintNow(Date.now());
    return () => window.clearInterval(timer);
  }, [profileOpen, progressSync.lastSyncedAt]);

  const clearConflictTimers = () => {
    if (conflictCleanupTimerRef.current !== null) {
      window.clearTimeout(conflictCleanupTimerRef.current);
      conflictCleanupTimerRef.current = null;
    }
    if (conflictOpenTimerRef.current !== null) {
      window.clearTimeout(conflictOpenTimerRef.current);
      conflictOpenTimerRef.current = null;
    }
  };

  const closeConflictModal = () => {
    setConflictOpen(false);
    if (conflictCleanupTimerRef.current !== null) {
      window.clearTimeout(conflictCleanupTimerRef.current);
    }
    conflictCleanupTimerRef.current = window.setTimeout(() => {
      setConflictSnapshot(null);
      conflictCleanupTimerRef.current = null;
    }, MODAL_EXIT_DURATION_MS);
  };

  const openConflictModalAfterProfile = async (snapshot: OfficialMarksSnapshot) => {
    clearConflictTimers();
    await handleCloseProfile();
    setConflictSnapshot(snapshot);
    setConflictOpen(false);
    conflictOpenTimerRef.current = window.setTimeout(() => {
      setConflictOpen(true);
      conflictOpenTimerRef.current = null;
    }, MODAL_EXIT_DURATION_MS);
  };

  const requestBindingThenImport = () => {
    void handleCloseProfile();
    requestEndfieldBinding({
      enableLocator: false,
      onBound: handleImportOfficialMarks,
    });
  };

  const handleImportOfficialMarks = async () => {
    if (isImportingOfficialMarks) return;
    setIsImportingOfficialMarks(true);
    try {
      const status = await getEFBindingStatus();
      if (!status.binding.bound || !status.binding.enabled) {
        requestBindingThenImport();
        return;
      }

      const snapshot = await loadOfficialMarksSnapshot();
      if (hasOfficialMarksConflict(snapshot)) {
        void openConflictModalAfterProfile(snapshot);
        return;
      }

      applyOfficialMarks(snapshot.officialPointIds, snapshot.unresolved);
    } catch (error) {
      if (error instanceof EFBackendError && error.code === 'ENDFIELD_BINDING_NOT_FOUND') {
        requestBindingThenImport();
        return;
      }
      console.warn('[sync][official] import failed', error);
    } finally {
      setIsImportingOfficialMarks(false);
    }
  };

  const handleConflictResolve = (choice: SyncConflictChoice) => {
    if (!conflictSnapshot) return;
    const pointIds = choice === 'a'
      ? conflictSnapshot.localPointIds
      : choice === 'b'
        ? conflictSnapshot.officialPointIds
        : [...new Set([...conflictSnapshot.localPointIds, ...conflictSnapshot.officialPointIds])];
    applyOfficialMarks(pointIds, conflictSnapshot.unresolved);
    closeConflictModal();
  };

  return (
    <>
      <ProgressSyncHost />
      <Modal
        open={profileOpen}
        size={modalSize}
        title={t('idcard.profile.title')}
        icon={<ProfileIcon />}
        iconScale={0.8}
        onClose={() => {
          void handleCloseProfile();
        }}
        onChange={(nextOpen) => {
          if (nextOpen) {
            setProfileOpen(true);
            return;
          }
          void handleCloseProfile();
        }}
        customHeight='80dvh'
      >
        <div className={styles.profileWrap}>
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
          {syncHint && (
            <div className={styles.profileSyncHint} aria-live="polite">
              {syncHint}
            </div>
          )}

          <div className={styles.profileDivider} data-label={t('idcard.profile.note')}></div>

          <div className={styles.profileNote}>
            <p>{t('idcard.profile.noteNickname')}</p>
            <p>
              {t('idcard.profile.noteUID')}
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

          <div className={styles.profileDivider} data-label={t('idcard.profile.auditLabel')}></div>

          <div className={styles.profileActions}>
            <div className={styles.profileActionWide}>
              <AccessButton
                onClick={() => {
                  void requestProgressSyncNow();
                }}
                disabled={isSavingProfile || isProgressSyncing || isLocalCloudSynced}
                label={syncButtonLabel}
              />
            </div>
            <div className={styles.profileActionWide}>
              <AccessButton
                onClick={() => {
                  void handleImportOfficialMarks();
                }}
                disabled={isSavingProfile || isImportingOfficialMarks}
                label={isImportingOfficialMarks
                  ? t('common.loading')
                  : t('idcard.profile.importOfficial')}
              />
            </div>
            <AccessButton
              onClick={() => {
                void handleSaveProfile();
              }}
              disabled={isSavingProfile}
              label={isSavingProfile
                ? t('idcard.profile.saving')
                : t('idcard.profile.save')}
            />
            <AccessButton
              onClick={() => {
                void handleLogout();
              }}
              disabled={isSavingProfile}
              label={t('idcard.profile.logout')}
            />
          </div>
        </div>
      </Modal>
      {conflictSnapshot && (
        <SyncConflictModal
          open={conflictOpen}
          sourceA={{
            side: 'local',
            updatedAt: conflictSnapshot.localUpdatedAt,
            pointIds: conflictSnapshot.localPointIds,
          }}
          sourceB={{
            side: 'remote',
            remoteSource: 'official',
            updatedAt: conflictSnapshot.officialUpdatedAt,
            pointIds: conflictSnapshot.officialPointIds,
          }}
          onClose={closeConflictModal}
          onResolve={handleConflictResolve}
        />
      )}
    </>
  );
};

export default ProfileModal;
