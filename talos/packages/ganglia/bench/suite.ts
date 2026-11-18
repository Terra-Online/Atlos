/**
 * Dataset names static artifact roots; Suite is configuration, never a running
 * solver. Each ScenarioSpec declares one shared world, its cases and ordered
 * training references. A case cannot override world setup or the run's solver
 * config. Training may overlap measured cases; no completed-route answers are
 * retained. A ScenarioBuilder validates serialized data and resolves references
 * before creating live resources. note is diagnostic text with no execution role.
 */
import type { RouteQuery } from '#@/src/solver/contract.ts';

// A suite is serialized configuration: each scenario has one world setup and
// ordered training and measured cases. Training IDs refer to that scenario's
// cases; training may overlap measurement but never changes the case list.
export interface Dataset {
  readonly root: string;
}

export interface Case {
  readonly id: string;
  readonly query: RouteQuery;
  readonly note?: string;
}

export interface Expectation {
  readonly kind: 'complete' | 'reject' | 'constraint';
  readonly assertions: readonly string[];
}

export interface ScenarioSpec<Setup, Test extends Case = Case> {
  readonly id: string;
  readonly setup: Setup;
  readonly training: readonly string[];
  readonly cases: readonly Test[];
  readonly note?: string;
}

export interface Suite<Setup, Test extends Case = Case> {
  readonly id: string;
  readonly scenarios: readonly ScenarioSpec<Setup, Test>[];
  readonly note?: string;
}
