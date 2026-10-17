import { fileURLToPath } from 'node:url';
import {
    literalText,
    root,
    regions,
    uiCharacters,
} from './catalog-data.mjs';

export { literalText, root, regions, uiCharacters };
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const { checkFonts } = await import('./vite-plugin.mjs');
    if (process.env.ATLOS_SOURCE_ONLY !== '1') {
        const { manifests } = await checkFonts(root);
        const ui = await uiCharacters();
        for (const [region, characters] of Object.entries(ui)) {
            const coverage = new Set();
            const manifest = manifests[region];
            for (const face of Object.values(manifest.faces))
                for (const part of Object.values(face))
                    for (const range of manifest.maps[part.map].split(',')) {
                        const [start, end = start] = range
                            .slice(2)
                            .split('-')
                            .map((code) => parseInt(code, 16));
                        for (let point = start; point <= end; point++)
                            coverage.add(point);
                    }
            const missing = [...characters].filter(
                (char) => !coverage.has(char.codePointAt(0)),
            );
            console.log(
                `${region}: current UI checked; ${missing.length} characters use existing fallback fonts.`,
            );
        }
        console.log('Frozen font artifacts verified; no fonts regenerated.');
    }
}
