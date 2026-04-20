export type PositionResponse = {
    code: number;
    message: string;
    timestamp: string;
    data: {
        pos: {
            x: number;
            y: number;
            z: number;
        };
        levelId: string;
        isOnline: boolean;
        mapId: string;
    };
};

export type EndfieldSession = {
    accountToken: string | null;
    cred: string;
    token: string;
};

export type EndfieldAuthFailureReason =
    | 'http-401'
    | 'http-403'
    | 'invalid-token'
    | 'invalid-cred'
    | 'captcha-required'
    | 'server-rejected';

export class EndfieldAuthError extends Error {
    readonly reason: EndfieldAuthFailureReason;
    readonly details?: unknown;

    constructor(reason: EndfieldAuthFailureReason, message: string, details?: unknown) {
        super(message);
        this.name = 'EndfieldAuthError';
        this.reason = reason;
        this.details = details;
    }
}

export type EndfieldTrackerSubscriber = (data: PositionResponse['data']) => void;

export type EndfieldTrackerOptions = {
    roleId: string;
    serverId: number;
    cred: string;
    token: string;
    baseUrl?: string;
    intervalMs?: number;
    maxBackoffMs?: number;
    pauseWhenHidden?: boolean;
    debug?: boolean;
    onError?: (error: unknown) => void;
};
