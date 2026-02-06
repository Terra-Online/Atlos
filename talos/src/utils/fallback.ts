/**
 * Storage Migration Fallback for Marker ID Changes
 *
 * Migration is driven purely by DATA INSPECTION — it checks whether any
 * non-numeric IDs exist in localStorage.  There is no version-gating:
 *   • If non-numeric IDs are found → load maps & migrate them.
 *   • If all IDs are already numeric (or storage is empty) → do nothing.
 *
 * This makes migration idempotent and safe to run on every page load.
 * It never deletes data — only replaces mapped IDs and deduplicates.
 *
 * IMPORTANT: This must run and complete BEFORE Zustand stores hydrate,
 * so that stores always read already-migrated data from localStorage.
 */

// ---------------------------------------------------------------------------
// Lazy-loaded migration maps
// ---------------------------------------------------------------------------

let MIGRATION_MAP_0110_0204: Record<string, string> | null = null;
let MIGRATION_MAP_0204_0206: Record<string, string> | null = null;

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

// ---------------------------------------------------------------------------
// ID helpers
// ---------------------------------------------------------------------------

const isNumericId = (id: string): boolean => /^\d+$/.test(id);

/** Migrate a single ID through a chain of maps. */
const migrateIdThroughMaps = (id: string, maps: Record<string, string>[]): string => {
  let cur = String(id);
  for (const map of maps) {
    cur = map[cur] ?? cur;
  }
  return String(cur);
};

// ---------------------------------------------------------------------------
// Detect non-numeric IDs in localStorage
// ---------------------------------------------------------------------------

/**
 * Extract ID arrays from a localStorage JSON blob.
 * Returns `null` when the key does not exist or has no relevant arrays.
 */
const readIdsFromStorage = (
  storageKey: string,
  fieldPath: string,
): string[] | null => {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const data = JSON.parse(raw) as { state?: Record<string, unknown> };
    const arr = data?.state?.[fieldPath];
    if (!Array.isArray(arr)) return null;
    return arr.map((id: unknown) => String(id));
  } catch {
    return null;
  }
};

/**
 * Check whether either store contains non-numeric IDs that need migration.
 */
const detectNonNumericIds = (): {
  pointsNeedMigration: boolean;
  filterNeedMigration: boolean;
} => {
  const activePoints = readIdsFromStorage('points-storage', 'activePoints');
  const selectedPoints = readIdsFromStorage('marker-filter', 'selectedPoints');

  return {
    pointsNeedMigration: activePoints !== null && activePoints.some((id) => !isNumericId(id)),
    filterNeedMigration: selectedPoints !== null && selectedPoints.some((id) => !isNumericId(id)),
  };
};

// ---------------------------------------------------------------------------
// Migration writers — operate directly on localStorage JSON
// ---------------------------------------------------------------------------

/**
 * Migrate `activePoints` inside `points-storage`.
 * Returns true if localStorage was actually written.
 */
const migratePointsStorage = (maps: Record<string, string>[]): boolean => {
  const storageKey = 'points-storage';
  const raw = localStorage.getItem(storageKey);
  if (!raw) return false;

  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    const state = data.state as Record<string, unknown> | undefined;
    const activePoints = state?.activePoints;

    if (!Array.isArray(activePoints) || activePoints.length === 0) return false;

    const original = activePoints.map((id) => String(id));
    const migrated = original.map((id) => migrateIdThroughMaps(id, maps));

    // Safety: if migration would produce an empty array from a non-empty
    // source, abort — something is very wrong with the maps.
    const unique = [...new Set(migrated)];
    if (unique.length === 0 && original.length > 0) {
      console.error('[Migration] Aborting points-storage migration: result would be empty!');
      return false;
    }

    const changed = migrated.some((id, i) => id !== original[i]);
    if (!changed) {
      console.log('[Migration] No changes needed for activePoints');
      return false;
    }

    const changeCount = migrated.filter((id, i) => id !== original[i]).length;
    const dedupeCount = migrated.length - unique.length;

    // Write back — preserve every other field in the JSON blob
    (data.state as Record<string, unknown>).activePoints = unique;
    localStorage.setItem(storageKey, JSON.stringify(data));

    console.log(`[Migration] Points: ${changeCount} migrated, ${dedupeCount} deduplicated (${original.length} → ${unique.length})`);
    return true;
  } catch (e) {
    console.error('[Migration] Failed to migrate points-storage:', e);
    return false;
  }
};

/**
 * Migrate `selectedPoints` inside `marker-filter`.
 * Returns true if localStorage was actually written.
 */
const migrateMarkerFilter = (maps: Record<string, string>[]): boolean => {
  const storageKey = 'marker-filter';
  const raw = localStorage.getItem(storageKey);
  if (!raw) return false;

  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    const state = data.state as Record<string, unknown> | undefined;
    const selectedPoints = state?.selectedPoints;

    if (!Array.isArray(selectedPoints) || selectedPoints.length === 0) return false;

    const original = selectedPoints.map((id) => String(id));
    const migrated = original.map((id) => migrateIdThroughMaps(id, maps));

    const unique = [...new Set(migrated)];
    if (unique.length === 0 && original.length > 0) {
      console.error('[Migration] Aborting marker-filter migration: result would be empty!');
      return false;
    }

    const changed = migrated.some((id, i) => id !== original[i]);
    if (!changed) {
      console.log('[Migration] No changes needed for selectedPoints');
      return false;
    }

    const changeCount = migrated.filter((id, i) => id !== original[i]).length;

    (data.state as Record<string, unknown>).selectedPoints = unique;
    localStorage.setItem(storageKey, JSON.stringify(data));

    console.log(`[Migration] Selected: ${changeCount} migrated (${original.length} → ${unique.length})`);
    return true;
  } catch (e) {
    console.error('[Migration] Failed to migrate marker-filter:', e);
    return false;
  }
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the storage migration.
 *
 * This is safe to call on every page load:
 *   1. Scans localStorage for non-numeric IDs.
 *   2. If found, loads ALL migration maps and migrates in-place.
 *   3. If everything is already numeric, returns immediately (no map loading).
 *
 * Must be **awaited** before Zustand stores initialise.
 */
export const runStorageMigration = async (): Promise<boolean> => {
  const { pointsNeedMigration, filterNeedMigration } = detectNonNumericIds();

  if (!pointsNeedMigration && !filterNeedMigration) {
    console.log('[Migration] All IDs are numeric — no migration needed');
    return false;
  }

  console.log(
    `[Migration] Non-numeric IDs detected — points: ${pointsNeedMigration}, filter: ${filterNeedMigration}`,
  );

  try {
    // Always load both maps — a single non-numeric ID may need both steps.
    const [map1, map2] = await Promise.all([
      loadMigrationMap0110to0204(),
      loadMigrationMap0204to0206(),
    ]);

    const maps = [map1, map2].filter((m) => Object.keys(m).length > 0);
    if (maps.length === 0) {
      console.warn('[Migration] All migration maps are empty — skipping');
      return false;
    }

    let migrated = false;

    if (pointsNeedMigration) {
      migrated = migratePointsStorage(maps) || migrated;
    }
    if (filterNeedMigration) {
      migrated = migrateMarkerFilter(maps) || migrated;
    }

    if (migrated) {
      // Post-migration verification
      const after = detectNonNumericIds();
      if (after.pointsNeedMigration || after.filterNeedMigration) {
        console.warn('[Migration] ⚠ Some non-numeric IDs remain — unmapped entries in migration tables');
      } else {
        console.log('[Migration] ✓ All IDs successfully migrated to numeric format');
      }
    }

    return migrated;
  } catch (e) {
    console.error('[Migration] Migration failed:', e);
    return false;
  }
};

/**
 * Migrate an array of imported IDs (e.g. from an old export file).
 * Safe to call at any time — loads maps on demand.
 */
export const migrateImportedIds = async (ids: string[]): Promise<string[]> => {
  const stringIds = ids.map((id) => String(id));
  const hasOld = stringIds.some((id) => !isNumericId(id));
  if (!hasOld) return stringIds;

  const [map1, map2] = await Promise.all([
    loadMigrationMap0110to0204(),
    loadMigrationMap0204to0206(),
  ]);
  const maps = [map1, map2].filter((m) => Object.keys(m).length > 0);
  return stringIds.map((id) => migrateIdThroughMaps(id, maps));
};

/**
 * Get migration statistics (for devtools / debugging).
 */
export const getMigrationStats = () => {
  const map0110Size = MIGRATION_MAP_0110_0204 ? Object.keys(MIGRATION_MAP_0110_0204).length : 0;
  const map0204Size = MIGRATION_MAP_0204_0206 ? Object.keys(MIGRATION_MAP_0204_0206).length : 0;
  return {
    mappings0110to0204: map0110Size,
    mappings0204to0206: map0204Size,
    totalMappings: map0110Size + map0204Size,
    isLoaded: MIGRATION_MAP_0110_0204 !== null || MIGRATION_MAP_0204_0206 !== null,
  };
};