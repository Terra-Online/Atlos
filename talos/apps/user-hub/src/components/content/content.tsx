import { useRef, useState } from 'react';
import { useLocale, useTranslateUI } from '@hub/locale';
import List from './list';
import { useContributions, type Kind } from './useContributions';
import type { Overview } from '../../types';
import { ModalTabs } from '@main/component/modal/modal';
import Feed from '@main/component/notify/feed';
import { AccessButton } from '@main/component/login/access/button';
import ImageIcon from '@main/assets/logos/images.svg?react';
import CommentIcon from '@main/assets/logos/comment.svg?react';
import styles from './content.module.scss';

type Props = {
    revision: number;
    counts: Overview['contributions'];
};

export default function Content({ revision, counts }: Props) {
    const t = useTranslateUI();
    const locale = useLocale();
    const [kind, setKind] = useState<Kind>('image');
    const swipeTarget = useRef<HTMLDivElement>(null);
    const { items, cursor, loading, error, loadMore, retry } = useContributions(
        kind,
        revision,
    );
    const totals = {
        image: counts.imageCount,
        comment: counts.commentCount,
    };

    return (
        <section data-font-region="content" className={styles.section} aria-busy={loading}>
            <div className={styles.feed} ref={swipeTarget}>
                <ModalTabs
                    className={styles.filters}
                    swipeTargetRef={swipeTarget}
                    ariaLabel={t('userHub.tabs.contributions')}
                    activeKey={kind}
                    onChange={(key) => {
                        if (key === 'image' || key === 'comment') setKind(key);
                    }}
                    items={(['image', 'comment'] as const).map((value) => ({
                        key: value,
                        icon:
                            value === 'image' ? <ImageIcon /> : <CommentIcon />,
                        title: `${t(`userHub.kinds.${value}`)} (${totals[value].toLocaleString(locale)})`,
                    }))}
                />
                <Feed resetKey={kind}>
                    <div className={styles.items}>
                        {error && (
                            <div className={styles.error} role='alert'>
                                <p>
                                    {t('userHub.contributionsError')} {error}
                                </p>
                                <div className={styles.more}>
                                    <AccessButton
                                        onClick={retry}
                                        disabled={loading}
                                        label={t('userHub.retry')}
                                    />
                                </div>
                            </div>
                        )}
                        {items !== null && <List items={items} kind={kind} />}
                        {loading && items === null && (
                            <p className={styles.loading} role='status'>
                                {t('common.loading')}
                            </p>
                        )}
                        {cursor && !error && (
                            <div className={styles.pagination}>
                                <AccessButton
                                    label={t(
                                        loading
                                            ? 'common.loading'
                                            : 'userHub.loadMore',
                                    )}
                                    disabled={loading}
                                    onClick={loadMore}
                                />
                            </div>
                        )}
                    </div>
                </Feed>
            </div>
        </section>
    );
}
