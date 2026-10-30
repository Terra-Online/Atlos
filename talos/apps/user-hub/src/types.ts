import type { SessionUser } from '@main/services/auth';
import type { UGCSubmissionStatus } from '@main/services/ugc/client';

type ReviewStatus =
    | 'pending_openai'
    | 'pending_audit'
    | 'approved'
    | 'rejected'
    | 'unknown';
type ReviewKey = 'uploaded' | 'ai' | 'manual' | 'public' | 'archived';

export type Contribution = {
    id: string;
    kind: 'image' | 'comment';
    markerId: string;
    poiType: string;
    content: string | null;
    previewUrl: string | null;
    snapshotId: string;
    revision: number;
    reviewStatus: ReviewStatus;
    authorDeletedAt: string | null;
    adminDeletedAt: string | null;
    status: UGCSubmissionStatus;
    visibility: 'public' | 'private' | 'unavailable';
    review: {
        events: {
            id: string;
            snapshotId: string;
            from: ReviewStatus;
            to: ReviewStatus;
            source: 'ai' | 'admin';
            adminUserId: string | null;
            note: string | null;
            at: string;
        }[];
        manual: boolean;
        published: boolean;
        path: { key: ReviewKey; at: string | null }[];
        times: Record<ReviewKey, string | null>;
    };
    createdAt: string;
};

export type Overview = {
    user: SessionUser;
    contributions: {
        imageCount: number;
        commentCount: number;
        pendingCount: number;
    };
};
