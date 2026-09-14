import contractJson from './generated/archive_contract.json';
import { decodeArchiveContract } from './archiveContract.mjs';

export type ArchiveCategory = 'paper' | 'digital' | 'collection' | 'document' | 'report' | 'media';

export type Acquisition =
  | { method: 'map'; pointId: number }
  | { method: 'mission'; missionId: string; questId?: string; interaction?: MissionInteraction; special?: MissionSpecial }
  | { method: 'auto' }
  | { method: 'shop'; shopGroupId: string; shopId: string; npcId?: string; pointId?: number; location: ShopLocation }
  | { method: 'invstgt'; researchId: string };

export interface MissionInteraction {
  pointId: number;
  stageId: string;
}

export interface MissionSpecial {
  npcId: string;
  dialogOptionId: string;
  bakerChatId: string;
  bakerDialogId: string;
}

export interface ShopLocation {
  regionId: string;
  subregionId?: string;
}

export interface IntelArchive {
  id: string;
  categoryId: ArchiveCategory;
  iconUrl: string;
  acquisition: Acquisition;
}

const iconModules = import.meta.glob<string>('../assets/archive-icons/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
});
const iconUrlByKey = new Map(
  Object.entries(iconModules).map(([file, url]) => [file.split('/').pop()?.replace(/\.webp$/, '') ?? '', url]),
);

export const intelArchives: IntelArchive[] = decodeArchiveContract(contractJson).map(({ iconKey, ...archive }) => {
  const iconUrl = iconUrlByKey.get(iconKey);
  if (!iconUrl) throw new Error(`Missing archive icon ${iconKey}`);
  return { ...archive, iconUrl };
});

export const archiveById = new Map(intelArchives.map((archive) => [archive.id, archive]));
