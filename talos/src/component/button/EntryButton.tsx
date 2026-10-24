import type { ButtonHTMLAttributes, Ref } from 'react';
import styles from './EntryButton.module.scss';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
    label: string;
    platform?: string;
    ref?: Ref<HTMLButtonElement>;
}

export function EntryButton({ platform, label, children, className, type = 'button', ref, ...props }: Props) {
    return (
        <button type={type} ref={ref} className={[styles.oauthMethod, className].filter(Boolean).join(' ')} {...props}>
            <div className={styles.oauthMethodInner}>
                {children && <span className={styles.oauthMethodIcon} data-platform={platform}>{children}</span>}
                <span className={styles.oauthMethodLabel}>{label}</span>
            </div>
        </button>
    );
}
