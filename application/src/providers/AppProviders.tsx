import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
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
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  });
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
