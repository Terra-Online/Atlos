import { createRustTransferQuery } from '#@/prototype/rust-kernel/binding.ts';
import { installTransferPrototype } from '#@/src/v1/search/candidate-transfers.ts';

installTransferPrototype(createRustTransferQuery);

import { createRustCollisionWorld } from '#@/prototype/rust-kernel/collision-world.ts';
import { installCollisionPrototype } from '#@/src/v1/geo/collision.ts';

if (process.env.GANGLIA_RUST_COLLISION === '1') installCollisionPrototype(createRustCollisionWorld);

import {
  chooseTypeScriptSchedule,
  installSchedulePrototype,
} from '#@/src/v1/resource/locomotion.ts';

if (process.env.GANGLIA_LOCOMOTION_LABELS) {
  const maxLabels = Number(process.env.GANGLIA_LOCOMOTION_LABELS);
  if (!Number.isSafeInteger(maxLabels) || maxLabels < 2 || maxLabels % 2)
    throw new Error('Invalid prototype locomotion label limit');
  installSchedulePrototype((blocks, options) =>
    chooseTypeScriptSchedule(blocks, options, maxLabels),
  );
}

import { createRustScheduleChooser } from '#@/prototype/rust-kernel/locomotion-binding.ts';

if (process.env.GANGLIA_RUST_LOCOMOTION === '1')
  installSchedulePrototype(
    createRustScheduleChooser(Number(process.env.GANGLIA_LOCOMOTION_LABELS ?? 256)),
  );

import { createRustGroundTracer } from '#@/prototype/rust-kernel/ground-trace-binding.ts';
import { installGroundTracePrototype } from '#@/src/v1/route/straighten.ts';

if (process.env.GANGLIA_RUST_GROUND_TRACE === '1')
  installGroundTracePrototype(createRustGroundTracer);

import { createRustGoalGeometry } from '#@/prototype/rust-kernel/goal-binding.ts';
import { installGoalGeometryPrototype } from '#@/src/v1/motion/goals.ts';

if (process.env.GANGLIA_RUST_GOALS === '1') installGoalGeometryPrototype(createRustGoalGeometry);

import { createRustCandidateSearch } from '#@/prototype/rust-kernel/candidate-binding.ts';
import { installCandidateSearchPrototype } from '#@/src/v1/search/candidate-search.ts';

if (process.env.GANGLIA_RUST_CANDIDATE === '1')
  installCandidateSearchPrototype(createRustCandidateSearch);

import { createRustRouteSearch } from '#@/prototype/rust-kernel/route-binding.ts';
import { installRouteSearchPrototype } from '#@/src/v1/search/route-search.ts';

if (process.env.GANGLIA_RUST_ROUTE === '1') installRouteSearchPrototype(createRustRouteSearch);
