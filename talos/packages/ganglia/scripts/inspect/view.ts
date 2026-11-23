import { readFile, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { parseArgs } from 'node:util';

import { z } from 'zod';

import { createRenderer } from '#@/scripts/inspect/renderer.ts';
import type { Vec3 } from '#@/src/geometry.ts';
import type { Segment } from '#@/src/movement.ts';
import type { RouteQuery, RouteResult } from '#@/src/solver/contract.ts';

interface Capture {
  coverage?: {
    span: number;
    tiles: [x: number, z: number, nodes: number, fromStart: number, toGoal: number][];
  };
  views: {
    min: Vec3;
    max: Vec3;
    triangles: [Vec3, Vec3, Vec3][];
    nodes: [position: Vec3, fromStart: boolean, toGoal: boolean, component?: number][];
    edges: [from: number, to: number, mode: string, conditional: boolean][];
  }[];
}

interface Trace extends Pick<Segment, 'mode' | 'traversal' | 'gait' | 'requiredGait'> {
  points: readonly Vec3[];
}

const point = z.tuple([z.number(), z.number(), z.number()]);
const tone = z.enum(['ink', 'path', 'barrier', 'start', 'goal']).optional();
// Overlay positions are world-space XYZ, so the same object can appear in several windows.
const overlay = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('label'),
    at: point,
    text: z.string(),
    align: z.enum(['left', 'right']).optional(),
    tone,
  }),
  z.object({
    kind: z.literal('line'),
    points: z.array(point).min(2),
    dashed: z.boolean().optional(),
    alwaysRender: z.boolean().optional(),
    tone,
  }),
  z.object({ kind: z.literal('face'), points: z.array(point).min(3), tone }),
]);
type Overlay = z.infer<typeof overlay>;

const renderConfig = z.strictObject({
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  camera: z
    .strictObject({
      center: point.optional(),
      yaw: z.number().optional(),
      pitch: z.number().optional(),
      distance: z.number().positive().optional(),
      focalLength: z.number().positive().optional(),
    })
    .optional(),
  layers: z
    .strictObject({
      mesh: z.boolean().optional(),
      graph: z.boolean().optional(),
      trace: z.boolean().optional(),
      components: z.boolean().optional(),
    })
    .optional(),
  occlusion: z.enum(['dash', 'hide']).optional(),
  contourSamples: z.union([z.literal(1), z.literal(2)]).optional(),
  hud: z.boolean().optional(),
});

interface Annotation {
  title?: string;
  detail?: string;
  angle?: [yaw: number, pitch: number];
  objects?: Overlay[];
  labels?: [position: Vec3, label: string][];
  gap?: [Vec3, Vec3];
  obstruction?: [Vec3, Vec3, Vec3];
  trace?: Trace[];
}

const { values } = parseArgs({
  options: {
    result: { type: 'string' },
    output: { type: 'string' },
    annotations: { type: 'string' },
    layout: { type: 'string', default: '0' },
    view: { type: 'string' },
    'render-config': { type: 'string' },
    fragment: { type: 'boolean' },
    chrome: { type: 'boolean' },
  },
});
if (!values.result || !values.output)
  throw new Error(
    'Usage: node scripts/inspect/view.ts --result <case artifact.json> --output <view.html|view.png> [--view overview|1|2|...] [--layout 0] [--annotations <annotations.json>] [--render-config <render.json>] [--fragment | --chrome]',
  );
const png = extname(values.output).toLowerCase() === '.png';
if (png && values.fragment) throw new Error('--fragment requires HTML output.');
if (!png && values['render-config']) throw new Error('--render-config requires PNG output.');
const render = values['render-config']
  ? renderConfig.parse(JSON.parse(await readFile(values['render-config'], 'utf8')))
  : {};

const artifact = JSON.parse(await readFile(values.result, 'utf8')) as {
  query: RouteQuery;
  result: RouteResult & {
    diagnostics: { v2?: { initialization: { layouts: { inspection?: Capture }[] } } };
  };
};
const capture =
  artifact.result.diagnostics?.v2?.initialization?.layouts?.[Number(values.layout)]?.inspection;
if (!capture?.views.length)
  throw new Error('No inspection windows in this layout. Run with GANGLIA_V2_INSPECT_BOUNDS.');

let initialView = 0;
if (values.view === 'overview') {
  if (!capture.coverage) throw new Error('This capture has no corridor overview.');
} else if (values.view !== undefined) {
  const window = Number(values.view);
  if (!/^[1-9]\d*$/.test(values.view) || window > capture.views.length)
    throw new Error(`Choose an inspection window from 1 to ${capture.views.length}.`);
  initialView = window - 1 + Number(Boolean(capture.coverage));
}
if (render.camera && capture.coverage && initialView === 0)
  throw new Error('Camera parameters require a numbered inspection window.');

const annotations: { title?: string; overview?: string; views?: Annotation[] } = values.annotations
  ? JSON.parse(await readFile(values.annotations, 'utf8'))
  : {};
const route = artifact.result.route;
const trace: Trace[] =
  route.status === 'complete'
    ? route.segments.map(({ mode, points, traversal, gait, requiredGait }) => ({
        mode,
        points,
        traversal,
        gait,
        requiredGait,
      }))
    : [];
const data = {
  initialView,
  render: png ? render : undefined,
  title: annotations.title ?? 'Ganglia 骨干网络',
  overview: annotations.overview,
  start: artifact.query.starts[0]?.position,
  goal: artifact.query.goal,
  route: trace,
  coverage: capture.coverage,
  views: capture.views.map((view, index) => {
    const note = annotations.views?.[index] ?? {};
    // Older captures can still be annotated with their existing fields.
    const objects: Overlay[] = [
      ...(note.obstruction ? [{ kind: 'face' as const, points: note.obstruction }] : []),
      ...(note.gap
        ? [{ kind: 'line' as const, points: note.gap, tone: 'barrier' as const, dashed: true }]
        : []),
      ...(note.labels ?? []).map(([at, text]): Overlay => ({ kind: 'label', at, text })),
      ...z.array(overlay).parse(note.objects ?? []),
    ];
    const center = view.min.map((value, axis) => (value + view.max[axis]) / 2);
    const local = (point: Vec3): Vec3 => [
      Math.round((point[0] - center[0]) * 100) / 100,
      Math.round((point[1] - center[1]) * 100) / 100,
      Math.round((point[2] - center[2]) * 100) / 100,
    ];
    return {
      title: note.title,
      detail: note.detail,
      angle: note.angle,
      min: local(view.min),
      max: local(view.max),
      center,
      triangles: view.triangles.map((triangle) => triangle.map(local)),
      nodes: view.nodes.map(([point, start, goal, component]) => [
        local(point),
        Number(start) + 2 * Number(goal),
        component ?? null,
      ]),
      edges: view.edges.map(([from, to, mode, conditional]) => [
        from,
        to,
        conditional ? 2 : Number(mode !== 'walk'),
      ]),
      trace: (note.trace ?? trace).map((segment) => ({
        ...segment,
        points: segment.points.map(local),
      })),
      objects: objects.map((object) =>
        object.kind === 'label'
          ? { ...object, at: local(object.at) }
          : { ...object, points: object.points.map(local) },
      ),
    };
  }),
};
const template = await readFile(new URL('viewer.html', import.meta.url), 'utf8');
const fragment = template
  .replace('/* CANVAS_RENDERER */', () => createRenderer.toString())
  .replace('/* SCENE_DATA */', () => JSON.stringify(data).replaceAll('<', '\\u003c'));
const captureStyle = png
  ? 'body{max-width:none;margin:0;padding:0}body #ganglia-viewer{display:block}body #ganglia-viewer > :not(canvas){display:none}body #ganglia-viewer canvas{width:100vw;height:100vh;border-radius:0}'
  : '';
const output = values.fragment
  ? fragment
  : `<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Ganglia 骨干查看器</title><style>body{max-width:1100px;margin:24px auto;padding:0 12px;background:#10161e;color:#e7eef5;font:15px system-ui,sans-serif}${captureStyle}</style></head><body>\n${fragment}\n</body></html>\n`;
if (png) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({
    headless: true,
    channel: values.chrome ? 'chrome' : undefined,
  });
  try {
    const page = await browser.newPage({
      viewport: { width: render.width ?? 600, height: render.height ?? 800 },
      colorScheme: 'dark',
      offline: true,
    });
    let pageError: Error | undefined;
    page.on('pageerror', (error) => {
      pageError ??= error;
    });
    await page.setContent(output);
    try {
      if (pageError) throw pageError;
      await page.locator(`#ganglia-viewer[data-rendered-view="${initialView}"] canvas`).screenshot({
        path: values.output,
        timeout: 10_000,
      });
    } catch (error) {
      throw pageError ?? error;
    }
  } finally {
    await browser.close();
  }
} else {
  await writeFile(values.output, output);
}
