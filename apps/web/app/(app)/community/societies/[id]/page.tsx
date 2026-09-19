'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import type { PostItem, SocietyDetail } from '@campusos/shared';
import { apiFetch, ApiError } from '@/lib/api/client';
import { useList, useOptions } from '@/lib/hooks/use-list';
import { useToast } from '@/components/providers/toast-provider';
import { EmptyState, ErrorState, Skeleton } from '@/components/data/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import { PostCard, PostComposer } from '@/components/domain/community/post-card';

interface UserOption {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  rollNo?: string;
}

export default function SocietyDetailPage() {
  const params = useParams<{ id: string }>();
  const { toast } = useToast();
  const [society, setSociety] = useState<SocietyDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const posts = useList<PostItem>('/community/posts', { societyId: params.id });

  const load = useCallback(() => {
    setError(null);
    apiFetch<SocietyDetail>(`/community/societies/${params.id}`)
      .then((response) => setSociety(response.data))
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Failed to load'),
      );
  }, [params.id]);
  useEffect(load, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!society) return <Skeleton rows={6} />;

  const isOfficer = society.myRole === 'OFFICER' || society.myRole === 'PRESIDENT';

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
      <div className="flex flex-col gap-4">
        <div className="rounded-card border border-line bg-surface-raised p-5 shadow-card">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{society.name}</h2>
              <p className="mt-1 text-sm text-ink-secondary">{society.description}</p>
            </div>
            <Badge tone="brand">
              {society.category.charAt(0) + society.category.slice(1).toLowerCase()}
            </Badge>
          </div>
          <p className="mt-3 text-xs text-ink-muted">
            {society.memberCount} members
            {society.facultyAdvisorName
              ? ` · Advisor: ${society.facultyAdvisorName}`
              : ''}
            {society.myRole
              ? ` · You: ${society.myRole.charAt(0) + society.myRole.slice(1).toLowerCase()}`
              : ''}
          </p>
        </div>

        {isOfficer || society.canManageMembers ? (
          <PostComposer
            societyId={society.id}
            allowAchievement={false}
            onPosted={posts.refetch}
          />
        ) : null}

        {posts.loading ? (
          <Skeleton rows={3} />
        ) : posts.error ? (
          <ErrorState message={posts.error} onRetry={posts.refetch} />
        ) : posts.rows.length === 0 ? (
          <div className="rounded-card border border-line bg-surface-raised shadow-card">
            <EmptyState
              title="No updates yet"
              message="Society officers post announcements and updates here."
            />
          </div>
        ) : (
          posts.rows.map((post) => (
            <PostCard key={post.id} post={post} onChanged={posts.refetch} />
          ))
        )}
      </div>

      <aside className="rounded-card border border-line bg-surface-raised shadow-card">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h3 className="text-sm font-semibold">Members</h3>
          {society.canManageMembers ? (
            <Button size="sm" variant="secondary" onClick={() => setAddOpen(true)}>
              Add
            </Button>
          ) : null}
        </div>
        <ul className="divide-y divide-line">
          {society.members.map((member) => (
            <li key={member.userId} className="flex items-center justify-between gap-2 px-4 py-2.5">
              <div>
                <p className="text-sm">{member.name}</p>
                <p className="text-xs text-ink-muted">
                  {member.role.charAt(0) + member.role.slice(1).toLowerCase()}
                </p>
              </div>
              {society.canManageMembers ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    try {
                      await apiFetch(
                        `/community/societies/${society.id}/members/${member.userId}`,
                        { method: 'DELETE' },
                      );
                      toast('Member removed');
                      load();
                    } catch (err) {
                      toast(
                        err instanceof ApiError ? err.message : 'Failed',
                        'error',
                      );
                    }
                  }}
                >
                  Remove
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </aside>

      {society.canManageMembers ? (
        <AddMemberDialog
          open={addOpen}
          societyId={society.id}
          excludeUserIds={society.members.map((m) => m.userId)}
          onClose={() => setAddOpen(false)}
          onDone={() => {
            setAddOpen(false);
            toast('Member added');
            load();
          }}
        />
      ) : null}
    </div>
  );
}

function AddMemberDialog({
  open,
  societyId,
  excludeUserIds,
  onClose,
  onDone,
}: {
  open: boolean;
  societyId: string;
  excludeUserIds: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const students = useOptions<UserOption>('/students', open);
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState('MEMBER');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const candidates = students.filter(
    (student) => !excludeUserIds.includes(student.userId),
  );

  async function submit() {
    if (!userId) {
      setError('Choose a student');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/community/societies/${societyId}/members`, {
        method: 'POST',
        body: JSON.stringify({ userId, role }),
      });
      setUserId('');
      setRole('MEMBER');
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add member');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} title="Add society member" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Select
          label="Student"
          value={userId}
          onChange={(event) => setUserId(event.target.value)}
          placeholder={candidates.length ? 'Select student' : 'No eligible students'}
          options={candidates.map((student) => ({
            value: student.userId,
            label: `${student.rollNo ? `${student.rollNo} — ` : ''}${student.firstName} ${student.lastName}`,
          }))}
          error={error ?? undefined}
        />
        <Select
          label="Role"
          value={role}
          onChange={(event) => setRole(event.target.value)}
          options={[
            { value: 'MEMBER', label: 'Member' },
            { value: 'OFFICER', label: 'Officer' },
            { value: 'PRESIDENT', label: 'President' },
          ]}
        />
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || candidates.length === 0}>
            {busy ? 'Adding…' : 'Add member'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
