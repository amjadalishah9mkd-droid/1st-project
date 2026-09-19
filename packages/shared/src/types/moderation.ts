/** M8 API payload types — moderation, notifications, announcements. */

export interface RenderedTarget {
  kind: 'POST' | 'COMMENT' | 'USER' | 'EVENT' | 'RESOURCE';
  title: string;
  body: string | null;
  authorUserId: string | null;
  authorName: string | null;
  status: string;
}

export interface ReportItem {
  id: string;
  targetType: RenderedTarget['kind'];
  targetId: string;
  reason: string;
  details: string | null;
  status: 'OPEN' | 'REVIEWING' | 'RESOLVED' | 'DISMISSED';
  reporterName: string;
  createdAt: string;
  resolvedByName: string | null;
  resolutionNote: string | null;
  /** Number of reports (any status) against the same target. */
  reportCountForTarget: number;
}

export interface ReportDetail extends ReportItem {
  target: RenderedTarget | null;
  /** Whether the target user currently has an active community suspension. */
  targetUserSuspended: boolean;
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  linkPath: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface AnnouncementItem {
  id: string;
  title: string;
  body: string;
  audienceScope: 'ALL' | 'ROLE' | 'DEPARTMENT' | 'SECTION';
  audienceLabels: string[];
  authorName: string;
  publishedAt: string | null;
  createdAt: string;
}
