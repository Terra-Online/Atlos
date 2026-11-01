import { createRoot } from 'react-dom/client';
import { i18nInitPromise } from '@/locale';
import { isPreviewOrigin } from '@/services/noclip/types';
import { Regions } from './regions';

const parameters = new URL(location.href).searchParams;
const origin = parameters.get('previewOrigin') || '';
const session = parameters.get('session') || '';
if (isPreviewOrigin(origin) && parent !== window) {
    void i18nInitPromise.then(() =>
        createRoot(document.getElementById('root')!).render(
            <Regions origin={origin} session={session} />,
        ),
    );
}
