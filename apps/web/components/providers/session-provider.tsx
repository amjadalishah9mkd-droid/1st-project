'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import type {
  AuthPayload,
  LoginInput,
  MePayload,
  PermissionKey,
} from '@campusos/shared';
import { apiFetch, ApiError } from '@/lib/api/client';
import { setAccessToken } from '@/lib/auth/token-store';
import { requestLogout, requestRefresh } from '@/lib/auth/auth-api';

interface SessionState {
  user: MePayload | null;
  status: 'loading' | 'authenticated' | 'unauthenticated';
  login: (input: LoginInput) => Promise<MePayload>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  hasPermission: (key: PermissionKey) => boolean;
}

const SessionContext = createContext<SessionState | null>(null);

// Refresh the access token 60s before its 15-minute expiry.
const PROACTIVE_REFRESH_MS = 14 * 60 * 1000;

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<MePayload | null>(null);
  const [status, setStatus] = useState<SessionState['status']>('loading');
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const router = useRouter();

  const applySession = useCallback((payload: AuthPayload | null) => {
    if (payload) {
      setUser(payload.user);
      setStatus('authenticated');
    } else {
      setUser(null);
      setStatus('unauthenticated');
    }
  }, []);

  // Session restoration after reload: the httpOnly refresh cookie is the only
  // durable credential; exchange it for a fresh in-memory access token.
  useEffect(() => {
    let cancelled = false;
    requestRefresh()
      .then((payload) => {
        if (!cancelled) applySession(payload);
      })
      .catch(() => {
        if (!cancelled) applySession(null);
      });
    return () => {
      cancelled = true;
    };
  }, [applySession]);

  // Proactive rotation keeps the access token warm during long sessions.
  useEffect(() => {
    if (status !== 'authenticated') return;
    refreshTimer.current = setInterval(() => {
      requestRefresh().then((payload) => applySession(payload));
    }, PROACTIVE_REFRESH_MS);
    return () => {
      if (refreshTimer.current) clearInterval(refreshTimer.current);
    };
  }, [status, applySession]);

  const login = useCallback(
    async (input: LoginInput): Promise<MePayload> => {
      const response = await apiFetch<AuthPayload>('/auth/login', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      setAccessToken(response.data.accessToken);
      applySession(response.data);
      return response.data.user;
    },
    [applySession],
  );

  const logout = useCallback(async () => {
    await requestLogout();
    applySession(null);
    router.push('/login');
  }, [applySession, router]);

  const refreshUser = useCallback(async () => {
    try {
      const response = await apiFetch<MePayload>('/me');
      setUser(response.data);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        applySession(null);
      }
    }
  }, [applySession]);

  const hasPermission = useCallback(
    (key: PermissionKey) =>
      user?.permissions.some((grant) => grant.key === key) ?? false,
    [user],
  );

  const value = useMemo(
    () => ({ user, status, login, logout, refreshUser, hasPermission }),
    [user, status, login, logout, refreshUser, hasPermission],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionState {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used within SessionProvider');
  }
  return context;
}
