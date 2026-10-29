import { useMemo } from 'react';
import { useAuthStore } from '@/store/auth';
import { useLocale } from '@/locale';
import { docsLink } from '@/lib/i18n/docsLink';
import { getUpvoteCount, type PointImagesState } from './useUGCPointImages';
import type { UploadState } from './useUGCUpload';

export type ImageState = 'noImage' | 'pending' | 'hasImage';

export type ImageUiState = {
    state: ImageState;
    canPreview: boolean;
    interactive: boolean;
    showRules: boolean;
    rulesUrl: string;
    authorNickname: string;
    authorPublicUid: string;
    createdAt: string;
    upvoteCount: number;
    upvoted: boolean;
    flagged: boolean;
    isOwnActive: boolean;
    canFlag: boolean;
    canDelete: boolean;
    ownerActionsOnly: boolean;
};

const useImageUiState = (imageState: PointImagesState, uploadState: UploadState): ImageUiState => {
    const locale = useLocale();
    const user = useAuthStore((state) => state.sessionUser);

    const { active, isOwnActive, isActivePending, pendingOwn } = imageState;
    const { canUpload, lastSubmission, uploadSent } = uploadState;

    const state: ImageState = pendingOwn || uploadSent || lastSubmission?.status === 'pending_openai' || lastSubmission?.status === 'pending_audit'
        ? 'pending'
        : active
            ? 'hasImage'
            : 'noImage';

    const canPreview = Boolean(active);
    const interactive = canPreview || canUpload;
    const karma = Number.isFinite(user?.karma) ? Math.max(0, user?.karma ?? 0) : 0;
    const showRules = canUpload && state === 'noImage' && karma < 2;

    const rulesUrl = useMemo(
        () => docsLink(locale, 'communityGuidelines'),
        [locale],
    );

    return {
        state,
        canPreview,
        interactive,
        showRules,
        rulesUrl,
        authorNickname: active?.author?.nickname ?? '',
        authorPublicUid: active?.author?.publicUid ?? '',
        createdAt: active?.createdAt ?? '',
        upvoteCount: active ? getUpvoteCount(active) : 0,
        upvoted: Boolean(active?.upvoted),
        flagged: Boolean(active?.flagged),
        isOwnActive,
        canFlag: Boolean(active?.snapshotId) && !isOwnActive && !isActivePending,
        canDelete: isOwnActive,
        ownerActionsOnly: isActivePending,
    };
};

export default useImageUiState;
