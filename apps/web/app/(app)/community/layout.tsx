'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';

const TABS = [
  { href: '/community', label: 'Feed' },
  { href: '/community/groups', label: 'Groups' },
  { href: '/community/societies', label: 'Societies' },
  { href: '/community/events', label: 'Events' },
  { href: '/community/resources', label: 'Resources' },
];

export default function CommunityLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Community"
        description="The private campus network — posts, groups, societies, events and shared resources."
      />
      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
        {TABS.map((tab) => {
          const active =
            tab.href === '/community'
              ? pathname === '/community'
              : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              role="tab"
              aria-selected={active}
              className={`whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-ink-muted hover:text-ink'
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
      {children}
    </div>
  );
}
