import { PermissionKey } from '../permissions';
import { PermissionScope, RoleKey, UserStatus } from '../enums';
import type { UserVerificationStatus } from '../schemas/verification';

/**
 * Uniform API envelopes (Blueprint §7).
 * Success: { data, meta? }   Failure: { error: { code, message, details? } }
 */
export interface ApiSuccess<T> {
  data: T;
  meta?: PageMeta | Record<string, unknown>;
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiErrorBody;

/** Payload of GET /me — profile + resolved permission grants. */
export interface PermissionGrant {
  key: PermissionKey;
  scope: PermissionScope;
}

export interface CurrentUser {
  id: string;
  collegeId: string;
  email: string;
  role: RoleKey;
  status: UserStatus;
  verificationStatus: UserVerificationStatus;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  mustChangePassword: boolean;
  /** M12-W2 — notification email opt-out (transactional mail unaffected). */
  emailOptOut: boolean;
  permissions: PermissionGrant[];
}

/** Extended /me payload: profile + college + role profile + live counters. */
export interface MePayload extends CurrentUser {
  college: { id: string; name: string; code: string };
  teacherProfile: {
    id: string;
    employeeNo: string;
    designation: string;
    departmentId: string;
    departmentName: string;
  } | null;
  studentProfile: {
    id: string;
    admissionNo: string;
    rollNo: string;
    batch: string;
    departmentId: string;
    departmentName: string;
    status: string;
  } | null;
  counters: {
    unreadNotifications: number;
  };
}

/** Payload of POST /auth/login and /auth/refresh. */
export interface AuthPayload {
  accessToken: string;
  user: MePayload;
}

/** Health endpoint payload. */
export interface HealthStatus {
  status: 'ok';
  service: 'campusos-api';
  version: string;
  database: 'up' | 'down';
  timestamp: string;
}

/**
 * M19-W3 — deep operational health (GET /health/ops, settings.manage only).
 * Internal-only V1: no external monitoring integration. Never contains
 * credentials, connection strings or filesystem paths.
 */
export interface OpsHealthStatus {
  status: 'ok' | 'degraded';
  database: 'up' | 'down';
  migrations: {
    applied: number;
    /** Rows with no finish or a rollback — must be 0 on a healthy system. */
    unfinished: number;
  };
  backups: {
    /** False when no backup directory is mounted (e.g. local test runs). */
    configured: boolean;
    count: number;
    latestAgeSeconds: number | null;
    /** True when the newest backup is older than the freshness threshold. */
    stale: boolean;
  };
  uploadsWritable: boolean;
  uptimeSeconds: number;
  timestamp: string;
}
