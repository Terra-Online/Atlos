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
    createdAt: string;
};

export type Overview = {
    user: SessionUser;
    loginMethods: LoginMethod[];
    services: { endfield: EndfieldBinding };
    contributions: {
        imageCount: number;
        commentCount: number;
        pendingCount: number;
        recent: Contribution[];
    };
};
