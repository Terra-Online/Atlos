import React, { useCallback, useEffect, useState } from 'react';
import Modal from '@/component/modal/modal';
import Button from '@/component/button/button';
import ToSIcon from '../../assets/logos/tos.svg?react';
import styles from './storage.module.scss';
import { useTranslateUI } from '@/locale';

export interface StorageProps {
  open: boolean;
  onClose: () => void;
  onChange?: (open: boolean) => void;
}

interface StorageInfo {
  localStorage: number;
  sessionStorage: number;
  cookies: number;
  indexedDB: number;
  cacheStorage: number;
  total: number;
}

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
};

const getStorageSize = (storage: Storage): number => {
  let size = 0;
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key) {
      const value = storage.getItem(key);
      size += (key.length + (value?.length || 0)) * 2; // UTF-16, 2 bytes per char
    }
  }
  return size;
};

const getCookieSize = (): number => {
  return document.cookie.length * 2;
};

const getIndexedDBSize = async (): Promise<number> => {
  if (!('indexedDB' in window)) return 0;
  
  try {
    const databases = await indexedDB.databases();
    let totalSize = 0;
    
    for (const dbInfo of databases) {
      if (!dbInfo.name) continue;
      
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(dbInfo.name as string);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new Error(request.error?.message || 'IndexedDB open failed'));
      });
      
      for (const storeName of Array.from(db.objectStoreNames)) {
        const transaction = db.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const allRecords = await new Promise<unknown[]>((resolve, reject) => {
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(new Error(request.error?.message || 'Store getAll failed'));
        });
        
        const sizeEstimate = JSON.stringify(allRecords).length * 2;
        totalSize += sizeEstimate;
      }
      
      db.close();
    }
    
    return totalSize;
  } catch (error) {
    console.error('Error calculating IndexedDB size:', error);
    return 0;
  }
};

const getCacheStorageSize = async (): Promise<number> => {
  if (!('caches' in window)) return 0;
  
  try {
    const cacheNames = await caches.keys();
    let totalSize = 0;
    
    for (const cacheName of cacheNames) {
      const cache = await caches.open(cacheName);
      const requests = await cache.keys();
      
      for (const request of requests) {
        const response = await cache.match(request);
        if (response) {
          const blob = await response.blob();
          totalSize += blob.size;
        }
      }
    }
    
    return totalSize;
  } catch (error) {
    console.error('Error calculating Cache Storage size:', error);
    return 0;
  }
};

const StorageModal: React.FC<StorageProps> = ({ open, onClose, onChange }) => {
  const t = useTranslateUI();
  const [storageInfo, setStorageInfo] = useState<StorageInfo>({
    localStorage: 0,
    sessionStorage: 0,
    cookies: 0,
    indexedDB: 0,
    cacheStorage: 0,
    total: 0,
  });
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);

  const calculateStorage = useCallback(async () => {
    setLoading(true);
    try {
      const localStorageSize = getStorageSize(localStorage);
      const sessionStorageSize = getStorageSize(sessionStorage);
      const cookiesSize = getCookieSize();
      const indexedDBSize = await getIndexedDBSize();
      const cacheStorageSize = await getCacheStorageSize();
      
      const total = localStorageSize + sessionStorageSize + cookiesSize + indexedDBSize + cacheStorageSize;
      
      setStorageInfo({
        localStorage: localStorageSize,
        sessionStorage: sessionStorageSize,
        cookies: cookiesSize,
        indexedDB: indexedDBSize,
        cacheStorage: cacheStorageSize,
        total,
      });
    } catch (error) {
      console.error('Error calculating storage:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      void calculateStorage();
    }
  }, [open, calculateStorage]);

  const handleClearStorage = async () => {
    setClearing(true);
    
    try {
      // Clear localStorage
      localStorage.clear();
      
      // Clear sessionStorage
      sessionStorage.clear();
      
      // Clear cookies
      document.cookie.split(';').forEach(cookie => {
        const name = cookie.split('=')[0].trim();
        if (name) {
          document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
        }
      });
      
      // Clear IndexedDB
      if ('indexedDB' in window) {
        const databases = await indexedDB.databases();
        for (const dbInfo of databases) {
          if (dbInfo.name) {
            indexedDB.deleteDatabase(dbInfo.name);
          }
        }
      }
      
      // Clear Cache Storage
      if ('caches' in window) {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map(name => caches.delete(name)));
      }
      
      // Recalculate storage
      await calculateStorage();
      
      // Show success and reload
      setTimeout(() => {
        window.location.reload();
      }, 500);
    } catch (error) {
      console.error('Error clearing storage:', error);
    } finally {
      setClearing(false);
    }
  };

  const storageItems = [
    { key: 'localStorage', label: t('storage.localStorage'), size: storageInfo.localStorage },
    { key: 'sessionStorage', label: t('storage.sessionStorage'), size: storageInfo.sessionStorage },
    { key: 'cookies', label: t('storage.cookies'), size: storageInfo.cookies },
    { key: 'indexedDB', label: t('storage.indexedDB'), size: storageInfo.indexedDB },
    { key: 'cacheStorage', label: t('storage.cacheStorage'), size: storageInfo.cacheStorage },
  ];

  return (
    <Modal
      open={open}
      size="m"
      onClose={onClose}
      onChange={onChange}
      title={t('storage.title')}
      icon={<ToSIcon aria-hidden="true" />}
    >
      <div className={styles.storageContainer}>
        {loading ? (
          <div className={styles.loading}>{t('storage.calculating')}</div>
        ) : (
          <>
            <div className={styles.storageList}>
              {storageItems.map(item => (
                <div key={item.key} className={styles.storageItem}>
                  <span className={styles.storageLabel}>{item.label}</span>
                  <span className={styles.storageSize}>{formatBytes(item.size)}</span>
                </div>
              ))}
              <div className={`${styles.storageItem} ${styles.total}`}>
                <span className={styles.storageLabel}>{t('storage.total')}</span>
                <span className={styles.storageSize}>{formatBytes(storageInfo.total)}</span>
              </div>
            </div>
            
            <div className={styles.actions}>
              <Button
                text={clearing ? t('storage.clearing') : t('storage.clearAll')}
                variant="next"
                width="100%"
                height="2.5rem"
                onClick={() => void handleClearStorage()}
                disabled={clearing}
              />
            </div>
            
            <div className={styles.warning}>
              {t('storage.warning')}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};

export default React.memo(StorageModal);
