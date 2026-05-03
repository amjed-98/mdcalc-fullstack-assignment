import type { HTMLAttributes, ReactNode } from 'react';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  title?: ReactNode;
  footer?: ReactNode;
}

export function Card({ title, footer, children, style, ...rest }: CardProps) {
  return (
    <section
      {...rest}
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        background: 'white',
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
        padding: '1.25rem',
        ...style,
      }}
    >
      {title ? <header style={{ fontWeight: 600, marginBottom: '0.75rem' }}>{title}</header> : null}
      <div>{children}</div>
      {footer ? <footer style={{ marginTop: '1rem' }}>{footer}</footer> : null}
    </section>
  );
}
