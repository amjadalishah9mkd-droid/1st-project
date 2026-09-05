'use client';

import type { PostItem } from '@campusos/shared';
import { useList } from '@/lib/hooks/use-list';
import { EmptyState, ErrorState, Skeleton } from '@/components/data/data-table';
import { Button } from '@/components/ui/button';
import { PostCard, PostComposer } from '@/components/domain/community/post-card';

export default function CommunityFeedPage() {
  const list = useList<PostItem>('/community/posts');

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <PostComposer onPosted={list.refetch} />

      {list.loading ? (
        <Skeleton rows={5} />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.refetch} />
      ) : list.rows.length === 0 ? (
        <div className="rounded-card border border-line bg-surface-raised shadow-card">
          <EmptyState
            title="Nothing here yet"
            message="Be the first to post to the campus feed."
          />
        </div>
      ) : (
        <>
          {list.rows.map((post) => (
            <PostCard key={post.id} post={post} onChanged={list.refetch} />
          ))}
          {list.meta && list.meta.page < list.meta.totalPages ? (
            <div className="flex justify-center">
              <Button
                variant="secondary"
                onClick={() => list.setPage(list.meta!.page + 1)}
              >
                Older posts
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
