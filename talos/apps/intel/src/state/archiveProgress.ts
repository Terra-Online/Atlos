import { intelArchives } from '@intel/data/types';
import type { ArchiveProgressManifestPayload } from '@main/services/progress';

let archiveProgressIndexPromise: Promise<ArchiveProgressManifestPayload> | null = null;

const toHex = (bytes: Uint8Array): string => (
  Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('')
);

const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return toHex(new Uint8Array(digest));
};

const buildCanonicalArchiveManifest = (archiveIds: string[]): string => JSON.stringify({
  schemaVersion: 1,
  scope: 'intel-archives',
  archives: archiveIds,
});

export const getArchiveProgressIndex = (): Promise<ArchiveProgressManifestPayload> => {
  archiveProgressIndexPromise ??= (async () => {
    const archiveIds = [...new Set(intelArchives
      .filter((archive) => archive.acquisition.method !== 'map')
      .map((archive) => archive.id))]
      .sort();
    return {
      archiveIds,
      archiveIndexHash: await sha256Hex(buildCanonicalArchiveManifest(archiveIds)),
    };
  })();
  return archiveProgressIndexPromise;
};

export const normalizeArchiveIds = (archiveIds: string[]): string[] => (
  [...new Set(archiveIds.map(String).map((archiveId) => archiveId.trim()).filter(Boolean))]
);

export const areArchiveSetsEqual = (first: string[], second: string[]): boolean => {
  if (first.length !== second.length) return false;
  const firstSet = new Set(first);
  return firstSet.size === second.length && second.every((archiveId) => firstSet.has(archiveId));
};

export const buildArchivePatch = (baseArchiveIds: string[], nextArchiveIds: string[]): {
  setArchiveIds: string[];
  clearArchiveIds: string[];
} => {
  const base = new Set(baseArchiveIds);
  const next = new Set(nextArchiveIds);
  return {
    setArchiveIds: [...next].filter((archiveId) => !base.has(archiveId)),
    clearArchiveIds: [...base].filter((archiveId) => !next.has(archiveId)),
  };
};

export const splitArchiveIds = (
  archiveIds: string[],
  knownArchiveIds: ReadonlySet<string>,
): { known: string[]; unknown: string[] } => {
  const known: string[] = [];
  const unknown: string[] = [];
  normalizeArchiveIds(archiveIds).forEach((archiveId) => {
    (knownArchiveIds.has(archiveId) ? known : unknown).push(archiveId);
  });
  return { known, unknown };
};
