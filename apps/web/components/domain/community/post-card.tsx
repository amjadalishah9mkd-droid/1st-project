'use client';

import { FormEvent, useState } from 'react';
import type { CommentItem, PostItem } from '@campusos/shared';
import { apiFetch, ApiError } from '@/lib/api/client';
import { useToast } from '@/components/providers/toast-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

const typeBadge: Record<PostItem['type'], { label: string; tone: 'brand' | 'success' | 'warning' | 'neutral' } | null> = {
  GENERAL: null,
  ACHIEVEMENT: { label: '🏆 Achievement', tone: 'success' },
  RESOURCE: { label: '📎 Resource', tone: 'brand' },
  EVENT_SHARE: { label: '📅 Event', tone: 'warning' },
};

export function PostCard({
  post,
  onChanged,
}: {
  post: PostItem;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [current, setCurrent] = useState(post);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState<CommentItem[] | null>(null);
  const [commentText, setCommentText] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  async function toggleLike() {
    try {
      const response = await apiFetch<PostItem>(
        `/community/posts/${current.id}/like`,
        { method: current.likedByMe ? 'DELETE' : 'PUT' },
      );
      setCurrent(response.data);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Action failed', 'error');
    }
  }

  async function loadComments() {
    const response = await apiFetch<CommentItem[]>(
      `/community/posts/${current.id}/comments`,
    );
    setComments(response.data);
  }

  async function openComments() {
    setCommentsOpen((open) => !open);
    if (!comments) await loadComments().catch(() => undefined);
  }

  async function submitComment(event: FormEvent) {
    event.preventDefault();
    if (!commentText.trim()) return;
    setBusy(true);
    try {
      const response = await apiFetch<CommentItem[]>(
        `/community/posts/${current.id}/comments`,
        { method: 'POST', body: JSON.stringify({ body: commentText.trim() }) },
      );
      setComments(response.data);
      setCurrent((c) => ({ ...c, commentCount: c.commentCount + 1 }));
      setCommentText('');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Comment failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  const badge = typeBadge[current.type];

  return (
    <article className="rounded-card border border-line bg-surface-raised p-5 shadow-card">
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800">
            {current.author.name
              .split(' ')
              .map((part) => part[0])
              .slice(0, 2)
              .join('')}
          </div>
          <div>
            <p className="text-sm font-medium">
              {current.author.name}{' '}
              <span className="text-xs font-normal text-ink-faint">
                · {current.author.role.charAt(0) + current.author.role.slice(1).toLowerCase()}
              </span>
            </p>
            <p className="text-xs text-ink-muted">
              {timeAgo(current.createdAt)}
              {current.groupName ? ` · in ${current.groupName}` : ''}
              {current.societyName ? ` · ${current.societyName}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {badge ? <Badge tone={badge.tone}>{badge.label}</Badge> : null}
          {current.canDelete ? (
            <Button variant="ghost" size="sm" onClick={() => setDeleteConfirm(true)}>
              Delete
            </Button>
          ) : null}
        </div>
      </header>

      <p className="mt-3 whitespace-pre-wrap text-sm text-ink">{current.body}</p>

      {current.resource ? (
        <a
          href={current.resource.fileUrl}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-brand-700 hover:border-brand-300"
        >
          ⬇ {current.resource.title}
        </a>
      ) : null}
      {current.event ? (
        <p className="mt-3 rounded-lg border border-line bg-surface px-3 py-2 text-sm">
          📅 <span className="font-medium">{current.event.title}</span>{' '}
          <span className="text-ink-muted">
            · {new Date(current.event.startsAt).toLocaleString('en-GB', {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </p>
      ) : null}

      <footer className="mt-4 flex items-center gap-4 border-t border-line pt-3">
        <button
          type="button"
          onClick={toggleLike}
          aria-pressed={current.likedByMe}
          className={`text-sm font-medium transition-colors ${
            current.likedByMe ? 'text-brand-700' : 'text-ink-muted hover:text-ink'
          }`}
        >
          ♥ {current.likeCount}
        </button>
        <button
          type="button"
          onClick={openComments}
          className="text-sm font-medium text-ink-muted transition-colors hover:text-ink"
        >
          💬 {current.commentCount}
        </button>
      </footer>

      {commentsOpen ? (
        <div className="mt-3 border-t border-line pt-3">
          {!comments ? (
            <p className="text-xs text-ink-muted">Loading comments…</p>
          ) : comments.length === 0 ? (
            <p className="text-xs text-ink-muted">No comments yet — be the first.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {comments.map((comment) => (
                <li
                  key={comment.id}
                  className={`rounded-lg bg-surface px-3 py-2 ${comment.parentId ? 'ml-6' : ''}`}
                >
                  <p className="text-xs">
                    <span className="font-semibold">{comment.author.name}</span>{' '}
                    <span className="text-ink-faint">{timeAgo(comment.createdAt)}</span>
                  </p>
                  <p className="mt-0.5 text-sm">{comment.body}</p>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={submitComment} className="mt-3 flex gap-2">
            <input
              value={commentText}
              onChange={(event) => setCommentText(event.target.value)}
              placeholder="Write a comment…"
              aria-label="Write a comment"
              className="h-9 flex-1 rounded-lg border border-line-strong bg-surface-raised px-3 text-sm"
            />
            <Button type="submit" size="sm" disabled={busy || !commentText.trim()}>
              {busy ? '…' : 'Comment'}
            </Button>
          </form>
        </div>
      ) : null}

      <ConfirmDialog
        open={deleteConfirm}
        title="Delete post"
        message="Delete this post? It will show as removed."
        confirmLabel="Delete"
        onConfirm={async () => {
          try {
            await apiFetch(`/community/posts/${current.id}`, { method: 'DELETE' });
            toast('Post removed');
            setDeleteConfirm(false);
            onChanged();
          } catch (err) {
            toast(err instanceof ApiError ? err.message : 'Delete failed', 'error');
            setDeleteConfirm(false);
          }
        }}
        onClose={() => setDeleteConfirm(false)}
      />
    </article>
  );
}

export function PostComposer({
  groupId,
  societyId,
  allowAchievement = true,
  onPosted,
}: {
  groupId?: string;
  societyId?: string;
  allowAchievement?: boolean;
  onPosted: () => void;
}) {
  const { toast } = useToast();
  const [body, setBody] = useState('');
  const [type, setType] = useState<'GENERAL' | 'ACHIEVEMENT'>('GENERAL');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/community/posts', {
        method: 'POST',
        body: JSON.stringify({ body: body.trim(), type, groupId, societyId }),
      });
      setBody('');
      setType('GENERAL');
      toast('Posted');
      onPosted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Posting failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-card border border-line bg-surface-raised p-4 shadow-card"
    >
      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={3}
        placeholder={
          groupId
            ? 'Share something with the group…'
            : societyId
              ? 'Post an update to the society wall…'
              : 'Share something with the campus…'
        }
        aria-label="Post body"
        className="w-full resize-y rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm"
      />
      {error ? (
        <p className="mt-2 text-xs text-danger-700" role="alert">
          {error}
        </p>
      ) : null}
      <div className="mt-2 flex items-center justify-between">
        {allowAchievement ? (
          <label className="flex items-center gap-2 text-xs text-ink-secondary">
            <input
              type="checkbox"
              checked={type === 'ACHIEVEMENT'}
              onChange={(event) =>
                setType(event.target.checked ? 'ACHIEVEMENT' : 'GENERAL')
              }
              className="h-4 w-4 rounded border-line-strong"
            />
            Share as achievement 🏆
          </label>
        ) : (
          <span />
        )}
        <Button type="submit" size="sm" disabled={busy || !body.trim()}>
          {busy ? 'Posting…' : 'Post'}
        </Button>
      </div>
    </form>
  );
}
