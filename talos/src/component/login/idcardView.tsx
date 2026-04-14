import type { MouseEventHandler, RefObject } from 'react';
import styles from './idcard.module.scss';

type KarmaLevel = 0 | 1 | 2 | 3 | 4 | 5;

export interface IdCardRenderModel {
  displayName: string;
  uidLabel: 'UID' | 'GID';
  displayUid: string;
  groupText: string;
  ageText: string;
  showAge: boolean;
  showKarma: boolean;
  titleLetter: string;
  karmaLevel: KarmaLevel;
  karmaTooltip: string;
}

interface IdCardViewProps {
  profile: IdCardRenderModel;
  embedded?: boolean;
  cardRef?: RefObject<HTMLDivElement | null>;
  onCardMouseMove?: MouseEventHandler<HTMLDivElement>;
  onCardMouseLeave?: MouseEventHandler<HTMLDivElement>;
  onAvatarClick?: () => void;
  avatarAriaLabel?: string;
  avatarIndex?: number;
  editableName?: boolean;
  nameValue?: string;
  onNameValueChange?: (value: string) => void;
  nickName?: string;
  nameAriaLabel?: string;
  nameMaxLength?: number;
}

const IdCardView = ({
  profile,
  embedded = false,
  cardRef,
  onCardMouseMove,
  onCardMouseLeave,
  onAvatarClick,
  avatarAriaLabel = 'Open profile dialog',
  avatarIndex,
  editableName = false,
  nameValue,
  onNameValueChange,
  nickName = '',
  nameAriaLabel = 'Edit username',
  nameMaxLength = 15,
}: IdCardViewProps) => {
  const cardClassName = embedded ? `${styles.idCard} ${styles.idCardEmbedded}` : styles.idCard;
  const editableDisplayName = nameValue ?? profile.displayName;

  return (
    <div
      className={cardClassName}
      ref={cardRef}
      onMouseMove={onCardMouseMove}
      onMouseLeave={onCardMouseLeave}
      data-embedded={embedded ? 'true' : 'false'}
    >
      <div className={styles.idCardWrap}>
        <button
          type="button"
          className={styles.avatarContainer}
          onClick={onAvatarClick}
          aria-label={avatarAriaLabel}
        >
          <div className={styles.avatar} data-avt={avatarIndex}></div>
        </button>

        {editableName ? (
          <label
            className={`${styles.usrName} ${styles.usrNameEditable}`}
            aria-label={nameAriaLabel}
          >
            <input
              className={styles.usrNameInput}
              value={editableDisplayName}
              onChange={(event) => onNameValueChange?.(event.target.value)}
              maxLength={nameMaxLength}
              spellCheck={false}
              autoComplete="off"
              placeholder={nickName}
            />
          </label>
        ) : (
          <span className={styles.usrName}>{profile.displayName}</span>
        )}

        <span className={styles.usrId}>
          {profile.uidLabel}: {profile.displayUid}
        </span>
        <div className={styles.metaGrid}>
          <span className={styles.usrGroup}>{profile.groupText}</span>
          {profile.showAge && <span className={styles.usrAge}>{profile.ageText}</span>}
          <span className={styles.usrTitle}>{profile.titleLetter}</span>
          {profile.showKarma && (
            <span
              className={styles.usrKarma}
              data-karma={profile.karmaLevel}
              aria-label={profile.karmaTooltip}
            ></span>
          )}
        </div>
      </div>
    </div>
  );
};

export default IdCardView;
