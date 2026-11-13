import { registerHooks } from 'node:module';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const profilerKey = '__atlosRouteStageProfiler';

// Keep per-vertex and per-sweep helpers out of the stopwatch pass. Their CPU
// contribution remains visible in the optional sampling profile.
const ganglia = {
    'build.ts': ['buildGroundTiles', 'buildGroundSurfaces', 'buildHeightLayers', 'supportHeightRanges', 'joinTiles', 'boundaryEdges'],
    'support-field.ts': ['buildSupportField'],
    'ground.ts': ['createGroundPlanner', 'planGroundRoute', 'plan', 'straightenRoute'],
    'surfaces.ts': ['surfaceGraph', 'surfacePortals'],
    'routes.ts': ['prepareRoutePlanner', 'prepareGraph', 'search'],
    'support-projector.ts': ['createSupportProjector'],
    'goals.ts': ['createGoalProjector'],
    'straighten.ts': ['createGroundStraightener'],
    'connectivity.ts': ['groundComponents', 'directedComponents', 'condenseComponents'],
    'collision.ts': ['createCollisionWorld'],
    'jump-planner.ts': ['planJumpRoute', 'solveJumpRoute', 'planDirectedRoute', 'planBaseRoute'],
    'shortcuts.ts': ['findJumpFrontier', 'findJumpShortcuts', 'findConnections', 'prepareGeometry'],
    'traversal.ts': ['findJumpConnections', 'exposedBoundaries', 'findChain', 'candidatesFor', 'validate'],
    'movement-geometry.ts': ['movementGeometry'],
    'route-shortcuts.ts': ['findRouteShortcuts'],
    'ground-detours.ts': ['pruneGroundDetours'],
    'airborne-goal.ts': ['planAirborneGoal'],
    'boosted-route.ts': ['planBoostedRoute'],
    'resource-search.ts': ['searchResources'],
    'distance-field.ts': ['advanceDistanceField'],
    // The resource DP can call scheduleBlock millions of times. Inspect that
    // hot path through CPU sampling to avoid per-call stopwatch overhead.
    'locomotion.ts': ['retimeGroundRoute'],
    'candidate-planner.ts': ['createCandidatePlanner', 'plan'],
};
const extractor = {
    'commands/player-route.ts': ['run'],
    'commands/player-ground.ts': ['run'],
    'game/collision-inputs.ts': ['collectCollisionInputs', 'collisionChunkFiles', 'readColliderGeometry', 'meshGeometry'],
    'game/collision-ground.ts': ['collisionGeometry', 'walkableCollisionIndices'],
    'game/ground-tile-cache.ts': ['groundTileCache', 'keyFor', 'load', 'save'],
    'game/ground-refinement.ts': ['refineGoalGround'],
    'game/moving-ground.ts': ['movingGround', 'clustersOf'],
    'game/traversal-links.ts': ['deviceConnections', 'groundDeviceConnections'],
    'game/following-route.ts': ['planFollowingRoute'],
    'game/round-exclusions.ts': ['roundExclusions'],
    'game/moving-route.ts': ['createMovingRouteAnnotator'],
    'game/world/world-index.ts': ['cellChunkFiles', 'readStreamingPayload'],
    'game/assets/assets.ts': ['findUnique', 'read'],
    'hg/bundles.ts': ['read'],
    'hg/vfs.ts': ['read'],
    'route-cache.ts': ['begin', 'read', 'memo'],
};
const recast = [
    'init', 'createHeightfield', 'markWalkableTriangles', 'rasterizeTriangles',
    'filterLowHangingWalkableObstacles', 'filterWalkableLowHeightSpans',
    'buildCompactHeightfield', 'erodeWalkableArea', 'buildDistanceField',
    'buildRegions', 'buildContours', 'buildPolyMesh', 'buildPolyMeshDetail',
];
const decoders = new Set([
    'parseStreamingChunk', 'readEcsCollider', 'readCollisionMesh',
    'readConvexMesh', 'readCollisionHeightfield',
]);
const ioModules = new Set([
    'commands/player-ground.ts', 'commands/player-route.ts',
    'game/ground-tile-cache.ts', 'route-cache.ts',
]);

function selection(path) {
    const sdk = path.match(/\/(?:@opendfieldmap|packages)\/ganglia\/src\/(?:v1\/)?(?:geo\/|reach\/|motion\/|search\/|resource\/|route\/)?([^/]+)$/);
    if (sdk && ganglia[sdk[1]]) return { module: `ganglia/${sdk[1]}`, names: new Set(ganglia[sdk[1]]) };
    const source = path.match(/\/packages\/extractor\/src\/(.+)$/);
    if (source && extractor[source[1]]) return { module: `extractor/${source[1]}`,
        names: new Set(extractor[source[1]]), calls: ioModules.has(source[1]) };
    if (/\/@recast-navigation\/core\/dist\/index\.mjs$/.test(path)) return { module: 'recast', names: new Set(recast), topLevel: true };
    if (/\/packages\/formats\/src\//.test(path)) return { module: `formats/${path.split('/src/').at(-1)}`, names: decoders };
    return null;
}

function functionName(node) {
    if (node.name && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))) return node.name.text;
    if (ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) return node.parent.name.text;
    if (ts.isPropertyAssignment(node.parent)) return node.parent.name.getText();
    return null;
}

/** Transform only selected function bodies. Arrow wrappers preserve lexical this,
 * arguments and return/throw behavior. Constructors and generators are excluded. */
export function transformSource(source, path, options = {}) {
    const selected = options.selection ?? selection(path);
    if (!selected) return { source, labels: [] };
    const config = selected;
    const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true,
        path.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS);
    const edits = [], labels = [];
    function visit(node, parents = []) {
        if (config.calls && ts.isCallExpression(node) && !node.questionDotToken) {
            const callee = node.expression;
            const io = ts.isIdentifier(callee) && ['readFile', 'writeFile', 'rename'].includes(callee.text);
            const json = ts.isPropertyAccessExpression(callee) && !callee.questionDotToken &&
                ts.isIdentifier(callee.expression) && callee.expression.text === 'JSON' &&
                ['parse', 'stringify'].includes(callee.name.text);
            if (io || json) {
                const label = `${config.module}::${callee.getText(tree)}`;
                labels.push(label);
                const invoke = `globalThis.${profilerKey}.invoke(${JSON.stringify(label)}, `;
                // Evaluate the original callee/receiver before its arguments.
                // Keep argument expressions at their original await level, and
                // begin timing only once all arguments have been evaluated.
                const replacement = json
                    ? `((__receiver) => { const __fn = __receiver.${callee.name.text}; return (...__args) => ${invoke}() => Reflect.apply(__fn, __receiver, __args)); })(JSON)`
                    : `((__fn) => (...__args) => ${invoke}() => __fn(...__args)))(${callee.getText(tree)})`;
                edits.push({ start: callee.getStart(tree), end: callee.end, text: replacement });
            }
        }
        const isFunction = ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) ||
            ts.isArrowFunction(node) || ts.isMethodDeclaration(node);
        const name = isFunction ? functionName(node) : null;
        const topLevel = isFunction && (ts.isFunctionDeclaration(node) ? ts.isSourceFile(node.parent) :
            ts.isVariableDeclaration(node.parent) && ts.isSourceFile(node.parent.parent.parent.parent));
        if (isFunction && name && node.body && !node.asteriskToken && config.names.has(name) && (!config.topLevel || topLevel)) {
            const label = `${config.module}::${[...parents, name].join('.')}`;
            labels.push(label);
            const asynchronous = node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword);
            const invoke = `globalThis.${profilerKey}.invoke(${JSON.stringify(label)}, ${asynchronous ? 'async ' : ''}() => `;
            if (ts.isBlock(node.body)) {
                edits.push({ start: node.body.getStart(tree) + 1, end: node.body.getStart(tree) + 1, text: `return ${invoke}{` });
                edits.push({ start: node.body.end - 1, end: node.body.end - 1, text: '});' });
            } else {
                edits.push({ start: node.body.getStart(tree), end: node.body.getStart(tree), text: `{return ${invoke}(` });
                edits.push({ start: node.body.end, end: node.body.end, text: '));}' });
            }
        }
        const className = (ts.isClassDeclaration(node) || ts.isClassExpression(node)) && node.name?.text;
        const scope = name ?? className;
        ts.forEachChild(node, child => visit(child, scope ? [...parents, scope] : parents));
    }
    visit(tree);
    edits.sort((a, b) => b.start - a.start || b.end - a.end);
    let transformed = source;
    for (const edit of edits) transformed = transformed.slice(0, edit.start) + edit.text + transformed.slice(edit.end);
    return { source: transformed, labels };
}

export function installStageHooks(profiler, { instrument = true } = {}) {
    globalThis[profilerKey] = profiler;
    const modules = [];
    const hooks = registerHooks({
        load(url, context, nextLoad) {
            const loaded = nextLoad(url, context);
            if (!url.startsWith('file:') || loaded.source == null) return loaded;
            const path = fileURLToPath(url);
            const source = typeof loaded.source === 'string' ? loaded.source : Buffer.from(loaded.source).toString('utf8');
            const identity = { path, bytes: Buffer.byteLength(source), sha256: createHash('sha256').update(source).digest('hex') };
            if (!selection(path)) {
                modules.push({ ...identity, labels: [] });
                return loaded;
            }
            const result = transformSource(source, path, {
                ...(!instrument ? { selection: { module: '', names: new Set() } } : {}),
            });
            modules.push({ ...identity, labels: result.labels });
            return { ...loaded, source: result.source };
        },
    });
    return { modules, close: () => hooks.deregister() };
}
