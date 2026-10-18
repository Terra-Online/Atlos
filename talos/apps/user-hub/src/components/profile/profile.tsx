import avatarStyles from '@main/component/login/avatar.module.scss';
import { useEffect, useRef, useState } from 'react';
import type { SessionUser } from '@main/services/auth';
import { useAuthStore } from '@main/store/auth';
import {
    AVATAR_MAX_INDEX,
    normalizeAvatarIndex,
} from '@main/component/login/avatarConfig';
import { useTranslateUI } from '@hub/locale';
import { saveProfile } from '../../api/client';
import styles from './profile.module.scss';

const avatars = Array.from(
    { length: AVATAR_MAX_INDEX },
    (_, index) => index + 1,
);

export default function Profile({
    user,
    onSaved,
}: {
    user: SessionUser;
    onSaved: (user: SessionUser) => void;
}) {
    const t = useTranslateUI();
    const [avatar, setAvatar] = useState(normalizeAvatarIndex(user.avatar));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const pending = useRef(false);
    useEffect(() => {
        setAvatar(normalizeAvatarIndex(user.avatar));
    }, [user.avatar]);
    const submit = async (nextAvatar: number) => {
        if (pending.current) return;
        pending.current = true;
        setSaving(true);
        setError('');
        try {
            const updated = await saveProfile(user.nickname, nextAvatar);
            useAuthStore.getState().setSessionUser(updated);
            setAvatar(normalizeAvatarIndex(updated.avatar));
            onSaved(updated);
        } catch (cause) {
            setAvatar(normalizeAvatarIndex(user.avatar));
            setError(
                cause instanceof Error
                    ? cause.message
                    : t('userHub.actionError'),
            );
        } finally {
            pending.current = false;
            setSaving(false);
        }
    };
    return (
        <section data-font-region="profile" aria-label={t('userHub.tabs.profile')}>
            <fieldset
                disabled={saving}
                className={styles.avatars}
                aria-label={t('userHub.avatar')}
            >
                <div className={styles.grid}>
                    {avatars.map((index) => (
                        <label
                            key={index}
                            className={styles.choice}
                            data-selected={avatar === index}
                        >
                            <input
                                type='radio'
                                name='avatar'
                                value={index}
                                checked={avatar === index}
                                onChange={() => {
                                    if (pending.current) return;
                                    setAvatar(index);
                                    void submit(index);
                                }}
                                aria-label={t('userHub.avatarChoice').replace(
                                    '{index}',
                                    String(index),
                                )}
                            />
                            <div
                                className={`${styles.avatar} ${avatarStyles.avatar}`}
                                data-avt={index}
                                aria-hidden='true'
                            />
                        </label>
                    ))}
                </div>
            </fieldset>
            {error && (
                <p role='alert' className={styles.error}>
                    {error}
                </p>
            )}
        </section>
    );
}
