import { useMemo } from 'react';
import { useLocale, useTranslateUI } from '@/locale';
import { formatAbsoluteTime, formatRelativeTime, parseTimestamp } from '@/lib/format/time';
import type { SessionUser, UserGroupCode } from '@/services/auth';

type KarmaLevel = 0 | 1 | 2 | 3 | 4 | 5;

interface UseIdCardProfileViewModelOptions {
  sessionUser: SessionUser | null;
  fallbackUsername?: string;
  fallbackUid?: string;
  hasLoggedInBefore?: boolean;
  authReady?: boolean;
}

interface IdCardProfileViewModel {
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

const DEFAULT_NAME = 'Anominstrator';
const DEFAULT_UID = 'ANONHK39SG';

const normalizeKarmaLevel = (value: number): KarmaLevel => {
  const level = Math.floor(value);
  if (level <= 0) return 0;
  if (level >= 5) return 5;
  return level as KarmaLevel;
};

const normalizeGroupCode = (value?: string): UserGroupCode | undefined => {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  const map: Record<string, UserGroupCode> = {
    normal: 'normal',
    n: 'normal',
    pioneer: 'pioneer',
    p: 'pioneer',
    admin: 'admin',
    a: 'admin',
    suspend: 'suspend',
    s: 'suspend',
    robot: 'robot',
    r: 'robot',
    guest: 'guest',
    g: 'guest',
  };
  return map[normalized];
};

const hash32 = (text: string, seed: number): number => {
  let hash = seed >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const buildGuestId = (): string => {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'guest';
  const h1 = hash32(ua, 2166136261);
  const h2 = hash32(ua, 2166136261 ^ 0x9e3779b9);
  const raw = `${h1.toString(36)}${h2.toString(36)}`.toUpperCase();
  return raw.padStart(10, '0').slice(0, 10);
};

export const useIdCardProfileViewModel = ({
  sessionUser,
  fallbackUsername,
  fallbackUid,
  hasLoggedInBefore = false,
  authReady = true,
}: UseIdCardProfileViewModelOptions): IdCardProfileViewModel => {
  const t = useTranslateUI();
  const locale = useLocale();

  return useMemo(() => {
    if (!authReady && hasLoggedInBefore) {
      const loadingText = t('common.loading');
      const group = t('idcard.group');
      return {
        displayName: loadingText,
        uidLabel: 'UID',
        displayUid: '...',
        groupText: `${group}...`,
        ageText: `${loadingText}...`,
        showAge: true,
        showKarma: false,
        titleLetter: '.',
        karmaLevel: 0,
        karmaTooltip: loadingText,
      };
    }

    const getGroupName = (groupCode: UserGroupCode): string => {
      if (groupCode === 'normal') return t('idcard.normal');
      if (groupCode === 'pioneer') return t('idcard.pioneer');
      if (groupCode === 'admin') return t('idcard.admin');
      if (groupCode === 'suspend') return t('idcard.suspend');
      if (groupCode === 'robot') return t('idcard.robot');
      return t('idcard.guest');
    };

    const isGuest = !sessionUser;
    const displayName = sessionUser?.nickname || fallbackUsername || DEFAULT_NAME;
    const uidLabel: 'UID' | 'GID' = isGuest ? 'GID' : 'UID';

    const unassignedText = t('idcard.unassigned');
    const displayUid = isGuest
      ? buildGuestId()
      : sessionUser?.needsProfileSetup
      ? unassignedText
      : sessionUser?.uid || fallbackUid || DEFAULT_UID;

    const groupCode = isGuest
      ? 'guest'
      : normalizeGroupCode(sessionUser?.groupCode) || 'normal';
    const groupName = getGroupName(groupCode);
    const group = t('idcard.group');
    const groupText = `${group}${groupName}`;

    const since = t('idcard.since');
    const registipText = t('idcard.registip');
    const logintipText = t('idcard.logintip');
    const registeredDate = parseTimestamp(sessionUser?.registeredAt);
    const ageText = isGuest
      ? hasLoggedInBefore ? logintipText : registipText
      : registeredDate
      ? `${since} ${formatAbsoluteTime(registeredDate, {
          locale,
          precision: 'date',
        })} (${formatRelativeTime(registeredDate, { locale })})`
      : `${since} --`;

    const titleSource = isGuest ? 'g' : sessionUser?.titleCode || groupCode;
    const titleLetter = (titleSource?.trim().charAt(0) || 'n').toUpperCase();

    const karmaValue = Number.isFinite(sessionUser?.karma)
      ? Math.max(0, sessionUser?.karma as number)
      : 0;
    const karmaLevel = normalizeKarmaLevel(karmaValue);
    const karma = t('idcard.karma');
    const karmaTooltip = `${karma}: ${karmaValue}`;

    return {
      displayName,
      uidLabel,
      displayUid,
      groupText,
      ageText,
      showAge: true,
      showKarma: !isGuest,
      titleLetter,
      karmaLevel,
      karmaTooltip,
    };
  }, [authReady, fallbackUid, fallbackUsername, hasLoggedInBefore, locale, sessionUser, t]);
};
