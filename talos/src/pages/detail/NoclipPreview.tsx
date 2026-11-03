import { useEffect, useState } from 'react';
import { useTranslateUI } from '@/locale';
import { enabled, loadCatalog, previewLink } from '@/services/noclip/client';
import { openPreview } from '@/services/noclip/preview';
import type { Catalog } from '@/services/noclip/types';
import styles from './detail.module.scss';

export default function NoclipPreview({ pointId }: { pointId: string }) {
    const t = useTranslateUI();
    const [catalog, setCatalog] = useState<Catalog | null>(null);
    useEffect(() => {
        let live = true;
        if (enabled)
            void loadCatalog()
                .then((value) => {
                    if (live) setCatalog(value);
                })
                .catch(() => {
                    if (live) setCatalog(null);
                });
        return () => {
            live = false;
        };
    }, [pointId]);
    if (!enabled || !catalog?.pointIndex[pointId]) return null;
    return (
        <>
            <div
                className={styles.detailDivider}
                data-label={t('detail.noclip.title')}
            />
            <div className={styles.detailAction} data-act='preview'>
                <a
                    href={previewLink(pointId)}
                    target='_blank'
                    onClick={(event) => {
                        if (openPreview(pointId)) event.preventDefault();
                    }}
                >
                    {t('detail.noclip.open')}
                </a>
            </div>
            {import.meta.env.DEV && (
                <div className={styles.detailAction} data-act='route'>
                    <a
                        href={previewLink(pointId, { planRoute: 'nearest' })}
                        target='_blank'
                        rel='noreferrer'
                    >
                        Route from nearest teleport
                    </a>
                </div>
            )}
        </>
    );
}
