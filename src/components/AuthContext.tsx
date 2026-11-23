import { User, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  auth,
  googleProvider,
  syncQuotaToFirestore,
  syncUserProfileToFirestore,
} from '../firebase';
import { ConversionMode, NanoBananaQuota, VisualStyleId } from '../types';

interface AuthContextValue {
  user: User | null;
  authReady: boolean;
  isSigningIn: boolean;
  authError: string | null;
  quota: NanoBananaQuota | null;
  signInWithGoogle: () => Promise<void>;
  signOutGoogle: () => Promise<void>;
  getIdToken: () => Promise<string | null>;
  authFetch: (input: string, init?: RequestInit) => Promise<Response>;
  refreshQuota: (lastJobId?: string) => Promise<NanoBananaQuota | null>;
  updateQuota: (nextQuota: NanoBananaQuota, lastJobId?: string) => void;
  savePreferences: (style: VisualStyleId, mode: ConversionMode) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [quota, setQuota] = useState<NanoBananaQuota | null>(null);

  const getIdToken = useCallback(async (): Promise<string | null> => {
    const current = auth.currentUser;
    if (!current) return null;
    try {
      return await current.getIdToken();
    } catch {
      return null;
    }
  }, []);

  const authFetch = useCallback(
    async (input: string, init: RequestInit = {}): Promise<Response> => {
      const token = await getIdToken();
      const headers = new Headers(init.headers);
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }
      return fetch(input, { ...init, headers });
    },
    [getIdToken]
  );

  const refreshQuota = useCallback(
    async (lastJobId = ''): Promise<NanoBananaQuota | null> => {
      const current = auth.currentUser;
      if (!current) {
        setQuota(null);
        return null;
      }
      try {
        const res = await authFetch('/api/quota');
        if (!res.ok) return null;
        const data = (await res.json()) as { quota?: NanoBananaQuota };
        if (data.quota) {
          setQuota(data.quota);
          syncQuotaToFirestore(current, data.quota, lastJobId).catch(() => {});
          return data.quota;
        }
        return null;
      } catch {
        return null;
      }
    },
    [authFetch]
  );

  const updateQuota = useCallback((nextQuota: NanoBananaQuota, lastJobId = '') => {
    setQuota(nextQuota);
    const current = auth.currentUser;
    if (current) {
      syncQuotaToFirestore(current, nextQuota, lastJobId).catch(() => {});
    }
  }, []);

  const savePreferences = useCallback((style: VisualStyleId, mode: ConversionMode) => {
    const current = auth.currentUser;
    if (current) {
      syncUserProfileToFirestore(current, style, mode).catch(() => {});
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      setAuthError(null);

      if (nextUser) {
        syncUserProfileToFirestore(nextUser).catch(() => {});
        await refreshQuota();
      } else {
        setQuota(null);
      }
    });
    return () => unsubscribe();
  }, [refreshQuota]);

  const signInWithGoogle = useCallback(async () => {
    setAuthError(null);
    setIsSigningIn(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const code = (err as { code?: string })?.code ?? '';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        setAuthError(null);
      } else if (code === 'auth/popup-blocked') {
        setAuthError('Browser blocked the Google sign-in popup. Please allow popups and try again.');
      } else {
        setAuthError(
          err instanceof Error ? err.message : 'Unable to sign in with Google. Please try again.'
        );
      }
    } finally {
      setIsSigningIn(false);
    }
  }, []);

  const signOutGoogle = useCallback(async () => {
    setAuthError(null);
    await signOut(auth);
    setQuota(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        authReady,
        isSigningIn,
        authError,
        quota,
        signInWithGoogle,
        signOutGoogle,
        getIdToken,
        authFetch,
        refreshQuota,
        updateQuota,
        savePreferences,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>.');
  }
  return ctx;
}
