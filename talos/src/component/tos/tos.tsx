import React, { useState, useCallback, useRef, useEffect } from 'react';
import Modal from '@/component/modal/modal';
import ToSIcon from '../../assets/logos/tos.svg?react';
import styles from './tos.module.scss';
import { useTranslateUI } from '@/locale';
import parse from 'html-react-parser';
import TreeMap from './treeMap/treeMap';
import Button from '../button/button';
import { clearAllStorage, clearStorageItem } from '@/utils/storage';
import { useDevice } from '@/utils/device';

export interface ToSProps {
  open: boolean;
  onClose: () => void;
  onChange?: (open: boolean) => void;
}

const TOSModal: React.FC<ToSProps> = ({ open, onClose, onChange }) => {
  const t = useTranslateUI();
  const { type: deviceType } = useDevice();
  const [selectedPath, setSelectedPath] = useState<string[] | null>(null);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Confirmation state
  const [pendingAction, setPendingAction] = useState<'selected' | 'all' | null>(null);
  const [isActionReady, setIsActionReady] = useState(false);
  const actionTimeoutRef = useRef<number | null>(null);
  const controlsRef = useRef<HTMLDivElement>(null);

  const handleSelect = useCallback((path: string[], name: string) => {
    setSelectedPath(path);
    setSelectedName(name);
    // Reset pending action on selection change
    setPendingAction(null);
    setIsActionReady(false);
  }, []);

  const handleClearAll = useCallback(async () => {
    await clearAllStorage();
    // After clearing storage, reload to ensure all in-memory state is reset.
    if (typeof window !== 'undefined') {
      window.location.reload();
      return;
    }
    setRefreshKey(prev => prev + 1);
    setSelectedPath(null);
    setSelectedName(null);
  }, []);

  const handleClearSelected = useCallback(async () => {
    if (!selectedPath || !selectedName) return;
    await clearStorageItem(selectedPath);
    // Selected deletions can remove state the app relies on; reload for consistency.
    if (typeof window !== 'undefined') {
      window.location.reload();
      return;
    }
    setRefreshKey(prev => prev + 1);
    setSelectedPath(null);
    setSelectedName(null);
  }, [selectedPath, selectedName]);

  const handleActionClick = (e: React.MouseEvent, action: 'selected' | 'all') => {
    e.stopPropagation();
    
    if (pendingAction === action) {
      if (isActionReady) {
        // Execute
        if (action === 'selected') void handleClearSelected();
        else void handleClearAll();
        
        // Reset
        setPendingAction(null);
        setIsActionReady(false);
      }
    } else {
      // Start new action
      setPendingAction(action);
      setIsActionReady(false);
      if (actionTimeoutRef.current) clearTimeout(actionTimeoutRef.current);
      actionTimeoutRef.current = window.setTimeout(() => {
        setIsActionReady(true);
      }, 800);
    }
  };

  // Click outside to cancel
  useEffect(() => {
    if (!pendingAction) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (controlsRef.current && !controlsRef.current.contains(e.target as Node)) {
        setPendingAction(null);
        setIsActionReady(false);
      }
    };

    window.addEventListener('click', handleClickOutside, { capture: true });
    return () => window.removeEventListener('click', handleClickOutside, { capture: true });
  }, [pendingAction]);

  // Cleanup timeout
  useEffect(() => {
    return () => {
      if (actionTimeoutRef.current) clearTimeout(actionTimeoutRef.current);
    };
  }, []);

  return (
    <Modal
      open={open}
      size="full"
      onClose={onClose}
      onChange={onChange}
      title={t('tos.title')}
      icon={<ToSIcon aria-hidden="true" />}
    >
      <div className={styles.storageContainer}>
          {parse(t('tos.policy') || '')}
      </div>
      <div className={styles.storageController} data-device={deviceType}>
        <div className={styles.storageMap}>
          <TreeMap onSelect={handleSelect} refreshTrigger={refreshKey} />
        </div>
        <div className={styles.controls} ref={controlsRef}>
          <Button 
            text={`${t('common.clear')} ${selectedName || t('common.selected')}`}
            onClick={(e) => handleActionClick(e, 'selected')}
              buttonStyle="square"
              schema="light"
              width="100%"
              disabled={!selectedPath}
            />
            <Button 
              text={t('common.clear') + ' ' + t('common.all')} 
              onClick={(e) => handleActionClick(e, 'all')} 
              buttonStyle="square"
              schema="light"
              width="100%"
            />
            <div className={`${styles.warning} ${pendingAction ? styles.visible : ''}`}>
              <div className={styles.warningInner}>
                {parse(t('tos.warning'))}
              </div>
            </div>
          </div>
        </div>
    </Modal>
  );
};

export default React.memo(TOSModal);