import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { isAuthenticationFailure } from '@erp/shared';
import { ApiFailure } from '../api/client';
import { SessionProvider } from '../session/SessionProvider';

/**
 * Server state is owned by TanStack Query — caching, invalidation after mutations, and the
 * loading and error states every screen renders. React Context is reserved for genuine
 * client state, which so far is the session and nothing else: small enough that Redux never
 * becomes necessary.
 *
 * `SessionProvider` sits inside the query client because it uses a query to find out what
 * its token means, and clears the cache on sign-out.
 */
/**
 * How many times a *transient* failure is retried before a screen is told about it.
 *
 * Zero in tests, where every response is deterministic and a retry only buys a slower suite.
 */
export function createQueryClient(retries = 3): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        /**
         * Retry only what has a chance of succeeding on its own.
         *
         * The API is down for a few seconds whenever the backend restarts — every deploy, and
         * every save while `nest --watch` is running. With no retries at all, one request that
         * happens to land in that window fails permanently, and the screen holding it shows an
         * error for the rest of the tab's life. That is what turns a three-second restart into
         * "the application is broken and my data is gone".
         *
         * A refused request is a different thing: 401, 403, 404 and a validation failure all
         * mean the server understood and said no, and asking four more times says nothing new.
         * Those are surfaced immediately.
         */
        retry: (failureCount, error) => failureCount < retries && isWorthRetrying(error),
        // 250ms, 500ms, 1s — long enough to cover a restart, short enough that a person
        // watching a spinner does not conclude it has hung.
        retryDelay: (attempt) => Math.min(250 * 2 ** attempt, 1_000),
        /**
         * Coming back to the tab re-asks for anything stale.
         *
         * This is the other half of not staying broken. Somebody leaves the tab open, the
         * server restarts behind it, they come back — and without this the screen goes on
         * showing whatever it was showing when the failure happened, with no way back other
         * than a manual reload that nobody should have to know to perform.
         */
        refetchOnWindowFocus: true,
      },
    },
  });
}

/**
 * Whether a failure might resolve itself.
 *
 * Anything the API refused in so many words is final. What is left — no connection, a proxy
 * answering while the backend is still coming up, a 5xx — is the server being briefly absent
 * rather than the request being wrong.
 */
function isWorthRetrying(error: unknown): boolean {
  if (!(error instanceof ApiFailure)) return false;
  if (isAuthenticationFailure(error.code)) return false;

  return error.code === 'network_error' || error.status === 0 || error.status >= 500;
}

export function AppProviders({
  children,
  client,
}: {
  children: ReactNode;
  client?: QueryClient;
}) {
  // Created lazily per provider instance so tests get a fresh cache each render and cannot
  // leak state between cases.
  const [fallback] = useState(createQueryClient);

  return (
    <QueryClientProvider client={client ?? fallback}>
      <SessionProvider>{children}</SessionProvider>
    </QueryClientProvider>
  );
}
