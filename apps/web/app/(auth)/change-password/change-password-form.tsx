'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { changePasswordSchema } from '@campusos/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSession } from '@/components/providers/session-provider';
import { apiFetch, ApiError } from '@/lib/api/client';

export function ChangePasswordForm() {
  const { user, status, refreshUser, logout } = useSession();
  const router = useRouter();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const formData = new FormData(event.currentTarget);
    const result = changePasswordSchema.safeParse({
      currentPassword: formData.get('currentPassword'),
      newPassword: formData.get('newPassword'),
    });
    if (!result.success) {
      const errors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const key = issue.path.join('.');
        if (!errors[key]) errors[key] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    try {
      await apiFetch('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify(result.data),
      });
      await refreshUser();
      router.push('/dashboard');
    } catch (error) {
      setFormError(
        error instanceof ApiError
          ? error.message
          : 'Unable to change password. Please try again.',
      );
      setSubmitting(false);
    }
  }

  if (status === 'loading') {
    return (
      <p className="mt-8 text-sm text-ink-muted" role="status">
        Restoring your session…
      </p>
    );
  }

  if (status === 'unauthenticated') {
    router.push('/login');
    return null;
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-5" noValidate>
      {user ? (
        <p className="text-sm text-ink-muted">
          Signed in as <span className="font-medium text-ink">{user.email}</span>
        </p>
      ) : null}
      <Input
        label="Current password"
        name="currentPassword"
        type="password"
        autoComplete="current-password"
        error={fieldErrors.currentPassword}
      />
      <Input
        label="New password"
        name="newPassword"
        type="password"
        autoComplete="new-password"
        error={fieldErrors.newPassword}
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
        {submitting ? 'Saving…' : 'Change password'}
      </Button>
      <button
        type="button"
        onClick={() => void logout()}
        className="text-sm text-ink-muted underline-offset-2 hover:text-ink hover:underline"
      >
        Sign out instead
      </button>
    </form>
  );
}
