import type { EFTrackerScope } from '@/utils/endfield/config';
import { MARKER_TYPE_DICT, type IMarkerType } from '@/data/marker';

export type LocatorReminderRule = string;

export type LocatorReminderStrategy = {
    include: LocatorReminderRule[];
    exclude: LocatorReminderRule[];
};

type MarkerTypeWithTier = IMarkerType & {
    tier?: string;
};

const COMMON_MOB_RULES: LocatorReminderRule[] = Object.values(MARKER_TYPE_DICT)
    .filter((typeInfo): typeInfo is MarkerTypeWithTier =>
        typeInfo.category.sub === 'mob'
        && (typeInfo as MarkerTypeWithTier).tier?.toLowerCase() === 'common',
    )
    .map((typeInfo) => `mob.${typeInfo.key}`);

export const LOCATOR_REMINDER_STRATEGIES = {
    auto: {
        include: [
            'collection.*',
            'archives.*',
            'exploration.*',
            'mob.*',
        ],
        exclude: [
            'collection.protocol_dl',
            'collection.protocol_dl_ii',
            'collection.gear_template',
            ...COMMON_MOB_RULES,
        ],
    },
    collection: {
        include: [
            'collection.*',
            'archives.*',
            'exploration.*',
        ],
        exclude: [],
    },
    enemy: {
        include: [
            'mob.*',
            'boss.*',
        ],
        exclude: [],
    },
} satisfies Record<EFTrackerScope, LocatorReminderStrategy>;

export const LOCATOR_REMINDER_SCOPE_OPTIONS = Object.keys(
    LOCATOR_REMINDER_STRATEGIES,
) as EFTrackerScope[];
