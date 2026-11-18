import type { InteractionGoal, Vec3 } from '@opendfieldmap/ganglia';

export type MovingContact = {
    kind: 'moving-collection';
    source: { buildGuid: string; contentHash: string; path: string };
    trajectory: {
        splineId: number;
        repeatFrom: number;
        startPosition: Vec3;
        segments: {
            curve: [Vec3, Vec3, Vec3, Vec3];
            speed: number;
            waitSeconds: number;
        }[];
    };
    interaction: InteractionGoal;
    position: Vec3;
    interception: {
        center: Vec3;
        segment: number;
        fraction: number;
        overlapAtLeastSeconds: number;
    };
    wait: {
        action: 'stationary';
        initialPhase: 'unknown';
        activation: 'loaded-entity-tick';
        firstContactBySeconds: number;
        maximumSeconds: number;
        approachSeconds: number;
        settleSeconds: number;
        staminaSpent: 0;
    };
};
