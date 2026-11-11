import { composeRoutes } from '@opendfieldmap/ganglia/solver';
import { isDeepStrictEqual } from 'node:util';
import { type GroundArrival, type InteractionGoal, type LocomotionOptions, type Route, type Vec3 } from '@opendfieldmap/ganglia';

type Complete = Extract<Route, {status:'complete'}>;
type Source = {buildGuid:string;contentHash:string};
export type Terminal = {id:string;scene:string;target:Vec3;interaction:InteractionGoal;route:Complete;supportBoxes?:unknown[]};
export type Catalog = {version:1;exportRevision:2;source:Source;generator:string;solver:string;movementHash:string;routes:Terminal[]};
const distance = (a:Vec3,b:Vec3) => Math.hypot(...a.map((v,i)=>v-b[i]));

/** Reuse only physically revalidated terminal routes from this exact resource/model release.
 * The marker need not have ground underneath; the prefix goal is the proven entry. */
export function selectTerminal(catalog:Catalog|null, context:{scene:string;source:Source;generator?:string;solver?:string;
    movementHash:string;target:Vec3;interaction?:InteractionGoal;arrivals:GroundArrival[];speed:number}) {
    if (!catalog || !context.interaction?.airborne || catalog.version!==1 || catalog.exportRevision!==2 ||
        !isDeepStrictEqual(catalog.source,context.source) || catalog.generator!==context.generator ||
        !context.solver?.endsWith(`ganglia-${catalog.solver}.tgz`) || catalog.movementHash!==context.movementHash) return null;
    const choices=catalog.routes.filter(asset=>asset.scene===context.scene && asset.route.status==='complete' &&
        asset.route.goalHit && asset.route.points.length && distance(asset.target,context.target)<1e-6 &&
        isDeepStrictEqual(asset.interaction,context.interaction));
    const estimate=(asset:Terminal)=>asset.route.cost+Math.min(...context.arrivals.filter(a=>a.state==='available')
        .map(a=>a.cost+distance(a.position,asset.route.points[0])/context.speed));
    choices.sort((a,b)=>estimate(a)-estimate(b));
    return choices[0]??null;
}

/** Joining must retain the validated entry and the boost's relative event clock. */
export function joinTerminal(prefix:Complete, terminal:Complete, locomotion:LocomotionOptions):Route {
    return composeRoutes([prefix, terminal], locomotion);
}
