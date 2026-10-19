import type { ReactElement, ReactNode } from 'react';

export interface AlertProps {
  tone?: 'error' | 'info';
  children: ReactNode;
}

const TONES = {
  error: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-fg',
} as const;

/** Errors are announced to screen readers immediately; info messages politely. */
export function Alert({ tone = 'info', children }: AlertProps): ReactElement {
  return (
    <div
      className={`rounded-lg px-4 py-3 ${TONES[tone]}`}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      {children}
    </div>
  );
}
