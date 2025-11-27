// Generic web storage utilities: size calculation, clear, export, disable hints
// Supports: localStorage, sessionStorage, cookies, IndexedDB, Cache Storage
// All size estimations are approximate (UTF-16 * 2 bytes per char, JSON length, Blob size)

// Development environment detection
const isDevelopment = import.meta.env.DEV;

// User Guide related localStorage keys (protected in production)
const USER_GUIDE_KEYS = ['ui-prefs'];

export interface StorageInfo {
  localStorage: number;
  sessionStorage: number;
  cookies: number;
  indexedDB: number;
  cacheStorage: number;
  total: number;
}

export type StorageKey = keyof Omit<StorageInfo, 'total'>;

export interface StorageItemDetail {
  key: StorageKey;
  size: number;
  entries?: number; // number of records / items
}

// Format bytes in human readable form
export const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
};

// ----- Internal Helpers -----

// Wrap IndexedDB request in Promise
const idbRequest = <T,>(request: IDBRequest<T>): Promise<T> => 
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error(request.error?.message || 'IDB request failed'));
  });

// ----- Size Calculation Helpers -----

export const getStorageSize = (storage: Storage): number => {
  let size = 0;
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key) continue;
    const value = storage.getItem(key) || '';
    size += (key.length + value.length) * 2; // UTF-16 estimate
  }
  return size;
};

export const getCookieSize = (): number => {
  return typeof document === 'undefined' ? 0 : document.cookie.length * 2;
};

export const getIndexedDBSize = async (): Promise<number> => {
  if (typeof indexedDB === 'undefined') return 0;
  try {
    const databases = await indexedDB.databases();
    let totalSize = 0;
    
    // Process databases sequentially to avoid concurrent IDB access issues
    for (const dbInfo of databases) {
      if (!dbInfo.name) continue;
      
      const db = await idbRequest(indexedDB.open(dbInfo.name));
      const storeNames = Array.from(db.objectStoreNames);
      
      // Parallel fetch all stores in this database
      const storeSizes = await Promise.all(
        storeNames.map(async (storeName) => {
          const tx = db.transaction(storeName, 'readonly');
          const records = await idbRequest(tx.objectStore(storeName).getAll());
          return JSON.stringify(records).length * 2;
        })
      );
      
      totalSize += storeSizes.reduce((sum, size) => sum + size, 0);
      db.close();
    }
    return totalSize;
  } catch (e) {
    console.warn('IndexedDB size error', e);
    return 0;
  }
};

export const getCacheStorageSize = async (): Promise<number> => {
  if (typeof caches === 'undefined') return 0;
  try {
    const names = await caches.keys();
    
    // Parallel process all caches
    const cacheSizes = await Promise.all(
      names.map(async (name) => {
        const cache = await caches.open(name);
        const requests = await cache.keys();
        
        // Parallel fetch all responses in this cache
        const responseSizes = await Promise.all(
          requests.map(async (req) => {
            const resp = await cache.match(req);
            if (!resp) return 0;
            
            // Prefer content-length header for performance
            const contentLength = resp.headers.get('content-length');
            if (contentLength) {
              return parseInt(contentLength, 10);
            }
            
            // Fallback to blob size if content-length is not available
            const blob = await resp.blob();
            return blob.size;
          })
        );
        
        return responseSizes.reduce((sum, size) => sum + size, 0);
      })
    );
    
    return cacheSizes.reduce((sum, size) => sum + size, 0);
  } catch (e) {
    console.warn('Cache size error', e);
    return 0;
  }
};

// Aggregate all sizes with parallel computation
export const calculateStorageInfo = async (): Promise<StorageInfo> => {
  // Compute sync storage sizes
  const localStorageSize = typeof localStorage !== 'undefined' ? getStorageSize(localStorage) : 0;
  const sessionStorageSize = typeof sessionStorage !== 'undefined' ? getStorageSize(sessionStorage) : 0;
  const cookiesSize = getCookieSize();
  
  // Parallel compute async storage sizes
  const [indexedDBSize, cacheStorageSize] = await Promise.all([
    getIndexedDBSize(),
    getCacheStorageSize()
  ]);
  
  const total = localStorageSize + sessionStorageSize + cookiesSize + indexedDBSize + cacheStorageSize;
  
  return {
    localStorage: localStorageSize,
    sessionStorage: sessionStorageSize,
    cookies: cookiesSize,
    indexedDB: indexedDBSize,
    cacheStorage: cacheStorageSize,
    total,
  };
};

// ----- Clear Helpers -----
export const clearStorageItem = async (key: StorageKey): Promise<void> => {
  switch (key) {
    case 'localStorage':
      if (!isDevelopment) {
        // In production, preserve user guide data
        const preserved: Record<string, string> = {};
        USER_GUIDE_KEYS.forEach(k => {
          const value = localStorage?.getItem(k);
          if (value) preserved[k] = value;
        });
        localStorage?.clear();
        // Restore preserved data
        Object.entries(preserved).forEach(([k, v]) => localStorage?.setItem(k, v));
      } else {
        // In development, clear everything
        localStorage?.clear();
      }
      break;
    case 'sessionStorage':
      sessionStorage?.clear();
      break;
    case 'cookies':
      document?.cookie.split(';').forEach(cookie => {
        const name = cookie.split('=')[0].trim();
        if (name) {
          document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
        }
      });
      break;
    case 'indexedDB':
      if (typeof indexedDB !== 'undefined') {
        const dbs = await indexedDB.databases();
        await Promise.all(
          dbs.map(db => db.name ? indexedDB.deleteDatabase(db.name) : Promise.resolve())
        );
      }
      break;
    case 'cacheStorage':
      if (typeof caches !== 'undefined') {
        const names = await caches.keys();
        await Promise.all(names.map(n => caches.delete(n)));
      }
      break;
  }
};

export const clearAllStorage = async (): Promise<void> => {
  await Promise.all([
    clearStorageItem('localStorage'),
    clearStorageItem('sessionStorage'),
    clearStorageItem('cookies'),
    clearStorageItem('indexedDB'),
    clearStorageItem('cacheStorage'),
  ]);
};

// ----- Export helpers -----
export interface ExportedStorageData {
  timestamp: string;
  data: {
    localStorage?: Record<string, string>;
    sessionStorage?: Record<string, string>;
    cookies?: Record<string, string>;
    indexedDB?: Record<string, unknown>;
    cacheStorage?: Record<string, { url: string; size: number }[]>;
  };
}

// Helper: convert Storage to object
const storageToObject = (storage: Storage): Record<string, string> => {
  const obj: Record<string, string> = {};
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key) obj[key] = storage.getItem(key) || '';
  }
  return obj;
};

// Helper: parse cookies to object
const parseCookies = (): Record<string, string> => {
  const obj: Record<string, string> = {};
  if (typeof document === 'undefined') return obj;
  
  document.cookie.split(';').forEach(raw => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) return;
    const name = trimmed.slice(0, eqIndex);
    const value = trimmed.slice(eqIndex + 1);
    if (name) obj[name] = decodeURIComponent(value);
  });
  return obj;
};

// Helper: export IndexedDB
const exportIndexedDB = async (): Promise<Record<string, unknown>> => {
  if (typeof indexedDB === 'undefined') return {};
  
  const databases = await indexedDB.databases();
  const result: Record<string, unknown> = {};
  
  for (const dbInfo of databases) {
    if (!dbInfo.name) continue;
    
    const db = await idbRequest(indexedDB.open(dbInfo.name));
    const storeNames = Array.from(db.objectStoreNames);
    
    const dbDump: Record<string, unknown[]> = {};
    await Promise.all(
      storeNames.map(async (storeName) => {
        const tx = db.transaction(storeName, 'readonly');
        const records = await idbRequest(tx.objectStore(storeName).getAll());
        dbDump[storeName] = records;
      })
    );
    
    result[dbInfo.name] = dbDump;
    db.close();
  }
  
  return result;
};

// Helper: export Cache Storage
const exportCacheStorage = async (): Promise<Record<string, { url: string; size: number }[]>> => {
  if (typeof caches === 'undefined') return {};
  
  const names = await caches.keys();
  const result: Record<string, { url: string; size: number }[]> = {};
  
  await Promise.all(
    names.map(async (name) => {
      const cache = await caches.open(name);
      const requests = await cache.keys();
      
      const entries = await Promise.all(
        requests.map(async (req) => {
          const resp = await cache.match(req);
          if (!resp) return null;
          const blob = await resp.blob();
          return { url: req.url, size: blob.size };
        })
      );
      
      result[name] = entries.filter((e): e is { url: string; size: number } => e !== null);
    })
  );
  
  return result;
};

export const exportStorageData = async (
  keys: StorageKey[] = ['localStorage', 'sessionStorage', 'cookies', 'indexedDB', 'cacheStorage']
): Promise<ExportedStorageData> => {
  const result: ExportedStorageData = { timestamp: new Date().toISOString(), data: {} };
  
  // Build promises for requested keys
  const promises: Promise<void>[] = [];
  
  if (keys.includes('localStorage') && typeof localStorage !== 'undefined') {
    promises.push(Promise.resolve().then(() => {
      result.data.localStorage = storageToObject(localStorage);
    }));
  }
  
  if (keys.includes('sessionStorage') && typeof sessionStorage !== 'undefined') {
    promises.push(Promise.resolve().then(() => {
      result.data.sessionStorage = storageToObject(sessionStorage);
    }));
  }
  
  if (keys.includes('cookies')) {
    promises.push(Promise.resolve().then(() => {
      result.data.cookies = parseCookies();
    }));
  }
  
  if (keys.includes('indexedDB')) {
    promises.push(exportIndexedDB().then(data => {
      result.data.indexedDB = data;
    }));
  }
  
  if (keys.includes('cacheStorage')) {
    promises.push(exportCacheStorage().then(data => {
      result.data.cacheStorage = data;
    }));
  }
  
  await Promise.all(promises);
  return result;
};

export const downloadExportedData = (data: ExportedStorageData, filename = 'talos-storage-export.json'): void => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};