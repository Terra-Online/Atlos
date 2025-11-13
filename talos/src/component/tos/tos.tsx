import React, { useCallback, useEffect, useState } from 'react';
import Modal from '@/component/modal/modal';
import Button from '@/component/button/button';
import ToSIcon from '../../assets/logos/tos.svg?react';
import styles from './tos.module.scss';
import { useTranslateUI } from '@/locale';
import {
  calculateStorageInfo,
  clearStorageItem,
  clearAllStorage,
  formatBytes,
  type StorageInfo,
} from '@/utils/storage';

export interface ToSProps {
  open: boolean;
  onClose: () => void;
  onChange?: (open: boolean) => void;
}

interface StorageItemConfig {
  key: keyof Omit<StorageInfo, 'total'>;
  label: string;
  description: string;
  clearable: boolean;
}

const TOSModal: React.FC<ToSProps> = ({ open, onClose, onChange }) => {
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
  const [clearingAll, setClearingAll] = useState(false);
  const [clearingItem, setClearingItem] = useState<string | null>(null);

  const calculateStorage = useCallback(async () => {
    setLoading(true);
    try {
      const info = await calculateStorageInfo();
      setStorageInfo(info);
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

  const handleClearItem = async (key: keyof Omit<StorageInfo, 'total'>) => {
    setClearingItem(key);
    try {
      await clearStorageItem(key);
      await calculateStorage();
    } catch (error) {
      console.error(`Error clearing ${key}:`, error);
    } finally {
      setClearingItem(null);
    }
  };

  const handleClearAll = async () => {
    setClearingAll(true);
    try {
      await clearAllStorage();
      setTimeout(() => { window.location.reload(); }, 500);
    } catch (error) {
      console.error('Error clearing all storage:', error);
    } finally {
      setClearingAll(false);
    }
  };

  const storageItems: StorageItemConfig[] = [
    { 
      key: 'localStorage' as const, 
      label: t('storage.localStorage'), 
      description: t('storage.localStorageDesc'),
      clearable: true,
    },
    { 
      key: 'sessionStorage' as const, 
      label: t('storage.sessionStorage'), 
      description: t('storage.sessionStorageDesc'),
      clearable: true,
    },
    { 
      key: 'cookies' as const, 
      label: t('storage.cookies'), 
      description: t('storage.cookiesDesc'),
      clearable: true,
    },
    { 
      key: 'indexedDB' as const, 
      label: t('storage.indexedDB'), 
      description: t('storage.indexedDBDesc'),
      clearable: true,
    },
    { 
      key: 'cacheStorage' as const, 
      label: t('storage.cacheStorage'), 
      description: t('storage.cacheStorageDesc'),
      clearable: true,
    },
  ].filter(item => storageInfo[item.key] > 0); // Only show items with data

  return (
    <Modal
      open={open}
      size="l"
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
            {storageItems.length === 0 ? (
              <div className={styles.noData}>{t('storage.noData')}</div>
            ) : (
              <>
                <div className={styles.storageList}>
                  {storageItems.map(item => (
                    <div key={item.key} className={styles.storageItem}>
                      <div className={styles.itemHeader}>
                        <span className={styles.storageLabel}>{item.label}</span>
                        <span className={styles.storageSize}>{formatBytes(storageInfo[item.key])}</span>
                      </div>
                      <div className={styles.itemDescription}>{item.description}</div>
                      <div className={styles.itemActions}>
                        {item.clearable && (
                          <Button
                            text={clearingItem === item.key ? t('storage.clearing') : t('storage.clear')}
                            buttonType="close"
                            schema='dark'

                            onClick={() => void handleClearItem(item.key)}
                            disabled={clearingItem === item.key || clearingAll}
                          />
                        )}
                      </div>
                    </div>
                  ))}
                  <div className={`${styles.storageItem} ${styles.total}`}>
                    <div className={styles.itemHeader}>
                      <span className={styles.storageLabel}>{t('storage.total')}</span>
                      <span className={styles.storageSize}>{formatBytes(storageInfo.total)}</span>
                    </div>
                  </div>
                </div>
                
                <div className={styles.actions}>
                  <Button
                    text={clearingAll ? t('storage.clearing') : t('storage.clearAll')}
                    buttonType="check"
                    buttonStyle='icon'

                    onClick={() => void handleClearAll()}
                    disabled={clearingAll}
                  />
                </div>
                
                <div className={styles.warning}>
                  {t('storage.warning')}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
};

export default React.memo(TOSModal);