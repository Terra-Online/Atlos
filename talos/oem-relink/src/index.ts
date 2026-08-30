import { handleDownloadRequest, type Env } from './download';
import { handleForwardRequest } from './forward';

export default {
    async fetch(request: Request, env?: Env): Promise<Response> {
        const downloadResponse = await handleDownloadRequest(request, env);
        if (downloadResponse) return downloadResponse;
        return handleForwardRequest(request);
    },
};
