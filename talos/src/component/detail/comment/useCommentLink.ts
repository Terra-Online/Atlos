import { useEffect, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { useMarkerStore } from '@/store/marker';
import { getUGCCommentById, type UGCComment } from '@/utils/ugcClient';
import { flatList, isVisible } from './commentsTree';
import { mergeCommentContext } from './commentContext';

type Options = {
    markerId: string;
    active: boolean;
    loading: boolean;
    comments: UGCComment[];
    setComments: Dispatch<SetStateAction<UGCComment[]>>;
    listRef: RefObject<HTMLDivElement | null>;
};

export function useCommentLink({ markerId, active, loading, comments, setComments, listRef }: Options) {
    const request = useMarkerStore(state => state.commentOpenRequest);
    const [highlightedId, setHighlightedId] = useState<string | null>(null);

    useEffect(() => {
        if (!request) return;
        setHighlightedId(null);
    }, [request]);

    useEffect(() => {
        setHighlightedId(null);
    }, [markerId]);

    useEffect(() => {
        if (!request || request.markerId !== markerId || !active || loading) return;
        let disposed = false;
        let frame = 0;
        const isCurrent = () => !disposed && useMarkerStore.getState().commentOpenRequest === request;
        const finish = () => {
            if (isCurrent()) useMarkerStore.getState().clearCommentOpenRequest();
        };
        const target = flatList(comments).find(comment => comment.id === request.commentId);
        if (target) {
            if (!isVisible(target.status)) {
                finish();
                return;
            }
            frame = window.requestAnimationFrame(() => {
                if (!isCurrent()) return;
                const list = listRef.current;
                const element = Array.from(list?.querySelectorAll<HTMLElement>('[data-comment-id]') ?? [])
                    .find(node => node.dataset.commentId === request.commentId);
                if (!list || !element) return;
                list.scrollTo({
                    top: list.scrollTop + element.getBoundingClientRect().top - list.getBoundingClientRect().top
                        - (list.clientHeight - element.offsetHeight) / 2,
                    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
                });
                finish();
                setHighlightedId(request.commentId);
            });
        } else {
            void getUGCCommentById(markerId, request.commentId).then(context => {
                if (!isCurrent()) return;
                if (context.targetId !== request.commentId || !context.path.some(comment => comment.id === request.commentId)) {
                    finish();
                    return;
                }
                setComments(current => mergeCommentContext(current, context));
            }).catch(() => {
                // An unavailable link leaves the marker open without moving focus.
                finish();
            });
        }
        return () => { disposed = true; window.cancelAnimationFrame(frame); };
    }, [active, comments, listRef, loading, markerId, request, setComments]);

    return { highlightedId };
}
