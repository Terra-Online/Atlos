import type { SessionUser } from '@main/services/auth';

export type Provider = 'email' | 'google' | 'discord' | 'github';

export type LoginMethod = {
    provider: Provider;
    linkedAt: string;
    verified?: boolean;
    unlinkable: boolean;
};

export type EndfieldBinding = {
    bound: boolean;
    enabled: boolean;
    provider?: string;
    serverId?: number;
    roleId?: string;
    nickname?: string;
    serverName?: string;
    updatedAt?: string;
};

export type Contribution = {
    id: string;
    kind: 'image' | 'comment';
    markerId: string;
    poiType: string;
    content: string | null;
    previewUrl?: string | null;
    status: string;
    visibility: string;
    review?: {
        manual: boolean;
        published: boolean;
        path?: {
            key: 'uploaded' | 'ai' | 'manual' | 'public' | 'archived';
            at: string | null;
        }[];
        times?: Partial<
            Record<
                'uploaded' | 'ai' | 'manual' | 'public' | 'archived',
                string | null
            >
        >;
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
