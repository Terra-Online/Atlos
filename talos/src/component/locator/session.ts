import { useAuthStore } from '@/store/auth';
import { useUiPrefsStore } from '@/store/uiPrefs';
import { getEFBindingStatus, type EFRoleOption } from '@/utils/endfield/backendClient';
import {
    readEFTrackerConf,
    saveEFTrackerConf,
    type EFTrackerConf,
} from '@/utils/endfield/config';
import { setCachedBinding } from '@/utils/backendCache';
import {
    inferLocatorAccountModeFromBaseUrl,
    type LocatorAccountMode,
} from './endfieldHosts';
import { useLocatorStore } from './state';

export const extractToken = (raw: string): string => {
    const trimmed = raw.trim();
    if (!trimmed) return '';

    try {
        const parsed = JSON.parse(trimmed) as {
            data?: {
                content?: unknown;
                accountToken?: unknown;
                token?: unknown;
            };
            content?: unknown;
            accountToken?: unknown;
            token?: unknown;
        };
        const content = parsed.data?.content
            ?? parsed.data?.accountToken
            ?? parsed.data?.token
            ?? parsed.content
            ?? parsed.accountToken
            ?? parsed.token;
        if (typeof content === 'string') return content.trim();
    } catch {
        const matched = trimmed.match(/"(?:content|accountToken|token)"\s*:\s*"([^"]+)"/);
        if (matched?.[1]) return matched[1].trim();
    }

    return trimmed;
};

export const cleanToken = (raw: string): string => {
    const trimmed = raw.trim();
    if (!trimmed) return raw;

    try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        if ('msg' in parsed) {
            const { msg: _msg, ...rest } = parsed;
            return JSON.stringify(rest);
        }
    } catch {
        return raw.replace(/,?\s*"msg"\s*:\s*"[^"]*"\s*/g, (match) => (match.trimStart().startsWith(',') ? '' : ''));
    }

    return raw;
};

const docsLang = (locale: string): string => {
    const normalized = locale.trim().toLowerCase();
    if (normalized === 'zh-hk') return '';
    if (normalized.startsWith('zh-cn')) return 'zh-cn';
    if (normalized.startsWith('ja')) return 'ja';
    if (normalized.startsWith('ko')) return 'ko';
    if (normalized.startsWith('en')) return 'en';
    return 'en';
};

export const docsUrl = (locale: string, slug: string): string => {
    const lang = docsLang(locale);
    const path = lang ? `/${encodeURIComponent(lang)}/docs/${slug}` : `/docs/${slug}`;
    return `https://blog.opendfieldmap.org${path}`;
};

export const applyRole = (
    accountMode: LocatorAccountMode,
    role: EFRoleOption,
): void => {
    const current = readEFTrackerConf();
    const next: EFTrackerConf = {
        enabled: true,
        locatorSync: true,
        baseUrl: accountMode,
        roleId: role.roleId,
        serverId: role.serverId,
        scope: current?.scope?.length ? current.scope : ['balanced'],
        trackPoints: current?.trackPoints ?? true,
        trail: current?.trail ?? false,
        debug: current?.debug ?? false,
        intervalMs: current?.intervalMs,
    };
    saveEFTrackerConf(next);
    useUiPrefsStore.getState().setPrefsLocatorSyncEnabled(true);
    useLocatorStore.getState().setViewMode('tracking');
};

export const enableSession = async (): Promise<boolean> => {
    const current = readEFTrackerConf();
    const status = await getEFBindingStatus();
    const sessionUser = useAuthStore.getState().sessionUser;
    if (sessionUser?.uid) {
        setCachedBinding(sessionUser.uid, status.binding);
    }
    if (!status.binding.bound || !status.binding.enabled || !status.binding.roleId || status.binding.serverId === undefined) {
        return false;
    }

    saveEFTrackerConf({
        ...(current ?? {}),
        enabled: true,
        locatorSync: true,
        baseUrl: status.binding.provider ?? current?.baseUrl ?? 'skport',
        roleId: status.binding.roleId,
        serverId: status.binding.serverId,
        scope: current?.scope?.length ? current.scope : ['balanced'],
        trackPoints: current?.trackPoints ?? true,
        trail: current?.trail ?? false,
        debug: current?.debug ?? false,
    });
    useUiPrefsStore.getState().setPrefsLocatorSyncEnabled(true);
    useLocatorStore.getState().setViewMode('tracking');
    return true;
};

export const disableSession = (): void => {
    const current = readEFTrackerConf();
    if (current) {
        saveEFTrackerConf({
            ...current,
            enabled: false,
            locatorSync: false,
        });
    }
    useUiPrefsStore.getState().setPrefsLocatorSyncEnabled(false);
    useLocatorStore.getState().setViewMode('off');
};

export const currentMode = (): LocatorAccountMode =>
    inferLocatorAccountModeFromBaseUrl(readEFTrackerConf()?.baseUrl);
