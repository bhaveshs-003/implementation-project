import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [person, setPerson] = useState(null);
  const [loading, setLoading] = useState(true);

  const refreshMe = useCallback(async () => {
    try {
      const data = await apiFetch('/api/auth/me');
      setPerson(data.person);
    } catch {
      setPerson(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshMe();
  }, [refreshMe]);

  const signIn = useCallback(async (email, password) => {
    const data = await apiFetch('/api/auth/signin', {
      method: 'POST',
      body: { email, password },
    });
    setPerson(data.person);
    return data;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await apiFetch('/api/auth/signout', { method: 'POST' });
    } catch {
      // ignore errors on sign out
    }
    setPerson(null);
    window.location.href = '/login';
  }, []);

  return (
    <AuthContext.Provider value={{ person, loading, signIn, signOut, refreshMe }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
