import { useEffect, useRef, useState } from 'react';
import type { SessionUser } from '@main/services/auth';
import { useAuthStore } from '@main/store/auth';
import {
    AVATAR_MAX_INDEX,
    normalizeAvatarIndex,
} from '@main/component/login/avatarConfig';
import { useTranslateUI } from '@hub/locale';
import { saveProfile } from '../../api/client';
import styles from './styles';

const avatars = Array.from(
    { length: AVATAR_MAX_INDEX },
    (_, index) => index + 1,
);

export default function Profile({
    user,
    onSaved,
}: {
    user: SessionUser;
    onSaved: () => void;
}) {
    const t = useTranslateUI();
    const [name, setName] = useState(
        user.needsProfileSetup ? '' : user.nickname,
    );
    const [avatar, setAvatar] = useState(normalizeAvatarIndex(user.avatar));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const pending = useRef(false);
    useEffect(() => {
        setName(user.needsProfileSetup ? '' : user.nickname);
        setAvatar(normalizeAvatarIndex(user.avatar));
    }, [user.nickname, user.avatar, user.needsProfileSetup]);
    const submit = async (nextName = name.trim(), nextAvatar = avatar) => {
        if (pending.current) return;
        if (!/^[A-Za-z0-9_-]{1,15}$/.test(nextName)) {
            setError(t('userHub.nameRule'));
            return;
        }
        pending.current = true;
        setSaving(true);
        setError('');
        try {
            const updated = await saveProfile(nextName, nextAvatar);
            useAuthStore.getState().setSessionUser(updated);
            setName(updated.nickname);
            setAvatar(normalizeAvatarIndex(updated.avatar));
            onSaved();
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
        <section className={styles.section}>
            <h2>{t('userHub.tabs.profile')}</h2>
            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    void submit();
                }}
            >
                <label className={styles.name}>
                    {t('userHub.nickname')}
                    <input
                        value={name}
                        maxLength={15}
                        disabled={saving}
                        onChange={(event) => setName(event.target.value)}
                        onBlur={(event) => {
                            if (
                                event.relatedTarget instanceof
                                    HTMLInputElement &&
                                event.relatedTarget.name === 'avatar'
                            )
                                return;
                            if (name.trim() !== user.nickname) void submit();
                        }}
                        autoComplete='nickname'
                    />
                </label>
                <fieldset disabled={saving} className={styles.avatars}>
                    <legend>{t('userHub.avatar')}</legend>
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
                                        void submit(name.trim(), index);
                                    }}
                                    aria-label={t(
                                        'userHub.avatarChoice',
                                    ).replace('{index}', String(index))}
                                />
                                <div
                                    className={styles.avatar}
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
            </form>
        </section>
    );
}
