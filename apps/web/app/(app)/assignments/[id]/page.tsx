'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  gradeSubmissionSchema,
  submitAssignmentSchema,
  type AssignmentDetail,
  type SubmissionList,
  type SubmissionListEntry,
  type UploadedFileInfo,
} from '@campusos/shared';
import { apiFetch, ApiError } from '@/lib/api/client';
import { uploadFile } from '@/lib/api/upload';
import { openFile } from '@/lib/api/files';
import { formValues, useZodForm } from '@/lib/hooks/use-zod-form';
import { useSession } from '@/components/providers/session-provider';
import { useToast } from '@/components/providers/toast-provider';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, ErrorState, Skeleton } from '@/components/data/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { assignmentStatus, formatDue } from '../assignment-utils';

export default function AssignmentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { hasPermission } = useSession();
  const canManage = hasPermission('assignments.manage');
  const canGrade = hasPermission('assignments.grade');
  const canSubmit = hasPermission('assignments.submit');
  const { toast } = useToast();

  const [assignment, setAssignment] = useState<AssignmentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [publishConfirm, setPublishConfirm] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch<AssignmentDetail>(`/assignments/${params.id}`)
      .then((response) => setAssignment(response.data))
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Failed to load'),
      )
      .finally(() => setLoading(false));
  }, [params.id]);
  useEffect(load, [load]);

  if (loading) return <Skeleton rows={8} />;
  if (error || !assignment)
    return <ErrorState message={error ?? 'Not found'} onRetry={load} />;

  const status = assignmentStatus(assignment);
  const isDraft = !assignment.publishedAt;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={assignment.title}
        description={`${assignment.courseCode} — Section ${assignment.sectionName} · ${assignment.termLabel}`}
        actions={
          canManage ? (
            <>
              {isDraft ? (
                <>
                  <Button variant="secondary" onClick={() => setDeleteConfirm(true)}>
                    Delete draft
                  </Button>
                  <Button onClick={() => setPublishConfirm(true)}>Publish</Button>
                </>
              ) : null}
            </>
          ) : undefined
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Status', <Badge key="s" tone={status.tone}>{status.label}</Badge>],
          ['Due', formatDue(assignment.dueAt)],
          ['Max points', assignment.maxPoints],
          [
            'Late policy',
            assignment.allowLate ? 'Late allowed (flagged)' : 'No late submissions',
          ],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-card border border-line bg-surface-raised p-4 shadow-card">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
              {label as string}
            </p>
            <p className="mt-1 text-sm font-semibold">{value as React.ReactNode}</p>
          </div>
        ))}
      </div>

      <section className="mb-6 rounded-card border border-line bg-surface-raised p-5 shadow-card">
        <h2 className="text-sm font-semibold">Description</h2>
        <p className="mt-2 whitespace-pre-wrap text-sm text-ink-secondary">
          {assignment.description}
        </p>
        {assignment.attachments.length > 0 ? (
          <div className="mt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Attachments
            </h3>
            <ul className="mt-2 flex flex-wrap gap-2">
              {assignment.attachments.map((attachment) => (
                <li key={attachment.url}>
                  <button
                    type="button"
                    onClick={() => void openFile(attachment.url)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-brand-700 hover:border-brand-300"
                  >
                    ⬇ {attachment.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {canSubmit && !isDraft ? (
        <StudentSubmissionPanel assignment={assignment} onChanged={load} />
      ) : null}

      {canGrade ? <SubmissionsPanel assignmentId={assignment.id} /> : null}

      <ConfirmDialog
        open={publishConfirm}
        title="Publish assignment"
        message={`Publish "${assignment.title}"? Enrolled students will see it and receive a notification.`}
        confirmLabel="Publish"
        tone="primary"
        busy={publishing}
        onConfirm={async () => {
          setPublishing(true);
          try {
            await apiFetch(`/assignments/${assignment.id}/publish`, { method: 'POST' });
            toast('Assignment published');
            setPublishConfirm(false);
            load();
          } catch (err) {
            toast(err instanceof ApiError ? err.message : 'Publish failed', 'error');
          } finally {
            setPublishing(false);
          }
        }}
        onClose={() => setPublishConfirm(false)}
      />
      <ConfirmDialog
        open={deleteConfirm}
        title="Delete draft"
        message="Delete this draft assignment? This cannot be undone."
        confirmLabel="Delete"
        busy={deleting}
        onConfirm={async () => {
          setDeleting(true);
          try {
            await apiFetch(`/assignments/${assignment.id}`, { method: 'DELETE' });
            toast('Draft deleted');
            router.push('/assignments');
          } catch (err) {
            toast(err instanceof ApiError ? err.message : 'Delete failed', 'error');
            setDeleting(false);
          }
        }}
        onClose={() => setDeleteConfirm(false)}
      />
    </div>
  );
}

// ── Student: submit + view grade ─────────────────────────────

function StudentSubmissionPanel({
  assignment,
  onChanged,
}: {
  assignment: AssignmentDetail;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const form = useZodForm(submitAssignmentSchema);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploaded, setUploaded] = useState<UploadedFileInfo | null>(null);
  const [uploading, setUploading] = useState(false);
  const submission = assignment.mySubmission;
  const graded = Boolean(submission?.gradedAt);
  const pastDue = new Date(assignment.dueAt) < new Date();
  const canStillSubmit = !graded && (!pastDue || assignment.allowLate);

  async function handleAttach() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      setUploaded(await uploadFile(file));
    } catch {
      form.setFormError('File upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const raw = formValues(event.currentTarget);
    if (uploaded) {
      raw.fileUrl = uploaded.url;
      raw.fileName = uploaded.name;
    }
    const input = form.validate(raw);
    if (!input) return;
    const done = await form.submit(async () => {
      await apiFetch(`/assignments/${assignment.id}/submissions`, {
        method: 'POST',
        body: JSON.stringify(input),
      });
    });
    if (done) {
      toast(submission ? 'Submission updated' : 'Submitted');
      setUploaded(null);
      onChanged();
    }
  }

  return (
    <section className="mb-6 rounded-card border border-line bg-surface-raised p-5 shadow-card">
      <h2 className="text-sm font-semibold">Your submission</h2>

      {submission ? (
        <div className="mt-3 rounded-lg border border-line bg-surface p-4 text-sm">
          <p>
            Submitted {formatDue(submission.submittedAt)}{' '}
            {submission.isLate ? <Badge tone="warning">Late</Badge> : null}
          </p>
          {assignment.mySubmissionContent?.textContent ? (
            <p className="mt-2 whitespace-pre-wrap text-ink-secondary">
              {assignment.mySubmissionContent.textContent}
            </p>
          ) : null}
          {assignment.mySubmissionContent?.fileUrl ? (
            <button
              type="button"
              onClick={() => void openFile(assignment.mySubmissionContent!.fileUrl!)}
              className="mt-2 inline-block text-brand-700 hover:underline"
            >
              ⬇ {assignment.mySubmissionContent.fileName}
            </button>
          ) : null}
          {graded ? (
            <div className="mt-3 border-t border-line pt-3">
              <p className="font-semibold text-success-700">
                Grade: {submission.points}/{assignment.maxPoints}
              </p>
              {submission.feedback ? (
                <p className="mt-1 text-ink-secondary">“{submission.feedback}”</p>
              ) : null}
            </div>
          ) : (
            <p className="mt-2 text-xs text-ink-muted">Not graded yet.</p>
          )}
        </div>
      ) : null}

      {canStillSubmit ? (
        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3" noValidate>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="textContent" className="text-sm font-medium">
              {submission ? 'Update your answer' : 'Your answer'}
            </label>
            <textarea
              id="textContent"
              name="textContent"
              rows={4}
              defaultValue={assignment.mySubmissionContent?.textContent ?? ''}
              className={`rounded-lg border bg-surface-raised px-3 py-2 text-sm ${
                form.fieldErrors.textContent ? 'border-danger-500' : 'border-line-strong'
              }`}
            />
            {form.fieldErrors.textContent ? (
              <p className="text-xs text-danger-700">{form.fieldErrors.textContent}</p>
            ) : null}
          </div>
          <div className="flex items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              aria-label="Submission file"
              onChange={handleAttach}
              className="flex-1 text-xs file:mr-2 file:rounded-lg file:border-0 file:bg-surface-sunken file:px-2 file:py-1.5 file:text-xs"
            />
            {uploading ? (
              <span className="text-xs text-ink-muted">Uploading…</span>
            ) : uploaded ? (
              <span className="text-xs text-success-700">✓ {uploaded.name}</span>
            ) : null}
          </div>
          {pastDue && assignment.allowLate ? (
            <p className="text-xs text-warning-700">
              The due date has passed — your submission will be marked late.
            </p>
          ) : null}
          {form.formError ? (
            <p className="rounded-card border border-danger-500/30 bg-danger-50 px-4 py-3 text-sm text-danger-700" role="alert">
              {form.formError}
            </p>
          ) : null}
          <div>
            <Button type="submit" disabled={form.busy || uploading}>
              {form.busy ? 'Submitting…' : submission ? 'Resubmit' : 'Submit'}
            </Button>
          </div>
        </form>
      ) : !submission ? (
        <p className="mt-3 text-sm text-danger-700">
          The due date has passed and late submissions are not allowed.
        </p>
      ) : null}
    </section>
  );
}

// ── Teacher/Admin: submissions + grading ─────────────────────

function SubmissionsPanel({ assignmentId }: { assignmentId: string }) {
  const { toast } = useToast();
  const [list, setList] = useState<SubmissionList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [grading, setGrading] = useState<SubmissionListEntry | null>(null);

  const load = useCallback(() => {
    setError(null);
    apiFetch<SubmissionList>(`/assignments/${assignmentId}/submissions`)
      .then((response) => setList(response.data))
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Failed to load'),
      );
  }, [assignmentId]);
  useEffect(load, [load]);

  return (
    <section className="rounded-card border border-line bg-surface-raised shadow-card">
      <h2 className="border-b border-line px-5 py-3 text-sm font-semibold">
        Submissions{' '}
        {list
          ? `(${list.entries.filter((e) => e.submission).length}/${list.entries.length})`
          : ''}
      </h2>
      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : !list ? (
        <Skeleton rows={4} />
      ) : list.entries.length === 0 ? (
        <EmptyState title="No students enrolled" message="This section has no active roster." />
      ) : (
        <ul className="divide-y divide-line">
          {list.entries.map((entry) => (
            <li
              key={entry.studentId}
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
            >
              <div>
                <p className="text-sm font-medium">
                  {entry.studentName}{' '}
                  <span className="font-mono text-xs text-ink-muted">{entry.rollNo}</span>
                </p>
                {entry.submission ? (
                  <p className="text-xs text-ink-muted">
                    Submitted {formatDue(entry.submission.submittedAt)}
                    {entry.submission.isLate ? ' · late' : ''}
                    {entry.submission.fileName ? (
                      <>
                        {' · '}
                        <button
                          type="button"
                          onClick={() =>
                            entry.submission?.fileUrl &&
                            void openFile(entry.submission.fileUrl)
                          }
                          className="text-brand-700 hover:underline"
                        >
                          {entry.submission.fileName}
                        </button>
                      </>
                    ) : null}
                  </p>
                ) : (
                  <p className="text-xs text-ink-faint">Not submitted</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {entry.submission?.gradedAt ? (
                  <Badge tone="success">
                    {entry.submission.points}/{list.maxPoints}
                  </Badge>
                ) : entry.submission ? (
                  <Badge tone="warning">Ungraded</Badge>
                ) : null}
                {entry.submission ? (
                  <Button size="sm" variant="secondary" onClick={() => setGrading(entry)}>
                    {entry.submission.gradedAt ? 'Regrade' : 'Grade'}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {grading?.submission ? (
        <GradeDialog
          entry={grading}
          maxPoints={list?.maxPoints ?? '0'}
          onClose={() => setGrading(null)}
          onGraded={() => {
            setGrading(null);
            toast('Grade saved');
            load();
          }}
        />
      ) : null}
    </section>
  );
}

function GradeDialog({
  entry,
  maxPoints,
  onClose,
  onGraded,
}: {
  entry: SubmissionListEntry;
  maxPoints: string;
  onClose: () => void;
  onGraded: () => void;
}) {
  const form = useZodForm(gradeSubmissionSchema);
  const submission = entry.submission!;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = form.validate(formValues(event.currentTarget));
    if (!input) return;
    const done = await form.submit(async () => {
      await apiFetch(`/submissions/${submission.id}/grade`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      });
    });
    if (done) onGraded();
  }

  return (
    <Dialog
      open
      title={`Grade — ${entry.studentName}`}
      description={`Submitted ${formatDue(submission.submittedAt)}${submission.isLate ? ' (late)' : ''}`}
      onClose={onClose}
      wide
    >
      <div className="flex flex-col gap-4">
        {submission.textContent ? (
          <div className="max-h-48 overflow-y-auto rounded-lg border border-line bg-surface p-3 text-sm whitespace-pre-wrap">
            {submission.textContent}
          </div>
        ) : null}
        {submission.fileUrl ? (
          <button
            type="button"
            onClick={() => void openFile(submission.fileUrl!)}
            className="text-left text-sm text-brand-700 hover:underline"
          >
            ⬇ {submission.fileName}
          </button>
        ) : null}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          <Input
            label={`Points (max ${maxPoints})`}
            name="points"
            type="number"
            step="0.5"
            min={0}
            defaultValue={submission.points ?? ''}
            error={form.fieldErrors.points}
          />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="feedback" className="text-sm font-medium">
              Feedback (optional)
            </label>
            <textarea
              id="feedback"
              name="feedback"
              rows={3}
              defaultValue={submission.feedback ?? ''}
              className="rounded-lg border border-line-strong bg-surface-raised px-3 py-2 text-sm"
            />
          </div>
          {form.formError ? (
            <p className="rounded-card border border-danger-500/30 bg-danger-50 px-4 py-3 text-sm text-danger-700" role="alert">
              {form.formError}
            </p>
          ) : null}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={onClose} disabled={form.busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={form.busy}>
              {form.busy ? 'Saving…' : 'Save grade'}
            </Button>
          </div>
        </form>
      </div>
    </Dialog>
  );
}
