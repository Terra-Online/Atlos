import { getSignature } from './crypto';
import { saveEndfieldSession } from './storage';
import { EndfieldAuthError, type EndfieldSession, type PositionResponse } from './types';

export type EndfieldClientOptions = {
    baseUrl: string;
    authBaseUrl?: string;
    fetchImpl?: typeof fetch;
};

export type EndfieldAccountProvider = 'skport' | 'skland';

type ApiEnvelope<T> = {
    code: number;
    message: string;
    timestamp: string;
    data: T;
};

type HypergryphEnvelope<T> = {
    status: number;
    msg: string;
    type?: string;
    data: T;
};

type EmailPasswordTokenData = {
    accountToken?: string;
    token?: string;
};

type PhoneCodeTokenData = {
    token: string;
    hgId?: string;
};

type OauthGrantData = {
    uid?: string;
    code: string;
    token: string;
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

    private async parseHypergryphEnvelope<T>(response: Response): Promise<HypergryphEnvelope<T>> {
        let json: HypergryphEnvelope<T> | null = null;

        try {
            json = (await response.json()) as HypergryphEnvelope<T>;
        } catch {
            throw new Error(`Failed to parse Hypergryph response (${response.status})`);
        }

        if (!response.ok) {
            throw new Error(json.msg || `HTTP ${response.status}`);
        }

        if (json.status !== 0) {
            throw new Error(json.msg || `Hypergryph API rejected request (${json.status})`);
        }

        return json;
    }

    private buildDeviceHeaders(deviceId: string): Record<string, string> {
        return {
            'x-deviceid': deviceId,
            'x-devicemodel': 'Chrome',
            'x-devicetype': '7',
            'x-osver': typeof navigator !== 'undefined' ? navigator.platform || 'Linux' : 'Linux',
        };
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

    async sendSklandPhoneCode(phone: string, deviceId: string): Promise<void> {
        const response = await this.fetchImpl(this.buildUrl('/general/v1/send_phone_code', this.authBaseUrl), {
            method: 'POST',
            headers: {
                accept: '*/*',
                'content-type': 'application/json;charset=UTF-8',
                ...this.buildDeviceHeaders(deviceId),
            },
            body: JSON.stringify({
                phone,
                type: 2,
            }),
        });

        await this.parseHypergryphEnvelope<Record<string, unknown>>(response);
    }

    async authenticateSklandByPhoneCode(args: {
        phone: string;
        verificationCode: string;
        deviceId: string;
        appCode?: string;
    }): Promise<EndfieldSession> {
        const appCode = args.appCode ?? 'endfield';

        const tokenResponse = await this.fetchImpl(this.buildUrl('/user/auth/v2/token_by_phone_code', this.authBaseUrl), {
            method: 'POST',
            headers: {
                accept: '*/*',
                'content-type': 'application/json;charset=UTF-8',
                ...this.buildDeviceHeaders(args.deviceId),
            },
            body: JSON.stringify({
                phone: args.phone,
                code: args.verificationCode,
                appCode,
            }),
        });

        const tokenEnvelope = await this.parseHypergryphEnvelope<PhoneCodeTokenData>(tokenResponse);

        const grantResponse = await this.fetchImpl(this.buildUrl('/user/oauth2/v2/grant', this.authBaseUrl), {
            method: 'POST',
            headers: {
                accept: '*/*',
                'content-type': 'application/json;charset=UTF-8',
                ...this.buildDeviceHeaders(args.deviceId),
            },
            body: JSON.stringify({
                token: tokenEnvelope.data.token,
                appCode,
                type: 0,
            }),
        });

        const grantEnvelope = await this.parseHypergryphEnvelope<OauthGrantData>(grantResponse);

        const timestamp = String(Math.floor(Date.now() / 1000));
        const credResponse = await this.fetchImpl(this.buildUrl('/web/v1/user/auth/generate_cred_by_code'), {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                did: args.deviceId,
                platform: '3',
                timestamp,
                vname: '1.0.0',
                'accept-language': 'en-US',
            },
            body: JSON.stringify({
                kind: 1,
                code: grantEnvelope.data.code,
            }),
        });

        const credEnvelope = await this.parseEnvelope<GenerateCredData>(credResponse);
        const session = {
            accountToken: tokenEnvelope.data.token,
            cred: credEnvelope.data.cred,
            token: credEnvelope.data.token,
        };
        saveEndfieldSession(session);
        return session;
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

export async function sendSklandPhoneCode(
    phone: string,
    deviceId: string,
    options: EndfieldClientOptions,
): Promise<void> {
    const client = new EndfieldBrowserClient(options);
    return client.sendSklandPhoneCode(phone, deviceId);
}

export async function authenticateEndfieldSession(
    args: {
        provider?: EndfieldAccountProvider;
        email?: string;
        password?: string;
        phone?: string;
        verificationCode?: string;
        deviceId?: string;
        appCode?: string;
        code?: string;
    },
    options: EndfieldClientOptions,
): Promise<EndfieldSession> {
    const client = new EndfieldBrowserClient(options);

    if (args.provider === 'skland') {
        if (!args.phone || !args.verificationCode || !args.deviceId) {
            throw new Error('Missing credentials: provide phone, verification code, and deviceId for SKLAND.');
        }
        return client.authenticateSklandByPhoneCode({
            phone: args.phone,
            verificationCode: args.verificationCode,
            deviceId: args.deviceId,
            appCode: args.appCode,
        });
    }

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
