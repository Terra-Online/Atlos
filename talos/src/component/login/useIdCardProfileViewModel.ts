import { useMemo } from 'react';
import { useTranslateUI } from '@/locale';
import type { SessionUser, UserGroupCode } from './authTypes';

type KarmaLevel = 0 | 1 | 2 | 3 | 4 | 5;

interface UseIdCardProfileViewModelOptions {
  sessionUser: SessionUser | null;
  fallbackUsername?: string;
  fallbackUid?: string;
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
const GROUP_NAME_FALLBACK: Record<UserGroupCode, string> = {
  normal: 'Normal',
  pioneer: 'Pioneer',
  admin: 'Admin',
  suspend: 'Suspended',
  robot: 'Robot',
  guest: 'Guest',
};

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

const parseRegisteredAt = (value?: string): Date | null => {
  if (!value) return null;
  const raw = value.trim();
  if (!raw) return null;

  if (/^\d+$/.test(raw)) {
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) return null;
    const ms = numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDate = (date: Date): string => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatElapsed = (fromMs: number, nowMs: number): string => {
  const diffSec = Math.max(0, Math.floor((nowMs - fromMs) / 1000));

  if (diffSec < 60) {
    return `${diffSec}s`;
  }

  if (diffSec < 60 * 60) {
    const minutes = Math.floor(diffSec / 60);
    return `${minutes}m`;
  }

  if (diffSec < 24 * 60 * 60) {
    const hours = Math.floor(diffSec / (60 * 60));
    return `${hours}hr`;
  }

  const days = Math.floor(diffSec / (24 * 60 * 60));
  return `${days}d`;
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
}: UseIdCardProfileViewModelOptions): IdCardProfileViewModel => {
  const t = useTranslateUI();

  return useMemo(() => {
    const getGroupName = (groupCode: UserGroupCode): string => {
      if (groupCode === 'normal') return t('idcard.normal') || GROUP_NAME_FALLBACK.normal;
      if (groupCode === 'pioneer') return t('idcard.pioneer') || GROUP_NAME_FALLBACK.pioneer;
      if (groupCode === 'admin') return t('idcard.admin') || GROUP_NAME_FALLBACK.admin;
      if (groupCode === 'suspend') return t('idcard.suspend') || GROUP_NAME_FALLBACK.suspend;
      if (groupCode === 'robot') return t('idcard.robot') || GROUP_NAME_FALLBACK.robot;
      return t('idcard.guest') || GROUP_NAME_FALLBACK.guest;
    };

    const isGuest = !sessionUser;
    const displayName = sessionUser?.nickname || fallbackUsername || DEFAULT_NAME;
    const uidLabel: 'UID' | 'GID' = isGuest ? 'GID' : 'UID';

    const pendingText = t('idcard.loading') || 'Pending';
    const displayUid = isGuest
      ? buildGuestId()
      : sessionUser?.needsProfileSetup
      ? pendingText
      : sessionUser?.uid || fallbackUid || DEFAULT_UID;

    const groupCode = isGuest
      ? 'guest'
      : normalizeGroupCode(sessionUser?.groupCode) || 'normal';
    const groupName = getGroupName(groupCode);
    const group = t('idcard.group') || 'Group';
    const groupText = `${group}${groupName}`;

    const since = t('idcard.since') || 'Since';
    const ago = t('idcard.ago') || 'Ago';
    const registipText = t('idcard.registip') || 'Click the avatar';
    const registeredDate = parseRegisteredAt(sessionUser?.registeredAt);
    const ageText = isGuest
      ? registipText
      : registeredDate
      ? (() => {
          const elapsed = formatElapsed(registeredDate.getTime(), Date.now());
          return `${since}: ${formatDate(registeredDate)} (${elapsed} ${ago})`;
        })()
      : `${since}: --`;

    const titleSource = isGuest ? 'g' : sessionUser?.titleCode || groupCode;
    const titleLetter = (titleSource?.trim().charAt(0) || 'n').toUpperCase();

    const karmaValue = Number.isFinite(sessionUser?.karma)
      ? Math.max(0, sessionUser?.karma as number)
      : 0;
    const karmaLevel = normalizeKarmaLevel(karmaValue);
    const karma = t('idcard.karma') || 'Karma';
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
  }, [fallbackUid, fallbackUsername, sessionUser, t]);
};
