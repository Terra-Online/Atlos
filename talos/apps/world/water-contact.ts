import { projectPoint } from '@opendfieldmap/ganglia/model';
import type { GroundOptions, Vec3 } from '@opendfieldmap/ganglia';
import type { SweptSupport } from '@opendfieldmap/ganglia/solver';

/** World points denote authored transforms. A WaterVolume's initial fill can
 * differ from the authored floater pose, so it does not select the terminal cap. */
export function authoredWaterContact(
    support: SweptSupport,
    marker: Vec3,
    options: Pick<GroundOptions, 'maxVertical' | 'profile'>,
) {
    const { control, endpoints, poses, surfacePoses } = support;
    if (
        support.family !== 'water-floater' ||
        support.assumption !== 'phase-free-swept-support' ||
        control?.kind !== 'water-volume' ||
        !Array.isArray(control.initialPosition) ||
        control.initialPosition.length !== 3 ||
        !control.initialPosition.every(Number.isFinite) ||
        !endpoints ||
        !poses?.length ||
        surfacePoses?.length !== support.surfaces.length ||
        Math.hypot(
            ...marker.map(
                (value, axis) => value - control.initialPosition[axis],
            ),
        ) > 1e-3
    ) {
        return null;
    }
    const spot = (position: Vec3, pose: number) =>
        projectPoint(
            support.surfaces.filter((_, index) =>
                surfacePoses[index].some(
                    (span) => span.fromPose === pose && span.toPose === pose,
                ),
            ),
            position,
            { maxVertical: options.maxVertical },
        );
    const initial = spot(marker, 0);
    if (!initial) return null;

    // A WaterVolume translates along Y. Use the exported body displacement,
    // then verify the corresponding terminal contact on its own sampled face.
    const terminal = spot(
        [
            marker[0],
            initial.position[1] +
                endpoints.terminal.max[1] -
                endpoints.initial.max[1],
            marker[2],
        ],
        poses.length - 1,
    );
    return {
        model: 'moving-support-contact-v1',
        position: initial.position,
        interaction: {
            radius: options.profile.radius,
            maxVertical: Math.min(options.profile.radius, options.maxVertical),
        },
        contact: {
            id: support.id,
            control: control.id,
            pose: 'initial' as const,
            surface: initial.surface,
            terminalPosition: terminal?.position,
        },
    };
}
