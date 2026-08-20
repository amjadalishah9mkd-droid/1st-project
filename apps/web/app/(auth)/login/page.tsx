import type { Metadata } from 'next';
import { LoginForm } from './login-form';

export const metadata: Metadata = {
  title: 'Sign in',
};

export default function LoginPage() {
  return (
    <div>
      <div className="mb-8 lg:hidden">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-brand-500 text-sm font-bold text-white">
            C
          </div>
          <span className="text-lg font-semibold tracking-tight">CampusOS</span>
        </div>
      </div>

      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-2 text-sm text-ink-secondary">
        Use your CampusOS account to access your workspace.
      </p>

      <LoginForm />
    </div>
  );
}
