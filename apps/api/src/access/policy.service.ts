import { Injectable } from '@nestjs/common';
import type {
  PermissionKey,
  PermissionGrant,
  PermissionScope,
} from '@campusos/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from './authenticated-user';

/**
 * Resource context passed to PolicyService.can().
 * Controllers/services provide whichever identifiers describe the resource
 * being acted on; the relevant scope handler consumes them.
 */
export interface ResourceContext {
  /** The user who owns the resource (OWN scope). */
  ownerUserId?: string;
  /** The section the resource belongs to (ASSIGNED scope). */
  sectionId?: string;
  /** The department the resource belongs to (DEPARTMENT scope). */
  departmentId?: string;
}

interface GrantCacheEntry {
  grants: PermissionGrant[];
  expiresAt: number;
}

const GRANT_CACHE_TTL_MS = 60_000;

/**
 * PolicyService (Blueprint §5) — the single authorization path.
 *
 * NON-NEGOTIABLE INVARIANT: business logic never checks `user.role`.
 * Authorization is: does RolePermission grant `permissionKey` to this user's
 * role, and does the grant's scope admit the resource context?
 *
 * Scope semantics:
 *  - ALL:        permitted college-wide (tenant boundary applies upstream).
 *  - OWN:        permitted when the resource belongs to the caller. When no
 *                ownerUserId is supplied, the caller is granted list-level
 *                access and the owning service MUST scope its query to the
 *                caller (self-scoping contract).
 *  - ASSIGNED:   permitted when the caller (teacher) has a TeachingAssignment
 *                for the resource's section. Without a sectionId the caller
 *                gets list-level access and the service must scope to
 *                assigned sections.
 *  - DEPARTMENT: permitted when the caller's department matches the
 *                resource's department (resolved via teacher/student profile).
 */
@Injectable()
export class PolicyService {
  private grantCache = new Map<string, GrantCacheEntry>();

  constructor(private readonly prisma: PrismaService) {}

  /** Resolve a role's grants from the database (60s in-memory cache). */
  async grantsForRole(role: string): Promise<PermissionGrant[]> {
    const cached = this.grantCache.get(role);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.grants;
    }
    const rows = await this.prisma.rolePermission.findMany({
      where: { role: role as never },
      include: { permission: { select: { key: true } } },
    });
    const grants = rows.map((row) => ({
      key: row.permission.key as PermissionKey,
      scope: row.scope as PermissionScope,
    }));
    this.grantCache.set(role, {
      grants,
      expiresAt: Date.now() + GRANT_CACHE_TTL_MS,
    });
    return grants;
  }

  /** Invalidate the grant cache (used when the matrix is edited). */
  invalidateCache(): void {
    this.grantCache.clear();
  }

  /**
   * Returns the scope granted to the user's role for a permission, or null
   * when denied. Services use this to self-scope list queries per the
   * OWN/ASSIGNED list-level contract.
   */
  async scopeFor(
    user: AuthenticatedUser,
    permissionKey: PermissionKey,
  ): Promise<PermissionScope | null> {
    if (user.status !== 'ACTIVE') return null;
    const grants = await this.grantsForRole(user.role);
    return grants.find((entry) => entry.key === permissionKey)?.scope ?? null;
  }


  async can(
    user: AuthenticatedUser,
    permissionKey: PermissionKey,
    context: ResourceContext = {},
  ): Promise<boolean> {
    if (user.status !== 'ACTIVE') {
      return false;
    }
    const grants = await this.grantsForRole(user.role);
    const grant = grants.find((entry) => entry.key === permissionKey);
    if (!grant) {
      return false;
    }

    switch (grant.scope) {
      case 'ALL':
        return true;
      case 'OWN':
        return this.checkOwn(user, context);
      case 'ASSIGNED':
        return this.checkAssigned(user, context);
      case 'DEPARTMENT':
        return this.checkDepartment(user, context);
      default:
        return false;
    }
  }

  private checkOwn(
    user: AuthenticatedUser,
    context: ResourceContext,
  ): boolean {
    if (context.ownerUserId === undefined) {
      // List-level access: the owning service must self-scope its query.
      return true;
    }
    return context.ownerUserId === user.id;
  }

  private async checkAssigned(
    user: AuthenticatedUser,
    context: ResourceContext,
  ): Promise<boolean> {
    if (context.sectionId === undefined) {
      // List-level access: the owning service must scope to assigned sections.
      return true;
    }
    const assignment = await this.prisma.teachingAssignment.findFirst({
      where: {
        sectionId: context.sectionId,
        teacher: { userId: user.id },
      },
      select: { id: true },
    });
    return assignment !== null;
  }

  private async checkDepartment(
    user: AuthenticatedUser,
    context: ResourceContext,
  ): Promise<boolean> {
    if (context.departmentId === undefined) {
      return true;
    }
    const [teacherProfile, studentProfile] = await Promise.all([
      this.prisma.teacherProfile.findUnique({
        where: { userId: user.id },
        select: { departmentId: true },
      }),
      this.prisma.studentProfile.findUnique({
        where: { userId: user.id },
        select: { departmentId: true },
      }),
    ]);
    const departmentId =
      teacherProfile?.departmentId ?? studentProfile?.departmentId ?? null;
    return departmentId === context.departmentId;
  }
}
