import { NextRequest, NextResponse } from 'next/server';
import {
  matchRoutePermission,
  roleHasPermission,
  type RoleKey,
} from '@campusos/shared';

/**
 * Route protection middleware (Blueprint §8).
 *
 * Uses the httpOnly `cos_auth` hint cookie set by the API on login/refresh
 * ({ role, mustChangePassword } — no tokens, no permissions). This cookie is
 * a ROUTING HINT ONLY: real authorization is enforced server-side on every
 * API request via PolicyService. Route→permission mapping and the role
 * matrix come from @campusos/shared — the same single source that seeds the
 * database. No permission definitions are duplicated here.
 */
const SESSION_HINT_COOKIE = 'cos_auth';
const PUBLIC_PATHS = ['/login'];

interface SessionHint {
  role: RoleKey;
  mustChangePassword: boolean;
}

function readHint(request: NextRequest): SessionHint | null {
  const raw = request.cookies.get(SESSION_HINT_COOKIE)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (typeof parsed?.r !== 'string') return null;
    return { role: parsed.r as RoleKey, mustChangePassword: parsed.mcp === true };
  } catch {
    return null;
  }
}

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const hint = readHint(request);

  // Public auth routes
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    if (hint) {
      return NextResponse.redirect(
        new URL(hint.mustChangePassword ? '/change-password' : '/dashboard', request.url),
      );
    }
    return NextResponse.next();
  }

  // Change-password requires a session; pinned while mustChangePassword=true
  if (pathname === '/change-password') {
    if (!hint) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
    return NextResponse.next();
  }

  // Root: send to the right place
  if (pathname === '/') {
    if (!hint) return NextResponse.redirect(new URL('/login', request.url));
    return NextResponse.redirect(
      new URL(hint.mustChangePassword ? '/change-password' : '/dashboard', request.url),
    );
  }

  // Everything else is an authenticated application route
  if (!hint) {
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  if (hint.mustChangePassword) {
    return NextResponse.redirect(new URL('/change-password', request.url));
  }

  // Route-level permission gate from the shared map (hint only; the API is
  // the enforcement point).
  const required = matchRoutePermission(pathname);
  if (required && !roleHasPermission(hint.role, required)) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Protect application pages; skip Next internals, static assets and the
  // API proxy (the API enforces its own auth).
  matcher: ['/((?!_next|api|favicon.ico|.*\\..*).*)'],
};
