/**
 * The mechanism manifest's serialized contract. A scenario owns its world setup
 * and ordered training IDs. Cases supply requests, expected outcomes and local
 * witnesses. Strict objects catch misspellings before input preparation.
 * Metadata is optional for new samples. Evidence can resolve authored inputs;
 * historical provenance and notes do not affect execution.
 */
import { z } from 'zod';

const text = z.string().min(1);
const id = z.string().regex(/^[a-zA-Z0-9_.-]+$/);
const note = z.string().optional();
const number = z.number();
const integer = z.int().nonnegative();
const vec3 = z.tuple([number, number, number]);
const sourceIdentity = z.strictObject({ buildGuid: text, contentHash: text });
const profile = z.strictObject({ radius: number, height: number });

const stamina = z.strictObject({
  capacity: number,
  initial: number,
  reserve: number,
  recoveryRate: number,
  recoveryDelay: number,
  activationCost: number.optional(),
  sprintDrain: number.optional(),
  recoveryDuringSprint: z.boolean().optional(),
  recoveryDuringNonWalk: z.boolean().optional(),
});
const locomotion = z.strictObject({
  speed: number,
  sprintSpeed: number,
  sprintAcceleration: number,
  dash: z
    .strictObject({ speed: number, duration: number, cooldown: number, cost: number })
    .optional(),
  stamina: stamina.optional(),
  sprintThrough: z.array(z.enum(['jump', 'drop', 'rope', 'launch'])).optional(),
  search: z
    .strictObject({ maxLabels: integer.optional(), maxExpanded: integer.optional() })
    .optional(),
});
const query = z.strictObject({
  starts: z
    .array(
      z.strictObject({
        id: text,
        position: vec3,
        cost: number,
        state: z.enum(['available', 'locked', 'unknown']),
      }),
    )
    .min(1),
  goal: vec3,
  interaction: z
    .strictObject({
      radius: number,
      maxVertical: number.optional(),
      facing: vec3.optional(),
      halfAngle: number.optional(),
      airborne: z.boolean().optional(),
    })
    .optional(),
  waypoints: z.array(vec3).optional(),
});

const bounds = z.tuple([number, number, number, number]);
const diagnostic = z.strictObject({ ground: text, collision: text });
const region = z.strictObject({
  bounds,
  level: id.optional(),
  anchor: z
    .strictObject({
      id: text,
      kind: text,
      level: id,
      scene: id,
      position: vec3,
      availability: text,
    })
    .optional(),
  exportOptions: z
    .strictObject({
      sceneState: text,
      area: text,
      terminalScene: z.boolean(),
    })
    .optional(),
});
const source = z.strictObject({
  scene: id.optional(),
  source: sourceIdentity,
  profile,
  locomotion,
  interactives: text.optional(),
  navigation: text.optional(),
  navigationExportRevision: integer.optional(),
  navigationGenerator: text.optional(),
  traversal: text.optional(),
  traversalExportRevision: integer.optional(),
  traversalGenerator: text.optional(),
});
const sources = z.record(
  id,
  source.extend({
    regions: z.record(id, region.extend({ diagnostic: diagnostic.optional() })),
  }),
);
const inputSelection = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('dynamic') }),
  z.strictObject({ kind: z.literal('frozen-window'), region: id }),
]);

const world = z.strictObject({
  locomotion: locomotion.optional(),
  locomotionPatch: z.strictObject({ stamina: stamina.partial().optional() }).optional(),
  followingPlacement: z
    .strictObject({
      movableSourceIds: z.array(text).min(1),
      minimumDistinctUsedBoxes: integer,
      retainOtherSourceBoxes: z.literal(true),
      jointSnapshot: z.literal(true),
      sourceActivityRanges: z.array(z.strictObject({ id: text, spawn: vec3, radius: number })),
    })
    .optional(),
  deviceAvailability: z.literal('assumed-enabled').optional(),
  assumption: z.literal('phase-free-swept-support').optional(),
  supportModel: z.literal('phase-free-circular-surface').optional(),
  sourceAnimation: z
    .strictObject({
      collection: z.literal('staticSupports.parts.motion'),
      id: text,
    })
    .optional(),
});
const requirements = z.strictObject({
  requiredDevice: text.optional(),
  requiredSupport: text.optional(),
  excludedUnresolvedDevice: text.optional(),
  projectStartToPhysicalSupport: z.literal(true).optional(),
});
const evidence = z.array(
  z.strictObject({
    file: text,
    collection: text,
    id: text.optional(),
    index: integer.optional(),
    capSurfaceIndex: integer.optional(),
    fromPose: integer.optional(),
    fromTransferIndex: integer.optional(),
    sourceTriangleIndex: integer.optional(),
    surfaceIndex: integer.optional(),
    toPose: integer.optional(),
    toTransferIndex: integer.optional(),
    triangleIndex: integer.optional(),
  }),
);
const expectationKind = z.enum(['complete', 'reject', 'constraint']);
const assertions = z.array(text);
const provenance = z.record(z.string(), z.json()).optional();
const metadata = z.strictObject({
  group: text.optional(),
  tags: z.array(text).optional(),
  evidence: evidence.optional(),
  level: id.optional(),
  target: z.strictObject({ id: text, kind: text, template: text.optional() }).optional(),
  pointToken: text.optional(),
  tokenRole: text.optional(),
  tokenSourceId: text.optional(),
  legacyCaseId: id.optional(),
  legacyToken: text.optional(),
  geometryProbe: z.strictObject({ file: text, id }).optional(),
  acceptanceRevision: provenance,
  expectedContactPose: provenance,
  inputRevision: provenance,
  replacement: provenance,
  selection: provenance,
  supportModel: provenance,
});
const scenario = z.strictObject({
  id,
  setup: world.extend({ scene: id, input: inputSelection }),
  training: z.array(id),
  cases: z
    .array(
      z.strictObject({
        id,
        query,
        expect: z.strictObject({ kind: expectationKind, assertions }),
        requirements: requirements.optional(),
        metadata: metadata.optional(),
        note,
      }),
    )
    .min(1),
  note,
});
export const suiteSchema = z.strictObject({
  $schema: z.string().optional(),
  schema: z.literal(8),
  id,
  revision: integer.optional(),
  requiredSource: sourceIdentity,
  sources,
  scenarios: z.array(scenario).min(1),
  note,
});

/** Standalone diagnostics may still load the flat control and probe manifests.
 * Their historical annotations are carried through to reports. */
export const legacySuiteSchema = z.looseObject({
  schema: z.literal(1),
  name: text.optional(),
  source: sourceIdentity,
  sources: z.record(id, source).optional(),
  cases: z
    .array(
      z.looseObject({
        id,
        scene: id,
        query,
        expected: expectationKind.optional(),
        assertions,
        setup: world.extend({
          ...requirements.shape,
          physical: diagnostic
            .extend({
              mode: z.literal('frozen-window'),
              region: id,
              allowExpansion: z.literal(false).optional(),
            })
            .optional(),
        }),
        group: text,
        tags: z.array(text),
        evidence,
      }),
    )
    .min(1),
});

export type AuthoredSuite = z.infer<typeof suiteSchema>;
export type CaseSetup = z.infer<typeof world> &
  z.infer<typeof requirements> & {
    physical?: { mode: 'frozen-window'; region: string; diagnostic?: z.infer<typeof diagnostic> };
  };
export type Source = z.infer<typeof source>;
export type Bounds = z.infer<typeof bounds>;
