import type { Acquisition, ArchiveCategory } from './types';

export interface DecodedArchive {
  id: string;
  categoryId: ArchiveCategory;
  iconKey: string;
  acquisition: Acquisition;
}

export function decodeArchiveContract(contract: unknown): DecodedArchive[];
