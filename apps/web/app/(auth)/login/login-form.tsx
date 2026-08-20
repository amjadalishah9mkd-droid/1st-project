'use client';

import { FormEvent, useState } from 'react';
import { loginSchema } from '@campusos/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Login form — M0 state.
 * Client-side validation runs against the shared `loginSchema` (the same
 * schema the API will validate with). The authentication endpoint itself is
 * delivered in Milestone M1; until then submission is honestly disabled and
 * labeled as such — no fake sign-in behavior.
 */
export function LoginForm() {
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-5" noValidate>
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

      <Button type="submit" disabled title="Authentication is delivered in Milestone M1">
        Sign in
      </Button>

      <p
        className="rounded-card border border-warning-500/30 bg-warning-50 px-4 py-3 text-xs leading-relaxed text-warning-700"
        role="status"
      >
        <span className="font-semibold">Milestone M0.</span> The platform
        foundation is in place. Sign-in is enabled in Milestone M1
        (Authentication &amp; Access) — this button is intentionally disabled
        until the real authentication service ships.
      </p>
    </form>
  );
}
