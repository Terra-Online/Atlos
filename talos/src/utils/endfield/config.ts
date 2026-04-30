export type EFTrackerScope = 'auto' | 'collection' | 'enemy';

export type EFTrackerConf = {
    enabled: boolean;
    baseUrl: string;
    roleId: string;
    serverId: number;
    locatorSync: boolean;
    scope?: EFTrackerScope[];
    trail?: boolean;
    intervalMs?: number;
    debug?: boolean;
};

export const LOCATOR_CONFIG_KEY = 'endfield.tracker.config';
export const LOCATOR_CONFIG_UPDATED_EVENT = 'endfield:tracker-config-updated';

export const readEFTrackerConf = (): EFTrackerConf | null => {
    const raw = localStorage.getItem(LOCATOR_CONFIG_KEY);
    if (!raw) return null;

    try {
        const parsed = JSON.parse(raw) as Partial<EFTrackerConf>;
        if (!parsed.baseUrl || !parsed.roleId || parsed.serverId === undefined || parsed.serverId === null) {
            return null;
        }

        return {
            enabled: parsed.enabled ?? false,
            baseUrl: parsed.baseUrl,
            roleId: parsed.roleId,
            serverId: Number(parsed.serverId),
            locatorSync: parsed.locatorSync ?? false,
            scope: Array.isArray(parsed.scope)
                ? parsed.scope.filter((item): item is EFTrackerScope =>
                    item === 'auto' || item === 'collection' || item === 'enemy',
                )
                : undefined,
            trail: parsed.trail ?? false,
            intervalMs: parsed.intervalMs,
            debug: parsed.debug ?? false,
        };
    } catch {
        return null;
    }
};

export const saveEFTrackerConf = (config: EFTrackerConf): void => {
    localStorage.setItem(LOCATOR_CONFIG_KEY, JSON.stringify(config));
    window.dispatchEvent(new CustomEvent(LOCATOR_CONFIG_UPDATED_EVENT));
};

export const removeEFTrackerConf = (): void => {
    localStorage.removeItem(LOCATOR_CONFIG_KEY);
    window.dispatchEvent(new CustomEvent(LOCATOR_CONFIG_UPDATED_EVENT));
};
