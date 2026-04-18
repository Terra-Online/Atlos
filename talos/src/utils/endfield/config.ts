export type EndfieldTrackerConfig = {
    enabled: boolean;
    baseUrl: string;
    roleId: string;
    serverId: number;
    locatorSync: boolean;
    intervalMs?: number;
    debug?: boolean;
    offsetX?: number;
    offsetZ?: number;
    scaleX?: number;
    scaleZ?: number;
};

export const ENDFIELD_TRACKER_CONFIG_KEY = 'endfield.tracker.config';
export const ENDFIELD_TRACKER_CONFIG_UPDATED_EVENT = 'endfield:tracker-config-updated';

export const readEndfieldTrackerConfig = (): EndfieldTrackerConfig | null => {
    const raw = localStorage.getItem(ENDFIELD_TRACKER_CONFIG_KEY);
    if (!raw) return null;

    try {
        const parsed = JSON.parse(raw) as Partial<EndfieldTrackerConfig>;
        if (!parsed.baseUrl || !parsed.roleId || parsed.serverId === undefined || parsed.serverId === null) {
            return null;
        }

        return {
            enabled: parsed.enabled ?? false,
            baseUrl: parsed.baseUrl,
            roleId: parsed.roleId,
            serverId: Number(parsed.serverId),
            locatorSync: parsed.locatorSync ?? false,
            intervalMs: parsed.intervalMs,
            debug: parsed.debug ?? false,
            offsetX: parsed.offsetX,
            offsetZ: parsed.offsetZ,
            scaleX: parsed.scaleX,
            scaleZ: parsed.scaleZ,
        };
    } catch {
        return null;
    }
};

export const saveEndfieldTrackerConfig = (config: EndfieldTrackerConfig): void => {
    localStorage.setItem(ENDFIELD_TRACKER_CONFIG_KEY, JSON.stringify(config));
    window.dispatchEvent(new CustomEvent(ENDFIELD_TRACKER_CONFIG_UPDATED_EVENT));
};

export const removeEndfieldTrackerConfig = (): void => {
    localStorage.removeItem(ENDFIELD_TRACKER_CONFIG_KEY);
    window.dispatchEvent(new CustomEvent(ENDFIELD_TRACKER_CONFIG_UPDATED_EVENT));
};
