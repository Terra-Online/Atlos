import { REGION_DICT, SUBREGION_DICT } from '@/data/map';

const REGION_I18N_CODE: Record<string, string> = {
    Valley_4: 'VL',
    Wuling: 'WL',
    Dijiang: 'DJ',
    Weekraid_1: 'ES',
};

export const getSubregionLabel = (
    subregionId: string,
    translateGame: (key: string) => string,
): string => {
    const regionKey = Object.entries(REGION_DICT).find(([, region]) => (
        region.subregions.includes(subregionId)
    ))?.[0];
    const regionCode = regionKey ? REGION_I18N_CODE[regionKey] : undefined;
    const subregionCode = SUBREGION_DICT[subregionId]?.name;
    if (!regionCode || !subregionCode) return subregionId;
    const translated = translateGame(`region.${regionCode}.sub.${subregionCode}.name`);
    return typeof translated === 'string' && translated.trim() ? translated : subregionId;
};
