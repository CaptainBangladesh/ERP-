import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AUTH_PATHS,
  ERROR_CODES,
  SESSION_TOKEN_PARAM,
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
    // A session arriving on the URL is how the Google flow ends: the browser was navigated
    // away to Google and back, so the token reaches the application the only way anything
    // can survive that — as a query parameter on the page it lands on.
    const arriving = claimTokenFromUrl();
    if (arriving) writeStoredToken(arriving);

    const stored = arriving ?? readStoredToken();
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
  useEffect(() => {
    setAuthToken(token);
    tokenRef.current = token;
  }, [token]);

  const sessionQuery = useQuery({
    queryKey: ['session', token],
    queryFn: () => {
      setAuthToken(token);
      return api.get<Session>(AUTH_PATHS.session);
    },
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

/**
 * Takes the session token off the URL, if one came back on it, and removes it from the
 * address bar.
 *
 * Stripped immediately because a credential in the address bar is a credential in the
 * history, in a bookmark, and in whatever the user pastes when they share "the page I am
 * on". `replaceState` rather than a navigation, so it leaves no entry to go back to.
 */
function claimTokenFromUrl(): string | undefined {
  try {
    const url = new URL(window.location.href);
    const token = url.searchParams.get(SESSION_TOKEN_PARAM);
    if (!token) return undefined;

    url.searchParams.delete(SESSION_TOKEN_PARAM);
    window.history.replaceState(null, '', url.pathname + url.search);
    return token;
  } catch {
    // No usable location — a test environment, or a document with an opaque origin. Falling
    // back to the stored token is the right answer either way.
    return undefined;
  }
}
