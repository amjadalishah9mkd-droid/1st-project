'use client';

import { SelectHTMLAttributes, forwardRef, useId } from 'react';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, options, placeholder, id, className = '', ...props }, ref) => {
    const generatedId = useId();
    const selectId = id ?? generatedId;
    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={selectId} className="text-sm font-medium text-ink">
          {label}
        </label>
        <select
          ref={ref}
          id={selectId}
          aria-invalid={Boolean(error) || undefined}
          className={`h-10 rounded-lg border bg-surface-raised px-3 text-sm text-ink focus:outline focus:outline-2 focus:outline-offset-1 ${
            error
              ? 'border-danger-500 focus:outline-danger-500'
              : 'border-line-strong focus:outline-brand-500'
          } ${className}`}
          {...props}
        >
          {placeholder !== undefined ? (
            <option value="">{placeholder}</option>
          ) : null}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {error ? <p className="text-xs text-danger-700">{error}</p> : null}
      </div>
    );
  },
);
Select.displayName = 'Select';
