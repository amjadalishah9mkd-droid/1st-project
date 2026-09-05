'use client';

import { FormEvent, Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { loginSchema } from '@campusos/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSession } from '@/components/providers/session-provider';
import { apiFetch, ApiError } from '@/lib/api/client';

/** M11-W5 — friendly copy for Google-flow redirect errors. */
const GOOGLE_ERRORS: Record<string, string> = {
  google_not_linked:
    'This Google account is not connected to CampusOS yet. Sign in with your email first, or use your invitation link.',
  google_disabled: 'Google sign-in is not enabled for your college.',
  google_auth_failed: 'Google sign-in could not be completed. Please try again.',
  self_registration_disabled: 'Self-registration is not enabled for this college.',
  registration_unavailable:
    'Registration is not available for this Google account. Contact your college administration.',
};

function GoogleSection() {
  const params = useSearchParams();
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    apiFetch<{ google: boolean }>('/auth/config')
      .then((response) => setAvailable(response.data.google))
      .catch(() => setAvailable(false));
  }, []);

  const error = params.get('error');
  const activated = params.get('activated') === '1';

  return (
    <div className="flex flex-col gap-4">
      {activated ? (
        <p className="rounded-card border border-success-500/30 bg-success-50 px-4 py-3 text-sm text-success-700" role="status">
          Your account is ready — sign in below.
        </p>
      ) : null}
      {error && GOOGLE_ERRORS[error] ? (
        <p className="rounded-card border border-danger-500/30 bg-danger-50 px-4 py-3 text-sm text-danger-700" role="alert">
          {GOOGLE_ERRORS[error]}
        </p>
      ) : null}
      {available ? (
        <>
          <a
            href="/api/v1/auth/google/start?intent=login"
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
          <div className="flex items-center gap-3 text-xs text-ink-muted">
            <span className="h-px flex-1 bg-line" />
            or sign in with email
            <span className="h-px flex-1 bg-line" />
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * Login form (M1).
 * Client-side validation runs against the shared `loginSchema` — the exact
 * schema the API validates with. On success the access token is held in
 * memory only; the refresh token arrives as an httpOnly cookie.
 */
export function LoginForm() {
  const { login } = useSession();
  const router = useRouter();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const formData = new FormData(event.currentTarget);
    const result = loginSchema.safeParse({
      email: formData.get('email'),
      password: formData.get('password'),
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
      const user = await login(result.data);
      router.push(user.mustChangePassword ? '/change-password' : '/dashboard');
    } catch (error) {
      setFormError(
        error instanceof ApiError
          ? error.message
          : 'Unable to sign in. Please try again.',
      );
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-8 flex flex-col gap-5">
      <Suspense fallback={null}>
        <GoogleSection />
      </Suspense>
      <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
      <Input
        label="Email"
        name="email"
        type="email"
        placeholder="you@college.edu"
        autoComplete="email"
        error={fieldErrors.email}
      />
      <Input
        label="Password"
        name="password"
        type="password"
        placeholder="••••••••••"
        autoComplete="current-password"
        error={fieldErrors.password}
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
        {submitting ? 'Signing in…' : 'Sign in'}
      </Button>
      </form>
    </div>
  );
}
