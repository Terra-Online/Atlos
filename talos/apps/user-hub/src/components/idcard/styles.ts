import shared from '@main/component/login/idcard.module.scss';
import local from './idcard.module.scss';

export default Object.assign({}, local, {
    shell: shared.idCardResponsiveShell,
    scale: shared.idCardResponsiveScale,
});
