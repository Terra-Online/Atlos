import React from 'react';
import styles from './button.module.scss';

export type ButtonVariant = 'next' | 'close';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  text: string;
  width?: string | number; // e.g., '6rem' | 96
  height?: string | number; // e.g., '1.5rem' | 24
  variant?: ButtonVariant;
}

const toCssSize = (v?: string | number): string | undefined => {
  if (v === undefined) return undefined;
  return typeof v === 'number' ? `${v}px` : v;
};

const Button: React.FC<ButtonProps> = ({
  text,
  width = '6rem',
  height = '1.5rem',
  variant = 'close',
  className,
  style,
  ...rest
}) => {
  const mergedStyle: React.CSSProperties = {
    width: toCssSize(width),
    height: toCssSize(height),
    ...style,
  };

  return (
    <button
      type="button"
      className={[styles.button, className].filter(Boolean).join(' ')}
      style={mergedStyle}
      data-variant={variant}
      {...rest}
    >
      {/* decorative line */}
      <span className={styles.deco} aria-hidden="true" />
      {/* content text */}
      <span className={styles.text}>{text}</span>
    </button>
  );
};

export default Button;
