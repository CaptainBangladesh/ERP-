import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { NAVIGATION_PATH, type NavigationEntry, type NavigationResponse } from '@erp/shared';
import { api } from '../api/client';
import { useSession } from '../session/SessionProvider';
import { linkProps, useLocationPath } from './location';

/**
 * The frame around every signed-in screen: who you are, where you can go, and the way out.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { session, signOut } = useSession();
  const path = useLocationPath();
  const [openCrmDropdown, setOpenCrmDropdown] = useState(false);

  const navigation = useQuery({
    queryKey: ['navigation'],
    queryFn: () => api.get<NavigationResponse>(NAVIGATION_PATH),
  });

  const entries = navigation.data?.entries ?? [];

  // Group CRM items together into one 'CRM' group, while keeping all other module items flat.
  const { crmEntries, nonCrmEntries } = useMemo(() => {
    const crm: NavigationEntry[] = [];
    const others: NavigationEntry[] = [];

    for (const entry of entries) {
      if (entry.module === 'crm') {
        crm.push(entry);
      } else {
        others.push(entry);
      }
    }
    return { crmEntries: crm, nonCrmEntries: others };
  }, [entries]);

  const isCrmActive = useMemo(() => {
    return crmEntries.some(
      (item) => item.path === path || (item.path !== '/' && path.startsWith(item.path)),
    ) || path.startsWith('/crm');
  }, [crmEntries, path]);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
          <span className="font-semibold text-slate-900">
            {session?.company.name ?? ''}
          </span>

          <nav aria-label="Main" className="flex items-center gap-4">
            {/* Render non-CRM top-level links */}
            {nonCrmEntries.map((entry) => (
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

            {/* Render CRM Group Dropdown if CRM entries exist */}
            {crmEntries.length > 0 && (
              <div className="relative inline-block text-left">
                <button
                  type="button"
                  onClick={() => setOpenCrmDropdown((open) => !open)}
                  aria-expanded={openCrmDropdown}
                  className={
                    isCrmActive
                      ? 'flex items-center gap-1 text-sm font-semibold text-slate-900'
                      : 'flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900'
                  }
                >
                  <span>CRM</span>
                  <svg className="w-3.5 h-3.5 fill-current text-slate-500" viewBox="0 0 20 20">
                    <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
                  </svg>
                </button>

                {openCrmDropdown && (
                  <div
                    className="absolute left-0 mt-2 w-48 rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none z-50 py-1 border border-slate-100"
                    onMouseLeave={() => setOpenCrmDropdown(false)}
                  >
                    {crmEntries.map((item) => (
                      <a
                        key={`dropdown:${item.module}:${item.path}`}
                        {...linkProps(item.path)}
                        onClick={() => setOpenCrmDropdown(false)}
                        aria-current={item.path === path ? 'page' : undefined}
                        className={
                          item.path === path
                            ? 'block px-4 py-2 text-sm font-medium text-slate-900 bg-slate-100'
                            : 'block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 hover:text-slate-900'
                        }
                      >
                        {item.label}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}
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

        {/* Secondary Sub-Nav Bar for CRM tabs when active in CRM */}
        {isCrmActive && crmEntries.length > 0 && (
          <div className="bg-slate-100/80 border-t border-slate-200">
            <div className="mx-auto flex max-w-5xl items-center gap-2 px-6 py-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 mr-2">
                CRM
              </span>
              <div className="flex items-center gap-1">
                {crmEntries.map((item) => {
                  const isActive = item.path === path;
                  return (
                    <a
                      key={`sub:${item.module}:${item.path}`}
                      {...linkProps(item.path)}
                      aria-current={isActive ? 'page' : undefined}
                      className={
                        isActive
                          ? 'px-3 py-1 text-xs font-semibold text-slate-900 bg-white rounded-md shadow-sm border border-slate-200'
                          : 'px-3 py-1 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-white/60 rounded-md transition-colors'
                      }
                    >
                      {item.label}
                    </a>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-5xl p-6">{children}</main>
    </div>
  );
}
