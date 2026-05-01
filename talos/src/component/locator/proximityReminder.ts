import { MARKER_TYPE_DICT, type IMarkerType } from '@/data/marker';
import type { EFTrackerScope } from '@/utils/endfield/config';
import { LOCATOR_REMINDER_STRATEGIES, type LocatorReminderRule } from './proximityReminderConfig';

type MarkerTypeWithName = IMarkerType & {
    name?: string;
};

const normalizeRuleToken = (value: string): string =>
    value.trim().toLowerCase().replace(/\s+/g, '_');

const markerTypePaths = (typeInfo: MarkerTypeWithName): string[][] => {
    const key = normalizeRuleToken(typeInfo.key);
    const name = typeInfo.name ? normalizeRuleToken(typeInfo.name) : key;
    const main = normalizeRuleToken(typeInfo.category.main);
    const sub = normalizeRuleToken(typeInfo.category.sub);

    return [
        [key],
        [name],
        [sub, key],
        [sub, name],
        [main, sub, key],
        [main, sub, name],
    ];
};

const ruleMatchesPath = (rule: LocatorReminderRule, path: string[]): boolean => {
    const parts = rule.split('.').map(normalizeRuleToken).filter(Boolean);
    if (parts.length !== path.length) return false;
    return parts.every((part, index) => part === '*' || part === path[index]);
};

const ruleMatchesType = (rule: LocatorReminderRule, typeInfo: MarkerTypeWithName): boolean =>
    markerTypePaths(typeInfo).some((path) => ruleMatchesPath(rule, path));

const strategyIncludesType = (scope: EFTrackerScope, typeInfo: MarkerTypeWithName): boolean => {
    const strategy = LOCATOR_REMINDER_STRATEGIES[scope];
    if (!strategy) return false;
    return strategy.include.some((rule) => ruleMatchesType(rule, typeInfo));
};

const strategyExcludesType = (scope: EFTrackerScope, typeInfo: MarkerTypeWithName): boolean => {
    const strategy = LOCATOR_REMINDER_STRATEGIES[scope];
    if (!strategy) return false;
    return strategy.exclude.some((rule) => ruleMatchesType(rule, typeInfo));
};

export const getLocatorReminderTypeKeys = (scopes: EFTrackerScope[]): string[] => {
    if (scopes.length === 0) return [];

    return Object.values(MARKER_TYPE_DICT)
        .filter((typeInfo) => {
            const markerType = typeInfo as MarkerTypeWithName;
            const included = scopes.some((scope) => strategyIncludesType(scope, markerType));
            if (!included) return false;

            return !scopes.every((scope) => strategyExcludesType(scope, markerType));
        })
        .map((typeInfo) => typeInfo.key);
};
