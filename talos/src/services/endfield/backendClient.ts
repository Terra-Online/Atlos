import { getAuthBase } from '@/services/http/authRuntime';
import { requestJson as requestHttpJson } from '@/services/http/request';
import type { PositionResponse } from './types';

export type EFProvider = 'skland' | 'skport';

export type EFRoleOption = {
    serverId: number;
    roleId: string;
    nickname: string;
    level: number;
    serverType: string;
    serverName: string;
    isDefault: boolean;
};

export type EFBindingSummary = {
    bound: boolean;
    enabled: boolean;
    provider?: EFProvider;
    serverId?: number;
    roleId?: string;
    nickname?: string;
    serverName?: string;
    updatedAt?: string;
};

export type AgreeRes = {
    ok?: true;
    code?: number;
    message?: string;
    timestamp?: string;
};

export type EFPositionEnvelope = {
    data: PositionResponse['data'];
    binding?: EFBindingSummary;
    socketTicket?: string;
};

export type EFOfficialMarksResponse = {
    binding: EFBindingSummary;
    timestamp?: string;
    markedIds: string[];
    pointIds: string[];
    markers: Array<{
        id: string;
        isUserMarked: boolean;
    }>;
    raw?: unknown;
};

export type EFPositionSocketMessage =
    | ({ type: 'position' } & EFPositionEnvelope)
    | {
        type: 'status';
        status: 'connecting' | 'connected' | 'reconnecting';
        reason?: string;
    }
    | {
        type: 'error';
        error: {
            status?: number;
            code?: string;
            message?: string;
            details?: unknown;
        };
    };

type ApiErrorPayload = {
    code?: string;
    message?: string;
    details?: unknown;
    upstreamCode?: unknown;
    upstreamMessage?: unknown;
    error?: {
        code?: string;
        message?: string;
        details?: unknown;
        upstreamCode?: unknown;
        upstreamMessage?: unknown;
    };
};

const BINDING_API_BASE = `${getAuthBase()}/binding/v1/endfield`;
const LOCATOR_API_BASE = `${getAuthBase()}/locator`;
const SYNC_API_BASE = `${getAuthBase()}/sync/v1`;
const BINDING_STATUS_MEMORY_TTL_MS = 3_000;

type EFBindingStatusResponse = { binding: EFBindingSummary };

let bindingStatusInFlight: Promise<EFBindingStatusResponse> | null = null;
let bindingStatusMemoryCache: {
    expiresAt: number;
    value: EFBindingStatusResponse;
} | null = null;

export class EFBackendError extends Error {
    readonly status: number;
    readonly code: string;
    readonly details?: unknown;

    constructor(message: string, options: { status: number; code: string; details?: unknown }) {
        super(message);
        this.name = 'EFBackendError';
        this.status = options.status;
        this.code = options.code;
        this.details = options.details;
    }
}

const readApiError = async (response: Response): Promise<EFBackendError> => {
    try {
        const payload = await response.json() as ApiErrorPayload & { error?: { details?: unknown } };
        const code = payload.code || payload.error?.code || `HTTP_${response.status}`;
        const message = payload.message || payload.error?.message || code;
        const details = payload.error?.details
            ?? payload.details
            ?? (payload.error?.upstreamCode !== undefined || payload.error?.upstreamMessage !== undefined ? payload.error : undefined)
            ?? (payload.upstreamCode !== undefined || payload.upstreamMessage !== undefined ? payload : undefined)
            ?? payload.error;
        return new EFBackendError(message, {
            status: response.status,
            code,
            details,
        });
    } catch {
        return new EFBackendError(`HTTP ${response.status}`, {
            status: response.status,
            code: `HTTP_${response.status}`,
        });
    }
};

async function requestJson<T>(baseUrl: string, path: string, init?: RequestInit): Promise<T> {
    return requestHttpJson(baseUrl, path, init, readApiError);
}

export const getEFBindingStatus = (): Promise<{ binding: EFBindingSummary }> =>
    getEFBindingStatusCached();

const clearBindingStatusMemoryCache = (): void => {
    bindingStatusMemoryCache = null;
    bindingStatusInFlight = null;
};

function getEFBindingStatusCached(): Promise<EFBindingStatusResponse> {
    const now = Date.now();
    if (bindingStatusMemoryCache && bindingStatusMemoryCache.expiresAt > now) {
        return Promise.resolve(bindingStatusMemoryCache.value);
    }

    if (bindingStatusInFlight) {
        return bindingStatusInFlight;
    }

    bindingStatusInFlight = requestJson<EFBindingStatusResponse>(BINDING_API_BASE, '/status')
        .then((value) => {
            bindingStatusMemoryCache = {
                expiresAt: Date.now() + BINDING_STATUS_MEMORY_TTL_MS,
                value,
            };
            return value;
        })
        .finally(() => {
            bindingStatusInFlight = null;
        });

    return bindingStatusInFlight;
}

export const exchangeEFToken = (provider: EFProvider, token: string): Promise<{ flowId: string; roles: EFRoleOption[] }> =>
    requestJson(BINDING_API_BASE, '/exchange-token', {
        method: 'POST',
        body: JSON.stringify({ provider, token }),
    });

export const bindEFRole = async (flowId: string, role: { serverId: number; roleId: string }): Promise<{ ok: true; binding: EFBindingSummary }> => {
    clearBindingStatusMemoryCache();
    const result = await requestJson<{ ok: true; binding: EFBindingSummary }>(BINDING_API_BASE, '/bind-role', {
        method: 'POST',
        body: JSON.stringify({
            flowId,
            serverId: role.serverId,
            roleId: role.roleId,
        }),
    });
    clearBindingStatusMemoryCache();
    return result;
};

export const disableEFBinding = async (): Promise<{ ok: true; binding: EFBindingSummary }> => {
    clearBindingStatusMemoryCache();
    const result = await requestJson<{ ok: true; binding: EFBindingSummary }>(BINDING_API_BASE, '/disable', {
        method: 'POST',
        body: '{}',
    });
    clearBindingStatusMemoryCache();
    return result;
};

export const unlinkEFBinding = async (): Promise<{ ok: true; binding: EFBindingSummary }> => {
    clearBindingStatusMemoryCache();
    const result = await requestJson<{ ok: true; binding: EFBindingSummary }>(BINDING_API_BASE, '/unlink', {
        method: 'POST',
        body: '{}',
    });
    clearBindingStatusMemoryCache();
    return result;
};

export const agreePolicy = (role?: { roleId?: string; serverId?: number | string }): Promise<AgreeRes> =>
    requestJson(LOCATOR_API_BASE, '/agree-policy', {
        method: 'POST',
        body: JSON.stringify(role?.roleId && role.serverId !== undefined
            ? {
                roleId: role.roleId,
                serverId: String(role.serverId),
            }
            : {}),
    });

export const getEFPosition = (options: {
    includeBinding?: boolean;
    includeSocketTicket?: boolean;
} = {}): Promise<{
    data: PositionResponse['data'];
    binding?: EFBindingSummary;
    socketTicket?: string;
}> => {
    const search = new URLSearchParams();
    if (options.includeBinding) search.set('binding', '1');
    if (options.includeSocketTicket) search.set('socket_ticket', '1');
    const query = search.toString();
    const path = query ? `/position?${query}` : '/position';
    return requestJson(LOCATOR_API_BASE, path);
};

export const getEFOfficialMarks = (): Promise<EFOfficialMarksResponse> =>
    requestJson(SYNC_API_BASE, '/official');

export const openEFPositionSocket = (options: {
    includeBinding?: boolean;
    socketTicket?: string | null;
} = {}): WebSocket => {
    const url = new URL(`${LOCATOR_API_BASE}/position-stream`);
    if (options.includeBinding) url.searchParams.set('binding', '1');
    if (options.socketTicket) url.searchParams.set('ticket', options.socketTicket);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return new WebSocket(url.toString());
};
