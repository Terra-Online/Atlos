import shared from '@main/component/shared/account/idcard.module.scss';
import local from './idcard.module.scss';

export default Object.assign({}, local, {
    shell: shared.idCardResponsiveShell,
    scale: shared.idCardResponsiveScale,
});
