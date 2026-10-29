import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiFetch, getToken, onUnauthorized, setToken } from '../data/apiClient.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // status: 'checking' (validating a stored token) | 'signedIn' | 'signedOut'
  const [state, setState] = useState(() => ({ status: getToken() ? 'checking' : 'signedOut', user: null, notice: '' }));

  useEffect(
    () =>
      onUnauthorized(() => {
        setToken(null);
        setState({ status: 'signedOut', user: null, notice: 'Your session expired. Please sign in again.' });
      }),
    [],
  );

  useEffect(() => {
    if (state.status !== 'checking') return;
    apiFetch('/auth/me')
      .then(({ user }) => setState({ status: 'signedIn', user, notice: '' }))
      .catch(() => {
        setToken(null);
        setState({ status: 'signedOut', user: null, notice: '' });
      });
  }, [state.status]);

  const login = useCallback(async (username, password) => {
    const { token, user } = await apiFetch('/auth/login', { method: 'POST', body: { username, password }, auth: false });
    setToken(token);
    setState({ status: 'signedIn', user, notice: '' });
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } catch {
      // Signing out locally is enough if the API is unreachable.
    }
    setToken(null);
    setState({ status: 'signedOut', user: null, notice: '' });
  }, []);

  const value = useMemo(() => ({ ...state, login, logout }), [state, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
