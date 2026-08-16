const CATEGORY_IDS = ['paper', 'digital', 'collection', 'document', 'report', 'media'];
const METHOD_IDS = new Set(['map', 'mission', 'auto', 'shop', 'invstgt']);

const fail = (message) => {
  throw new Error(`Invalid archive contract: ${message}`);
};

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0;
const isPointId = (value) => Number.isInteger(value);

const validateLocation = (location, archiveId) => {
  if (!isRecord(location) || !isNonEmptyString(location.regionId)) {
    fail(`invalid shop location for ${archiveId}`);
  }
  if (location.subregionId !== undefined && !isNonEmptyString(location.subregionId)) {
    fail(`invalid shop subregion for ${archiveId}`);
  }
};

const validateAcquisition = (acquisition, archiveId) => {
  if (!isRecord(acquisition) || !METHOD_IDS.has(acquisition.method)) {
    fail(`invalid acquisition for ${archiveId}`);
  }
  switch (acquisition.method) {
    case 'map':
      if (!isPointId(acquisition.pointId)) fail(`invalid map point for ${archiveId}`);
      break;
    case 'mission':
      if (!isNonEmptyString(acquisition.missionId)) fail(`invalid mission for ${archiveId}`);
      if (acquisition.questId !== undefined && !isNonEmptyString(acquisition.questId)) {
        fail(`invalid quest for ${archiveId}`);
      }
      if (acquisition.interaction !== undefined) {
        if (!isRecord(acquisition.interaction)
          || !isPointId(acquisition.interaction.pointId)
          || !isNonEmptyString(acquisition.interaction.stageId)) {
          fail(`invalid mission interaction for ${archiveId}`);
        }
      }
      if (acquisition.special !== undefined) {
        const keys = ['npcId', 'dialogOptionId', 'bakerChatId', 'bakerDialogId'];
        if (!isRecord(acquisition.special)
          || keys.some((key) => !isNonEmptyString(acquisition.special[key]))) {
          fail(`invalid special acquisition for ${archiveId}`);
        }
      }
      break;
    case 'shop':
      if (!isNonEmptyString(acquisition.shopGroupId) || !isNonEmptyString(acquisition.shopId)) {
        fail(`invalid shop for ${archiveId}`);
      }
      if (acquisition.npcId !== undefined && !isNonEmptyString(acquisition.npcId)) {
        fail(`invalid shop NPC for ${archiveId}`);
      }
      if (acquisition.pointId !== undefined && !isPointId(acquisition.pointId)) {
        fail(`invalid shop point for ${archiveId}`);
      }
      validateLocation(acquisition.location, archiveId);
      break;
    case 'invstgt':
      if (!isNonEmptyString(acquisition.researchId)) fail(`invalid investigation for ${archiveId}`);
      break;
    default:
      break;
  }
};

export const decodeArchiveContract = (contract) => {
  if (!isRecord(contract) || contract.version !== 1 || !isRecord(contract.categories)) {
    fail('unsupported shape or version');
  }
  if (Object.keys(contract.categories).sort().join(',') !== [...CATEGORY_IDS].sort().join(',')) {
    fail('category keys do not match the contract');
  }

  const seenIds = new Set();
  return CATEGORY_IDS.flatMap((categoryId) => {
    const archives = contract.categories[categoryId];
    if (!Array.isArray(archives)) fail(`${categoryId} must be an array`);
    return archives.map((archive) => {
      if (!isRecord(archive)
        || !isNonEmptyString(archive.id)
        || !isNonEmptyString(archive.icon)
        || !isRecord(archive.acquisition)) {
        fail(`invalid archive row in ${categoryId}`);
      }
      if (seenIds.has(archive.id)) fail(`duplicate archive ID ${archive.id}`);
      seenIds.add(archive.id);
      validateAcquisition(archive.acquisition, archive.id);
      return {
        id: archive.id,
        categoryId,
        iconKey: archive.icon,
        acquisition: archive.acquisition,
      };
    });
  });
};
