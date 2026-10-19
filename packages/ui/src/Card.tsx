import type { HTMLAttributes, ReactElement } from 'react';

import { cn } from './cn.js';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>): ReactElement {
  return (
    <div
      className={cn('rounded-lg border border-line bg-surface p-6 shadow-sm', className)}
      {...props}
    />
  );
}
