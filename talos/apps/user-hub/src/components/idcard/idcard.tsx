import type { CSSProperties } from 'react';
import { useTranslateUI } from '@hub/locale';
import IdCardView from '@main/component/shared/account/idcardView';
import { normalizeAvatarIndex } from '@main/component/shared/account/avatarConfig';
import { useIdCardHoverAngle } from '@main/component/shared/account/useIdCardHoverAngle';
import { useIdCardScale } from '@main/component/shared/account/useIdCardScale';
import { useIdCardProfileViewModel } from '@main/component/shared/account/useIdCardProfileViewModel';
import type { Overview } from '../../types';
import styles from './styles';
import { navigate } from '../../routing';

export default function IDCard({ overview }: { overview: Overview }) {
    const t = useTranslateUI();
    const profile = useIdCardProfileViewModel({
        sessionUser: overview.user,
        authReady: true,
    });
    const { cardRef, handleCardMouseMove, handleCardMouseLeave } =
        useIdCardHoverAngle();
    const { shellRef, scale } = useIdCardScale(cardRef);

    return (
        <section
            className={styles.profile}
            aria-label={t('userHub.accountStatus')}
        >
            <div
                ref={shellRef}
                className={styles.shell}
                style={{ '--idcard-scale': scale.toString() } as CSSProperties}
            >
                <div className={styles.scale}>
                    <div className='theme-transition-scope'>
                        <IdCardView
                            profile={profile}
                            cardRef={cardRef}
                            onAvatarClick={() => navigate('profile')}
                            avatarAriaLabel={t('userHub.tabs.profile')}
                            avatarIndex={normalizeAvatarIndex(
                                overview.user.avatar,
                            )}
                            onCardMouseMove={handleCardMouseMove}
                            onCardMouseLeave={handleCardMouseLeave}
                        />
                    </div>
                </div>
            </div>
        </section>
    );
}
