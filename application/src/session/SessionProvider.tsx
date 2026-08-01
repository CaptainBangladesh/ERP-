import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AUTH_PATHS,
  ERROR_CODES,
  type AuthenticatedSession,
  type Session,
} from '@erp/shared';
import { api, setAuthToken, setSessionUnusableHandler } from '../api/client';
import { readStoredToken, writeStoredToken } from './token-storage';

/**
 * Who is signed in, for the whole application.
 *
 * This is the one thing in the frontend that is genuinely client state — a token the user
 * holds — so it is Context rather than TanStack Query. What the token *means* is server
 * state, and that half is a query: the application asks the API who the bearer is instead
 * of decoding the token, because only the server knows whether the session behind it is
 * still live.
 */
interface SessionContextValue {
  /** The signed-in user and company, or null when nobody is signed in. */
  session: Session | null;
  /**
   * True only while a stored token is being checked on first load. Distinguishing it from
   * "signed out" is what stops a reload flashing the sign-in screen at someone who is
   * already signed in.
   */
  isRestoring: boolean;
  /** True when the last session ended because it expired rather than by signing out. */
  hasExpired: boolean;
  /** Adopts the session a sign-in or sign-up just returned. */
  adopt: (session: AuthenticatedSession) => void;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState<string | undefined>(() => {
    const stored = readStoredToken();
    // Set before the first render so the restore request below already carries it.
    setAuthToken(stored);
    return stored;
  });
  const [hasExpired, setHasExpired] = useState(false);

  const sessionQuery = useQuery({
    queryKey: ['session', token],
    queryFn: () => api.get<Session>(AUTH_PATHS.session),
    enabled: Boolean(token),
    retry: false,
  });

  const forget = useCallback(
    (expired: boolean) => {
      setAuthToken(undefined);
      writeStoredToken(undefined);
      setHasExpired(expired);
      setToken(undefined);
      // Everything cached was fetched as somebody. None of it belongs to the next person
      // to sign in on this machine.
      queryClient.clear();
    },
    [queryClient],
  );

  // Any request refused because the session is unusable ends the session here — not only
  // the one that asks who you are. A session runs out during whatever the user is doing,
  // so watching a single query would leave them clicking around an application that has
  // quietly stopped working.
  useEffect(() => {
    setSessionUnusableHandler((code) => forget(code === ERROR_CODES.sessionExpired));
    return () => setSessionUnusableHandler(undefined);
  }, [forget]);

  const adopt = useCallback(
    (session: AuthenticatedSession) => {
      setAuthToken(session.token);
      writeStoredToken(session.token);
      setHasExpired(false);
      setToken(session.token);
      queryClient.setQueryData(['session', session.token], {
        user: session.user,
        company: session.company,
        expiresAt: session.expiresAt,
      } satisfies Session);
    },
    [queryClient],
  );

  const signOut = useCallback(async () => {
    // Told to the server first, so the session is withdrawn rather than merely forgotten by
    // this browser — a token nobody revoked is a token that still works.
    await api.post(AUTH_PATHS.signOut).catch(() => undefined);
    forget(false);
  }, [forget]);

  return (
    <SessionContext.Provider
      value={{
        session: sessionQuery.data ?? null,
        isRestoring: Boolean(token) && sessionQuery.isPending,
        hasExpired,
        adopt,
        signOut,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside a SessionProvider');
  return value;
}
