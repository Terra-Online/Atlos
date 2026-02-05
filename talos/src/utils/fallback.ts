/**
 * Storage Migration Fallback for Marker ID Changes
 * 
 * Supports multi-version migration:
 * - 0110 -> 0206 (via combined map)
 * - 0204 -> 0206
 * 
 * Migration happens ONCE per DATASET_VERSION and is irreversible.
 * All IDs are stored as strings to avoid precision issues with large numbers.
 */

import { DATASET_VERSION } from '@/data/migration/version';

// Known dataset versions for migration path detection
const VERSION_0110 = 20260110;
const VERSION_0204 = 20260204;
const VERSION_0206 = 20260206;

// Lazy-loaded migration maps
let MIGRATION_MAP_0110_0204: Record<string, string> | null = null;
let MIGRATION_MAP_0204_0206: Record<string, string> | null = null;

/**
 * Load migration map from 0110 to 0204
 */
const loadMigrationMap0110to0204 = async (): Promise<Record<string, string>> => {
  if (MIGRATION_MAP_0110_0204) return MIGRATION_MAP_0110_0204;
  
  try {
    const mod: { default: Record<string, string> } = await import('@/data/migration/map.json');
    MIGRATION_MAP_0110_0204 = mod.default;
    console.log(`[Migration] Loaded PUB1.0 map: ${Object.keys(MIGRATION_MAP_0110_0204).length} entries`);
    return MIGRATION_MAP_0110_0204;
  } catch (e) {
    console.error('[Migration] Error loading PUB1.0 map:', e);
    return {};
  }
};

/**
 * Load migration map from 0204 to 0206
 */
const loadMigrationMap0204to0206 = async (): Promise<Record<string, string>> => {
  if (MIGRATION_MAP_0204_0206) return MIGRATION_MAP_0204_0206;
  
  try {
    const mod: { default: Record<string, string> } = await import('@/data/migration/id.json');
    MIGRATION_MAP_0204_0206 = mod.default;
    console.log(`[Migration] Loaded id map: ${Object.keys(MIGRATION_MAP_0204_0206).length} entries`);
    return MIGRATION_MAP_0204_0206;
  } catch (e) {
    console.error('[Migration] Error loading id map:', e);
    return {};
  }
};

/**
 * Migrate a single ID using a migration map.
 * Always returns a string to avoid precision issues.
 */
const migrateId = (id: string, map: Record<string, string>): string => {
  const result = map[id] || id;
  // Ensure result is always a string
  return String(result);
};

/**
 * Migrate an array of IDs through a single map.
 */
const migrateIds = (ids: string[], map: Record<string, string>): string[] => {
  return ids.map(id => migrateId(id, map));
};

/**
 * Migrate an array of IDs through multiple maps sequentially.
 */
const migrateIdsThroughMaps = (ids: string[], maps: Record<string, string>[]): string[] => {
  let result = ids.map(id => String(id)); // Ensure all IDs are strings
  for (const map of maps) {
    result = migrateIds(result, map);
  }
  return result;
};

/**
 * Get the stored data version from localStorage
 */
const getStoredVersion = (): number | null => {
  const storageKey = 'points-storage';
  const raw = localStorage.getItem(storageKey);
  if (!raw) return null;

  try {
    const data = JSON.parse(raw) as { version?: number };
    return data.version ?? null;
  } catch {
    return null;
  }
};

/**
 * Determine which migration maps are needed based on stored version
 */
const getMigrationPath = (storedVersion: number | null): ('0110_0204' | '0204_0206')[] => {
  if (storedVersion === VERSION_0206 || storedVersion === DATASET_VERSION) {
    return []; // Already up to date
  }
  
  if (storedVersion === null || storedVersion <= VERSION_0110) {
    // Old data or no version - need full migration path
    return ['0110_0204', '0204_0206'];
  }
  
  if (storedVersion === VERSION_0204) {
    // Only need 0204 -> 0206
    return ['0204_0206'];
  }
  
  // Unknown version, try full migration
  return ['0110_0204', '0204_0206'];
};

/**
 * Load required migration maps based on migration path
 */
const loadRequiredMaps = async (path: ('0110_0204' | '0204_0206')[]): Promise<Record<string, string>[]> => {
  const maps: Record<string, string>[] = [];
  
  for (const step of path) {
    if (step === '0110_0204') {
      maps.push(await loadMigrationMap0110to0204());
    } else if (step === '0204_0206') {
      maps.push(await loadMigrationMap0204to0206());
    }
  }
  
  return maps;
};

/**
 * Migrate the points-storage (userRecord store) data.
 */
const migratePointsStorage = (maps: Record<string, string>[]): boolean => {
  const storageKey = 'points-storage';
  const raw = localStorage.getItem(storageKey);
  if (!raw) return false;

  try {
    const data = JSON.parse(raw) as { state?: { activePoints?: string[] }; version?: number };
    const activePoints = data.state?.activePoints;
    
    if (!activePoints || !Array.isArray(activePoints)) return false;

    // Ensure all IDs are strings before migration
    const stringIds = activePoints.map(id => String(id));
    const migratedPoints = migrateIdsThroughMaps(stringIds, maps);
    
    // Check if any changes occurred
    const hasChanges = migratedPoints.some((id, i) => id !== stringIds[i]);
    if (!hasChanges) return false;
    
    // Remove duplicates
    const uniquePoints = [...new Set(migratedPoints)];
    
    data.state = { ...data.state, activePoints: uniquePoints };
    data.version = DATASET_VERSION;
    localStorage.setItem(storageKey, JSON.stringify(data));
    
    const changeCount = migratedPoints.filter((id, i) => id !== stringIds[i]).length;
    const dedupeCount = migratedPoints.length - uniquePoints.length;
    console.log(`[Migration] Points: ${changeCount} migrated, ${dedupeCount} deduplicated`);
    return true;
  } catch (e) {
    console.error('[Migration] Failed to migrate points-storage:', e);
    return false;
  }
};

/**
 * Migrate the marker-filter (markerStore) data.
 */
const migrateMarkerFilter = (maps: Record<string, string>[]): boolean => {
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
      const stringIds = selectedPoints.map(id => String(id));
      const migratedSelected = migrateIdsThroughMaps(stringIds, maps);
      const hasChanges = migratedSelected.some((id, i) => id !== stringIds[i]);
      if (hasChanges) {
        const uniqueSelected = [...new Set(migratedSelected)];
        data.state = { ...data.state, selectedPoints: uniqueSelected };
        changed = true;
        const changeCount = migratedSelected.filter((id, i) => id !== stringIds[i]).length;
        console.log(`[Migration] Selected: ${changeCount} migrated`);
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
  const storedVersion = getStoredVersion();
  return storedVersion === DATASET_VERSION;
};

/**
 * Mark migration as complete.
 */
const markMigrationComplete = (): void => {
  const storageKey = 'points-storage';
  const raw = localStorage.getItem(storageKey);
  if (!raw) return;

  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    data.version = DATASET_VERSION;
    localStorage.setItem(storageKey, JSON.stringify(data));
  } catch {
    // ignore
  }
};

/**
 * Run the full migration process.
 * Supports multi-step migration: 0110 -> 0204 -> 0206
 * 
 * @returns true if any migration was performed, false otherwise
 */
export const runStorageMigration = async (): Promise<boolean> => {
  // Skip if already migrated
  if (isMigrationApplied()) {
    return false;
  }

  const storedVersion = getStoredVersion();
  const migrationPath = getMigrationPath(storedVersion);
  
  if (migrationPath.length === 0) {
    console.log('[Migration] No migration needed');
    markMigrationComplete();
    return false;
  }

  console.log(`[Migration] Starting migration from version ${storedVersion ?? 'unknown'} to ${DATASET_VERSION}`);
  console.log(`[Migration] Migration path: ${migrationPath.join(' -> ')}`);
  
  let migrated = false;
  
  try {
    // Load required migration maps
    const maps = await loadRequiredMaps(migrationPath);
    
    if (maps.some(m => Object.keys(m).length === 0)) {
      console.warn('[Migration] Some migration maps are empty, proceeding anyway...');
    }
    
    // Perform migration
    const pointsResult = migratePointsStorage(maps);
    const filterResult = migrateMarkerFilter(maps);
    
    migrated = pointsResult || filterResult;
    
    if (migrated) {
      console.log('[Migration] ✓ Migration completed successfully');
    } else {
      console.log('[Migration] No data needed migration');
    }
  } catch (e) {
    console.error('[Migration] Migration failed:', e);
  }
  
  // Mark dataset version regardless of outcome
  markMigrationComplete();
  
  return migrated;
};

/**
 * Migrate IDs for import data (used when importing old export files)
 * This function can migrate IDs from any known version to current.
 * 
 * @param ids Array of IDs to migrate
 * @param sourceVersion The dataset version the IDs are from (null for legacy data)
 * @returns Migrated IDs as strings
 */
export const migrateImportedIds = async (
  ids: string[], 
  sourceVersion: number | null
): Promise<string[]> => {
  const migrationPath = getMigrationPath(sourceVersion);
  
  if (migrationPath.length === 0) {
    // Already current version, just ensure strings
    return ids.map(id => String(id));
  }
  
  const maps = await loadRequiredMaps(migrationPath);
  return migrateIdsThroughMaps(ids.map(id => String(id)), maps);
};

/**
 * Get migration statistics.
 */
export const getMigrationStats = () => {
  const map0110Size = MIGRATION_MAP_0110_0204 ? Object.keys(MIGRATION_MAP_0110_0204).length : 0;
  const map0204Size = MIGRATION_MAP_0204_0206 ? Object.keys(MIGRATION_MAP_0204_0206).length : 0;
  return {
    mappings0110to0204: map0110Size,
    mappings0204to0206: map0204Size,
    totalMappings: map0110Size + map0204Size,
    isLoaded: MIGRATION_MAP_0110_0204 !== null || MIGRATION_MAP_0204_0206 !== null,
    datasetVersion: Number(DATASET_VERSION),
  };
};