import type { Metadata } from 'next';
import { ChangePasswordForm } from './change-password-form';

export const metadata: Metadata = {
  title: 'Change password',
};

export default function ChangePasswordPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">
        Change your password
      </h1>
      <p className="mt-2 text-sm text-ink-secondary">
        Choose a new password to continue. It must be at least 10 characters
        with an uppercase letter, a lowercase letter and a digit.
      </p>
      <ChangePasswordForm />
    </div>
  );
}
