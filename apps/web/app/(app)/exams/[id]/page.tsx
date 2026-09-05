'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  createExamPaperSchema,
  type ExamAnalytics,
  type ExamDetail,
  type ExamPaperItem,
  type MarksSheet,
  type SectionItem,
} from '@campusos/shared';
import { apiFetch, ApiError } from '@/lib/api/client';
import { useOptions } from '@/lib/hooks/use-list';
import { formValues, useZodForm } from '@/lib/hooks/use-zod-form';
import { useSession } from '@/components/providers/session-provider';
import { useToast } from '@/components/providers/toast-provider';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, ErrorState, Skeleton } from '@/components/data/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { examStatusTone } from '../exam-utils';

export default function ExamDetailPage() {
  const params = useParams<{ id: string }>();
  const { hasPermission } = useSession();
  const canManage = hasPermission('exams.manage');
  const canPublish = hasPermission('results.publish');
  const { toast } = useToast();

  const [exam, setExam] = useState<ExamDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [paperOpen, setPaperOpen] = useState(false);
  const [marksPaper, setMarksPaper] = useState<ExamPaperItem | null>(null);
  const [publishConfirm, setPublishConfirm] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const sections = useOptions<SectionItem>('/sections', canManage);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch<ExamDetail>(`/exams/${params.id}`)
      .then((response) => setExam(response.data))
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Failed to load'),
      )
      .finally(() => setLoading(false));
  }, [params.id]);
  useEffect(load, [load]);

  if (loading) return <Skeleton rows={8} />;
  if (error || !exam)
    return <ErrorState message={error ?? 'Not found'} onRetry={load} />;

  const isPublished = exam.status === 'PUBLISHED';

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={exam.title}
        description={`${exam.type.charAt(0) + exam.type.slice(1).toLowerCase()} · ${exam.termLabel}`}
        actions={
          <div className="flex items-center gap-3">
            <Badge tone={examStatusTone(exam.status)}>{exam.status}</Badge>
            {canManage && !isPublished ? (
              <Button variant="secondary" onClick={() => setPaperOpen(true)}>
                Add paper
              </Button>
            ) : null}
            {canPublish && !isPublished ? (
              <Button onClick={() => setPublishConfirm(true)}>
                Publish results
              </Button>
            ) : null}
          </div>
        }
      />

      {isPublished ? (
        <p className="mb-5 rounded-card border border-success-500/30 bg-success-50 px-4 py-3 text-sm text-success-700">
          Results were published
          {exam.publishedAt
            ? ` on ${new Date(exam.publishedAt).toLocaleString('en-GB')}`
            : ''}
          . Marks are locked and visible to students.
        </p>
      ) : null}

      <div className="rounded-card border border-line bg-surface-raised shadow-card">
        <h2 className="border-b border-line px-5 py-3 text-sm font-semibold">
          Papers ({exam.papers.length})
        </h2>
        {exam.papers.length === 0 ? (
          <EmptyState
            title="No papers yet"
            message="Add a paper per section so teachers can enter marks."
          />
        ) : (
          <ul className="divide-y divide-line">
            {exam.papers.map((paper) => (
              <li
                key={paper.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
              >
                <div>
                  <p className="text-sm font-medium">
                    {paper.courseCode} — Section {paper.sectionName}
                  </p>
                  <p className="text-xs text-ink-muted">
                    {new Date(paper.examDate).toLocaleString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {paper.room ? ` · ${paper.room}` : ''} · max {paper.maxMarks}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-ink-muted">
                    {paper.markCount}/{paper.enrolledCount} marks
                  </span>
                  {paper.canEnterMarks ? (
                    <Button
                      size="sm"
                      variant={isPublished ? 'secondary' : 'primary'}
                      onClick={() => setMarksPaper(paper)}
                    >
                      {isPublished ? 'View marks' : 'Enter marks'}
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {canManage ? (
        <AnalyticsPanel examId={exam.id} refreshKey={exam.markCount} />
      ) : null}

      {canManage ? (
        <AddPaperDialog
          open={paperOpen}
          examId={exam.id}
          sections={sections.filter(
            (section) =>
              section.termId === exam.termId &&
              !exam.papers.some((paper) => paper.sectionId === section.id),
          )}
          onClose={() => setPaperOpen(false)}
          onSaved={() => {
            setPaperOpen(false);
            toast('Paper added');
            load();
          }}
        />
      ) : null}

      {marksPaper ? (
        <MarksDialog
          paper={marksPaper}
          onClose={() => setMarksPaper(null)}
          onSaved={() => {
            setMarksPaper(null);
            toast('Marks saved');
            load();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={publishConfirm}
        title="Publish results"
        message={`Publish "${exam.title}"? This locks all marks permanently and notifies every student with a mark. This cannot be undone.`}
        confirmLabel="Publish results"
        tone="primary"
        busy={publishing}
        onConfirm={async () => {
          setPublishing(true);
          try {
            await apiFetch(`/exams/${exam.id}/publish`, { method: 'POST' });
            toast('Results published');
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
    </div>
  );
}

function AnalyticsPanel({
  examId,
  refreshKey,
}: {
  examId: string;
  refreshKey: number;
}) {
  const [analytics, setAnalytics] = useState<ExamAnalytics | null>(null);

  useEffect(() => {
    apiFetch<ExamAnalytics>(`/results/analytics?examId=${examId}`)
      .then((response) => setAnalytics(response.data))
      .catch(() => undefined);
  }, [examId, refreshKey]);

  if (!analytics) return null;
  const totalMarks = analytics.bandDistribution.reduce((sum, band) => sum + band.count, 0);

  return (
    <div className="mt-6 grid gap-4 lg:grid-cols-2">
      <section className="rounded-card border border-line bg-surface-raised shadow-card">
        <h2 className="border-b border-line px-5 py-3 text-sm font-semibold">
          Paper statistics
        </h2>
        {analytics.papers.every((paper) => paper.markCount === 0) ? (
          <p className="px-5 py-6 text-center text-sm text-ink-muted">
            Statistics appear once marks are entered.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                {['Paper', 'Marks', 'Avg', 'High', 'Low'].map((header) => (
                  <th key={header} className="px-5 py-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {analytics.papers.map((paper) => (
                <tr key={paper.paperId} className="border-b border-line last:border-b-0">
                  <td className="px-5 py-2">
                    {paper.courseCode} — {paper.sectionName}
                  </td>
                  <td className="px-5 py-2">{paper.markCount}</td>
                  <td className="px-5 py-2">{paper.average ?? '—'}</td>
                  <td className="px-5 py-2">{paper.highest ?? '—'}</td>
                  <td className="px-5 py-2">{paper.lowest ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-card border border-line bg-surface-raised shadow-card">
        <h2 className="border-b border-line px-5 py-3 text-sm font-semibold">
          Grade distribution
        </h2>
        {totalMarks === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-ink-muted">
            The distribution appears once marks are entered.
          </p>
        ) : (
          <ul className="space-y-2 px-5 py-4">
            {analytics.bandDistribution.map((band) => (
              <li key={band.label} className="flex items-center gap-3 text-sm">
                <span className="w-8 font-semibold">{band.label}</span>
                <div className="h-3 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                  <div
                    className="h-full rounded-full bg-brand-500"
                    style={{ width: `${totalMarks > 0 ? (band.count / totalMarks) * 100 : 0}%` }}
                  />
                </div>
                <span className="w-8 text-right text-xs text-ink-muted">{band.count}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function AddPaperDialog({
  open,
  examId,
  sections,
  onClose,
  onSaved,
}: {
  open: boolean;
  examId: string;
  sections: SectionItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const form = useZodForm(createExamPaperSchema);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const raw = formValues(event.currentTarget);
    if (typeof raw.examDate === 'string' && raw.examDate) {
      raw.examDate = new Date(raw.examDate as string).toISOString();
    }
    const input = form.validate(raw);
    if (!input) return;
    const done = await form.submit(async () => {
      await apiFetch(`/exams/${examId}/papers`, {
        method: 'POST',
        body: JSON.stringify(input),
      });
    });
    if (done) onSaved();
  }

  return (
    <Dialog
      open={open}
      title="Add paper"
      description="One paper per section; the section must belong to the exam's term."
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <Select
          label="Section"
          name="sectionId"
          placeholder={sections.length ? 'Select section' : 'No eligible sections'}
          options={sections.map((section) => ({
            value: section.id,
            label: `${section.courseCode} — Section ${section.name}`,
          }))}
          error={form.fieldErrors.sectionId}
        />
        <Input label="Exam date & time" name="examDate" type="datetime-local" error={form.fieldErrors.examDate} />
        <div className="grid grid-cols-2 gap-4">
          <Input label="Max marks" name="maxMarks" type="number" min={1} defaultValue={100} error={form.fieldErrors.maxMarks} />
          <Input label="Room (optional)" name="room" error={form.fieldErrors.room} />
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
          <Button type="submit" disabled={form.busy || sections.length === 0}>
            {form.busy ? 'Adding…' : 'Add paper'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function MarksDialog({
  paper,
  onClose,
  onSaved,
}: {
  paper: ExamPaperItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [sheet, setSheet] = useState<MarksSheet | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch<MarksSheet>(`/papers/${paper.id}/marks`)
      .then((response) => {
        setSheet(response.data);
        setValues(
          Object.fromEntries(
            response.data.entries.map((entry) => [
              entry.studentId,
              entry.marksObtained ?? '',
            ]),
          ),
        );
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Failed to load'),
      );
  }, [paper.id]);

  async function save() {
    if (!sheet) return;
    const marks = Object.entries(values)
      .filter(([, value]) => value.trim() !== '')
      .map(([studentId, value]) => ({
        studentId,
        marksObtained: Number(value),
      }));
    if (marks.length === 0) {
      setError('Enter at least one mark');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/papers/${paper.id}/marks`, {
        method: 'PUT',
        body: JSON.stringify({ marks }),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      title={`Marks — ${paper.courseCode} Section ${paper.sectionName}`}
      description={sheet ? `${sheet.examTitle} · max ${paper.maxMarks}` : undefined}
      onClose={onClose}
      wide
    >
      {!sheet && !error ? (
        <Skeleton rows={5} />
      ) : error && !sheet ? (
        <ErrorState message={error} />
      ) : sheet ? (
        <div className="flex flex-col gap-4">
          {sheet.locked ? (
            <p className="rounded-card border border-warning-500/30 bg-warning-50 px-4 py-2.5 text-sm text-warning-700">
              Results are published — marks are locked and read-only.
            </p>
          ) : null}
          <ul className="max-h-96 divide-y divide-line overflow-y-auto rounded-card border border-line">
            {sheet.entries.map((entry) => (
              <li key={entry.studentId} className="flex items-center justify-between gap-3 px-4 py-2">
                <div>
                  <p className="text-sm font-medium">{entry.name}</p>
                  <p className="font-mono text-xs text-ink-muted">{entry.rollNo}</p>
                </div>
                <input
                  type="number"
                  min={0}
                  max={Number(paper.maxMarks)}
                  step="0.5"
                  aria-label={`Marks for ${entry.name}`}
                  value={values[entry.studentId] ?? ''}
                  disabled={sheet.locked}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      [entry.studentId]: event.target.value,
                    }))
                  }
                  className="h-9 w-24 rounded-lg border border-line-strong bg-surface-raised px-2 text-right text-sm disabled:bg-surface-sunken"
                />
              </li>
            ))}
          </ul>
          {error ? (
            <p className="rounded-card border border-danger-500/30 bg-danger-50 px-4 py-3 text-sm text-danger-700" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              {sheet.locked ? 'Close' : 'Cancel'}
            </Button>
            {!sheet.locked ? (
              <Button onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save marks'}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
