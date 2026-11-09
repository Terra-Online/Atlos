import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
    label: string;
    icon?: ReactNode;
    pressed?: boolean;
    ref?: Ref<HTMLButtonElement>;
}

/** Shared button semantics; the caller owns its existing visual treatment. */
export default function IconButton({ label, icon, pressed, children, type = 'button', ref, ...props }: Props) {
    return <button type={type} ref={ref} aria-label={label} aria-pressed={pressed} {...props}>{icon}{children}</button>;
}
