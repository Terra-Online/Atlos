import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, readdir, rename, rm, stat, statfs } from 'node:fs/promises';
import { resolve } from 'node:path';

import { physicalTileSpan } from '@opendfieldmap/ganglia/solver/host';

import type { RegionBuildRequest } from '#@/bench/scene-data.ts';

const GIB = 1024 * 1024 * 1024;

function parseBudgetGiB(envName: string, fallbackGiB: number) {
  const raw = process.env[envName];
  if (raw === undefined) return fallbackGiB * GIB;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed * GIB : fallbackGiB * GIB;
}

async function ensureDiskBudget(directory: string) {
  const minFreeBytes = parseBudgetGiB('GANGLIA_BENCHMARK_MIN_FREE_DISK_GB', 30);
  const maxDirBytes = parseBudgetGiB('GANGLIA_BENCHMARK_MAX_REGION_CACHE_GB', 12);
  const fsStats = await statfs(directory);
  const availBytes = fsStats.bavail * fsStats.bsize;
  if (availBytes < minFreeBytes) {
    throw new Error(
      `Refusing to export region: available disk ${(availBytes / GIB).toFixed(1)} GiB is below ${(minFreeBytes / GIB).toFixed(1)} GiB safety floor`,
    );
  }
  let dirBytes = 0;
  for (const name of await readdir(directory)) {
    const info = await stat(resolve(directory, name)).catch(() => null);
    if (info?.isFile()) dirBytes += info.size;
  }
  if (dirBytes >= maxDirBytes) {
    throw new Error(
      `Refusing to export region: ${directory} reached ${(dirBytes / GIB).toFixed(1)} GiB cap (limit ${(maxDirBytes / GIB).toFixed(1)} GiB)`,
    );
  }
}

export async function exportPhysicalRegion(
  options: { dataRoot: string; extractor: string; config: string; devices?: string },
  request: RegionBuildRequest,
) {
  const directory = resolve(options.dataRoot, `scene-${request.scene}/regions`);
  await mkdir(directory, { recursive: true });
  const digest = createHash('sha256').update(JSON.stringify(request)).digest('hex').slice(0, 16);
  const ground = resolve(directory, `${digest}.ground.json`);
  const collision = resolve(directory, `${digest}.collision.bin`);
  const exists = await Promise.all([
    access(ground).then(
      () => true,
      () => false,
    ),
    access(collision).then(
      () => true,
      () => false,
    ),
  ]);
  if (exists[0] && exists[1]) return { ground, collision };
  await ensureDiskBudget(directory);
  // An interrupted exporter must not leave a discoverable half-written region.
  const pending = resolve(directory, `.pending-${digest}-${randomUUID()}`);
  await mkdir(pending);
  const tiles = [...request.tiles];
  if (!tiles.length)
    for (
      let x = Math.floor(request.bounds[0] / physicalTileSpan);
      x < Math.ceil(request.bounds[2] / physicalTileSpan);
      x++
    )
      for (
        let z = Math.floor(request.bounds[1] / physicalTileSpan);
        z < Math.ceil(request.bounds[3] / physicalTileSpan);
        z++
      )
        tiles.push({ x, z });
  try {
    const args = [
      resolve(options.extractor, 'packages/extractor/src/cli.ts'),
      'player-ground',
      request.scene,
      `--bounds=${request.bounds.join(',')}`,
      '--terminal-scene',
      '--scene-state',
      '0',
      '--area',
      '0',
      `--tiles=${tiles.map(({ x, z }) => `${x},${z}`).join(';')}`,
      '--movement-settings',
      resolve(options.dataRoot, 'routing/movement-settings-current.json'),
      '--config',
      resolve(options.config),
      '--input-cache',
      resolve(options.dataRoot, 'cache/physical-inputs'),
      '--tile-cache',
      resolve(options.dataRoot, 'cache/physical-tiles'),
      '--output',
      resolve(pending, 'ground.json'),
      '--collision-output',
      resolve(pending, 'collision.bin'),
      '--collision-format',
      'v8',
      ...(options.devices ? ['--static-supports', options.devices] : []),
    ];
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, args, {
        cwd: options.extractor,
        stdio: ['ignore', 'pipe', 'inherit'],
      });
      child.stdout.pipe(process.stderr);
      child.once('error', reject);
      child.once('exit', (code, signal) => {
        if (code === 0) resolve();
        else reject(new Error(`player-ground failed (${signal ?? code})`));
      });
    });
    await rename(resolve(pending, 'collision.bin'), collision);
    await rename(resolve(pending, 'ground.json'), ground);
    return { ground, collision };
  } finally {
    await rm(pending, { recursive: true, force: true });
  }
}
