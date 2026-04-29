import { getAuthBase } from '@/component/login/authFlow';
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

export type EFLocatorPosition = {
    mapX: number;
    mapZ: number;
    mode: string;
    regionKey: string | null;
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

const API_BASE = `${getAuthBase()}/binding/v1/endfield`;

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

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${API_BASE}${path}`, {
        ...init,
        credentials: 'include',
        headers: {
            'content-type': 'application/json',
            ...(init?.headers ?? {}),
        },
    });

    if (!response.ok) {
        throw await readApiError(response);
    }

    return response.json() as Promise<T>;
}

export const getEFBindingStatus = (): Promise<{ binding: EFBindingSummary }> =>
    requestJson('/status');

export const exchangeEFToken = (provider: EFProvider, token: string): Promise<{ flowId: string; roles: EFRoleOption[] }> =>
    requestJson('/exchange-token', {
        method: 'POST',
        body: JSON.stringify({ provider, token }),
    });

export const bindEFRole = (flowId: string, role: { serverId: number; roleId: string }): Promise<{ ok: true; binding: EFBindingSummary }> =>
    requestJson('/bind-role', {
        method: 'POST',
        body: JSON.stringify({
            flowId,
            serverId: role.serverId,
            roleId: role.roleId,
        }),
    });

export const disableEFBinding = (): Promise<{ ok: true; binding: EFBindingSummary }> =>
    requestJson('/disable', {
        method: 'POST',
        body: '{}',
    });

export const unlinkEFBinding = (): Promise<{ ok: true; binding: EFBindingSummary }> =>
    requestJson('/unlink', {
        method: 'POST',
        body: '{}',
    });

export const getEFPosition = (): Promise<{ data: PositionResponse['data']; locator: EFLocatorPosition; binding: EFBindingSummary }> =>
    requestJson('/position');
