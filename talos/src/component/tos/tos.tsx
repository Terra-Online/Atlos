import React, { useState, useCallback } from 'react';
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
      <div className={styles.storageController} data-device={deviceType}>
        <div className={styles.storageMap}>
          <TreeMap onSelect={handleSelect} refreshTrigger={refreshKey} />
        </div>
        <div className={styles.controls}>
          <Button 
            text={`${t('common.clear')} ${selectedName || t('common.selected')}`}
            onClick={() => { void handleClearSelected(); }}
            buttonStyle="square"
            schema="light"
            width="100%"
            style={{ 
              opacity: selectedPath ? 1 : 0.5, 
              pointerEvents: selectedPath ? 'auto' : 'none'
            }}
          />
          <Button 
            text={t('common.clear') + t('common.all')} 
            onClick={() => { void handleClearAll(); }} 
            buttonStyle="square"
            schema="light"
            width="100%"
          />
        </div>
      </div>
    </Modal>
  );
};

export default React.memo(TOSModal);