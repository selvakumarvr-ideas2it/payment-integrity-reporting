'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { SessionUser } from '@/model';
import { apiFetch } from '@/lib/api';

type Status = 'checking' | 'signedIn' | 'signedOut';

type AuthState = {
  status: Status;
  user: SessionUser | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('checking');
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ user: SessionUser }>('/api/auth/me', { redirectOn401: false })
      .then((result) => {
        if (cancelled) return;
        setUser(result.user);
        setStatus('signedIn');
      })
      .catch(() => {
        if (cancelled) return;
        setUser(null);
        setStatus('signedOut');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const result = await apiFetch<{ user: SessionUser }>('/api/auth/login', {
      method: 'POST',
      body: { username, password },
      redirectOn401: false,
    });
    setUser(result.user);
    setStatus('signedIn');
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST', redirectOn401: false });
    } catch {
      // Clearing local state is enough when the request cannot finish.
    }
    setUser(null);
    setStatus('signedOut');
  }, []);

  const value = useMemo(() => ({ status, user, login, logout }), [status, user, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider');
  return value;
}
