import { createHash } from 'node:crypto';
import { access, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { gangliaV1Defaults, type SolverConfig } from '@opendfieldmap/ganglia';

import { prepareCoverage, type CoveragePass } from '#@/bench/prepare-coverage.ts';
import { QUERY_SLO_MS } from '#@/bench/slo.ts';
import { prepareWorkerSolver } from '#@/bench/workers.ts';
import { readWorkload } from '#@/bench/workload.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({
  options: {
    help: { type: 'boolean' },
    config: { type: 'string' },
    workload: { type: 'string' },
    offset: { type: 'string', default: '0' },
    limit: { type: 'string' },
    'solver-config': { type: 'string' },
    scene: { type: 'string', default: 'map02' },
    'data-root': { type: 'string' },
    extractor: { type: 'string', default: resolve(root, '../../.cache/noclip') },
  },
});
if (values.help) {
  console.log(
    'Usage: node bench/prepare.ts --config <exporter-config> --workload <json-file | map02-long-range | map02-long-detours | map02-stress> [--offset <index>] [--limit <count>] [--scene <name; default map02>] [--data-root <path>] [--extractor <path>] [--solver-config <json-file>]. Builds missing physical regions through the real solver with batchConcurrency=1 and a hard 300-second per-query SLO. Timeouts count as failed routes. This is data preparation, not a performance run.',
  );
} else {
  try {
    if (!values.config || !values.workload)
      throw new Error('Preparation requires --config and --workload');
    const extractor = resolve(values.extractor);
    const configFile = resolve(values.config);
    const { cases: allCases, directory } = await readWorkload(values.workload);
    const dataRoot = values['data-root'] ?? resolve(root, '../../../.local/data', directory);
    const offset = Number(values.offset),
      count = Number(values.limit ?? allCases.length - offset);
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(count) ||
      count < 1 ||
      offset + count > allCases.length
    )
      throw new Error('Invalid preparation offset or query limit');
    const workload = allCases.slice(offset, offset + count);
    const workloadBytes = JSON.stringify(workload);
    if (
      !Array.isArray(workload) ||
      !workload.length ||
      workload.some((item) => !item || typeof item.id !== 'string' || !item.query)
    )
      throw new Error('Invalid preparation workload');
    const solverConfig: SolverConfig = values['solver-config']
      ? JSON.parse(await readFile(values['solver-config'], 'utf8'))
      : { ...gangliaV1Defaults };
    const devicesFile = resolve(dataRoot, `routing/${values.scene}-traversal-devices.json`);
    let devices: string | undefined = devicesFile;
    try {
      await access(devicesFile);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      devices = undefined;
    }
    const generated: { ground: string; collision: string }[] = [];
    const configSha256 = createHash('sha256')
      .update(await readFile(configFile))
      .digest('hex');
    const movement: { defaultProfile: { radius: number; height: number } } = JSON.parse(
      await readFile(resolve(dataRoot, 'routing/movement-settings-current.json'), 'utf8'),
    );
    const prepared = await prepareWorkerSolver({
      count: 1,
      config: { ...solverConfig, batchConcurrency: 1 },
      dataRoot,
      extractor,
      scene: values.scene,
      preparation: { config: configFile, devices },
      onRegion: (files) => {
        generated.push(files);
        console.error(JSON.stringify({ phase: 'prepared-physical-region', ...files }));
      },
    });
    let results: {
      id: string;
      status: string;
      partial: boolean;
      truncated: boolean;
      reason?: string;
      timedOut: boolean;
      wallMs?: number;
    }[] = [];
    const passes: CoveragePass[] = [];
    let coverageReady = false;
    let failure: string | undefined;
    try {
      const { solver } = prepared;
      try {
        const reports = await prepareCoverage(
          async () => {
            const reports = await solver.solveBatch(workload.map((item) => item.query));
            return reports;
          },
          () => generated.length,
          (pass) => {
            passes.push(pass);
            console.error(JSON.stringify({ phase: 'prepare-coverage-pass', ...pass }));
          },
        );
        coverageReady = true;
        results = reports.map((result, index) => ({
          id: workload[index].id,
          status: result.route.status,
          partial: result.partial === true,
          truncated: result.diagnostics.truncated,
          reason: result.reason,
          timedOut: result.reason === 'timeout',
          ...('solveWallMs' in result.diagnostics &&
          typeof result.diagnostics.solveWallMs === 'number'
            ? { wallMs: result.diagnostics.solveWallMs }
            : {}),
        }));
      } finally {
        await solver.close();
      }
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      const report = {
        kind: 'physical-coverage-preparation',
        version: 1,
        scene: values.scene,
        source: prepared.metadata.source,
        selection: { terminalScene: true, sceneState: 0, area: 0 },
        profile: movement.defaultProfile,
        querySloMs: QUERY_SLO_MS,
        solverConfig: { ...solverConfig, batchConcurrency: 1 },
        configSha256,
        workload: {
          name: values.workload,
          offset,
          sha256: createHash('sha256').update(workloadBytes).digest('hex'),
          ids: workload.map((item) => item.id),
        },
        gameAdapterSha256: prepared.metadata.gameAdapterSha256,
        kernelSha256: prepared.metadata.kernelSha256,
        hashes: prepared.metadata.hashes,
        recoverySetupMs: prepared.recoverySetupMs,
        generated,
        passes,
        coverageReady,
        results,
        ...(failure ? { failure } : {}),
      };
      const output = resolve(dataRoot, `preparation-${values.scene}-${Date.now()}.json`);
      await writeFile(output, JSON.stringify(report, null, 2));
      console.log(JSON.stringify({ ...report, output }, null, 2));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  }
}
