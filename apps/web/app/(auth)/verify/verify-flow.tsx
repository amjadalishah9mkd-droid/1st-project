'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MyClaimItem } from '@campusos/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSession } from '@/components/providers/session-provider';
import { apiFetch, ApiError } from '@/lib/api/client';
import { getAccessToken } from '@/lib/auth/token-store';
import { requestRefresh } from '@/lib/auth/auth-api';

/**
 * M11-W5 — student verification flow.
 * States: no claim → submission form; PENDING → waiting card; REJECTED →
 * reason + resubmit. Approval routes to the dashboard on next load (the
 * refreshed session hint unpins /verify).
 */
export function VerifyFlow() {
  const { user, status, refreshUser, logout } = useSession();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [claims, setClaims] = useState<MyClaimItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resubmitting, setResubmitting] = useState(false);

  const load = useCallback(() => {
    apiFetch<MyClaimItem[]>('/verification/claims/me')
      .then((response) => setClaims(response.data))
      .catch((error) =>
        setLoadError(
          error instanceof ApiError ? error.message : 'Failed to load status',
        ),
      );
  }, []);

  useEffect(() => {
    if (status === 'authenticated') load();
  }, [status, load]);

  // Verified/legacy users don't belong here.
  useEffect(() => {
    if (
      user &&
      (user.verificationStatus === 'VERIFIED' ||
        user.verificationStatus === 'LEGACY')
    ) {
      router.push('/dashboard');
    }
  }, [user, router]);

  if (status === 'loading' || (status === 'authenticated' && claims === null && !loadError)) {
    return (
      <p className="mt-8 text-sm text-ink-muted" role="status">
        Checking your verification status…
      </p>
    );
  }
  if (status === 'unauthenticated') {
    router.push('/login');
    return null;
  }
  if (loadError) {
    return (
      <p className="mt-8 rounded-card border border-danger-500/30 bg-danger-50 px-4 py-3 text-sm text-danger-700" role="alert">
        {loadError}
      </p>
    );
  }

  const latest = claims?.[0] ?? null;
  const pending = latest?.status === 'PENDING' ? latest : null;
  const rejected =
    !pending && latest?.status === 'REJECTED' ? latest : null;
  const approved = latest?.status === 'APPROVED' ? latest : null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const formData = new FormData(event.currentTarget);
    const admissionNo = String(formData.get('admissionNo') ?? '').trim();
    const file = fileRef.current?.files?.[0];
    if (!admissionNo) {
      setFormError('Enter your admission number');
      return;
    }
    if (!file) {
      setFormError('Upload a photo of your student ID card');
      return;
    }
    setSubmitting(true);
    try {
      // 1. Evidence upload (purpose-restricted endpoint).
      const body = new FormData();
      body.append('file', file);
      const uploadRes = await fetch('/api/v1/verification/evidence', {
        method: 'POST',
        body,
        credentials: 'include',
        headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
      });
      const uploadJson = await uploadRes.json();
      if (!uploadRes.ok) {
        throw new ApiError(
          uploadJson?.error?.code ?? 'UNKNOWN',
          uploadJson?.error?.message ?? 'Upload failed',
          uploadRes.status,
        );
      }
      // 2. Claim submission.
      await apiFetch('/verification/claims', {
        method: 'POST',
        body: JSON.stringify({
          claimedAdmissionNo: admissionNo,
          evidenceFileKey: uploadJson.data.evidenceFileKey,
        }),
      });
      await refreshUser();
      load();
    } catch (error) {
      setFormError(
        error instanceof ApiError
          ? error.message
          : 'Could not submit your claim. Please try again.',
      );
    } finally {
      setSubmitting(false);
      setResubmitting(false);
    }
  }

  if (approved) {
    return (
      <div className="mt-8 rounded-card border border-success-500/30 bg-success-50 px-4 py-4 text-sm text-success-700">
        <p className="font-semibold">You are verified 🎉</p>
        <p className="mt-1">Redirecting you to your dashboard…</p>
        <RefreshToDashboard />
      </div>
    );
  }

  if (pending) {
    return (
      <div className="mt-8 flex flex-col gap-4">
        <div className="rounded-card border border-line bg-surface-raised p-5 shadow-card text-sm">
          <p className="font-semibold">Verification in progress</p>
          <p className="mt-2 text-ink-secondary">
            Your claim for admission number{' '}
            <span className="font-mono font-medium">{pending.claimedAdmissionNo}</span>{' '}
            was submitted on{' '}
            {new Date(pending.createdAt).toLocaleDateString(undefined, {
              dateStyle: 'medium',
            })}
            . Your college administration will review your ID card and
            approve or reject the claim. You will be notified here.
          </p>
          {pending.evidence ? (
            <p className="mt-2 text-xs text-ink-muted">
              Evidence: {pending.evidence.name}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-4">
          <Button variant="secondary" onClick={load}>
            Check status
          </Button>
          <button
            type="button"
            onClick={() => void logout()}
            className="text-sm text-ink-muted underline-offset-2 hover:text-ink hover:underline"
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  const showForm = !rejected || resubmitting;

  return (
    <div className="mt-8 flex flex-col gap-5">
      {rejected ? (
        <div className="rounded-card border border-danger-500/30 bg-danger-50 px-4 py-4 text-sm text-danger-700">
          <p className="font-semibold">Your claim was not approved</p>
          <p className="mt-1">
            {rejected.rejectionReason ??
              'Your college could not verify your identity from the submitted claim.'}
          </p>
          {!showForm ? (
            <Button className="mt-3" onClick={() => setResubmitting(true)}>
              Submit a new claim
            </Button>
          ) : null}
        </div>
      ) : null}

      {showForm ? (
        <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
          <Input
            label="Admission number"
            name="admissionNo"
            placeholder="e.g. ADM-2026-0042"
          />
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium" htmlFor="evidence">
              Student ID card (JPEG, PNG, WebP or PDF — max 5 MB)
            </label>
            <input
              id="evidence"
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="rounded-lg border border-line-strong bg-surface p-3 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white"
            />
            <p className="text-xs text-ink-muted">
              Used only as verification evidence and visible only to your
              college administration.
            </p>
          </div>

          {formError ? (
            <p className="rounded-card border border-danger-500/30 bg-danger-50 px-4 py-3 text-sm text-danger-700" role="alert">
              {formError}
            </p>
          ) : null}

          <Button type="submit" disabled={submitting}>
            {submitting ? 'Submitting…' : 'Submit for verification'}
          </Button>
        </form>
      ) : null}

      <button
        type="button"
        onClick={() => void logout()}
        className="self-start text-sm text-ink-muted underline-offset-2 hover:text-ink hover:underline"
      >
        Sign out
      </button>
    </div>
  );
}

/**
 * After approval the middleware pin is driven by the hint cookie, which
 * only updates on POST /auth/refresh — so force one before navigating.
 */
function RefreshToDashboard() {
  const { refreshUser } = useSession();
  const router = useRouter();
  useEffect(() => {
    void requestRefresh()
      .then(() => refreshUser())
      .finally(() => router.push('/dashboard'));
  }, [refreshUser, router]);
  return null;
}
