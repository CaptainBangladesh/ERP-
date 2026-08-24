import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { NAVIGATION_PATH, type NavigationEntry, type NavigationResponse } from '@erp/shared';
import { api } from '../api/client';
import { useSession } from '../session/SessionProvider';
import { linkProps, useLocationPath } from './location';

function getCrmIcon(label: string) {
  switch (label.toLowerCase()) {
    case 'dashboard':
      return (
        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
        </svg>
      );
    case 'leads':
      return (
        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="8" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 2v4m0 12v4m10-10h-4M6 12H2" />
        </svg>
      );
    case 'deals':
      return (
        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V6m0 8v2m0-8e-3.156-1.042-4.108-2.613-4.108-4.288 0-1.674 1.509-3.246 4.108-4.288m0 8.576V20m0-16V4" />
        </svg>
      );
    case 'workflow rules':
    case 'workflow':
      return (
        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      );
    default:
      return (
        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
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
                        key={`dropdown:${item.module}:${item.path}`}
                        {...linkProps(item.path)}
                        onClick={() => setOpenCrmDropdown(false)}
                        aria-current={item.path === path ? 'page' : undefined}
                        className={
                          item.path === path
                            ? 'flex items-center gap-2.5 px-4 py-2 text-sm font-medium text-slate-900 bg-slate-100'
                            : 'flex items-center gap-2.5 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 hover:text-slate-900'
                        }
                      >
                        {getCrmIcon(item.label)}
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
        <div className="mx-auto flex max-w-7xl min-h-[calc(100vh-57px)]">
          <aside aria-label="CRM Sidebar" className="w-56 shrink-0 border-r border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                CRM
              </span>
            </div>
            <nav className="mt-2 space-y-1">
              {crmEntries.map((item) => {
                const isActive = item.path === path;
                return (
                  <a
                    key={`sidebar:${item.module}:${item.path}`}
                    {...linkProps(item.path)}
                    aria-current={isActive ? 'page' : undefined}
                    className={
                      isActive
                        ? 'flex items-center gap-2.5 px-3 py-2 text-sm font-semibold text-slate-900 bg-slate-100 rounded-lg shadow-xs'
                        : 'flex items-center gap-2.5 px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-lg transition-colors'
                    }
                  >
                    <span className={isActive ? 'text-slate-900' : 'text-slate-400'}>
                      {getCrmIcon(item.label)}
                    </span>
                    <span>{item.label}</span>
                  </a>
                );
              })}
            </nav>
          </aside>

          <main className="flex-1 p-6">{children}</main>
        </div>
      ) : (
        <main className="mx-auto max-w-5xl p-6">{children}</main>
      )}
    </div>
  );
}
