'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { CourseItem, SectionItem } from '@campusos/shared';
import { apiFetch, ApiError } from '@/lib/api/client';
import { useList } from '@/lib/hooks/use-list';
import { useSession } from '@/components/providers/session-provider';
import { useToast } from '@/components/providers/toast-provider';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable, ErrorState, Skeleton } from '@/components/data/data-table';
import { Badge, statusTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';

export default function CourseDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { hasPermission } = useSession();
  const canManage = hasPermission('academics.manage');
  const { toast } = useToast();
  const [course, setCourse] = useState<CourseItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const sections = useList<SectionItem>('/sections', { courseId: params.id });

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch<CourseItem>(`/courses/${params.id}`)
      .then((response) => setCourse(response.data))
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Failed to load'),
      )
      .finally(() => setLoading(false));
  }, [params.id]);

  useEffect(load, [load]);

  if (loading) return <Skeleton rows={8} />;
  if (error || !course)
    return <ErrorState message={error ?? 'Not found'} onRetry={load} />;

  const archived = course.status === 'ARCHIVED';

  async function toggleArchive() {
    setArchiving(true);
    try {
      await apiFetch(`/courses/${params.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: archived ? 'ACTIVE' : 'ARCHIVED' }),
      });
      toast(archived ? 'Course restored' : 'Course archived');
      setConfirmArchive(false);
      load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Action failed', 'error');
    } finally {
      setArchiving(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={`${course.code} — ${course.title}`}
        description={`${course.departmentName} · ${course.credits} credits`}
        actions={
          canManage ? (
            <Button
              variant={archived ? 'primary' : 'secondary'}
              onClick={() => setConfirmArchive(true)}
            >
              {archived ? 'Restore course' : 'Archive course'}
            </Button>
          ) : undefined
        }
      />

      <div className="mb-6 flex items-center gap-3">
        <Badge tone={statusTone(course.status)}>{course.status}</Badge>
        {course.description ? (
          <p className="text-sm text-ink-secondary">{course.description}</p>
        ) : null}
      </div>

      <h2 className="mb-3 text-sm font-semibold">Sections</h2>
      <DataTable
        rowKey={(row) => row.id}
        rows={sections.rows}
        meta={sections.meta}
        loading={sections.loading}
        error={sections.error}
        onPageChange={sections.setPage}
        onRetry={sections.refetch}
        onRowClick={(row) => router.push(`/sections/${row.id}`)}
        emptyTitle="No sections"
        emptyMessage={
          archived
            ? 'Archived courses cannot receive new sections.'
            : 'Create sections for this course from the Sections page.'
        }
        columns={[
          { key: 'name', header: 'Section', render: (row) => row.name },
          { key: 'term', header: 'Term', render: (row) => row.termLabel },
          {
            key: 'enrolled',
            header: 'Enrolled',
            render: (row) => `${row.enrolledCount}/${row.capacity}`,
          },
          {
            key: 'teachers',
            header: 'Teachers',
            render: (row) => row.teacherNames.join(', ') || '—',
          },
          { key: 'room', header: 'Room', render: (row) => row.room ?? '—' },
        ]}
      />

      <ConfirmDialog
        open={confirmArchive}
        title={archived ? 'Restore course' : 'Archive course'}
        message={
          archived
            ? `Restore ${course.code}? New sections can then be created for it again.`
            : `Archive ${course.code}? Existing sections keep working, but no new sections can be created. Nothing is deleted.`
        }
        confirmLabel={archived ? 'Restore' : 'Archive'}
        tone={archived ? 'primary' : 'danger'}
        busy={archiving}
        onConfirm={toggleArchive}
        onClose={() => setConfirmArchive(false)}
      />
    </div>
  );
}
