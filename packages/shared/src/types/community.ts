/** M7 API payload types — community. */

export interface PostAuthor {
  id: string;
  name: string;
  role: string;
}

export interface CommentItem {
  id: string;
  author: PostAuthor;
  body: string;
  parentId: string | null;
  likeCount: number;
  likedByMe: boolean;
  canDelete: boolean;
  createdAt: string;
}

export interface PostItem {
  id: string;
  type: 'GENERAL' | 'RESOURCE' | 'ACHIEVEMENT' | 'EVENT_SHARE';
  body: string;
  author: PostAuthor;
  groupId: string | null;
  groupName: string | null;
  societyId: string | null;
  societyName: string | null;
  resource: { id: string; title: string; fileUrl: string } | null;
  event: { id: string; title: string; startsAt: string } | null;
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
  canDelete: boolean;
  canEdit: boolean;
  createdAt: string;
}

export interface GroupItem {
  id: string;
  name: string;
  description: string;
  privacy: 'OPEN' | 'REQUEST';
  memberCount: number;
  myMembership: { role: 'MEMBER' | 'MODERATOR'; status: 'ACTIVE' | 'PENDING' } | null;
  createdByName: string;
}

export interface GroupDetail extends GroupItem {
  members: Array<{
    userId: string;
    name: string;
    role: 'MEMBER' | 'MODERATOR';
    status: 'ACTIVE' | 'PENDING';
  }>;
  canModerate: boolean;
}

export interface SocietyItem {
  id: string;
  name: string;
  category: string;
  description: string;
  status: 'ACTIVE' | 'ARCHIVED';
  memberCount: number;
  facultyAdvisorName: string | null;
  myRole: 'MEMBER' | 'OFFICER' | 'PRESIDENT' | null;
}

export interface SocietyDetail extends SocietyItem {
  members: Array<{
    userId: string;
    name: string;
    role: 'MEMBER' | 'OFFICER' | 'PRESIDENT';
  }>;
  canManageMembers: boolean;
  canCreateEvents: boolean;
}

export interface EventItem {
  id: string;
  title: string;
  description: string;
  venue: string;
  startsAt: string;
  endsAt: string;
  capacity: number | null;
  status: 'ACTIVE' | 'CANCELLED' | 'REMOVED';
  societyId: string | null;
  societyName: string | null;
  createdByName: string;
  goingCount: number;
  interestedCount: number;
  myRsvp: 'GOING' | 'INTERESTED' | 'DECLINED' | null;
  canManage: boolean;
}

export interface ResourceItem {
  id: string;
  title: string;
  description: string | null;
  courseCode: string | null;
  fileName: string;
  fileType: string;
  fileSize: number;
  downloadCount: number;
  uploaderName: string;
  createdAt: string;
}
