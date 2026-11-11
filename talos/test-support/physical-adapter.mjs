import { URL } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Run the fixture's synthetic solver through the same resource-adapter seam
 * as a real worker, while keeping its ground-export CLI available. */
export async function writePhysicalAdapter(extractor) {
    const source = join(extractor, 'packages/extractor/src');
    const cli = await readFile(join(source, 'cli.ts'), 'utf8');
    const imports = cli.match(/^\s*import[^;]+;/gm) ?? [];
    const body = cli
        .replace(/^\s*import[^;]+;/gm, '')
        .replaceAll('process.argv', 'argv')
        .replaceAll('process.exit(0);', 'return;')
        .replaceAll('console.log(', 'progress(');
    await mkdir(join(source, 'game'), { recursive: true });
    await writeFile(
        join(source, 'game/physical-input.ts'),
        `${imports.join('\n')}
export {physicalFiles} from ${JSON.stringify(new URL('../.cache/noclip/packages/extractor/src/game/physical-input.ts', import.meta.url).href)};
export const runPhysicalFiles=async(files,context)=>{
    const argv=['node','cli','player-route',...Object.entries(files).flatMap(([key,value])=>value===undefined?[]:key==='effort'?value==='walking'?['--ground-only']:value==='devices'?['--devices-only']:[]:[key==='output'?'-o':key==='movement'?'--movement-settings':'--'+key,String(value)])];
    const progress=text=>context.progress(JSON.parse(text));
    ${body}
};\n`,
    );
}
