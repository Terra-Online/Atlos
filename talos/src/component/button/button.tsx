import React from 'react';
import styles from './button.module.scss';

export type ButtonType = 'next' | 'prev' | 'close' | 'check';
export type ButtonStyle = 'normal' | 'icon';
export type ButtonSchema = 'light' | 'dark';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  text: string;
  width?: string | number; // e.g., '6rem' | 96
  height?: string | number; // e.g., '1.5rem' | 24
  buttonType?: ButtonType;
  buttonStyle?: ButtonStyle;
  schema?: ButtonSchema;
  deco?: boolean; // Control whether to show decorative elements
}

const toCssSize = (v?: string | number): string | undefined => {
  if (v === undefined) return undefined;
  return typeof v === 'number' ? `${v}px` : v;
};

const Button: React.FC<ButtonProps> = ({
  text,
  width = '6rem',
  height = '1.5rem',
  buttonType = 'close',
  buttonStyle = 'normal',
  schema = 'light',
  deco = true,
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
      data-type={buttonType}
      data-button-style={buttonStyle}
      data-schema={schema}
      data-deco={deco}
      {...rest}
    >
      {/* decorative line */}
      {deco && buttonStyle === 'normal' && <span className={styles.deco} aria-hidden="true" />}
      {/* content text */}
      {buttonStyle === 'normal' && <span className={styles.text}>{text}</span>}
      {/* icon */}
      <span className={styles.icon} aria-hidden="true" />
    </button>
  );
};

export default Button;
