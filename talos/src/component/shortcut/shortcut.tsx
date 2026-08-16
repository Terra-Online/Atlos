import React from 'react';
import styles from './shortcut.module.scss';
import { isMac } from '@/platform/platform';

export interface KeyChip {
    label: string;
    size?: '1u' | '2u' | '3u';
    variant?: 'mod';
    type?: 'key' | 'left-click';
}

export interface ShortcutEntry {
    id: string;
    keys: KeyChip[];
}

type KeyCapProps = {
    chip: KeyChip;
};

type ShortcutProps = {
    keys: KeyChip[];
    className?: string;
    scale?: number;
};

export const KeyCap: React.FC<KeyCapProps> = ({ chip }) => {
    const size = chip.variant === 'mod'
        ? (isMac() ? '1u' : '2u')
        : (chip.size ?? '1u');

    return (
        <span className={styles.keyCap} data-ch={size} data-type={chip.type ?? 'key'}>
            {chip.label}
        </span>
    );
};

export const Shortcut: React.FC<ShortcutProps> = ({ keys, className, scale = 1 }) => (
    <span
        className={className ? `${styles.shortcut} ${className}` : styles.shortcut}
        style={{ '--key-scale': scale } as React.CSSProperties}
    >
        {keys.map((chip, index) => (
            <KeyCap key={`${chip.label}:${chip.type ?? 'key'}:${index}`} chip={chip} />
        ))}
    </span>
);
