'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { acceptInviteSchema } from '@campusos/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiFetch, ApiError } from '@/lib/api/client';

type InviteMode = 'password' | 'google' | 'both';

export function AcceptInviteForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const isReset = params.get('purpose') === 'reset';

  const [mode, setMode] = useState<InviteMode | null>(isReset ? 'password' : null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // M11-W4: invitations may be activated with Google, a password, or both —
  // decided server-side by the invited student's college settings.
  useEffect(() => {
    if (isReset || !token) return;
    apiFetch<{ mode: InviteMode }>(
      `/auth/invite-info?token=${encodeURIComponent(token)}`,
    )
      .then((response) => setMode(response.data.mode))
      .catch((error) =>
        setInviteError(
          error instanceof ApiError
            ? error.message
            : 'This link is invalid or has expired. Request a new one.',
        ),
      );
  }, [isReset, token]);

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

  if (inviteError) {
    return (
      <p
        className="mt-8 rounded-card border border-danger-500/30 bg-danger-50 px-4 py-3 text-sm text-danger-700"
        role="alert"
      >
        {inviteError}
      </p>
    );
  }

  if (mode === null) {
    return (
      <p className="mt-8 text-sm text-ink-muted" role="status">
        Checking your invitation…
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

  const showGoogle = !isReset && (mode === 'google' || mode === 'both');
  const showPassword = mode === 'password' || mode === 'both';

  return (
    <div className="mt-8 flex flex-col gap-6">
      {showGoogle ? (
        <div className="flex flex-col gap-3">
          <a
            href={`/api/v1/auth/google/start?intent=invite&token=${encodeURIComponent(token)}`}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-line-strong bg-surface px-4 text-sm font-medium shadow-sm transition-colors hover:bg-surface-raised"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
              <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.57-5.17 3.57-8.81Z" />
              <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.88-3.01c-1.08.72-2.45 1.15-4.06 1.15-3.13 0-5.78-2.11-6.72-4.95H1.27v3.11A12 12 0 0 0 12 24Z" />
              <path fill="#FBBC05" d="M5.28 14.28a7.2 7.2 0 0 1 0-4.56V6.61H1.27a12 12 0 0 0 0 10.78l4.01-3.11Z" />
              <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.44-3.44A11.98 11.98 0 0 0 1.27 6.61l4.01 3.11C6.22 6.88 8.87 4.77 12 4.77Z" />
            </svg>
            Continue with Google
          </a>
          {showPassword ? (
            <div className="flex items-center gap-3 text-xs text-ink-muted">
              <span className="h-px flex-1 bg-line" />
              or set a password
              <span className="h-px flex-1 bg-line" />
            </div>
          ) : (
            <p className="text-xs text-ink-muted">
              Your college requires Google sign-in for student accounts.
            </p>
          )}
        </div>
      ) : null}

      {showPassword ? (
        <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
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
        </form>
      ) : null}

      <Link
        href="/login"
        className="text-sm text-ink-muted underline-offset-2 hover:text-ink hover:underline"
      >
        Back to sign in
      </Link>
    </div>
  );
}
