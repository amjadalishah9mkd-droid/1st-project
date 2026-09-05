'use client';

import { FormEvent, useEffect, useState } from 'react';
import type { CollegeSettings, GoogleAuthMode } from '@campusos/shared';
import { apiFetch, ApiError } from '@/lib/api/client';
import { useToast } from '@/components/providers/toast-provider';
import { PageHeader } from '@/components/layout/page-header';
import { ErrorState, Skeleton } from '@/components/data/data-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

interface Payload {
  name: string;
  code: string;
  settings: CollegeSettings;
}

const MODE_HELP: Record<GoogleAuthMode, string> = {
  off: 'Google sign-in is disabled. Students use password login and invitations set passwords.',
  additive:
    'Google sign-in is available alongside passwords. Announce the grace period before switching to Required.',
  required:
    'Google-only for students: accounts with a student record cannot sign in with a password. Staff accounts are unaffected.',
};

/**
 * M11-W7 — college settings (Google-auth rollout). The backend enforces
 * settings.manage, tenancy, validation and auditing; this page is a thin
 * authorized editor.
 */
export default function SettingsPage() {
  const { toast } = useToast();
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<GoogleAuthMode>('off');
  const [selfReg, setSelfReg] = useState(false);
  const [graceDays, setGraceDays] = useState('30');
  const [attendanceThreshold, setAttendanceThreshold] = useState('75');
  const [saving, setSaving] = useState(false);

  function load() {
    setError(null);
    apiFetch<Payload>('/settings/college')
      .then((response) => {
        setPayload(response.data);
        setMode(response.data.settings.googleAuth);
        setSelfReg(response.data.settings.allowSelfRegistration);
        setGraceDays(String(response.data.settings.googleAuthGraceDays));
        setAttendanceThreshold(
          String(response.data.settings.attendanceWarningThreshold),
        );
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Failed to load settings'),
      );
  }
  useEffect(load, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await apiFetch<Payload>('/settings/college', {
        method: 'PATCH',
        body: JSON.stringify({
          googleAuth: mode,
          allowSelfRegistration: selfReg,
          googleAuthGraceDays: Number(graceDays),
          attendanceWarningThreshold: Number(attendanceThreshold),
        }),
      });
      setPayload(response.data);
      toast('College settings saved');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!payload) return <Skeleton rows={6} />;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Settings"
        description={`${payload.name} (${payload.code}) — identity, sign-in & display configuration.`}
      />

      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-5 rounded-card border border-line bg-surface-raised p-6 shadow-card"
      >
        <div className="flex flex-col gap-1.5">
          <Select
            label="Google sign-in mode"
            value={mode}
            onChange={(event) => setMode(event.target.value as GoogleAuthMode)}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'additive', label: 'Additive (Google + password)' },
              { value: 'required', label: 'Required (Google-only for students)' },
            ]}
          />
          <p className="text-xs text-ink-muted">{MODE_HELP[mode]}</p>
        </div>

        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={selfReg}
            onChange={(event) => setSelfReg(event.target.checked)}
            className="h-4 w-4 rounded border-line-strong"
          />
          <span>
            Allow student self-registration with Google
            <span className="block text-xs text-ink-muted">
              New students may register themselves and submit an identity
              claim for admin review. Off by default.
            </span>
          </span>
        </label>

        <div className="flex flex-col gap-1.5">
          <Input
            label="Grace period before Required (days)"
            type="number"
            min={0}
            max={365}
            value={graceDays}
            onChange={(event) => setGraceDays(event.target.value)}
          />
          <p className="text-xs text-ink-muted">
            Operational transition window: announce this period while in
            Additive mode, then switch to Required. The switch itself is the
            enforcement — there is no hidden password exception.
          </p>
        </div>

        <div className="flex justify-end">
          <div className="flex flex-col gap-1.5">
            <Input
              label="Attendance warning threshold (%)"
              type="number"
              min={0}
              max={100}
              value={attendanceThreshold}
              onChange={(event) => setAttendanceThreshold(event.target.value)}
            />
            <p className="text-xs text-ink-muted">
              Students whose attendance percentage falls below this value are
              flagged on attendance views. Display only — it never changes
              attendance records or sends notifications.
            </p>
          </div>

          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save settings'}
          </Button>
        </div>
      </form>
    </div>
  );
}
