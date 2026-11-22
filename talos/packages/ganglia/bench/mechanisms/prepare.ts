import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual, parseArgs } from 'node:util';

import { parseInputIndex } from '#@/bench/mechanisms/input-index.ts';
import { readSuite, type Suite } from '#@/bench/mechanisms/suite.ts';
import type { Vec3 } from '#@/src/geometry.ts';
import { physicalTileSpan } from '#@/src/model/coverage.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));

export function inputGroups(suite: Suite) {
  return parseInputIndex({
    inputs: Object.fromEntries(
      [...new Set(suite.scenarios.map(({ setup }) => setup.input.scene))].map((scene) => [
        scene,
        { directory: `scenes/${scene}` },
      ]),
    ),
  });
}

function sceneBounds(suite: Suite, scene: string, ground: unknown) {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  const include = (x: number, z: number) => {
    bounds[0] = Math.min(bounds[0], x);
    bounds[1] = Math.min(bounds[1], z);
    bounds[2] = Math.max(bounds[2], x);
    bounds[3] = Math.max(bounds[3], z);
  };
  for (const {
    setup: { input },
  } of suite.scenarios) {
    if (input.scene !== scene || input.kind !== 'frozen-window') continue;
    include(input.bounds[0], input.bounds[1]);
    include(input.bounds[2], input.bounds[3]);
  }
  if (
    suite.scenarios.some(
      ({ setup }) => setup.input.scene === scene && setup.input.kind === 'dynamic',
    )
  ) {
    const data = ground as { surfaces: { vertices: Vec3[] }[] };
    for (const surface of data.surfaces) for (const [x, , z] of surface.vertices) include(x, z);
    // Covers the benchmark corridor margin and its independent 32 m rounding.
    for (let i = 0; i < 4; i++) bounds[i] += (i < 2 ? -2 : 2) * physicalTileSpan;
  }
  return bounds;
}

export async function prepareNavigation(extractor: string, routing: string, scene: string) {
  const read = async (name: string) => JSON.parse(await readFile(resolve(routing, name), 'utf8'));
  const navigation = await read(`${scene}-navmesh.json`);
  if (navigation.partial) throw new Error(`Partial navigation: ${scene}`);
  const movement = await read('movement-settings-current.json');
  // The accepted terminal snapshots enable map01 states 1, 4, 5, 8, 11 and
  // map02 states 2, 4, 7, 9, 10. State 0 is the shared base, and each
  // enabled state's one-based index selects a bit in the navigation mask.
  const terminalMasks: Record<string, string> = { map01: '1177', map02: '842' };
  const mask = Object.hasOwn(terminalMasks, scene) ? terminalMasks[scene] : undefined;
  if (!mask) throw new Error(`No terminal navigation recipe for ${scene}`);
  const navigationState = Object.fromEntries(
    Array.from({ length: 8 }, (_, i) => [`bucket${i}`, i === 0 ? mask : '0']),
  );
  const request = {
    release: movement.source.buildGuid,
    state: `${scene}-terminal-completed`,
    progression: 'completed',
    assets: navigation.assets.map((asset: { asset: string }) => asset.asset),
    navigationState,
    areas: [0],
    speed: 5,
    maxVertical: 0.5,
    arrivals: [],
    targets: [],
  };
  const { groundData } = (await import(
    pathToFileURL(resolve(extractor, 'packages/extractor/src/game/ground-data.ts')).href
  )) as {
    groundData(
      nav: unknown,
      walls: unknown,
      request: unknown,
      inputs: { movement: unknown },
    ): unknown;
  };
  const ground = groundData(navigation, await read(`${scene}-air-walls.json`), request, {
    movement,
  });
  await writeFile(
    resolve(routing, `${scene}-ground-all.json`),
    JSON.stringify({ version: 1, ...(ground as object) }),
  );
}

export async function main() {
  const { values } = parseArgs({
    options: {
      config: { type: 'string' },
      output: { type: 'string' },
      extractor: { type: 'string', default: resolve(root, '../../.cache/noclip') },
      suite: { type: 'string', default: resolve(root, 'bench/scenes/mechanisms/suite.json') },
      plan: { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log(
      'Usage: pnpm benchmark:prepare-mechanisms --config <private-config.json> --output <new-directory> [--extractor <prepared-noclip>] [--plan]',
    );
    return;
  }
  if (!values.config || !values.output)
    throw new Error('Provide --config and a new --output directory');
  const suite = await readSuite(values.suite);
  const index = inputGroups(suite);
  const output = resolve(values.output);
  const extractor = resolve(values.extractor);
  const config = resolve(values.config);
  const cli = resolve(extractor, 'packages/extractor/src/cli.ts');
  if (values.plan) {
    console.log(
      JSON.stringify(
        {
          source: suite.source,
          cases: suite.cases.length,
          index,
          exports: [
            'movement-settings',
            'navmesh',
            'air-walls',
            'traversal-devices',
            'interaction-points',
            'player-scene',
          ],
          output,
        },
        null,
        2,
      ),
    );
    return;
  }
  await readFile(config);
  await mkdir(dirname(output), { recursive: true });
  // A failed export remains inspectable in its own output directory.
  await mkdir(output);
  const routing = resolve(output, 'routing');
  await mkdir(routing);
  const run = (args: string[]) => {
    const result = spawnSync(process.execPath, [cli, ...args, '--config', config], {
      cwd: extractor,
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(`Exporter failed: ${args[0]} (${result.signal ?? result.status})`);
  };
  const read = async (name: string) => JSON.parse(await readFile(resolve(routing, name), 'utf8'));
  const checkSource = (value: { source: unknown }, name: string) => {
    if (!isDeepStrictEqual(value.source, suite.source))
      throw new Error(`Game build differs from suite: ${name}`);
  };
  run(['movement-settings', '-o', resolve(routing, 'movement-settings-current.json')]);
  const movement = await read('movement-settings-current.json');
  checkSource(movement, 'movement');
  for (const [scene, entry] of Object.entries(index.inputs)) {
    const source = suite.sources[scene];
    if (
      !isDeepStrictEqual(movement.defaultProfile, source.profile) ||
      !isDeepStrictEqual(movement.sustainedSprint, source.locomotion)
    )
      throw new Error(`Movement/profile differs from suite: ${scene}`);
    for (const command of ['navmesh', 'air-walls', 'traversal-devices', 'interaction-points']) {
      const name = `${scene}-${command}.json`;
      run([command, scene, '-o', resolve(routing, name)]);
      checkSource(await read(name), name);
    }
    await prepareNavigation(extractor, routing, scene);
    const bounds = sceneBounds(suite, scene, await read(`${scene}-ground-all.json`));
    run([
      'player-scene',
      scene,
      `--bounds=${bounds.join(',')}`,
      '--movement-settings',
      resolve(routing, 'movement-settings-current.json'),
      '--static-supports',
      resolve(routing, `${scene}-traversal-devices.json`),
      '--output',
      resolve(output, entry.directory),
    ]);
    await Promise.all(
      ['navmesh', 'air-walls'].map((name) => unlink(resolve(routing, `${scene}-${name}.json`))),
    );
  }
  // Publish the index only when all declared roots have finished exporting.
  const pending = resolve(output, 'input-index.json.tmp');
  await writeFile(pending, JSON.stringify(index, null, 2) + '\n');
  await rename(pending, resolve(output, 'input-index.json'));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
