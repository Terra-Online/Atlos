import { getSignature } from './crypto';
import { saveEndfieldSession } from './storage';
import { EndfieldAuthError, type EndfieldSession, type PositionResponse } from './types';

export type EndfieldClientOptions = {
    baseUrl: string;
    authBaseUrl?: string;
    fetchImpl?: typeof fetch;
};

type ApiEnvelope<T> = {
    code: number;
    message: string;
    timestamp: string;
    data: T;
};

type EmailPasswordTokenData = {
    accountToken?: string;
    token?: string;
};

type GenerateCredData = {
    cred: string;
    token: string;
};

type BindingRole = {
    serverId: string;
    roleId: string;
    nickname: string;
    level: number;
    isDefault?: boolean;
    isBanned?: boolean;
    serverType?: string;
    serverName?: string;
};

type PlayerBindingData = {
    list?: Array<{
        appCode?: string;
        bindingList?: Array<{
            roles?: BindingRole[];
            defaultRole?: BindingRole;
        }>;
    }>;
};

export type EndfieldRoleOption = {
    serverId: number;
    roleId: string;
    nickname: string;
    level: number;
    serverType: string;
    serverName: string;
    isDefault: boolean;
};

export class EndfieldBrowserClient {
    private readonly baseUrl: string;
    private readonly authBaseUrl: string;
    private readonly fetchImpl: typeof fetch;

    constructor(options: EndfieldClientOptions) {
        this.baseUrl = options.baseUrl.replace(/\/$/, '');
        this.authBaseUrl = (options.authBaseUrl ?? options.baseUrl).replace(/\/$/, '');
        const boundFetch = globalThis.fetch.bind(globalThis);
        this.fetchImpl = options.fetchImpl ?? boundFetch;
    }

    private buildUrl(path: string, baseUrl = this.baseUrl): string {
        if (/^https?:\/\//.test(path)) return path;
        return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    }

    private async parseEnvelope<T>(response: Response): Promise<ApiEnvelope<T>> {
        let json: ApiEnvelope<T> | null = null;

        try {
            json = (await response.json()) as ApiEnvelope<T>;
        } catch {
            throw new Error(`Failed to parse API response (${response.status})`);
        }

        if (!response.ok) {
            if (response.status === 401) {
                throw new EndfieldAuthError('http-401', 'Authentication failed (401).');
            }
            if (response.status === 403) {
                throw new EndfieldAuthError('http-403', 'Authentication failed (403).');
            }
            throw new Error(json.message || `HTTP ${response.status}`);
        }

        if (json.code !== 0) {
            const lowerMessage = (json.message || '').toLowerCase();
            if (lowerMessage.includes('token')) {
                throw new EndfieldAuthError('invalid-token', json.message || 'Invalid token.');
            }
            if (lowerMessage.includes('cred')) {
                throw new EndfieldAuthError('invalid-cred', json.message || 'Invalid cred.');
            }
            throw new EndfieldAuthError('server-rejected', json.message || `API rejected request (${json.code})`);
        }

        return json;
    }

    async tokenByEmailPassword(email: string, password: string): Promise<string> {
        const response = await this.fetchImpl(
            this.buildUrl('/user/auth/v1/token_by_email_password', this.authBaseUrl),
            {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'accept-language': 'en-US',
            },
            body: JSON.stringify({ email, password }),
            },
        );

        const envelope = await this.parseEnvelope<EmailPasswordTokenData>(response);
        const accountToken = envelope.data.accountToken ?? envelope.data.token;
        if (!accountToken) {
            throw new Error('Auth succeeded but token is missing in response payload.');
        }
        return accountToken;
    }

    async getEndfieldRoleOptions(cred: string, token: string): Promise<EndfieldRoleOption[]> {
        const path = '/api/v1/game/player/binding?';
        const timestamp = String(Math.floor(Date.now() / 1000));
        const sign = await getSignature(path, timestamp, token, '');

        const response = await this.fetchImpl(this.buildUrl(path), {
            method: 'GET',
            headers: {
                accept: '*/*',
                cred,
                platform: '3',
                timestamp,
                vname: '1.0.0',
                sign,
                'accept-language': 'en-US',
                'sk-language': 'en',
            },
        });

        const envelope = await this.parseEnvelope<PlayerBindingData>(response);
        const endfieldEntry = (envelope.data.list ?? []).find((entry) => entry.appCode === 'endfield');
        const roles = endfieldEntry?.bindingList?.[0]?.roles ?? [];

        return roles
            .map((role): EndfieldRoleOption | null => {
                const serverId = Number(role.serverId);
                if (!role.roleId || !Number.isFinite(serverId)) return null;

                return {
                    serverId,
                    roleId: role.roleId,
                    nickname: role.nickname || 'Unknown',
                    level: role.level ?? 0,
                    serverType: role.serverType ?? '',
                    serverName: role.serverName ?? '',
                    isDefault: Boolean(role.isDefault),
                };
            })
            .filter((role): role is EndfieldRoleOption => Boolean(role));
    }

    async generateCredByCode(code: string): Promise<{ cred: string; token: string }> {
        const response = await this.fetchImpl(this.buildUrl('/web/v1/game/endfield/cred/by/code'), {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'accept-language': 'en-US',
            },
            body: JSON.stringify({ code }),
        });

        const envelope = await this.parseEnvelope<GenerateCredData>(response);
        return {
            cred: envelope.data.cred,
            token: envelope.data.token,
        };
    }

    async getMapMePositionBrowser(
        roleId: string,
        serverId: number,
        cred: string,
        token: string,
    ): Promise<PositionResponse> {
        const path = '/web/v1/game/endfield/map/me/position';
        const timestamp = String(Math.floor(Date.now() / 1000));
        const body = '';
        const sign = await getSignature(path, timestamp, token, body);
        const query = new URLSearchParams({
            roleId,
            serverId: String(serverId),
        });

        const response = await this.fetchImpl(`${this.buildUrl(path)}?${query.toString()}`, {
            method: 'GET',
            headers: {
                cred,
                platform: '3',
                timestamp,
                vname: '1.0.0',
                sign,
                'accept-language': 'en-US',
            },
        });

        return this.parseEnvelope<PositionResponse['data']>(response);
    }
}

export async function tokenByEmailPassword(
    email: string,
    password: string,
    options: EndfieldClientOptions,
): Promise<string> {
    const client = new EndfieldBrowserClient(options);
    return client.tokenByEmailPassword(email, password);
}

export async function generateCredByCode(
    code: string,
    options: EndfieldClientOptions,
): Promise<{ cred: string; token: string }> {
    const client = new EndfieldBrowserClient(options);
    return client.generateCredByCode(code);
}

export async function getMapMePositionBrowser(
    roleId: string,
    serverId: number,
    cred: string,
    token: string,
    options: EndfieldClientOptions,
): Promise<PositionResponse> {
    const client = new EndfieldBrowserClient(options);
    return client.getMapMePositionBrowser(roleId, serverId, cred, token);
}

export async function getEndfieldRoleOptions(
    cred: string,
    token: string,
    options: EndfieldClientOptions,
): Promise<EndfieldRoleOption[]> {
    const client = new EndfieldBrowserClient(options);
    return client.getEndfieldRoleOptions(cred, token);
}

export async function authenticateEndfieldSession(
    args: {
        email?: string;
        password?: string;
        code?: string;
    },
    options: EndfieldClientOptions,
): Promise<EndfieldSession> {
    const client = new EndfieldBrowserClient(options);

    if (args.code) {
        const generated = await client.generateCredByCode(args.code);
        const session = {
            accountToken: null,
            cred: generated.cred,
            token: generated.token,
        };
        saveEndfieldSession(session);
        return session;
    }

    if (!args.email || !args.password) {
        throw new Error('Missing credentials: provide code or email/password.');
    }

    const accountToken = await client.tokenByEmailPassword(args.email, args.password);
    const generated = await client.generateCredByCode(accountToken);
    const session = {
        accountToken,
        cred: generated.cred,
        token: generated.token,
    };
    saveEndfieldSession(session);
    return session;
}
