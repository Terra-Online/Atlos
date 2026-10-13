import type { ReactNode } from 'react';
import type { OAuthProvider } from '@/services/auth';
import styles from './access.module.scss';

interface AccessButtonProps {
    platform?: OAuthProvider;
    label: string;
    disabled?: boolean;
    onClick: () => void;
    children?: ReactNode;
}

export const AccessButton = ({
    platform,
    label,
    disabled = false,
    onClick,
    children,
}: AccessButtonProps) => (
    <button
        type='button'
        className={styles.oauthMethod}
        disabled={disabled}
        onClick={onClick}
    >
        <div className={styles.oauthMethodInner}>
            {children ? (
                <span
                    className={styles.oauthMethodIcon}
                    data-platform={platform}
                >
                    {children}
                </span>
            ) : null}
            <span className={styles.oauthMethodLabel}>{label}</span>
        </div>
    </button>
);
