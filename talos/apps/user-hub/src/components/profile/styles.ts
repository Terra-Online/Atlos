import shared from '@main/component/login/idcard.module.scss';
import local from './profile.module.scss';

export default Object.assign({}, local, {
    grid: `${shared.idCardWrap} ${local.grid}`,
    choice: `${shared.avatarContainer} ${local.choice}`,
    avatar: shared.avatar,
});
