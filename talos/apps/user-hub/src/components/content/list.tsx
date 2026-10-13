import { useState } from 'react';
import { CommentContent } from '@main/component/detail/comment/emoji';
import { useTranslateGame } from '@main/locale';
import { useTranslateUI } from '@hub/locale';
import type { Contribution } from '../../types';
import { formatDate } from '../../config';
import { list as styles } from './styles';

function Preview({ item }: { item: Contribution }) {
    const t = useTranslateUI();
    const [failed, setFailed] = useState(false);
    return (
        <div className={styles.preview}>
            {item.previewUrl && !failed ? (
                <img
                    src={item.previewUrl}
                    alt={t('userHub.kinds.image')}
                    loading='lazy'
                    onError={() => setFailed(true)}
                />
            ) : (
                <span>{t('userHub.previewUnavailable')}</span>
            )}
        </div>
    );
}

export default function List({
    items,
    kind,
}: {
    items: Contribution[];
    kind: 'image' | 'comment';
}) {
    const t = useTranslateUI();
    const game = useTranslateGame();
    if (!items.length)
        return (
            <p className={styles.empty}>{t('userHub.emptyContributions')}</p>
        );
    return (
        <ul className={kind === 'image' ? styles.images : styles.list}>
            {items.map((item) => {
                const date = formatDate(item.createdAt);
                const [day, ...clock] = date.split(' ');
                const status = (
                    <span className={styles.status} data-status={item.status}>
                        {t(`userHub.status.${item.status}`) || item.status}
                    </span>
                );
                const time = (
                    <time
                        className={`${styles.date} ${styles.imageDate}`}
                        dateTime={item.createdAt}
                    >
                        <span>{day}</span>
                        <span>{clock.join(' ')}</span>
                    </time>
                );
                return (
                    <li key={item.id}>
                        {kind === 'image' ? (
                            <article className={styles.image}>
                                <Preview key={item.previewUrl} item={item} />
                                <div className={styles.imageMeta}>
                                    {time}
                                    {status}
                                </div>
                            </article>
                        ) : (
                            <article
                                className={styles.comment}
                                data-status={item.status}
                            >
                                <div className={styles.body}>
                                    <div className={styles.message}>
                                        <div className={styles.meta}>
                                            <span className={styles.place}>
                                                {game(
                                                    `markerType.key.${item.poiType}`,
                                                ) || item.poiType}
                                            </span>
                                            {status}
                                        </div>
                                        <p className={styles.text}>
                                            <CommentContent
                                                content={item.content || ''}
                                            />
                                        </p>
                                    </div>
                                </div>
                                <time
                                    className={styles.time}
                                    dateTime={item.createdAt}
                                >
                                    {formatDate(item.createdAt)}
                                </time>
                            </article>
                        )}
                    </li>
                );
            })}
        </ul>
    );
}
