import React, { useState, useCallback } from 'react';
import Modal from '@/component/modal/modal';
import ToSIcon from '../../assets/logos/tos.svg?react';
import styles from './tos.module.scss';
import { useTranslateUI } from '@/locale';
import parse from 'html-react-parser';
import TreeMap from './treeMap/treeMap';
import Button from '../button/button';
import { clearAllStorage, clearStorageItem } from '@/utils/storage';

export interface ToSProps {
  open: boolean;
  onClose: () => void;
  onChange?: (open: boolean) => void;
}

const TOSModal: React.FC<ToSProps> = ({ open, onClose, onChange }) => {
  const t = useTranslateUI();
  const [selectedPath, setSelectedPath] = useState<string[] | null>(null);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleSelect = useCallback((path: string[], name: string) => {
    setSelectedPath(path);
    setSelectedName(name);
  }, []);

  const handleClearAll = useCallback(async () => {
    await clearAllStorage();
    setRefreshKey(prev => prev + 1);
    setSelectedPath(null);
    setSelectedName(null);
  }, []);

  const handleClearSelected = useCallback(async () => {
    if (!selectedPath || !selectedName) return;
    await clearStorageItem(selectedPath);
    setRefreshKey(prev => prev + 1);
    setSelectedPath(null);
    setSelectedName(null);
  }, [selectedPath, selectedName]);

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
      <div className={styles.storageMap}>
        <TreeMap onSelect={handleSelect} refreshTrigger={refreshKey} />
      </div>
      <div className={styles.controls}>
        <Button 
          text={`Clear ${selectedName || 'Selected'}`}
          onClick={() => { void handleClearSelected(); }}
          buttonStyle="normal"
          schema="light"
          height="1.8rem"
          width="auto"
          style={{ 
            opacity: selectedPath ? 1 : 0.5, 
            pointerEvents: selectedPath ? 'auto' : 'none',
            padding: '0 1rem'
          }}
        />
        <Button 
          text="Clear All" 
          onClick={() => { void handleClearAll(); }} 
          buttonStyle="normal"
          schema="light"
          width= "6rem"
          height="1.8rem"
        />
      </div>
    </Modal>
  );
};

export default React.memo(TOSModal);