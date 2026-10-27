import { useAuthStore } from '@/store/auth';
import { useUiPrefsStore } from '@/store/uiPrefs';
import { type EFRoleOption } from '@/services/endfield';
import {
    readEFTrackerConf,
    saveEFTrackerConf,
    type EFTrackerConf,
} from '@/services/endfield';
import { setCachedBinding } from '@/services/cache/backend';
import {
    inferLocatorAccountModeFromBaseUrl,
    type LocatorAccountMode,
} from '@/pages/locator/endfieldHosts';
import { useLocatorStore } from '@/store/locator';
import { loadBindingStatus } from './bindingStatus';

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
        centerOnPosition: current?.centerOnPosition ?? false,
        trail: current?.trail ?? false,
        debug: current?.debug ?? false,
        intervalMs: current?.intervalMs,
    };
    saveEFTrackerConf(next);
    useUiPrefsStore.getState().setPrefsLocatorSyncEnabled(true);
    useLocatorStore.getState().setViewMode('tracking');
};

let activation = 0;
let activationController: AbortController | null = null;

export const enableSession = async (isOwnerCurrent: () => boolean = () => true, signal?: AbortSignal): Promise<boolean | undefined> => {
    if (!isOwnerCurrent()) return undefined;
    const version = useAuthStore.getState().sessionVersion;
    const request = ++activation;
    const isCurrent = () => request === activation && useAuthStore.getState().sessionVersion === version && isOwnerCurrent();
    activationController?.abort();
    const controller = new AbortController();
    activationController = controller;
    const abort = () => { controller.abort(); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const unsubscribe = useAuthStore.subscribe((state) => {
        if (state.sessionVersion !== version) abort();
    });
    const status = await loadBindingStatus(controller.signal).catch((error: unknown) => {
        if (controller.signal.aborted || !isCurrent()) return null;
        throw error;
    }).finally(() => {
        unsubscribe();
        signal?.removeEventListener('abort', abort);
        if (activationController === controller) activationController = null;
    });
    // Cancellation is distinct from an unbound account; callers must not open
    // the binding flow after a cancelled activation finishes.
    if (!status || !isCurrent()) return undefined;
    const current = readEFTrackerConf();
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
        centerOnPosition: current?.centerOnPosition ?? false,
        trail: current?.trail ?? false,
        debug: current?.debug ?? false,
    });
    useUiPrefsStore.getState().setPrefsLocatorSyncEnabled(true);
    useLocatorStore.getState().setViewMode('tracking');
    return true;
};

export const disableSession = (): void => {
    ++activation;
    activationController?.abort();
    activationController = null;
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
