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

export type AgreeRes = {
    ok?: true;
    code?: number;
    message?: string;
    timestamp?: string;
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
    const hasBody = init?.body !== undefined && init.body !== null;
    const headers = {
        ...(hasBody ? { 'content-type': 'application/json' } : {}),
        ...(init?.headers ?? {}),
    };
    const response = await fetch(`${baseUrl}${path}`, {
        ...init,
        credentials: 'include',
        headers,
    });

    if (!response.ok) {
        throw await readApiError(response);
    }

    return response.json() as Promise<T>;
}

export const getEFBindingStatus = (): Promise<{ binding: EFBindingSummary }> =>
    requestJson(BINDING_API_BASE, '/status');

export const exchangeEFToken = (provider: EFProvider, token: string): Promise<{ flowId: string; roles: EFRoleOption[] }> =>
    requestJson(BINDING_API_BASE, '/exchange-token', {
        method: 'POST',
        body: JSON.stringify({ provider, token }),
    });

export const bindEFRole = (flowId: string, role: { serverId: number; roleId: string }): Promise<{ ok: true; binding: EFBindingSummary }> =>
    requestJson(BINDING_API_BASE, '/bind-role', {
        method: 'POST',
        body: JSON.stringify({
            flowId,
            serverId: role.serverId,
            roleId: role.roleId,
        }),
    });

export const disableEFBinding = (): Promise<{ ok: true; binding: EFBindingSummary }> =>
    requestJson(BINDING_API_BASE, '/disable', {
        method: 'POST',
        body: '{}',
    });

export const unlinkEFBinding = (): Promise<{ ok: true; binding: EFBindingSummary }> =>
    requestJson(BINDING_API_BASE, '/unlink', {
        method: 'POST',
        body: '{}',
    });

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

export const getEFPosition = (options: { includeBinding?: boolean } = {}): Promise<{ data: PositionResponse['data']; binding?: EFBindingSummary }> =>
    requestJson(LOCATOR_API_BASE, options.includeBinding ? '/position?binding=1' : '/position');
