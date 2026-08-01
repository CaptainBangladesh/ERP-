import { useEffect } from 'react';
import { useSession } from '../session/SessionProvider';
import { AppShell } from './AppShell';
import { navigate, useLocationPath } from './location';
import { routeFor } from './module-registry';

/**
 * Renders the screen for the current path, and decides who may see it.
 *
 * The guard is the same shape as the backend's: protected unless the route says otherwise.
 * A module that adds a screen and forgets to think about access gets a screen that requires
 * a session, which is the safe way round to be wrong.
 */
export function AppRoutes() {
  const { session, isRestoring } = useSession();
  const path = useLocationPath();
  const route = routeFor(path);

  const needsSession = !route?.public;
  const shouldRedirect = !isRestoring && needsSession && !session;

  useEffect(() => {
    // In an effect rather than during render: navigating is a side effect, and doing it
    // while rendering makes the redirect race the render that triggered it.
    if (shouldRedirect) navigate('/sign-in', { replace: true });
  }, [shouldRedirect]);

  // Checking a stored token takes a moment. Showing sign-in during it would flash the
  // wrong screen at somebody who is already signed in.
  if (isRestoring) return <Loading />;

  if (shouldRedirect) return <Loading />;

  if (!route) return <NotFound />;

  const Screen = route.component;

  // A signed-in user on a public route — sign-in with a live session — gets the screen
  // they asked for rather than a redirect. They may be about to sign in as somebody else.
  if (route.public) return <Screen />;

  return (
    <AppShell>
      <Screen />
    </AppShell>
  );
}

function Loading() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <p className="text-sm text-slate-500">Loading…</p>
    </main>
  );
}

function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-3 p-6">
      <h1 className="text-2xl font-semibold text-slate-900">Page not found</h1>
      <p className="text-sm text-slate-600">
        There is nothing at this address. It may belong to a module that is not installed.
      </p>
    </main>
  );
}
