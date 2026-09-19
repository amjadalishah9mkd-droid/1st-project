'use client';

import { FormEvent, useRef, useState } from 'react';
import {
  createResourceSchema,
  type CourseItem,
  type ResourceItem,
  type UploadedFileInfo,
} from '@campusos/shared';
import { apiFetch, ApiError } from '@/lib/api/client';
import { uploadFile } from '@/lib/api/upload';
import { openFile } from '@/lib/api/files';
import { useList, useOptions } from '@/lib/hooks/use-list';
import { formValues, useZodForm } from '@/lib/hooks/use-zod-form';
import { useToast } from '@/components/providers/toast-provider';
import { EmptyState, ErrorState, Skeleton } from '@/components/data/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ResourcesPage() {
  const list = useList<ResourceItem>('/community/resources');
  const courses = useOptions<CourseItem>('/courses');
  const { toast } = useToast();
  const [uploadOpen, setUploadOpen] = useState(false);

  async function download(resource: ResourceItem) {
    try {
      const response = await apiFetch<{ url: string }>(
        `/community/resources/${resource.id}/download`,
      );
      await openFile(response.data.url);
      list.refetch();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Download failed', 'error');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <input
          type="search"
          value={list.search}
          onChange={(event) => list.onSearchChange(event.target.value)}
          placeholder="Search resources…"
          aria-label="Search resources"
          className="h-9 w-64 rounded-lg border border-line-strong bg-surface-raised px-3 text-sm"
        />
        <Button onClick={() => setUploadOpen(true)}>Share resource</Button>
      </div>

      {list.loading ? (
        <Skeleton rows={4} />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.refetch} />
      ) : list.rows.length === 0 ? (
        <div className="rounded-card border border-line bg-surface-raised shadow-card">
          <EmptyState
            title="No resources yet"
            message="Share notes, slides and study material with your peers."
          />
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.rows.map((resource) => (
            <li
              key={resource.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface-raised p-4 shadow-card"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold">
                  {resource.title}{' '}
                  {resource.courseCode ? (
                    <Badge tone="brand">{resource.courseCode}</Badge>
                  ) : null}
                </p>
                {resource.description ? (
                  <p className="mt-0.5 text-sm text-ink-secondary">
                    {resource.description}
                  </p>
                ) : null}
                <p className="mt-1 text-xs text-ink-muted">
                  {resource.fileName} · {formatSize(resource.fileSize)} · shared by{' '}
                  {resource.uploaderName} · {resource.downloadCount} downloads
                </p>
              </div>
              <Button size="sm" variant="secondary" onClick={() => download(resource)}>
                Download
              </Button>
            </li>
          ))}
        </ul>
      )}

      <ShareResourceDialog
        open={uploadOpen}
        courses={courses}
        onClose={() => setUploadOpen(false)}
        onSaved={() => {
          setUploadOpen(false);
          toast('Resource shared');
          list.refetch();
        }}
      />
    </div>
  );
}

function ShareResourceDialog({
  open,
  courses,
  onClose,
  onSaved,
}: {
  open: boolean;
  courses: CourseItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const form = useZodForm(createResourceSchema);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploaded, setUploaded] = useState<UploadedFileInfo | null>(null);
  const [uploading, setUploading] = useState(false);

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
      raw.fileSize = uploaded.size;
    }
    const input = form.validate(raw);
    if (!input) return;
    const done = await form.submit(async () => {
      await apiFetch('/community/resources', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    });
    if (done) {
      setUploaded(null);
      onSaved();
    }
  }

  return (
    <Dialog
      open={open}
      title="Share a resource"
      description="Upload a file (max 10 MB) and describe it so others can find it."
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <Input label="Title" name="title" error={form.fieldErrors.title} />
        <Input label="Description (optional)" name="description" error={form.fieldErrors.description} />
        <Select
          label="Course tag (optional)"
          name="courseId"
          placeholder="No course"
          options={courses.map((course) => ({
            value: course.id,
            label: `${course.code} — ${course.title}`,
          }))}
          error={form.fieldErrors.courseId}
        />
        <div className="flex items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            aria-label="Resource file"
            onChange={handleAttach}
            className="flex-1 text-xs file:mr-2 file:rounded-lg file:border-0 file:bg-surface-sunken file:px-2 file:py-1.5 file:text-xs"
          />
          {uploading ? (
            <span className="text-xs text-ink-muted">Uploading…</span>
          ) : uploaded ? (
            <span className="text-xs text-success-700">✓ {uploaded.name}</span>
          ) : null}
        </div>
        {form.fieldErrors.fileUrl ? (
          <p className="text-xs text-danger-700">{form.fieldErrors.fileUrl}</p>
        ) : null}
        {form.formError ? (
          <p className="rounded-card border border-danger-500/30 bg-danger-50 px-4 py-3 text-sm text-danger-700" role="alert">
            {form.formError}
          </p>
        ) : null}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose} disabled={form.busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={form.busy || uploading || !uploaded}>
            {form.busy ? 'Sharing…' : 'Share resource'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
