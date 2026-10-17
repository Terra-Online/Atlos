import fs from 'node:fs/promises';
import path from 'node:path';
import { root, regions, uiCharacters } from './catalog.mjs';

const strings = (value) =>
    typeof value === 'string'
        ? value
        : Object.values(value || {})
              .map(strings)
              .join('');
const points = (range) =>
    range.split(',').map((span) => {
        const [start, end = start] = span.slice(2).split('-');
        return [parseInt(start, 16), parseInt(end, 16)];
    });
export const partsForText = (manifest, face, text) => {
    const chars = [...new Set([...text, ...text.normalize('NFC')])].map(
        (char) => char.codePointAt(0),
    );
    return Object.entries(manifest.faces[face] || {})
        .filter(([, part]) => {
            const spans = points(manifest.maps[part.map]);
            return chars.some((code) =>
                spans.some(([start, end]) => code >= start && code <= end),
            );
        })
        .map(([key]) => key);
};

// Conservative shell requirements are built from catalogs, never inferred from
// layout. Additional faces/content are requested by their owning components.
export async function requirements(manifests, app) {
    const ui = await uiCharacters();
    const result = {};
    for (const [region, locale] of Object.entries(regions)) {
        const manifest = manifests[region];
        if (!manifest) continue;
        const contentLocale = locale === 'zh-HK' ? 'zh-TW' : locale;
        const labels = (
            await Promise.all(
                [
                    `src/locale/data/game/${contentLocale}.json`,
                    `src/locale/data/region/${contentLocale}.json`,
                    `apps/intel/src/locale/data/game/${contentLocale}.json`,
                ].map(async (file) =>
                    strings(
                        JSON.parse(
                            await fs.readFile(path.join(root, file), 'utf8'),
                        ),
                    ),
                ),
            )
        ).join('');
        const uiParts = Object.fromEntries(
            Object.keys(manifest.faces).map((face) => [
                face,
                partsForText(manifest, face, ui[region]),
            ]),
        );
        const catalog = Object.fromEntries(
            Object.keys(manifest.faces).map((face) => [
                face,
                partsForText(manifest, face, ui[region] + labels),
            ]),
        );
        // The main sidebar ID card uses Regular from its first render;
        // include it here instead of discovering it after auth loads.
        const shellFaces =
            app === 'intel'
                ? ['db', 'r', 'h']
                : app === 'user-hub'
                  ? ['db', 'h']
                  : ['db', 'm', 'r', 'h'];
        // JP has no Harmony; retain its existing UD fallback.
        if (region === 'JP' && !shellFaces.includes('r')) shellFaces.push('r');
        // Intel's acquisition labels fall through Harmony to UD Medium in JP.
        if (region === 'JP' && app === 'intel') shellFaces.push('m');
        const shell = Object.fromEntries(
            shellFaces
                .filter((face) => manifest.faces[face])
                .map((face) => [
                    face,
                    partsForText(
                        manifest,
                        face,
                        ui[region] +
                            (app !== 'user-hub' &&
                            (face === 'db' || face === 'h')
                                ? labels
                                : ''),
                    ),
                ]),
        );
        result[region] = { ui: uiParts, catalog, shell };
    }
    return result;
}
