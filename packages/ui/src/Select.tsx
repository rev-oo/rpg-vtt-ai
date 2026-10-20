import { useId, type ReactElement, type SelectHTMLAttributes } from 'react';

import { cn } from './cn.js';
import { controlClass } from './TextField.js';

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  label: string;
}

export function Select({ label, className, children, ...props }: SelectProps): ReactElement {
  const id = useId();
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label className="text-sm font-semibold" htmlFor={id}>
        {label}
      </label>
      <select id={id} className={controlClass} {...props}>
        {children}
      </select>
    </div>
  );
}
