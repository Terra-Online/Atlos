import { handleDownloadRequest, type Env } from './download';
import { handleForwardRequest } from './forward';

const CROWDIN_HOSTNAME = 'translate.oem.re';
const CROWDIN_PROJECT_URL = 'https://crowdin.com/project/oem';

export default {
    async fetch(request: Request, env?: Env): Promise<Response> {
        if (new URL(request.url).hostname === CROWDIN_HOSTNAME) {
            return Response.redirect(CROWDIN_PROJECT_URL, 302);
        }

        const downloadResponse = await handleDownloadRequest(request, env);
        if (downloadResponse) return downloadResponse;
        return handleForwardRequest(request);
    },
};
