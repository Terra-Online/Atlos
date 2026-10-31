import { afterEach, expect, it } from 'vitest';
import { LOCATOR_CONFIG_KEY, readEFTrackerConf, saveEFTrackerConf } from './config';

afterEach(() => localStorage.removeItem(LOCATOR_CONFIG_KEY));

it('keeps locator preferences and polling interval when reading and resaving old configuration', () => {
    localStorage.setItem(LOCATOR_CONFIG_KEY, JSON.stringify({ enabled: true, locatorSync: true,
        baseUrl: 'skport', roleId: 'role', serverId: 1, scope: ['auto', 'enemy'], trackPoints: false,
        centerOnPosition: true, intervalMs: 1700, trail: true, debug: true }));
    const config = readEFTrackerConf();
    expect(config).toEqual({ enabled: true, locatorSync: true, baseUrl: 'skport', roleId: 'role', serverId: 1,
        scope: ['balanced', 'manual'], trackPoints: false, centerOnPosition: true, intervalMs: 1700 });
    saveEFTrackerConf(config!);
    expect(JSON.parse(localStorage.getItem(LOCATOR_CONFIG_KEY)!)).toEqual(config);
});
