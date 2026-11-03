import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react';

import { cn } from './cn.js';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** An icon before the text; screen readers skip it, the text names the button. */
  icon?: ReactNode;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'border-transparent bg-primary text-on-primary hover:enabled:bg-primary-hover',
  secondary: 'border-line bg-surface text-fg hover:enabled:bg-canvas',
  ghost: 'border-transparent bg-transparent text-fg hover:enabled:bg-canvas',
};

/** An icon, sized to sit in a line of text and hidden from screen readers. */
export function IconSlot({ children }: { children: ReactNode }): ReactElement {
  return (
    <span aria-hidden="true" className="inline-flex shrink-0 [&>svg]:size-4">
      {children}
    </span>
  );
}

export function Button({
  variant = 'secondary',
  type = 'button',
  className,
  icon,
  children,
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
    >
      {icon !== undefined && <IconSlot>{icon}</IconSlot>}
      {children}
    </button>
  );
}

export interface IconButtonProps extends Omit<ButtonProps, 'icon' | 'children' | 'aria-label'> {
  icon: ReactNode;
  /** Names the button for screen readers and shows as its tooltip (ADR-071). */
  label: string;
}

/** A square button showing only an icon; its label names it and is its tooltip. */
export function IconButton({ icon, label, className, ...props }: IconButtonProps): ReactElement {
  return (
    <Button
      aria-label={label}
      title={label}
      className={cn('size-10 shrink-0 px-0', className)}
      {...props}
    >
      <IconSlot>{icon}</IconSlot>
    </Button>
  );
}
