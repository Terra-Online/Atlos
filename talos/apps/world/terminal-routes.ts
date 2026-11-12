import { supportBoxes } from './src/moving-bounds.ts';
import { isDeepStrictEqual } from 'node:util';
import {
    type InteractionGoal,
    type Route,
    type Vec3,
} from '@opendfieldmap/ganglia';

type Complete = Extract<Route, { status: 'complete' }>;
type Source = { buildGuid: string; contentHash: string };
export type Terminal = {
    id: string;
    scene: string;
    target: Vec3;
    interaction: InteractionGoal;
    route: Complete;
    supportBoxes?: unknown[];
};
export type Catalog = {
    version: 1;
    exportRevision: 2;
    source: Source;
    generator: string;
    solver: string;
    movementHash: string;
    routes: Terminal[];
};
const distance = (a: Vec3, b: Vec3) => Math.hypot(...a.map((v, i) => v - b[i]));

/** Reuse only physically revalidated terminal routes from this exact resource/model release.
 * The marker need not have ground underneath; the prefix goal is the proven entry. */
export function matchingTerminals(
    catalog: Catalog | null,
    context: {
        scene: string;
        source: Source;
        generator?: string;
        solver?: string;
        movementHash: string;
        target: Vec3;
        interaction?: InteractionGoal;
    },
) {
    if (
        !catalog ||
        !context.interaction?.airborne ||
        catalog.version !== 1 ||
        catalog.exportRevision !== 2 ||
        !isDeepStrictEqual(catalog.source, context.source) ||
        catalog.generator !== context.generator ||
        !context.solver?.endsWith(`ganglia-${catalog.solver}.tgz`) ||
        catalog.movementHash !== context.movementHash
    )
        return [];
    const choices = catalog.routes.filter(
        (asset) =>
            asset.scene === context.scene &&
            asset.route.status === 'complete' &&
            asset.route.goalHit &&
            asset.route.points.length &&
            distance(asset.target, context.target) < 1e-6 &&
            isDeepStrictEqual(asset.interaction, context.interaction),
    );
    return choices.map((asset) => ({
        ...asset,
        supportBoxes: supportBoxes(asset.supportBoxes),
    }));
}
