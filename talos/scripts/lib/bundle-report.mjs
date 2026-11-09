import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';

/** Opt-in build evidence; leaves emitted code and chunk boundaries untouched. */
export function bundleReport(app) {
    const directory = process.env.BUNDLE_REPORT_DIR;
    if (!directory) return null;
    return {
        name: 'atlos-bundle-report',
        async writeBundle(_options, bundle) {
            const files = Object.values(bundle).filter((entry) => entry.type === 'chunk' || /\.css$/.test(entry.fileName)).map((entry) => {
                const bytes = Buffer.from(entry.type === 'chunk' ? entry.code : entry.source);
                const row = { file: entry.fileName, raw: bytes.length, gzip: gzipSync(bytes).length,
                    brotli: brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length };
                if (entry.type === 'chunk') Object.assign(row, {
                    entry: entry.isEntry, imports: entry.imports, dynamicImports: entry.dynamicImports,
                    modules: Object.entries(entry.modules).map(([id, module]) => ({
                        id: id.replaceAll('\\', '/').replace(/^.*?\/talos\//, ''), renderedLength: module.renderedLength,
                    })),
                });
                return row;
            });
            await mkdir(directory, { recursive: true });
            await writeFile(path.join(directory, `${app}.json`), JSON.stringify({ app,
                compression: 'Per-file gzip defaults; Brotli quality 11. Module renderedLength is Rollup output before final chunk minification, not compressed attribution.', files }, null, 2) + '\n');
        },
    };
}
