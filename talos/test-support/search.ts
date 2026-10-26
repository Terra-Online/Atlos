// Mirrors the prebuilt index's tuple format, including grouped and unique hits,
// archive snippets, CJK text, and one malformed row to exercise the parser.
export const searchDocs = [
    ['ore-a', 'ore-a', 'ore', 'collection', 'Copper ore 铜矿石', 'copper ore 铜矿石', '', '', 'Valley_4', 'VL_A', '', '铜矿石'],
    ['ore-b', 'ore-b', 'ore', 'collection', 'Copper ore 铜矿石', 'copper ore 铜矿石', '', '', 'Wuling', 'WL_A', '', '铜矿石'],
    ['archive-a', 'archive-a', 'report', 'files', 'Field report', 'research report', 'Mineral studies', 'Mineral studies', 'Valley_4', 'VL_A', 'Field report\nCopper ore grows near the river. 铜矿石出现在河边。', '铜矿石'],
    ['invalid-row'],
];

export const markerTypes = {
    ore: { icon: 'copper_spot', category: { main: 'collection' } },
    report: { icon: 'report', ctgr: 'Mineral studies', category: { main: 'files' } },
};

const names: Record<string, string> = {
    'markerType.key.ore': 'Copper ore 铜矿石',
    'markerType.key.report': 'Field report',
    'markerType.FileCtgr.mineral_studies': 'Mineral studies',
    'region.VL.sub.A.name': 'Valley mine',
    'region.WL.sub.A.name': 'Wuling mine',
};
export const translateGame = (key: string) => names[key] ?? '';
