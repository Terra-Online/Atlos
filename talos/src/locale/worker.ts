/**
 * Web Worker for loading and parsing i18n JSON files
 * Offloads JSON parsing from main thread to prevent blocking
 */

const DB_NAME = 'talos-i18n-cache';
const DB_VERSION = 1;
const STORE_NAME = 'locale-bundles';

interface CacheEntry {
  locale: string;
  ui: Record<string, unknown>;
  game: Record<string, unknown>;
  timestamp: number;
}

interface WorkerMessage {
  type: 'load';
  locale: string;
}

// IndexedDB helper
let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => reject(new Error(request.error?.message || 'Failed to open database'));
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'locale' });
      }
    };
  });
  
  return dbPromise;
}

async function getCached(locale: string): Promise<CacheEntry | null> {
  try {
    const db = await openDB();
    return new Promise<CacheEntry | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(locale);
      
      request.onsuccess = () => resolve(request.result as CacheEntry | null || null);
      request.onerror = () => reject(new Error(request.error?.message || 'Failed to get cache'));
    });
  } catch {
    return null;
  }
}

async function setCache(entry: CacheEntry): Promise<void> {
  try {
    const db = await openDB();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(entry);
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error(request.error?.message || 'Failed to set cache'));
    });
  } catch {
    // Ignore cache write errors
  }
}

// Load JSON from network
async function loadJSON(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load ${url}`);
  return response.json() as Promise<Record<string, unknown>>;
}

// Main message handler
self.addEventListener('message', (e: MessageEvent<WorkerMessage>) => {
  void (async () => {
    const { type, locale } = e.data;
    
    if (type === 'load') {
      try {
        // Try cache first
        const cached = await getCached(locale);
        
        if (cached) {
          // Cache hit - return immediately
          self.postMessage({
            type: 'success',
            locale,
            ui: cached.ui,
            game: cached.game,
            fromCache: true,
          });
          return;
        }
        
        // Cache miss - load from network
        const baseUrl = self.location.origin;
        const [ui, game] = await Promise.all([
          loadJSON(`${baseUrl}/src/locale/data/ui/${locale}.json`),
          loadJSON(`${baseUrl}/src/locale/data/game/${locale}.json`),
        ]);
        
        // Store in cache for next time
        await setCache({
          locale,
          ui,
          game,
          timestamp: Date.now(),
        });
        
        self.postMessage({
          type: 'success',
          locale,
          ui,
          game,
          fromCache: false,
        });
      } catch (error) {
        self.postMessage({
          type: 'error',
          locale,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  })();
});

// Signal ready
self.postMessage({ type: 'ready' });
