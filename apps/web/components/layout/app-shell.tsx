'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api/client';
import { useSession } from '@/components/providers/session-provider';
import { navItemsFor } from './navigation';

/**
 * AppShell (Blueprint §6 layout): dark sidebar + light content, topbar with
 * user area and logout. Sidebar items are derived from routePermissions and
 * the session's resolved grants — never from role names in UI code.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, status, logout, hasPermission } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [unread, setUnread] = useState<number | null>(null);

  // Live bell: poll the unread count every 30s (Blueprint §10).
  useEffect(() => {
    if (status !== 'authenticated') return;
    let cancelled = false;
    const poll = () => {
      apiFetch<{ unread: number }>('/notifications/unread-count')
        .then((response) => {
          if (!cancelled) setUnread(response.data.unread);
        })
        .catch(() => undefined);
    };
    poll();
    const interval = setInterval(poll, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [status, pathname]);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
    } else if (status === 'authenticated' && user?.mustChangePassword) {
      router.replace('/change-password');
    }
  }, [status, user, router]);

  if (status === 'loading') {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="flex flex-col items-center gap-3" role="status">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-line-strong border-t-brand-600" />
          <p className="text-sm text-ink-muted">Restoring your session…</p>
        </div>
      </div>
    );
  }

  if (status !== 'authenticated' || !user) {
    return null;
  }

  const items = navItemsFor(hasPermission);
  const initials =
    `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase();

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="flex w-60 shrink-0 flex-col bg-surface-inverse">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-brand-500 text-xs font-bold text-white">
            C
          </div>
          <span className="text-sm font-semibold tracking-tight text-ink-inverse">
            CampusOS
          </span>
        </div>

        <nav className="flex flex-1 flex-col gap-1 px-3 py-2" aria-label="Main">
          {items.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-brand-600 text-white'
                    : 'text-ink-faint hover:bg-white/5 hover:text-ink-inverse'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-white/10 px-5 py-4">
          <p className="text-xs text-ink-faint">{user.college.name}</p>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-line bg-surface-raised px-6">
          <div />
          <div className="flex items-center gap-4">
            <Link
              href="/notifications"
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                (unread ?? user.counters.unreadNotifications) > 0
                  ? 'border-brand-300 bg-brand-50 text-brand-800'
                  : 'border-line bg-surface text-ink-secondary'
              }`}
              title="Notifications"
            >
              🔔 {unread ?? user.counters.unreadNotifications} unread
            </Link>
            <div className="flex items-center gap-3">
              <div className="grid h-8 w-8 place-items-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800">
                {initials}
              </div>
              <div className="hidden sm:block">
                <p className="text-sm font-medium leading-tight">
                  {user.firstName} {user.lastName}
                </p>
                <p className="text-xs leading-tight text-ink-muted">
                  {user.role.charAt(0) + user.role.slice(1).toLowerCase()}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void logout()}
              className="rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium text-ink-secondary transition-colors hover:bg-surface-sunken hover:text-ink"
            >
              Sign out
            </button>
          </div>
        </header>

        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
