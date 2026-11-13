import { memo, type CSSProperties } from 'react';
import classNames from 'classnames';
import { useTranslateUI } from '@/locale';
import { useFontRegion } from '@/locale/useFontRegion';
import type { UGCCommentPlaceholder } from '@/services/ugc/client';
import styles from './comments.module.scss';

type Props = {
    comment: UGCCommentPlaceholder;
    displayDepth: number;
    highlighted: boolean;
};

const CommentPlaceholder = memo(
    ({ comment, displayDepth, highlighted }: Props) => {
        const tUI = useTranslateUI();
        const text = tUI('detail.comments.unavailable');
        const fontRef = useFontRegion(
            [{ faces: ['r'], text, localized: 'ui' }],
            { scope: 'background' },
        );
        return (
            <div
                data-comment-id={comment.id}
                data-highlighted={highlighted ? 'true' : undefined}
                className={classNames(styles.commentNode, {
                    [styles.replyNode]: displayDepth > 0,
                })}
                style={
                    { '--comment-display-depth': displayDepth } as CSSProperties
                }
            >
                <article
                    ref={fontRef}
                    className={classNames(
                        styles.commentBubble,
                        styles.commentBody,
                        styles.commentPlaceholder,
                    )}
                >
                    {text}
                </article>
            </div>
        );
    },
);

export default CommentPlaceholder;
