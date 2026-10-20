import { useId, type InputHTMLAttributes, type ReactElement } from 'react';

import { cn } from './cn.js';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  hint?: string;
  error?: string | undefined;
}

/** Shared look of text inputs and selects. */
export const controlClass =
  'min-h-10 rounded-lg border border-line bg-surface px-3 py-2 text-fg aria-invalid:border-danger disabled:opacity-60';

/** A labelled input; hint and error text are linked through `aria-describedby` (NFR-10). */
export function TextField({
  label,
  hint,
  error,
  className,
  ...props
}: TextFieldProps): ReactElement {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label className="text-sm font-semibold" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={controlClass}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...props}
      />
      {hint && (
        <span id={hintId} className="text-sm text-muted">
          {hint}
        </span>
      )}
      {error && (
        <span id={errorId} className="text-sm text-danger">
          {error}
        </span>
      )}
    </div>
  );
}
