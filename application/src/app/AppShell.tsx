import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { NAVIGATION_PATH, type NavigationResponse } from '@erp/shared';
import { api } from '../api/client';
import { useSession } from '../session/SessionProvider';
import { linkProps, useLocationPath } from './location';

/**
 * The frame around every signed-in screen: who you are, where you can go, and the way out.
 *
 * The menu comes from the API, which assembles it from what the modules declared. Ticket 07
 * filters those entries by permission and tier — server-side, which is why this component
 * renders what it is given rather than deciding anything.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { session, signOut } = useSession();
  const path = useLocationPath();

  const navigation = useQuery({
    queryKey: ['navigation'],
    queryFn: () => api.get<NavigationResponse>(NAVIGATION_PATH),
  });

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
          <span className="font-semibold text-slate-900">
            {session?.company.name ?? ''}
          </span>

          <nav aria-label="Main" className="flex items-center gap-4">
            {/* No skeleton and no spinner: the menu is a handful of links that arrive in a
                moment, and a placeholder shaped like navigation would be a menu that
                cannot be clicked. */}
            {(navigation.data?.entries ?? []).map((entry) => (
              <a
                key={`${entry.module}:${entry.path}`}
                {...linkProps(entry.path)}
                aria-current={entry.path === path ? 'page' : undefined}
                className={
                  entry.path === path
                    ? 'text-sm font-medium text-slate-900'
                    : 'text-sm text-slate-600 hover:text-slate-900'
                }
              >
                {entry.label}
              </a>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-4">
            <span className="text-sm text-slate-600">{session?.user.email}</span>
            <button
              type="button"
              onClick={() => void signOut()}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl p-6">{children}</main>
    </div>
  );
}
