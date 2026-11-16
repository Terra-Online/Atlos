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
import {readFileSync as readFixtureResult} from 'node:fs';
export {physicalResources} from ${JSON.stringify(new URL('../.cache/noclip/packages/extractor/src/game/physical-input.ts', import.meta.url).href)};
export const preparePhysicalRoute=async(resources,request,context)=>({solve:async(options)=>{
    const input=${JSON.stringify(join('/private/tmp', 'physical-fixture-'))}+process.pid+'-request.json';
    const output=input+'-output.json';
    await (await import('node:fs/promises')).writeFile(input,JSON.stringify(request));
    const files={...resources,request:input,output};
    const argv=['node','cli','player-route',...Object.entries(files).flatMap(([key,value])=>value===undefined?[]:[key==='output'?'-o':key==='movement'?'--movement-settings':'--'+key,String(value)]),...(options.work.step===0?['--ground-only']:options.work.step===1?['--devices-only']:[])];
    let writes=Promise.resolve();
    const progress=text=>{const value=JSON.parse(text);if(value.phase==='ground-route'){const report=JSON.parse(readFixtureResult(output,'utf8'));writes=writes.then(()=>options.onResult(report)).then(()=>options.onProgress(value));return;} options.onProgress(value);};
    const execute=async()=>{${body}};
    try{await execute();await writes;const report=JSON.parse(await (await import('node:fs/promises')).readFile(output,'utf8'));await options.onResult(report);return report;}
    finally{await (await import('node:fs/promises')).rm(input,{force:true});await (await import('node:fs/promises')).rm(output,{force:true});}
}});\n`,
    );
}
