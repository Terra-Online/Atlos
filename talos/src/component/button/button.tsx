import React from 'react';
import styles from './button.module.scss';

export type ButtonType = 'next' | 'prev' | 'close' | 'confirm';
export type ButtonStyle = 'normal' | 'icon' | 'square';
export type ButtonSchema = 'light' | 'dark';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  text: string;
  buttonType?: ButtonType;
  buttonStyle?: ButtonStyle;
  schema?: ButtonSchema;
  deco?: boolean; // Control whether to show decorative elements
  // Size params: width/height for 'normal', size for 'icon'
  width?: string | number; // Only for buttonStyle='normal' | 'square', e.g., '6rem' | 96
  height?: string | number; // Only for buttonStyle='normal' | 'square', e.g., '1.5rem' | 24
  size?: string | number; // Only for buttonStyle='icon', creates square button, e.g., '2rem' | 32
}

const toCssSize = (v?: string | number): string | undefined => {
  if (v === undefined) return undefined;
  return typeof v === 'number' ? `${v}px` : v;
};

const Button: React.FC<ButtonProps> = ({
  text,
  width = '6rem',
  height = '1.5rem',
  size = '2rem',
  buttonType = 'close',
  buttonStyle = 'normal',
  schema = 'light',
  deco = true,
  className,
  style,
  ...rest
}) => {
  // Default dimensions for square style if not provided
  const finalWidth = buttonStyle === 'square' && width === '6rem' ? '12rem' : width;
  const finalHeight = buttonStyle === 'square' && height === '1.5rem' ? '3rem' : height;

  const mergedStyle: React.CSSProperties = {
    '--btn-width': buttonStyle === 'icon' ? toCssSize(size) : toCssSize(finalWidth),
    '--btn-height': buttonStyle === 'icon' ? toCssSize(size) : toCssSize(finalHeight),
    ...style,
  } as React.CSSProperties;

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
      {(buttonStyle === 'normal' || buttonStyle === 'square') && <span className={styles.text}>{text}</span>}
      {/* icon */}
      {buttonStyle !== 'square' && <span className={styles.icon} aria-hidden="true" />}
    </button>
  );
};

export default Button;
