import type { RoleKey, UserStatus } from '@prisma/client';

/**
 * The request-scoped identity attached by JwtAuthGuard.
 * Loaded fresh from the database on every request — never trusted from the
 * JWT beyond the subject lookup (Blueprint §9).
 */
export interface AuthenticatedUser {
  id: string;
  collegeId: string;
  email: string;
  role: RoleKey;
  status: UserStatus;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  mustChangePassword: boolean;
}
