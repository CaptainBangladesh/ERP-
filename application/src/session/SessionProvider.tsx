import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
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

  /**
   * The current token, readable from the refusal handler.
   *
   * A ref rather than the state value, because the handler is registered once and would
   * otherwise close over whichever token was current when it was registered — which is the
   * stale reading the check below exists to avoid.
   */
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const sessionQuery = useQuery({
    queryKey: ['session', token],
    queryFn: () => api.get<Session>(AUTH_PATHS.session),
    enabled: Boolean(token),
    retry: false,
  });

  const forget = useCallback(
    (expired: boolean) => {
      // Storage first: the api client falls back to stored token when its own module-level
      // copy has been wiped by a hot reload, so clearing that fallback has to happen before
      // the in-memory one or a request in between would still find a token to send.
      writeStoredToken(undefined);
      setAuthToken(undefined);
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
  //
  // But only the session that was actually refused. Several requests are usually in flight
  // when one runs out, and their refusals keep arriving while the person is signing back
  // in — so a refusal is acted on only if the token it carried is still the current one.
  // Without that check, a straggler from the previous session signs the new one out the
  // instant it is adopted, and the screen goes on showing somebody who is signed in while
  // every request behind it is anonymous.
  useEffect(() => {
    setSessionUnusableHandler((code, refusedToken) => {
      if (refusedToken !== tokenRef.current) return;
      forget(code === ERROR_CODES.sessionExpired);
    });
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
        permissions: session.permissions,
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
