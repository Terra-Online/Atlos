import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import type { Vec3 } from '#@/src/geometry.ts';
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
    nodes: [position: Vec3, fromStart: boolean, toGoal: boolean][];
    edges: [from: number, to: number, mode: string, conditional: boolean][];
  }[];
}

interface Trace {
  mode: string;
  points: readonly Vec3[];
}

interface Annotation {
  title?: string;
  detail?: string;
  angle?: [yaw: number, pitch: number];
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
    fragment: { type: 'boolean' },
  },
});
if (!values.result || !values.output)
  throw new Error(
    'Usage: node scripts/inspect/view.ts --result <case artifact.json> --output <view.html> [--layout 0] [--annotations <annotations.json>] [--fragment]',
  );

const artifact = JSON.parse(await readFile(values.result, 'utf8')) as {
  query: RouteQuery;
  result: RouteResult & {
    diagnostics: { v2?: { initialization: { layouts: { inspection?: Capture }[] } } };
  };
};
const capture =
  artifact.result.diagnostics.v2?.initialization.layouts[Number(values.layout)]?.inspection;
if (!capture?.views.length)
  throw new Error('No inspection windows in this layout. Run with GANGLIA_V2_INSPECT_BOUNDS.');

const annotations: { title?: string; overview?: string; views?: Annotation[] } = values.annotations
  ? JSON.parse(await readFile(values.annotations, 'utf8'))
  : {};
const route = artifact.result.route;
const trace: Trace[] =
  route.status === 'complete' ? route.segments.map(({ mode, points }) => ({ mode, points })) : [];
const data = {
  title: annotations.title ?? 'Ganglia 骨干网络',
  overview: annotations.overview,
  start: artifact.query.starts[0]?.position,
  goal: artifact.query.goal,
  route: trace,
  coverage: capture.coverage,
  views: capture.views.map((view, index) => {
    const note = annotations.views?.[index] ?? {};
    const center = view.min.map((value, axis) => (value + view.max[axis]) / 2);
    const local = (point: Vec3): Vec3 => [
      Math.round((point[0] - center[0]) * 100) / 100,
      Math.round((point[1] - center[1]) * 100) / 100,
      Math.round((point[2] - center[2]) * 100) / 100,
    ];
    return {
      ...note,
      min: local(view.min),
      max: local(view.max),
      center,
      triangles: view.triangles.map((triangle) => triangle.map(local)),
      nodes: view.nodes.map(([point, start, goal]) => [
        local(point),
        Number(start) + 2 * Number(goal),
      ]),
      edges: view.edges.map(([from, to, mode, conditional]) => [
        from,
        to,
        conditional ? 2 : Number(mode !== 'walk'),
      ]),
      trace: (note.trace ?? trace).map(({ mode, points }) => ({ mode, points: points.map(local) })),
      labels: note.labels?.map(([position, label]) => [local(position), label]),
      gap: note.gap?.map(local),
      obstruction: note.obstruction?.map(local),
    };
  }),
};
const template = await readFile(new URL('viewer.html', import.meta.url), 'utf8');
const fragment = template.replace('/* SCENE_DATA */', () =>
  JSON.stringify(data).replaceAll('<', '\\u003c'),
);
const output = values.fragment
  ? fragment
  : `<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Ganglia 骨干查看器</title><style>body{max-width:1100px;margin:24px auto;padding:0 12px;background:#10161e;color:#e7eef5;font:15px system-ui,sans-serif}</style></head><body>\n${fragment}\n</body></html>\n`;
await writeFile(values.output, output);
