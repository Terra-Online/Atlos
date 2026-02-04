/**
 * Storage Migration Fallback for Marker ID Changes
 * 
 * Handles migration from CBT3 to current version using complete ID mapping.
 * Migration happens ONCE and is irreversible.
 */

import { DATASET_VERSION } from '@/data/migration/version';

// Lazy-loaded migration map
let MIGRATION_MAP: Record<string, string> | null = null;

/**
 * Load migration map from JSON file
 */
const loadMigrationMap = async (): Promise<Record<string, string>> => {
  if (MIGRATION_MAP) return MIGRATION_MAP;
  
  try {
    // Vite can bundle JSON imports. Dynamic import keeps it lazy.
    const mod: { default: Record<string, string> } = await import('@/data/migration/map.json');
    MIGRATION_MAP = mod.default;
    console.log(`[Migration] Loaded ${Object.keys(MIGRATION_MAP).length} ID mappings`);
    return MIGRATION_MAP;
  } catch (e) {
    console.error('[Migration] Error loading migration map:', e);
    return {};
  }
};

/**
 * Migrate a single ID using the migration map.
 */
const migrateId = (id: string, map: Record<string, string>): string => {
  return map[id] || id;
};

/**
 * Migrate an array of IDs.
 */
const migrateIds = (ids: string[], map: Record<string, string>): string[] => {
  return ids.map(id => migrateId(id, map));
};

/**
 * Migrate the points-storage (userRecord store) data.
 * Storage key: 'points-storage'
 * Structure: { state: { activePoints: string[] }, version: number }
 */
const migratePointsStorage = (map: Record<string, string>): boolean => {
  const storageKey = 'points-storage';
  const raw = localStorage.getItem(storageKey);
  if (!raw) return false;

  try {
    const data = JSON.parse(raw) as { state?: { activePoints?: string[] }; version?: number };
    const activePoints = data.state?.activePoints;
    
    if (!activePoints || !Array.isArray(activePoints)) return false;

    const migratedPoints = migrateIds(activePoints, map);
    // Check if any changes occurred
    const hasChanges = migratedPoints.some((id, i) => id !== activePoints[i]);
    if (!hasChanges) return false;
    
    // Remove duplicates that might occur from multiple old IDs mapping to same new ID
    const uniquePoints = [...new Set(migratedPoints)];
    
    data.state = { ...data.state, activePoints: uniquePoints };
    localStorage.setItem(storageKey, JSON.stringify(data));
    
    const changeCount = migratedPoints.filter((id, i) => id !== activePoints[i]).length;
    const dedupeCount = activePoints.length - uniquePoints.length;
    console.log(`[Migration] Points: ${changeCount} migrated, ${dedupeCount} deduplicated`);
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
const migrateMarkerFilter = (map: Record<string, string>): boolean => {
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
      const migratedSelected = migrateIds(selectedPoints, map);
      const hasChanges = migratedSelected.some((id, i) => id !== selectedPoints[i]);
      if (hasChanges) {
        const uniqueSelected = [...new Set(migratedSelected)];
        data.state = { ...data.state, selectedPoints: uniqueSelected };
        changed = true;
        const changeCount = migratedSelected.filter((id, i) => id !== selectedPoints[i]).length;
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
  const storageKey = 'points-storage';
  const raw = localStorage.getItem(storageKey);
  if (!raw) return false;

  try {
    const data = JSON.parse(raw) as { version?: number };
    return data.version === DATASET_VERSION;
  } catch {
    return false;
  }
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
 * Called during language initialization to avoid blocking initial render.
 * This migration is FORCED and happens ONCE only.
 * 
 * @returns true if any migration was performed, false otherwise
 */
export const runStorageMigration = async (): Promise<boolean> => {
  // Skip if already migrated
  if (isMigrationApplied()) {
    return false;
  }

  console.log('[Migration] Starting full marker ID migration...');
  
  let migrated = false;
  
  try {
    // Load migration map
    const map = await loadMigrationMap();
    
    if (Object.keys(map).length === 0) {
      console.warn('[Migration] Migration map is empty, skipping...');
      markMigrationComplete();
      return false;
    }
    
    // Perform migration
    const pointsResult = migratePointsStorage(map);
    const filterResult = migrateMarkerFilter(map);
    
    migrated = pointsResult || filterResult;
    
    if (migrated) {
      console.log('[Migration] ✓ Migration completed successfully');
    } else {
      console.log('[Migration] No data needed migration');
    }
  } catch (e) {
    console.error('[Migration] Migration failed:', e);
  }
  
  // Mark dataset version regardless of outcome (once-only per DATASET_VERSION)
  markMigrationComplete();
  
  return migrated;
};

/**
 * Get migration statistics.
 */
export const getMigrationStats = () => {
  const mapSize = MIGRATION_MAP ? Object.keys(MIGRATION_MAP).length : 0;
  return {
    totalMappings: mapSize,
    isLoaded: MIGRATION_MAP !== null,
    datasetVersion: Number(DATASET_VERSION),
  };
};
