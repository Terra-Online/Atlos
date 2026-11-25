import type { ComponentProps, ComponentPropsWithRef, CSSProperties } from 'react';
import classNames from 'classnames';
import IconButton from './IconButton';
import styles from './button.module.scss';

type Schema = 'light' | 'dark';
type NativeProps = ComponentPropsWithRef<'button'>;

export function PillButton({
    children,
    className,
    schema = 'light',
    type = 'button',
    ...props
}: NativeProps & { schema?: Schema }) {
    return (
        <button {...props} type={type} className={classNames(styles.button, styles.pill, className)} data-schema={schema}>
            <span className={styles.arrow} aria-hidden="true" />
            <span className={styles.text}>{children}</span>
            <span className={styles.icon} aria-hidden="true" />
        </button>
    );
}

export function SquareButton({
    children,
    className,
    fullWidth,
    type = 'button',
    ...props
}: NativeProps & { fullWidth?: boolean }) {
    return (
        <button {...props} type={type} className={classNames(styles.button, styles.square, fullWidth && styles.fullWidth, className)}>
            <span className={styles.squareDeco} aria-hidden="true" />
            <span className={styles.text}>{children}</span>
        </button>
    );
}

type RoundProps = Omit<ComponentProps<typeof IconButton>, 'children' | 'icon'> & {
    icon: 'close' | 'prev' | 'next';
    schema?: Schema;
    size?: CSSProperties['width'];
};

export function RoundIconButton({ className, icon, schema = 'light', size, style, ...props }: RoundProps) {
    return (
        <IconButton
            {...props}
            className={classNames(styles.button, styles.round, className)}
            style={size === undefined ? style : { width: size, ...style }}
            data-schema={schema}
            data-type={icon}
            icon={<span className={styles.icon} aria-hidden="true" />}
        />
    );
}
