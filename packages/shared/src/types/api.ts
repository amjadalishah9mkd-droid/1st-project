import { PermissionKey } from '../permissions';
import { PermissionScope, RoleKey, UserStatus } from '../enums';

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
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  mustChangePassword: boolean;
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
