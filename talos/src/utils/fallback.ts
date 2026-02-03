/**
 * Storage Migration Fallback for Chest ID Changes
 * 
 * Handles migration when chests are upgraded (crate_ii/crate_iii → cratesurprise).
 * Uses upgrade list + offset rules instead of full ID mapping for efficiency.
 */

const MIGRATION_VERSION = '20250204';
const MIGRATION_KEY = 'OEMIGRV';

/**
 * Chests that were upgraded to cratesurprise.
 * Format: { oldId: newId }
 */
const UPGRADE_MAP: Record<string, string> = {
  "int_trchest_common_high_008": "int_trchest_common_gorgeous_002",
  "int_trchest_common_high_009": "int_trchest_common_gorgeous_003",
  "int_trchest_common_high_011": "int_trchest_common_gorgeous_004",
  "int_trchest_common_high_019": "int_trchest_common_gorgeous_005",
  "int_trchest_common_high_020": "int_trchest_common_gorgeous_006",
  "int_trchest_common_high_021": "int_trchest_common_gorgeous_007",
  "int_trchest_common_normal_039": "int_trchest_common_gorgeous_007",
  "int_trchest_common_high_038": "int_trchest_common_gorgeous_008",
  "int_trchest_common_high_043": "int_trchest_common_gorgeous_009",
  "int_trchest_common_high_056": "int_trchest_common_gorgeous_010",
  "int_trchest_common_high_058": "int_trchest_common_gorgeous_010",
  "int_trchest_common_high_103": "int_trchest_common_gorgeous_014",
  "int_trchest_common_high_114": "int_trchest_common_gorgeous_015",
  "int_trchest_common_high_120": "int_trchest_common_gorgeous_016",
  "int_trchest_common_high_128": "int_trchest_common_gorgeous_017",
  "int_trchest_common_normal_123": "int_trchest_common_gorgeous_013",
};

/**
 * Index offsets for each chest type after upgrades.
 * Format: { type: { startIndex: offset } }
 * Offsets are cumulative - each entry represents the total shift from that index onwards.
 */
const INDEX_OFFSETS: Record<string, Record<number, number>> = {
  'high': {
    10: -1,  // After _008 upgrade, _010+ shift by -1
    12: -2,  // After _009,_011 upgrades, _012+ shift by -2
    22: -3,  // After _019,_020,_021 upgrades, _022+ shift by -3
    39: -7,  // After VL_1 upgrades, _039+ shift by -7
    72: -1,  // After _071 upgrade
    79: -2,  // After _078 upgrade
    104: -1, // After _103 upgrade
    115: -1, // After _114 upgrade
    121: -2, // After _120,_128 upgrades
  },
  'normal': {
    2: -1,   // WL_1 shifts
    18: -1,  // VL_7 shifts
    30: -1,  // VL_6 shifts
    40: -1,  // After _039 upgrade
    55: -1,  // VL_1 shifts
    85: -1,  // WL_2 shifts
    124: -1, // After _123 upgrade
  }
};

/**
 * Parse chest ID to extract type and index.
 * Returns null if not a chest ID that needs migration.
 */
const parseChestId = (id: string): { prefix: string; type: string; index: number } | null => {
  const highMatch = id.match(/^(int_trchest_common_high)_(\d+)$/);
  if (highMatch) return { prefix: highMatch[1], type: 'high', index: parseInt(highMatch[2]) };
  
  const normalMatch = id.match(/^(int_trchest_common_normal)_(\d+)$/);
  if (normalMatch) return { prefix: normalMatch[1], type: 'normal', index: parseInt(normalMatch[2]) };
  
  return null;
};

/**
 * Migrate a single ID.
 */
const migrateId = (id: string): string => {
  // Check upgrade first
  if (id in UPGRADE_MAP) return UPGRADE_MAP[id];
  
  // Parse chest ID
  const parsed = parseChestId(id);
  if (!parsed) return id;
  
  const { prefix, type, index } = parsed;
  const offsets = INDEX_OFFSETS[type];
  if (!offsets) return id;
  
  // Find applicable offset (use largest startIndex that's <= current index)
  let offset = 0;
  const sortedIndices = Object.keys(offsets).map(Number).sort((a, b) => b - a);
  for (const startIndex of sortedIndices) {
    if (index >= startIndex) {
      offset = offsets[startIndex];
      break;
    }
  }
  
  if (offset === 0) return id;
  
  const newIndex = index + offset;
  return `${prefix}_${newIndex.toString().padStart(3, '0')}`;
};

/**
 * Migrate an array of IDs.
 */
const migrateIds = (ids: string[]): string[] => {
  return ids.map(migrateId);
};

/**
 * Migrate the points-storage (userRecord store) data.
 * Storage key: 'points-storage'
 * Structure: { state: { activePoints: string[] }, version: number }
 */
const migratePointsStorage = (): boolean => {
  const storageKey = 'points-storage';
  const raw = localStorage.getItem(storageKey);
  if (!raw) return false;

  try {
    const data = JSON.parse(raw) as { state?: { activePoints?: string[] }; version?: number };
    const activePoints = data.state?.activePoints;
    
    if (!activePoints || !Array.isArray(activePoints)) return false;

    const migratedPoints = migrateIds(activePoints);
    // Check if any changes occurred
    const hasChanges = migratedPoints.some((id, i) => id !== activePoints[i]);
    if (!hasChanges) return false;
    
    // Remove duplicates that might occur from multiple old IDs mapping to same new ID
    const uniquePoints = [...new Set(migratedPoints)];
    
    data.state = { ...data.state, activePoints: uniquePoints };
    localStorage.setItem(storageKey, JSON.stringify(data));
    
    console.log(`[Migration] Migrated ${activePoints.length - uniquePoints.length + migratedPoints.filter((_, i) => migratedPoints[i] !== activePoints[i]).length} points`);
    return true;
  } catch (e) {
    console.error('[Migration] Failed to migrate points-storage:', e);
    return false;
  }
};

/**
 * Migrate the marker-filter (markerStore) data.
 * Storage key: 'marker-filter'
 * Structure: { state: { filter: string[], selectedPoints: string[] }, version: number }
 */
const migrateMarkerFilter = (): boolean => {
  const storageKey = 'marker-filter';
  const raw = localStorage.getItem(storageKey);
  if (!raw) return false;

  try {
    const data = JSON.parse(raw) as { 
      state?: { filter?: string[]; selectedPoints?: string[] }; 
      version?: number 
    };
    
    let changed = false;
    
    // Migrate selectedPoints
    const selectedPoints = data.state?.selectedPoints;
    if (selectedPoints && Array.isArray(selectedPoints)) {
      const migratedSelected = migrateIds(selectedPoints);
      const hasChanges = migratedSelected.some((id, i) => id !== selectedPoints[i]);
      if (hasChanges) {
        const uniqueSelected = [...new Set(migratedSelected)];
        data.state = { ...data.state, selectedPoints: uniqueSelected };
        changed = true;
        console.log('[Migration] Migrated selectedPoints');
      }
    }
    
    if (changed) {
      localStorage.setItem(storageKey, JSON.stringify(data));
    }
    
    return changed;
  } catch (e) {
    console.error('[Migration] Failed to migrate marker-filter:', e);
    return false;
  }
};

/**
 * Check if migration has already been applied.
 */
const isMigrationApplied = (): boolean => {
  const version = localStorage.getItem(MIGRATION_KEY);
  return version === MIGRATION_VERSION;
};

/**
 * Mark migration as complete.
 */
const markMigrationComplete = (): void => {
  localStorage.setItem(MIGRATION_KEY, MIGRATION_VERSION);
};

/**
 * Run the full migration process.
 * Called during language initialization to avoid blocking initial render.
 * 
 * @returns true if any migration was performed, false otherwise
 */
export const runStorageMigration = (): boolean => {
  // Skip if already migrated
  if (isMigrationApplied()) {
    return false;
  }

  console.log('[Migration] Starting chest ID migration...');
  
  let migrated = false;
  
  try {
    const pointsResult = migratePointsStorage();
    const filterResult = migrateMarkerFilter();
    
    migrated = pointsResult || filterResult;
    
    if (migrated) {
      console.log('[Migration] Migration completed successfully.');
    } else {
      console.log('[Migration] No data needed migration.');
    }
  } catch (e) {
    console.error('[Migration] Migration failed:', e);
  }
  
  // Mark as complete even if no migration was needed
  markMigrationComplete();
  
  return migrated;
};

/**
 * Get migration statistics.
 */
export const getMigrationStats = () => {
  return {
    upgradeCount: Object.keys(UPGRADE_MAP).length,
    offsetRules: Object.values(INDEX_OFFSETS).reduce((sum, rules) => sum + Object.keys(rules).length, 0),
  };
};
