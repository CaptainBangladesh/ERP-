import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { NAVIGATION_PATH, type NavigationEntry, type NavigationResponse } from '@erp/shared';
import { api } from '../api/client';
import { useSession } from '../session/SessionProvider';
import { linkProps, useLocationPath } from './location';

function renderSidebarIcon(key: string, isActive: boolean) {
  const colorClass = isActive ? 'stroke-teal-600 font-semibold' : 'stroke-slate-400 group-hover:stroke-slate-600';

  switch (key) {
    case 'workspace':
      return (
        <svg className={`w-4 h-4 shrink-0 fill-none ${colorClass}`} viewBox="0 0 24 24" strokeWidth="1.75">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l9-8 9 8M5 10v9a1 1 0 001 1h4v-6h4v6h4a1 1 0 001-1v-9" />
        </svg>
      );
    case 'deals':
      return (
        <svg className={`w-4 h-4 shrink-0 fill-none ${colorClass}`} viewBox="0 0 24 24" strokeWidth="1.75">
          <circle cx="12" cy="12" r="8.5" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5v9m-2.5-6.5c0-1.2 1.12-2 2.5-2s2.5.8 2.5 2-1.12 2-2.5 2m-2.5 0c0 1.2 1.12 2 2.5 2s2.5-.8 2.5-2m-5 0h5" />
        </svg>
      );
    case 'leads':
      return (
        <svg className={`w-4 h-4 shrink-0 fill-none ${colorClass}`} viewBox="0 0 24 24" strokeWidth="1.75">
          <circle cx="12" cy="12" r="5" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 2v3m0 14v3m10-10h-3M7 12H4" />
        </svg>
      );
    case 'contacts':
      return (
        <svg className={`w-4 h-4 shrink-0 fill-none ${colorClass}`} viewBox="0 0 24 24" strokeWidth="1.75">
          <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      );
    case 'accounts':
      return (
        <svg className={`w-4 h-4 shrink-0 fill-none ${colorClass}`} viewBox="0 0 24 24" strokeWidth="1.75">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5m0 0v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
      );
    case 'activities':
      return (
        <svg className={`w-4 h-4 shrink-0 fill-none ${colorClass}`} viewBox="0 0 24 24" strokeWidth="1.75">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
        </svg>
      );
    case 'sales dashboard':
    case 'dashboard':
      return (
        <svg className={`w-4 h-4 shrink-0 fill-none ${colorClass}`} viewBox="0 0 24 24" strokeWidth="1.75">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      );
    case 'workflow rules':
    case 'workflow':
      return (
        <svg className={`w-4 h-4 shrink-0 fill-none ${colorClass}`} viewBox="0 0 24 24" strokeWidth="1.75">
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      );
    default:
      return (
        <svg className={`w-4 h-4 shrink-0 fill-none ${colorClass}`} viewBox="0 0 24 24" strokeWidth="1.75">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      );
  }
}

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
    return (
      crmEntries.some(
        (item) => item.path === path || (item.path !== '/' && path.startsWith(item.path)),
      ) || path.startsWith('/crm')
    );
  }, [crmEntries, path]);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white sticky top-0 z-40">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
          <span className="font-semibold text-slate-900">
            {session?.company.name ?? ''}
          </span>

          <nav aria-label="Main" className="flex items-center gap-4">
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

            {crmEntries.length > 0 && (
              <div className="relative inline-block text-left">
                <button
                  type="button"
                  onClick={() => setOpenCrmDropdown((open) => !open)}
                  aria-expanded={openCrmDropdown}
                  className={
                    isCrmActive
                      ? 'flex items-center gap-1 text-sm font-semibold text-slate-900 bg-slate-100 rounded-md px-2.5 py-1'
                      : 'flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900 rounded-md px-2.5 py-1'
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
                        key={`dropdown:${item.module}:${item.path}:${item.label}`}
                        {...linkProps(item.path)}
                        onClick={() => setOpenCrmDropdown(false)}
                        aria-current={item.path === path ? 'page' : undefined}
                        className={
                          item.path === path
                            ? 'flex items-center gap-2.5 px-4 py-2 text-sm font-medium text-slate-900 bg-slate-100'
                            : 'flex items-center gap-2.5 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 hover:text-slate-900'
                        }
                      >
                        {renderSidebarIcon(item.label.toLowerCase(), item.path === path)}
                        <span>{item.label}</span>
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
      </header>

      {/* Sidebar Layout for CRM pages */}
      {isCrmActive && crmEntries.length > 0 ? (
        <div className="mx-auto flex w-full max-w-[1700px] min-h-[calc(100vh-57px)]">
          <aside aria-label="CRM Sidebar" className="w-56 shrink-0 border-r border-slate-200 bg-white p-4">
            <nav className="space-y-1">
              {crmEntries.map((item) => {
                const isActive = item.path === path;
                return (
                  <a
                    key={`sidebar:${item.module}:${item.path}:${item.label}`}
                    {...linkProps(item.path)}
                    aria-current={isActive ? 'page' : undefined}
                    className={
                      isActive
                        ? 'group flex items-center gap-2.5 px-3 py-2 text-sm font-semibold text-teal-600 bg-teal-50/60 rounded-lg'
                        : 'group flex items-center gap-2.5 px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-lg transition-colors'
                    }
                  >
                    {renderSidebarIcon(item.label.toLowerCase(), isActive)}
                    <span>{item.label}</span>
                  </a>
                );
              })}
            </nav>
          </aside>

          {/* min-w-0 is essential: without it a flex child keeps its content's intrinsic width,
              so a wide workspace column would force the whole page past the viewport (horizontal
              scroll). overflow-x-clip is the backstop so nothing can ever scroll the page sideways. */}
          <main className="min-w-0 flex-1 overflow-x-clip p-6">{children}</main>
        </div>
      ) : (
        <main className="mx-auto max-w-5xl p-6">{children}</main>
      )}
    </div>
  );
}
