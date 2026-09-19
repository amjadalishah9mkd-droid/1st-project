'use client';

import { useState } from 'react';
import type { ZodSchema } from 'zod';
import { ApiError } from '@/lib/api/client';

/**
 * useZodForm — one client-side validation path for all M2 forms, driven by
 * the shared schemas (identical to server validation).
 */
export function useZodForm<T>(schema: ZodSchema<T>) {
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function validate(raw: Record<string, unknown>): T | null {
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      cleaned[key] = value === '' ? undefined : value;
    }
    const result = schema.safeParse(cleaned);
    if (!result.success) {
      const errors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const key = issue.path.join('.');
        if (!errors[key]) errors[key] = issue.message;
      }
      setFieldErrors(errors);
      return null;
    }
    setFieldErrors({});
    setFormError(null);
    return result.data;
  }

  async function submit(action: () => Promise<void>): Promise<boolean> {
    setBusy(true);
    setFormError(null);
    try {
      await action();
      return true;
    } catch (error) {
      setFormError(
        error instanceof ApiError ? error.message : 'Request failed. Try again.',
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { fieldErrors, formError, busy, validate, submit, setFormError };
}

export function formValues(form: HTMLFormElement): Record<string, unknown> {
  const data = new FormData(form);
  const values: Record<string, unknown> = {};
  for (const [key, value] of data.entries()) {
    values[key] = typeof value === 'string' ? value : undefined;
  }
  return values;
}
