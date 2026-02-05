// Generic web storage utilities: size calculation and tree map data generation
// Supports: localStorage, sessionStorage, cookies, IndexedDB, Cache Storage

import { StateStorage } from 'zustand/middleware';

// ----- Zustand Storage Helpers -----

// Prevent writing to storage if condition is not met
export const createConditionalStorage = (
    storage: StateStorage,
    canWrite: () => boolean,
): StateStorage => ({
    getItem: (name) => storage.getItem(name),
    setItem: async (name, value) => {
        if (canWrite()) {
            await storage.setItem(name, value);
        }
    },
    removeItem: (name) => storage.removeItem(name),
});

// Preserve (do not overwrite) specific keys in storage if they are masked
export const createPartialGuardStorage = (
    storage: StateStorage,
    getMaskedKeys: () => string[],
): StateStorage => ({
    getItem: (name) => storage.getItem(name),
    removeItem: (name) => storage.removeItem(name),
    setItem: async (name, value) => {
        const maskedKeys = getMaskedKeys();
        if (maskedKeys.length === 0) {
            await storage.setItem(name, value);
            return;
        }

        let oldValue = storage.getItem(name);
        if (oldValue instanceof Promise) {
            oldValue = await oldValue;
        }

        if (typeof oldValue !== 'string') {
            await storage.setItem(name, value);
            return;
        }

        try {
            const oldObj = JSON.parse(oldValue) as unknown;
            const newObj = JSON.parse(value) as unknown;

            // Type check handling
            if (
                typeof oldObj !== 'object' ||
                oldObj === null ||
                typeof newObj !== 'object' ||
                newObj === null
            ) {
                await storage.setItem(name, value);
                return;
            }

            // Zustand persist wraps state in { state: ..., version: ... }
            const oldPersisted = oldObj as { state?: Record<string, unknown> };
            const newPersisted = newObj as { state?: Record<string, unknown> };

            const oldState = oldPersisted.state || {};
            const newState = newPersisted.state || {};

            maskedKeys.forEach((key) => {
                // If key exists in old storage, keep it (ignore new in-memory value)
                if (Object.prototype.hasOwnProperty.call(oldState, key)) {
                    newState[key] = oldState[key];
                }
            });

            newPersisted.state = newState;
            await storage.setItem(name, JSON.stringify(newPersisted));
        } catch (e) {
            console.error('Error merging persisted state inside storage', e);
            await storage.setItem(name, value);
        }
    },
});

// ----- Original Exports -----
export interface TreeMapNode {
  name: string;
  id?: string; // The actual key for deletion if different from name
  value?: number;
  children?: TreeMapNode[];
}

// ----- Internal Helpers -----

// Wrap IndexedDB request in Promise
const idbRequest = <T,>(request: IDBRequest<T>): Promise<T> => 
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error(request.error?.message || 'IDB request failed'));
  });

export const clearAllStorage = async () => {
  // Local & Session
  if (typeof localStorage !== 'undefined') localStorage.clear();
  if (typeof sessionStorage !== 'undefined') sessionStorage.clear();

  // Cookies
  if (typeof document !== 'undefined') {
    document.cookie.split(';').forEach(c => {
      document.cookie = c.replace(/^ +/, '').replace(/=.*/, '=;expires=' + new Date().toUTCString() + ';path=/');
    });
  }

  // IndexedDB
  if (typeof indexedDB !== 'undefined') {
    try {
      const dbs = await indexedDB.databases();
      for (const db of dbs) {
        if (db.name) indexedDB.deleteDatabase(db.name);
      }
    } catch (e) {
      console.warn('Failed to clear IndexedDB', e);
    }
  }

  // CacheStorage
  if (typeof caches !== 'undefined') {
    try {
      const keys = await caches.keys();
      for (const key of keys) {
        await caches.delete(key);
      }
    } catch (e) {
      console.warn('Failed to clear CacheStorage', e);
    }
  }
};

export const clearStorageItem = async (path: string[]) => {
  if (path.length === 0) return;
  const [root, ...rest] = path;

  switch (root) {
    case 'LocalStorage':
      if (rest.length === 0) {
        if (typeof localStorage !== 'undefined') localStorage.clear();
      } else {
        if (typeof localStorage !== 'undefined') localStorage.removeItem(rest[0]);
      }
      break;
    case 'SessionStorage':
      if (rest.length === 0) {
        if (typeof sessionStorage !== 'undefined') sessionStorage.clear();
      } else {
        if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(rest[0]);
      }
      break;
    case 'Cookies':
      if (rest.length === 0) {
         if (typeof document !== 'undefined') {
            document.cookie.split(';').forEach(c => {
                document.cookie = c.replace(/^ +/, '').replace(/=.*/, '=;expires=' + new Date().toUTCString() + ';path=/');
            });
         }
      } else {
         if (typeof document !== 'undefined') {
            document.cookie = `${rest[0]}=;expires=${new Date().toUTCString()};path=/`;
         }
      }
      break;
    case 'IndexedDB':
      if (typeof indexedDB === 'undefined') return;
      if (rest.length === 0) {
         const dbs = await indexedDB.databases();
         for (const db of dbs) { if (db.name) indexedDB.deleteDatabase(db.name); }
      } else if (rest.length === 1) {
         indexedDB.deleteDatabase(rest[0]);
      } else if (rest.length === 2) {
         // Cannot easily clear object store without version change or opening DB
         // We will clear data inside it
         try {
            const [dbName, storeName] = rest;
            const db = await idbRequest(indexedDB.open(dbName));
            const tx = db.transaction(storeName, 'readwrite');
            await idbRequest(tx.objectStore(storeName).clear());
            db.close();
         } catch (e) {
            console.warn('Failed to clear object store', e);
         }
      }
      break;
    case 'CacheStorage':
      if (typeof caches === 'undefined') return;
      if (rest.length === 0) {
         const keys = await caches.keys();
         for (const key of keys) await caches.delete(key);
      } else if (rest.length === 1) {
         await caches.delete(rest[0]);
      } else if (rest.length === 2) {
         const [cacheName, url] = rest;
         try {
            const cache = await caches.open(cacheName);
            await cache.delete(url);
         } catch (e) {
            console.warn('Failed to delete cache item', e);
         }
      }
      break;
  }
};

// ----- Tree Map Data Generation -----

const getStorageTree = (storage: Storage | undefined, rootName: string): TreeMapNode => {
  const children: TreeMapNode[] = [];
  const isDev = import.meta.env.DEV;
  
  if (storage) {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key) continue;
      
      // Whitelist: Hide UserGuide in production to prevent accidental deletion
      if (!isDev && key === 'UserGuide') continue;
      
      const value = storage.getItem(key) || '';
      const size = (key.length + value.length) * 2; // UTF-16 estimate
      children.push({ name: key, value: size });
    }
  }
  return { name: rootName, children };
};

const getCookiesTree = (): TreeMapNode => {
  const children: TreeMapNode[] = [];
  if (typeof document !== 'undefined' && document.cookie) {
    document.cookie.split(';').forEach(cookie => {
      const trimmed = cookie.trim();
      if (!trimmed) return;
      const eqIndex = trimmed.indexOf('=');
      const name = eqIndex > -1 ? trimmed.slice(0, eqIndex) : trimmed;
      const size = trimmed.length * 2;
      children.push({ name, value: size });
    });
  }
  return { name: 'Cookies', children };
};

const getIndexedDBTree = async (): Promise<TreeMapNode> => {
  const root: TreeMapNode = { name: 'IndexedDB', children: [] };
  if (typeof indexedDB === 'undefined') return root;

  try {
    const databases = await indexedDB.databases();
    
    for (const dbInfo of databases) {
      if (!dbInfo.name) continue;
      
      const dbNode: TreeMapNode = { name: dbInfo.name, children: [] };
      const db = await idbRequest(indexedDB.open(dbInfo.name));
      const storeNames = Array.from(db.objectStoreNames);
      
      const storeNodes = await Promise.all(
        storeNames.map(async (storeName) => {
          const tx = db.transaction(storeName, 'readonly');
          const records = await idbRequest(tx.objectStore(storeName).getAll());
          const size = JSON.stringify(records).length * 2;
          return { name: storeName, value: size };
        })
      );
      
      dbNode.children = storeNodes;
      root.children?.push(dbNode);
      db.close();
    }
  } catch (e) {
    console.warn('IndexedDB tree error', e);
  }
  return root;
};

const getCacheStorageTree = async (): Promise<TreeMapNode> => {
  const root: TreeMapNode = { name: 'CacheStorage', children: [] };
  if (typeof caches === 'undefined') return root;

  try {
    const names = await caches.keys();
    
    const cacheNodes = await Promise.all(
      names.map(async (name) => {
        const cacheNode: TreeMapNode = { name, children: [] };
        const cache = await caches.open(name);
        const requests = await cache.keys();
        
        const requestNodes = await Promise.all(
          requests.map(async (req) => {
            const resp = await cache.match(req);
            let size = 0;
            if (resp) {
                const contentLength = resp.headers.get('content-length');
                if (contentLength) {
                    size = parseInt(contentLength, 10);
                } else {
                    const blob = await resp.blob();
                    size = blob.size;
                }
            }
            
            let itemName = req.url;
            try {
                const urlObj = new URL(req.url);
                itemName = urlObj.pathname.split('/').pop() || urlObj.pathname || req.url;
            } catch (_e) {
                // ignore invalid URLs
            }

            return { name: itemName, id: req.url, value: size };
          })
        );
        
        cacheNode.children = requestNodes;
        return cacheNode;
      })
    );
    
    root.children = cacheNodes;
  } catch (e) {
    console.warn('Cache tree error', e);
  }
  return root;
};

export const getStorageTreeMapData = async (): Promise<TreeMapNode[]> => {
  const [indexedDBTree, cacheStorageTree] = await Promise.all([
    getIndexedDBTree(),
    getCacheStorageTree()
  ]);

  return [
    getStorageTree(typeof localStorage !== 'undefined' ? localStorage : undefined, 'LocalStorage'),
    getStorageTree(typeof sessionStorage !== 'undefined' ? sessionStorage : undefined, 'SessionStorage'),
    getCookiesTree(),
    indexedDBTree,
    cacheStorageTree
  ];
};

// ----- Marker Data Export/Import -----

import { DATASET_VERSION } from '@/data/migration/version';
import { migrateImportedIds } from '@/utils/fallback';

// Type definition for exported marker data
export interface MarkerExportData {
  version: number;           // Export format version (1 = legacy, 2 = with dataset version)
  datasetVersion?: number;   // Dataset version the IDs are from (new in v2)
  timestamp: number;
  activePoints: string[];
  filter: string[];
  selectedPoints: string[];
}

// Legacy export data (no datasetVersion field)
interface LegacyMarkerExportData {
  version: number;
  timestamp: number;
  activePoints: (string | number)[];  // May contain numbers in old exports
  filter: string[];
  selectedPoints: (string | number)[];
}

const formatDateTime = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
};

export const isValidMarkerExportData = (data: unknown): data is MarkerExportData | LegacyMarkerExportData => {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;
  return (
    typeof obj.version === 'number' &&
    Array.isArray(obj.activePoints) &&
    Array.isArray(obj.filter) &&
    Array.isArray(obj.selectedPoints)
  );
};

export const exportMarkerData = (
  activePoints: string[],
  filter: string[],
  selectedPoints: string[]
): void => {
  const exportData: MarkerExportData = {
    version: 2,                        // New format version
    datasetVersion: DATASET_VERSION,   // Include dataset version for migration
    timestamp: Date.now(),
    // Ensure all IDs are strings
    activePoints: activePoints.map(id => String(id)),
    filter,
    selectedPoints: selectedPoints.map(id => String(id)),
  };

  const json = JSON.stringify(exportData, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `oem-marker-data-${formatDateTime()}.json`;
  a.click();
  URL.revokeObjectURL(url);
};

export const importMarkerData = async (
  content: string,
  callbacks: {
    clearPoints: () => void;
    addPoint: (id: string) => void;
    setFilter: (filter: string[]) => void;
    getSelectedPoints: () => string[];
    setSelected: (id: string, value: boolean) => void;
    getActivePoints?: () => string[];
    getFilter?: () => string[];
  }
): Promise<boolean> => {
  try {
    const data: unknown = JSON.parse(content);
    
    if (!isValidMarkerExportData(data)) {
      console.error('Invalid import file format');
      return false;
    }

    // Determine source dataset version
    // version 2+ has datasetVersion field
    // version 1 or missing datasetVersion means legacy data
    const sourceDatasetVersion = (data as MarkerExportData).datasetVersion ?? null;
    
    // Convert all IDs to strings to avoid precision issues
    const rawActivePoints = data.activePoints.map(id => String(id));
    const rawSelectedPoints = data.selectedPoints.map(id => String(id));
    
    // Migrate IDs if from older dataset version
    let activePoints = rawActivePoints;
    let selectedPoints = rawSelectedPoints;
    
    if (sourceDatasetVersion !== DATASET_VERSION) {
      console.log(`[Import] Migrating from dataset version ${sourceDatasetVersion ?? 'legacy'} to ${DATASET_VERSION}`);
      activePoints = await migrateImportedIds(rawActivePoints, sourceDatasetVersion);
      selectedPoints = await migrateImportedIds(rawSelectedPoints, sourceDatasetVersion);
    }

    // Merge active points (add new ones, keep existing)
    activePoints.forEach((id: string) => {
      callbacks.addPoint(id);
    });

    // Merge filter (combine and deduplicate)
    if (callbacks.getFilter) {
      const existingFilter = callbacks.getFilter();
      const mergedFilter = Array.from(new Set([...existingFilter, ...data.filter]));
      callbacks.setFilter(mergedFilter);
    } else {
      // Fallback: replace if getter not provided
      callbacks.setFilter(data.filter);
    }
    
    // Get current active points for checked/selected consistency
    const currentActivePoints = new Set(callbacks.getActivePoints?.() ?? []);
    
    // Merge selections with checked/selected consistency fix:
    // - If a point is "checked" (in activePoints), it must also be "selected"
    // - A point can be "selected" without being "checked"
    selectedPoints.forEach((id: string) => {
      callbacks.setSelected(id, true);
    });
    
    // Ensure all checked (activePoints) are also selected
    // This fixes the issue where only checked flag was set without selected
    activePoints.forEach((id: string) => {
      // If this point is now in activePoints, ensure it's also selected
      if (currentActivePoints.has(id) || activePoints.includes(id)) {
        callbacks.setSelected(id, true);
      }
    });

    return true;
  } catch (err) {
    console.error('Failed to import data:', err);
    return false;
  }
};