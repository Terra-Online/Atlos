import PopoverTooltip from '@main/component/popover/popover';
import { intelArchives } from '@intel/data/types';
import { useTranslateUI } from '@intel/locale';
import styles from './archiveSummary.module.scss';
import archiveVersion from '@intel/data/generated/archive_version.json';

const version = `${archiveVersion.gameVersion} (${archiveVersion.gameBuild})`;

const ArchiveSummary = () => {
  const tUI = useTranslateUI();
  const [prefix, suffix] = tUI('intel.archiveTotal').split('{num}');

  return (
    <PopoverTooltip content={version} placement="top" gap={4}>
      <p className={styles.summary}>
        {prefix}<span className="keyword">{intelArchives.length}</span>{suffix}
      </p>
    </PopoverTooltip>
  );
};

export default ArchiveSummary;
