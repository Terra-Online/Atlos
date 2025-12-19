// Helper: map Map's currentRegionKey (e.g. Valley_4) -> locale region code (e.g. VL)
export const mapRegionKeyToLocaleCode = (mapRegionKey: string | null | undefined): string | null => {
    if (!mapRegionKey) return null;
    // Current known regions:
    // - Valley_4 -> VL
    // - Wuling   -> WL
    // - Dijiang  -> DJ
    if (mapRegionKey === 'Valley_4') return 'VL';
    if (mapRegionKey === 'Wuling') return 'WL';
    if (mapRegionKey === 'Dijiang') return 'DJ';
    return null;
};
