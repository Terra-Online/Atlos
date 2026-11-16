import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual, parseArgs } from 'node:util';

import { readMechanismSuite, type MechanismSuite } from '#@/bench/mechanism-suite.ts';
import { exportPhysicalRegion } from '#@/bench/prepare-region.ts';

const root = fileURLToPath(new URL('../', import.meta.url));

export function inputGroups(suite: MechanismSuite) {
  const cases: Record<string, { directory: string }> = {};
  const groups = new Map<string, { scene: string; bounds?: number[] }>();
  for (const item of suite.cases) {
    const region = item.setup.physical
      ? suite.physicalRegions.find((r) => r.id === item.setup.physical!.region)
      : undefined;
    if (item.setup.physical && (!region || region.scene !== item.scene))
      throw new Error(`Missing or mismatched frozen region: ${item.id}`);
    const directory = `scenarios/${item.scene}-${region?.id ?? 'dynamic'}`;
    cases[item.id] = { directory };
    groups.set(directory, { scene: item.scene, bounds: region?.bounds });
  }
  return { cases, groups };
}

async function main() {
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
  const suite = await readMechanismSuite(values.suite);
  const { cases, groups } = inputGroups(suite);
  const output = resolve(values.output);
  const extractor = resolve(values.extractor);
  const config = resolve(values.config);
  const cli = resolve(extractor, 'packages/extractor/src/cli.ts');
  if (values.plan) {
    console.log(
      JSON.stringify(
        {
          source: suite.source,
          cases: Object.keys(cases).length,
          groups: [...groups],
          exports: [
            'movement-settings',
            'navmesh',
            'air-walls',
            'traversal-devices',
            'interaction-points',
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
  const receipt = JSON.parse(await readFile(resolve(extractor, '.generated.json'), 'utf8'));
  await mkdir(dirname(output), { recursive: true });
  // A failed export remains inspectable, but never publishes a usable input index.
  await mkdir(output);
  const routing = resolve(output, 'routing');
  await mkdir(routing);
  const commands: string[][] = [];
  const run = (args: string[]) => {
    commands.push(args);
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
  for (const [scene, source] of Object.entries(suite.sources)) {
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
    const navigation = await read(`${scene}-navmesh.json`);
    if (navigation.partial) throw new Error(`Partial navigation: ${scene}`);
    // This recipe binds a new candidate dataset. It does not claim to recreate
    // a missing historical export byte-for-byte or reuse its performance score.
    const request = {
      release: 'mechanism-service-candidate',
      state: 'completed-level-tasks-player-ground-v1',
      progression: 'fully-enabled',
      assets: navigation.assets.map((a: { asset: string }) => a.asset),
      areas: scene === 'map01' ? [0] : [0, 10],
      speed: 5,
      maxVertical: 0.5,
      arrivals: [],
      targets: [],
    };
    if (!['map01', 'map02'].includes(scene)) throw new Error(`No navigation recipe for ${scene}`);
    await writeFile(resolve(routing, `${scene}-request.json`), JSON.stringify(request));
    const ground = groundData(navigation, await read(`${scene}-air-walls.json`), request, {
      movement,
    });
    await writeFile(
      resolve(routing, `${scene}-ground-all.json`),
      JSON.stringify({ version: 1, ...(ground as object) }),
    );
  }
  for (const [directory, group] of groups) {
    const dataRoot = resolve(output, directory);
    await mkdir(dataRoot, { recursive: true });
    await symlink(relative(dataRoot, routing), resolve(dataRoot, 'routing'), 'dir');
    if (group.bounds)
      await exportPhysicalRegion(
        {
          dataRoot,
          extractor,
          config,
          devices: resolve(routing, `${group.scene}-traversal-devices.json`),
        },
        {
          scene: group.scene,
          source: suite.source as { buildGuid: string; contentHash: string },
          bounds: group.bounds,
          tiles: [],
        },
      );
  }
  const files: Record<string, string> = {};
  const visit = async (directory: string) => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name, 'en'),
    )) {
      const file = resolve(directory, entry.name);
      if (entry.name === 'cache' || entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await visit(file);
      else {
        const hash = createHash('sha256');
        for await (const chunk of createReadStream(file)) hash.update(chunk);
        files[relative(output, file)] = hash.digest('hex');
      }
    }
  };
  await visit(output);
  const binding = {
    schema: 1,
    recipe: 'mechanism-service-v1',
    suiteSha256: createHash('sha256')
      .update(await readFile(values.suite))
      .digest('hex'),
    source: suite.source,
    profiles: Object.fromEntries(
      Object.entries(suite.sources).map(([scene, source]) => [scene, source.profile]),
    ),
    extractor: receipt,
    commands,
    files,
    cases,
  };
  const revision = createHash('sha256').update(JSON.stringify(binding)).digest('hex');
  await writeFile(
    resolve(output, 'input-index.json'),
    JSON.stringify({ ...binding, revision }, null, 2),
    { flag: 'wx' },
  );
  console.log(JSON.stringify({ output, revision, cases: Object.keys(cases).length }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
