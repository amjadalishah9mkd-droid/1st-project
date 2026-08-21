'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import type { GroupDetail, PostItem } from '@campusos/shared';
import { apiFetch, ApiError } from '@/lib/api/client';
import { useList } from '@/lib/hooks/use-list';
import { useToast } from '@/components/providers/toast-provider';
import { EmptyState, ErrorState, Skeleton } from '@/components/data/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PostCard, PostComposer } from '@/components/domain/community/post-card';

export default function GroupDetailPage() {
  const params = useParams<{ id: string }>();
  const { toast } = useToast();
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const posts = useList<PostItem>('/community/posts', { groupId: params.id });

  const load = useCallback(() => {
    setError(null);
    apiFetch<GroupDetail>(`/community/groups/${params.id}`)
      .then((response) => setGroup(response.data))
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Failed to load'),
      );
  }, [params.id]);
  useEffect(load, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!group) return <Skeleton rows={6} />;

  const isActiveMember = group.myMembership?.status === 'ACTIVE';
  const membersOnly = group.privacy === 'REQUEST' && !isActiveMember;

  async function membershipAction(
    action: 'join' | 'leave' | 'approve' | 'remove',
    userId?: string,
  ) {
    try {
      if (action === 'join') {
        await apiFetch(`/community/groups/${group!.id}/membership`, { method: 'POST' });
      } else if (action === 'approve') {
        await apiFetch(
          `/community/groups/${group!.id}/membership/${userId}/approve`,
          { method: 'PATCH' },
        );
      } else {
        const query = userId ? `?userId=${userId}` : '';
        await apiFetch(`/community/groups/${group!.id}/membership${query}`, {
          method: 'DELETE',
        });
      }
      toast('Done');
      load();
      posts.refetch();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Action failed', 'error');
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
      <div className="flex flex-col gap-4">
        <div className="rounded-card border border-line bg-surface-raised p-5 shadow-card">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{group.name}</h2>
              <p className="mt-1 text-sm text-ink-secondary">{group.description}</p>
            </div>
            <Badge tone={group.privacy === 'OPEN' ? 'success' : 'warning'}>
              {group.privacy === 'OPEN' ? 'Open' : 'By request'}
            </Badge>
          </div>
          <div className="mt-3 flex items-center gap-3 text-xs text-ink-muted">
            <span>{group.memberCount} members</span>
            <span>Created by {group.createdByName}</span>
            {!group.myMembership ? (
              <Button size="sm" onClick={() => membershipAction('join')}>
                {group.privacy === 'OPEN' ? 'Join' : 'Request to join'}
              </Button>
            ) : group.myMembership.status === 'PENDING' ? (
              <Badge tone="neutral">Request pending</Badge>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => membershipAction('leave')}>
                Leave
              </Button>
            )}
          </div>
        </div>

        {membersOnly ? (
          <div className="rounded-card border border-line bg-surface-raised shadow-card">
            <EmptyState
              title="Members only"
              message="Request to join this group to see its posts."
            />
          </div>
        ) : (
          <>
            {isActiveMember ? (
              <PostComposer groupId={group.id} onPosted={posts.refetch} />
            ) : null}
            {posts.loading ? (
              <Skeleton rows={3} />
            ) : posts.error ? (
              <ErrorState message={posts.error} onRetry={posts.refetch} />
            ) : posts.rows.length === 0 ? (
              <div className="rounded-card border border-line bg-surface-raised shadow-card">
                <EmptyState title="No posts yet" message="Start the conversation." />
              </div>
            ) : (
              posts.rows.map((post) => (
                <PostCard key={post.id} post={post} onChanged={posts.refetch} />
              ))
            )}
          </>
        )}
      </div>

      <aside className="rounded-card border border-line bg-surface-raised shadow-card">
        <h3 className="border-b border-line px-4 py-3 text-sm font-semibold">Members</h3>
        <ul className="divide-y divide-line">
          {group.members.map((member) => (
            <li key={member.userId} className="flex items-center justify-between gap-2 px-4 py-2.5">
              <div>
                <p className="text-sm">{member.name}</p>
                <p className="text-xs text-ink-muted">
                  {member.status === 'PENDING'
                    ? 'Pending approval'
                    : member.role === 'MODERATOR'
                      ? 'Moderator'
                      : 'Member'}
                </p>
              </div>
              {group.canModerate && member.status === 'PENDING' ? (
                <Button size="sm" onClick={() => membershipAction('approve', member.userId)}>
                  Approve
                </Button>
              ) : group.canModerate && member.role !== 'MODERATOR' ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => membershipAction('remove', member.userId)}
                >
                  Remove
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
