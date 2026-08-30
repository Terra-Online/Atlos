import { handleOeaPackage } from './package/oea';
import type { DownloadHandler, Env } from './types';

// Add one handler per downloadable package/service. Each handler returns null
// when the request does not belong to it, allowing the next handler to run.
const DOWNLOAD_HANDLERS: readonly DownloadHandler[] = [handleOeaPackage];

export type { Env } from './types';

export const handleDownloadRequest = async (
    request: Request,
    env?: Env,
): Promise<Response | null> => {
    for (const handler of DOWNLOAD_HANDLERS) {
        const response = await handler(request, env);
        if (response) return response;
    }
    return null;
};
