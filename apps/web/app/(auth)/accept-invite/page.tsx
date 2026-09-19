import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AcceptInviteForm } from './accept-invite-form';

export const metadata: Metadata = {
  title: 'Set your password',
};

export default function AcceptInvitePage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">
        Set your password
      </h1>
      <p className="mt-2 text-sm text-ink-secondary">
        Choose a password to activate your CampusOS account. It must be at
        least 10 characters with an uppercase letter, a lowercase letter and a
        digit.
      </p>
      <Suspense fallback={null}>
        <AcceptInviteForm />
      </Suspense>
    </div>
  );
}
