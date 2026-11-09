import { useRef } from 'react';
import parse from 'html-react-parser';
import PopoverTooltip from '@/component/popover/popover';
import { useTranslateGame } from '@/locale';
import styles from '@/pages/map/Preview.module.scss';

export default function SupplementTooltip({ point }: { point: { left: number; top: number } | null }) {
    const t = useTranslateGame();
    const anchor = useRef(point);
    if (point) anchor.current = point;
    const text = t('glossary.optical_fog');
    return (
        <PopoverTooltip visible={point !== null} content={parse(text)} fontText={text.replace(/<[^>]*>/g, '')}>
            <span className={styles.previewAnchor} style={anchor.current ?? undefined} />
        </PopoverTooltip>
    );
}
