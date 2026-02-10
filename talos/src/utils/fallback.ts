/**
 * Storage Migration Fallback for Marker ID Changes
 *
 * Handles migration across dataset versions:
 *   • 0110 (PUB1.0)  — text IDs like "int_trchest_common_normal_055"
 *   • 0204           — text IDs like "eny_0018_lbtough_001"
 *   • 0206+          — numeric IDs like "2800090055" (0206→0210 was additive, no remaps)
 *
 * Migration chain: 0110 → 0204 → 0206 (numeric, also covers 0210+)
 *
 * For localStorage: checks whether any non-numeric IDs exist and migrates them.
 * For import: uses datasetVersion from the export file to determine which maps
 *   to apply. Data without datasetVersion is assumed to be version 0110 or 0204
 *   (detected by ID format inspection).
 *
 * This makes migration idempotent and safe to run on every page load.
 * It never deletes data — only replaces mapped IDs and deduplicates.
 *
 * IMPORTANT: This must run and complete BEFORE Zustand stores hydrate,
 * so that stores always read already-migrated data from localStorage.
 */

import { DATASET_VERSION } from '@/data/migration/version';

// ---------------------------------------------------------------------------
// Lazy-loaded migration maps
// ---------------------------------------------------------------------------

let MIGRATION_MAP_0110_0204: Record<string, string> | null = null;
let MIGRATION_MAP_0204_0206: Record<string, string> | null = null;

const loadMigrationMap0110to0204 = async (): Promise<Record<string, string>> => {
  if (MIGRATION_MAP_0110_0204) return MIGRATION_MAP_0110_0204;
  try {
    const mod = (await import('@/data/migration/map.json')) as { default: Record<string, string> };
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
    const mod = (await import('@/data/migration/id.json')) as { default: Record<string, string> };
    MIGRATION_MAP_0204_0206 = mod.default;
    console.log(`[Migration] Loaded 0204→0206 map: ${Object.keys(MIGRATION_MAP_0204_0206).length} entries`);
    return MIGRATION_MAP_0204_0206;
  } catch (e) {
    console.error('[Migration] Error loading 0204→0206 map:', e);
    return {};
  }
};

// ---------------------------------------------------------------------------
// ID helpers
// ---------------------------------------------------------------------------

const isNumericId = (id: string): boolean => /^\d+$/.test(id);

/** Read the stored datasetVersion from a localStorage JSON blob. */
const readStoredVersion = (storageKey: string): number | undefined => {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return undefined;
    const data = JSON.parse(raw) as { state?: Record<string, unknown> };
    const v = data?.state?.datasetVersion;
    return typeof v === 'number' ? v : undefined;
  } catch {
    return undefined;
  }
};

/** Stamp the current DATASET_VERSION into a localStorage JSON blob. */
const stampDatasetVersion = (storageKey: string): void => {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return;
    const data = JSON.parse(raw) as Record<string, unknown>;
    const state = (data.state ?? {}) as Record<string, unknown>;
    state.datasetVersion = DATASET_VERSION;
    data.state = state;
    localStorage.setItem(storageKey, JSON.stringify(data));
  } catch {
    // ignore
  }
};

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
 * Check whether either store contains non-numeric IDs that need migration,
 * or whether activePoints needs recovery from selectedPoints.
 */
const RECOVERY_THRESHOLD = 0.3; // If activePoints < 30% of selectedPoints, recover

const detectMigrationNeeds = (): {
  pointsNeedMigration: boolean;
  filterNeedMigration: boolean;
  activePointsCount: number;
  selectedPointsCount: number;
  needsRecovery: boolean;
  storedVersionOutdated: boolean;
} => {
  const activePoints = readIdsFromStorage('points-storage', 'activePoints');
  const selectedPoints = readIdsFromStorage('marker-filter', 'selectedPoints');

  const activeCount = activePoints?.length ?? 0;
  const selectedCount = selectedPoints?.length ?? 0;

  // Recovery needed when selectedPoints exists and activePoints is
  // disproportionately small (< 30% of selected), indicating data loss.
  const needsRecovery = selectedCount > 0 && activeCount < selectedCount * RECOVERY_THRESHOLD;

  // Check if stored version is behind the current build version.
  // Old data without datasetVersion is treated as version 0 (needs migration).
  const storedVersion = readStoredVersion('points-storage') ?? 0;
  const storedVersionOutdated = storedVersion < DATASET_VERSION;

  return {
    pointsNeedMigration: activePoints !== null && activePoints.some((id) => !isNumericId(id)),
    filterNeedMigration: selectedPoints !== null && selectedPoints.some((id) => !isNumericId(id)),
    activePointsCount: activeCount,
    selectedPointsCount: selectedCount,
    needsRecovery,
    storedVersionOutdated,
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

    const existingActive = Array.isArray(activePoints)
      ? activePoints.map((id) => String(id))
      : [];

    // Check if recovery from selectedPoints is needed
    const filterRaw = localStorage.getItem('marker-filter');
    let recoveredFromSelected = false;
    let merged = existingActive.map((id) => migrateIdThroughMaps(id, maps));

    if (filterRaw) {
      try {
        const filterData = JSON.parse(filterRaw) as Record<string, unknown>;
        const filterState = filterData.state as Record<string, unknown> | undefined;
        const selectedPoints = filterState?.selectedPoints;
        if (Array.isArray(selectedPoints) && selectedPoints.length > 0) {
          const selectedCount = selectedPoints.length;
          // Recover when activePoints is disproportionately small (< 30% of selectedPoints)
          if (merged.length < selectedCount * RECOVERY_THRESHOLD) {
            const migratedSelected = selectedPoints.map((id) =>
              migrateIdThroughMaps(String(id), maps),
            );
            // Merge: keep existing active entries and add missing ones from selected
            const mergedSet = new Set(merged);
            for (const id of migratedSelected) {
              mergedSet.add(id);
            }
            const beforeCount = merged.length;
            merged = [...mergedSet];
            recoveredFromSelected = true;
            console.warn(`[Migration] activePoints (${beforeCount}) < 30% of selectedPoints (${selectedCount}) — recovered to ${merged.length} entries by merging selectedPoints`);
          }
        }
      } catch {
        // ignore parse error for marker-filter
      }
    }

    if (merged.length === 0 && existingActive.length === 0) {
      return false;
    }

    const migrated = merged;

    // Safety: if migration would produce an empty array from a non-empty
    // source, abort — something is very wrong with the maps.
    const unique = [...new Set(migrated)];
    if (unique.length === 0 && existingActive.length > 0) {
      console.error('[Migration] Aborting points-storage migration: result would be empty!');
      return false;
    }

    const changed = recoveredFromSelected || migrated.some((id, i) => id !== existingActive[i]) || migrated.length !== existingActive.length;
    if (!changed) {
      console.log('[Migration] No changes needed for activePoints');
      return false;
    }

    const changeCount = migrated.filter((id, i) => id !== existingActive[i]).length;
    const dedupeCount = migrated.length - unique.length;

    // Write back — preserve every other field in the JSON blob
    if (!state) {
      data.state = { activePoints: unique };
    } else {
      (data.state as Record<string, unknown>).activePoints = unique;
    }
    localStorage.setItem(storageKey, JSON.stringify(data));

    console.log(`[Migration] Points: ${changeCount} migrated, ${dedupeCount} deduplicated (${existingActive.length} → ${unique.length})`);
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
  const needs = detectMigrationNeeds();
  const { pointsNeedMigration, filterNeedMigration, needsRecovery, storedVersionOutdated } = needs;

  if (!pointsNeedMigration && !filterNeedMigration && !needsRecovery && !storedVersionOutdated) {
    console.log('[Migration] All IDs are numeric, activePoints is present, version is current — no migration needed');
    return false;
  }

  // If only the version stamp is outdated but nothing else needs work,
  // just stamp the version and return.
  if (!pointsNeedMigration && !filterNeedMigration && !needsRecovery && storedVersionOutdated) {
    console.log('[Migration] Data is clean but version stamp is outdated — updating to', DATASET_VERSION);
    stampDatasetVersion('points-storage');
    stampDatasetVersion('marker-filter');
    return false;
  }

  console.log(
    `[Migration] Migration needed — points: ${pointsNeedMigration}, filter: ${filterNeedMigration}, recovery: ${needsRecovery}, versionOutdated: ${storedVersionOutdated}`,
  );

  try {
    // Always load both maps — a single non-numeric ID may need both steps.
    const [map1, map2] = await Promise.all([
      loadMigrationMap0110to0204(),
      loadMigrationMap0204to0206(),
    ]);

    const maps = [map1, map2].filter((m) => Object.keys(m).length > 0);
    if (maps.length === 0 && (pointsNeedMigration || filterNeedMigration)) {
      console.warn('[Migration] All migration maps are empty — skipping');
      return false;
    }

    let migrated = false;

    if (pointsNeedMigration || needsRecovery) {
      migrated = migratePointsStorage(maps) || migrated;
    }
    if (filterNeedMigration) {
      migrated = migrateMarkerFilter(maps) || migrated;
    }

    if (migrated) {
      // Post-migration verification
      const after = detectMigrationNeeds();
      if (after.pointsNeedMigration || after.filterNeedMigration) {
        console.warn('[Migration] ⚠ Some non-numeric IDs remain — unmapped entries in migration tables');
      } else {
        console.log('[Migration] ✓ All IDs successfully migrated to numeric format');
      }
    }

    // Always stamp the current version after migration attempt
    stampDatasetVersion('points-storage');
    stampDatasetVersion('marker-filter');

    return migrated;
  } catch (e) {
    console.error('[Migration] Migration failed:', e);
    return false;
  }
};

/**
 * Migrate an array of imported IDs (e.g. from an old export file).
 * Safe to call at any time — loads maps on demand.
 *
 * @param ids          Array of IDs to migrate.
 * @param datasetVersion  The dataset version the IDs originate from.
 *   - undefined / missing → legacy 0110 data (no version field). Run full chain.
 *   - 20260110            → same as above.
 *   - 20260204            → IDs are in 0204 text format. Run 0204→0206 only.
 *   - >= 20260206         → IDs are already numeric. Skip migration.
 *
 * Even when version suggests IDs should be numeric, we still inspect for
 * non-numeric stragglers and migrate them (belt-and-suspenders).
 */
export const migrateImportedIds = async (
  ids: string[],
  datasetVersion?: number,
): Promise<string[]> => {
  const stringIds = ids.map((id) => String(id));

  // Fast path: if version ≥ 0206 AND all IDs are already numeric, skip.
  if (datasetVersion && datasetVersion >= 20260206) {
    const hasOld = stringIds.some((id) => !isNumericId(id));
    if (!hasOld) return stringIds;
    // Some non-numeric stragglers exist even though version says 0206 —
    // fall through to migrate them.
    console.warn(`[Migration] datasetVersion=${datasetVersion} but found non-numeric IDs — migrating`);
  }

  const hasNonNumeric = stringIds.some((id) => !isNumericId(id));
  if (!hasNonNumeric) return stringIds;

  // Determine which maps to load based on version
  const maps: Record<string, string>[] = [];

  if (!datasetVersion || datasetVersion <= 20260110) {
    // Legacy / 0110 data: need full chain 0110 → 0204 → 0206
    const [map1, map2] = await Promise.all([
      loadMigrationMap0110to0204(),
      loadMigrationMap0204to0206(),
    ]);
    if (Object.keys(map1).length > 0) maps.push(map1);
    if (Object.keys(map2).length > 0) maps.push(map2);
    console.log(`[Migration] Import: applying full chain (0110→0204→0206), ${maps.length} maps loaded`);
  } else if (datasetVersion < 20260206) {
    // 0204 data: only need 0204 → 0206
    const map2 = await loadMigrationMap0204to0206();
    if (Object.keys(map2).length > 0) maps.push(map2);
    console.log(`[Migration] Import: applying 0204→0206 only, ${maps.length} maps loaded`);
  }

  if (maps.length === 0) {
    console.warn('[Migration] Import: no migration maps loaded — returning IDs unchanged');
    return stringIds;
  }

  const migrated = stringIds.map((id) => migrateIdThroughMaps(id, maps));
  const changeCount = migrated.filter((id, i) => id !== stringIds[i]).length;
  const remaining = migrated.filter((id) => !isNumericId(id)).length;

  console.log(`[Migration] Import: ${changeCount}/${stringIds.length} IDs migrated, ${remaining} non-numeric remaining`);

  return migrated;
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