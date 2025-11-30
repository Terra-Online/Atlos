// Generic web storage utilities: size calculation and tree map data generation
// Supports: localStorage, sessionStorage, cookies, IndexedDB, Cache Storage

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
  if (storage) {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key) continue;
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