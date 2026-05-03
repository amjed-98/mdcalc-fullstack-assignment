import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

const baseStyles: React.CSSProperties = {
  borderRadius: 6,
  padding: '0.5rem 1rem',
  fontWeight: 600,
  cursor: 'pointer',
  border: '1px solid transparent',
  transition: 'background-color 120ms ease, border-color 120ms ease',
};

const variantStyles: Record<Variant, React.CSSProperties> = {
  primary: { background: '#0b6bcb', color: 'white' },
  secondary: { background: 'white', color: '#0b6bcb', borderColor: '#0b6bcb' },
  ghost: { background: 'transparent', color: '#0b6bcb' },
};

export function Button({ variant = 'primary', style, ...rest }: ButtonProps) {
  return <button {...rest} style={{ ...baseStyles, ...variantStyles[variant], ...style }} />;
}
