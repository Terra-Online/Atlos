import React, { useState, useMemo, useRef, useEffect } from 'react';
import styles from './detail.module.scss';
//import Button from '@/component/button.tsx';

import { getItemIconUrl, getCtgrIconUrl } from '@/utils/resource.ts';
import {
    useMarkerStore,
    useRegionMarkerCount,
    useWorldMarkerCount,
} from '@/store/marker.ts';
import {
    useAddPoint,
    useDeletePoint,
    useUserRecord,
} from '@/store/userRecord.ts';
import classNames from 'classnames';
import { useClickAway } from 'ahooks';
import { motion, AnimatePresence, usePresence } from 'motion/react';
import { useTranslateGame, useTranslateUI } from '@/locale';

// const mockPoint = {
//   id: "001",
//   position: [-656.19, 645.58],
//   region: {
//     main: "Valley_4",
//     sub: "pane_1"
//   },
//   type: {
//     main: "resource",
//     sub: "natural",
//     key: "originium_ore"
//   },
//   status: {
//     user: {
//       isCollected: false,
//       localNote: "Complete E1M7 to enable the secret path to the point. Open on SAT/SUN only."
//     }
//   },
//   meta: {
//     addedBy: "cirisus",
//     addedAt: "2025-03-09T15:30:00Z"
//   }
// };

const TEXT_DURATION = 30;
const AnimatedText = (props:{text:string} & React.ComponentProps<typeof motion.span>) => {
    const {
        text,
        ...rest
    } = props;
    const [isPresent, safeToRemove] = usePresence();
    // text should not be changed
    const [textToRender, setTextToRender] = useState('');
    useEffect(() => {
        if (isPresent) {
            let index = 0;
            const interval = setInterval(() => {
                setTextToRender(text.slice(0, index));
                index++;
                if (index > text.length) {
                    clearInterval(interval);
                }
            }, TEXT_DURATION);
            return () => clearInterval(interval);
        } else {
            let index = text.length;
            const interval = setInterval(() => {
                setTextToRender(text.slice(0, index));
                index--;
                if (index < 0) {
                    clearInterval(interval);
                    safeToRemove();
                }
            }, TEXT_DURATION);
            return () => clearInterval(interval);
        }
    }, [isPresent, safeToRemove, text]);
    return (
        <motion.span
            {...rest}
            initial='initial'
            animate={isPresent ? 'animate' : 'exit'}
        >
            {textToRender
                ?.split('')
                .map((c, index) => <span key={index}>{c}</span>) ?? ''}
        </motion.span>
    );
};

export const Detail = ({ inline = false }: { inline?: boolean }) => {
    /**
     * @type {import('../mapContainer/store/marker.type').IMarkerData}
     */
    const currentPoint = useMarkerStore((state) => state.currentActivePoint);
    const pointsRecord = useUserRecord();
    const addPoint = useAddPoint();
    const deletePoint = useDeletePoint();

    const isCollected = currentPoint
        ? pointsRecord.includes(currentPoint.id)
        : false;

    const iconKey = currentPoint ? currentPoint.type : 'UKN';
    const iconUrl = getItemIconUrl(iconKey);

    const ctgyIconUrl = getCtgrIconUrl(
        currentPoint ? currentPoint.type : 'UKN',
    );

    const tGame = useTranslateGame();
    const tUI = useTranslateUI();
    const pointName = tGame(`markerType.key.${currentPoint?.type}`);

    // const noteContent = currentPoint?.status?.user?.localNote;

    const [isVisible, setIsVisible] = useState(false);
    const ref = useRef(null);
    useClickAway(() => {
        setIsVisible(false);
    }, ref);
    useEffect(() => {
        if (currentPoint) setIsVisible(true);
        console.log(currentPoint);
    }, [currentPoint]);

    // const handleNextPoint = () => addPoint(currentPoint.id);

    // marks
    const worldCnt = useWorldMarkerCount(currentPoint?.type);
    const regionCnt = useRegionMarkerCount(currentPoint?.type);

    const statItems = useMemo(
        () => [
            { label: tUI('detail.stat.world'), data: worldCnt, index: 0 },
            { label: tUI('detail.stat.main'), data: regionCnt, index: 1 },
        ],
        [worldCnt, regionCnt, tUI],
    );

    return (
        <AnimatePresence mode='wait'>
            {isVisible && currentPoint && (
                <motion.div
                    initial={{ x: '150%' }}
                    animate={{ x: '0%' }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    key={currentPoint ? 'active' : 'null'}
                    className={`${styles.detailContainer} ${inline ? styles.inline : ''}`}
                    ref={ref}
                >
                    {/* Head */}
                    <div className={styles.detailHeader}>
                        <div className={styles.pointInfo}>
                            {ctgyIconUrl && (
                                <span
                                    className={styles.categoryIcon}
                                    style={{
                                        backgroundImage: `url(${ctgyIconUrl})`,
                                    }}
                                ></span>
                            )}
                            <AnimatePresence mode='wait'>
                                <AnimatedText
                                    text={pointName}
                                    key={currentPoint?.id ?? 'null'}
                                    className={styles.pointName}
                                >
                                    {pointName}
                                </AnimatedText>
                            </AnimatePresence>
                        </div>
                        {/* actions                        <div className={styles.headerActions}>
                            {!isCollected && (
                                <Button
                                    text={'Next'}
                                    variant='next'
                                    width='6rem'
                                    height='1.5rem'
                                    onClick={() => {}}
                                />
                            )}
                        </div>
                         */}
                    </div>
                    {/* Content */}
                    <div className={styles.detailContent}>
                        {/* Icon & Stats */}
                        <div className={styles.iconStatsContainer}>
                            <div
                                className={classNames(styles.pointIcon, {
                                    [styles.collected]: isCollected,
                                })}
                                onClick={() => {
                                    if (isCollected) {
                                        deletePoint(currentPoint.id);
                                    } else {
                                        addPoint(currentPoint.id);
                                    }
                                }}
                            >
                                <AnimatePresence mode='wait'>
                                    {iconUrl && (
                                        <motion.img
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            exit={{ opacity: 0 }}
                                            transition={{ duration: 0.3 }}
                                            key={currentPoint?.id ?? 'null'}
                                            src={iconUrl}
                                            alt={pointName}
                                        />
                                    )}
                                </AnimatePresence>
                            </div>
                            <div className={styles.pointStats}>
                                <div className={styles.statsTxt}>
                                    {statItems.map((item) => (
                                        <div
                                            className={styles.statRow}
                                            key={item.label}
                                            style={{
                                                transform: `translateY(${3 - item.index * 2}px)`,
                                            }}
                                        >
                                            <span className={styles.statLabel}>
                                                {item.label}:{' '}
                                            </span>
                                            <div className={styles.statValue}>
                                                <span
                                                    className={`user-value ${item.data.collected === item.data.total ? 'check' : ''}`}
                                                >
                                                    {item.data.collected}
                                                </span>
                                                <span className='value-separator'>
                                                    /
                                                </span>
                                                <span className='total-value'>
                                                    {item.data.total}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <div className={styles.statsProg}>
                                    {statItems.map((item) => (
                                        <div
                                            key={`prog-${item.label}`}
                                            className={classNames(
                                                styles.progBar,
                                                {
                                                    [styles.check]:
                                                        item.data.collected ===
                                                        item.data.total,
                                                },
                                            )}
                                            style={{
                                                '--prog':
                                                    item.data.collected /
                                                    item.data.total,
                                            }}
                                        ></div>
                                    ))}
                                </div>
                            </div>
                        </div>
                        {/* Circumstance */}
                        {/* <div className="point-image">
            <div className="no-image">No info.</div>
          </div> */}
                        {/* Note */}
                        {/* <div className="detail-notes">
            {noteContent ? (
              <p className="note-text">{noteContent}</p>
            ) : (
              <p className="no-note">No info.</p>
            )}
          </div> */}
                        {/* Wiki */}
                        {/* <div className="detail-wiki">
            No info.
          </div> */}
                    </div>
                    {/* Meta
      <div className="detail-meta">
        <span>Provided by: {mockPoint.meta?.addedBy || 'UKN'}</span>
        <span>At: {mockPoint.meta?.addedAt ?
          new Date(mockPoint.meta.addedAt).toLocaleDateString() : 'UKN'}</span>
      </div>
      */}
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default Detail;
