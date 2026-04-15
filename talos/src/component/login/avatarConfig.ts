const DEFAULT_AVATAR_MAX_INDEX = 33;

const parseAvatarMaxIndex = (): number => {
  const envRaw = (import.meta.env.VITE_AVATAR_MAX_INDEX as string | undefined)?.trim();
  const parsed = envRaw ? Number(envRaw) : NaN;

  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_AVATAR_MAX_INDEX;
  }

  return Math.floor(parsed);
};

export const AVATAR_MAX_INDEX = parseAvatarMaxIndex();

export const normalizeAvatarIndex = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }

  const normalized = Math.floor(parsed);
  if (normalized > AVATAR_MAX_INDEX) {
    return AVATAR_MAX_INDEX;
  }

  return normalized;
};

export const getNextAvatarIndex = (current: number): number =>
  current >= AVATAR_MAX_INDEX ? 1 : current + 1;
