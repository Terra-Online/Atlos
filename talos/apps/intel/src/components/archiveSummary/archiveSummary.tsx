import { useEffect, useState } from 'react';
import PopoverTooltip from '@main/component/popover/popover';
import { intelArchives } from '@intel/data/types';
import { useTranslateUI } from '@intel/locale';
import styles from './archiveSummary.module.scss';

const SDK_ORIGIN = 'https://data.opendfieldmap.org';

const readVersion = async (signal: AbortSignal): Promise<string> => {
  const channelResponse = await fetch(`${SDK_ORIGIN}/channels/stable.json`, { signal });
  if (!channelResponse.ok) throw new Error('SDK channel unavailable');
  const channel = await channelResponse.json() as { manifest: { path: string } };
  const manifestUrl = new URL(channel.manifest.path, SDK_ORIGIN);
  if (manifestUrl.origin !== SDK_ORIGIN) throw new Error('Invalid SDK manifest origin');
  const response = await fetch(manifestUrl, { signal });
  if (!response.ok) throw new Error('SDK manifest unavailable');
  const manifest = await response.json() as { gameVersion?: string; gameBuild?: string };
  if (typeof manifest.gameVersion !== 'string' || typeof manifest.gameBuild !== 'string') {
    throw new Error('SDK version unavailable');
  }
  return `${manifest.gameVersion.replace(/_/g, '.')} (${manifest.gameBuild})`;
};

const ArchiveSummary = () => {
  const tUI = useTranslateUI();
  const [version, setVersion] = useState('');
  const [prefix, suffix] = tUI('intel.archiveTotal').split('{num}');

  useEffect(() => {
    const controller = new AbortController();
    // Version lookup must not prevent the local archive count from rendering.
    void readVersion(controller.signal).then(setVersion).catch(() => undefined);
    return () => controller.abort();
  }, []);

  return (
    <PopoverTooltip content={version} placement="top" gap={4}>
      <p className={styles.summary}>
        {prefix}<span className="keyword">{intelArchives.length}</span>{suffix}
      </p>
    </PopoverTooltip>
  );
};

export default ArchiveSummary;
