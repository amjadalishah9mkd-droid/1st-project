'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { acceptInviteSchema } from '@campusos/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiFetch, ApiError } from '@/lib/api/client';

export function AcceptInviteForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const isReset = params.get('purpose') === 'reset';

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!token) {
    return (
      <p
        className="mt-8 rounded-card border border-danger-500/30 bg-danger-50 px-4 py-3 text-sm text-danger-700"
        role="alert"
      >
        This link is incomplete. Ask your administrator for a new one.
      </p>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const formData = new FormData(event.currentTarget);
    const password = formData.get('password');
    const confirm = formData.get('confirmPassword');
    const result = acceptInviteSchema.safeParse({ token, password });
    if (!result.success) {
      const errors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const key = issue.path.join('.');
        if (!errors[key]) errors[key] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }
    if (password !== confirm) {
      setFieldErrors({ confirmPassword: 'Passwords do not match' });
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    try {
      await apiFetch(isReset ? '/auth/reset-password' : '/auth/accept-invite', {
        method: 'POST',
        body: JSON.stringify(result.data),
      });
      router.push('/login?activated=1');
    } catch (error) {
      setFormError(
        error instanceof ApiError
          ? error.message
          : 'Unable to set your password. Please try again.',
      );
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-5" noValidate>
      <Input
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        error={fieldErrors.password}
      />
      <Input
        label="Confirm password"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        error={fieldErrors.confirmPassword}
      />

      {formError ? (
        <p
          className="rounded-card border border-danger-500/30 bg-danger-50 px-4 py-3 text-sm text-danger-700"
          role="alert"
        >
          {formError}
        </p>
      ) : null}

      <Button type="submit" disabled={submitting}>
        {submitting ? 'Saving…' : isReset ? 'Reset password' : 'Activate account'}
      </Button>
      <Link
        href="/login"
        className="text-sm text-ink-muted underline-offset-2 hover:text-ink hover:underline"
      >
        Back to sign in
      </Link>
    </form>
  );
}
