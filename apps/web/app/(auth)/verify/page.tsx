import type { Metadata } from 'next';
import { VerifyFlow } from './verify-flow';

export const metadata: Metadata = {
  title: 'Verify your identity',
};

export default function VerifyPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">
        Verify your student identity
      </h1>
      <p className="mt-2 text-sm text-ink-secondary">
        To activate your account, tell us your admission number and upload a
        photo of your student ID card. Your college will review it.
      </p>
      <VerifyFlow />
    </div>
  );
}
