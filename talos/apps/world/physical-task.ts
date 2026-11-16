import {
    physicalResources,
    type PhysicalResources,
} from '../../.cache/noclip/packages/extractor/src/game/physical-input.ts';
import {
    readPhysicalWork,
    type PhysicalWork,
} from '@opendfieldmap/ganglia/solver/host';
export type PhysicalTask = {
    resources: PhysicalResources;
    request: unknown;
    output: string;
    work: PhysicalWork;
};
export function physicalTask(value: unknown): PhysicalTask {
    if (
        !value ||
        typeof value !== 'object' ||
        !('resources' in value) ||
        !('request' in value) ||
        !('output' in value) ||
        typeof value.output !== 'string' ||
        !value.output ||
        !('work' in value)
    )
        throw new Error('Invalid physical task');
    return {
        resources: physicalResources(value.resources),
        request: value.request,
        output: value.output,
        work: readPhysicalWork(value.work),
    };
}
