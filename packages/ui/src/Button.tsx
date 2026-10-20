import type { ButtonHTMLAttributes, ReactElement } from 'react';

import { cn } from './cn.js';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'border-transparent bg-primary text-on-primary hover:enabled:bg-primary-hover',
  secondary: 'border-line bg-surface text-fg hover:enabled:bg-canvas',
  ghost: 'border-transparent bg-transparent text-fg hover:enabled:bg-canvas',
};

export function Button({
  variant = 'secondary',
  type = 'button',
  className,
  ...props
}: ButtonProps): ReactElement {
  return (
    <button
      type={type}
      data-variant={variant}
      className={cn(
        'inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border px-4 font-semibold transition-colors motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-60',
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}
