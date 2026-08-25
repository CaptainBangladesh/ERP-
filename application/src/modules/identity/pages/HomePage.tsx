import { useSession } from '../../../session/SessionProvider';
import { linkProps } from '../../../app/location';

/**
 * Where a signed-in user lands.
 *
 * Provides a central workspace dashboard with direct launch cards and quick links
 * to all enabled modules in the application (CRM, Products, Inventory, Parties, Team).
 */
export function HomePage() {
  const { session } = useSession();
  if (!session) return null;

  return (
    <div className="flex flex-col gap-8 pb-10">
      {/* Header banner */}
      <header className="rounded-2xl bg-gradient-to-r from-slate-900 via-teal-900 to-slate-900 p-8 text-white shadow-lg relative overflow-hidden">
        <div className="absolute right-0 top-0 -mt-8 -mr-8 w-64 h-64 rounded-full bg-teal-500/10 blur-3xl pointer-events-none" />
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <span className="inline-flex items-center rounded-full bg-teal-400/20 px-3 py-1 text-xs font-medium text-teal-300 ring-1 ring-inset ring-teal-400/30">
              Workspace Hub
            </span>
            <span className="text-xs text-slate-400 font-mono">
              Tier: {session.company.tier.toUpperCase()}
            </span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Welcome, {session.user.name}
          </h1>
          <p className="mt-2 text-base text-slate-300 max-w-2xl">
            You are signed in to {session.company.name}
            {session.user.isOwner ? ', which you own.' : '.'} Access your active business modules below.
          </p>
        </div>
      </header>

      {/* CRM Section */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-teal-500" />
              CRM & Sales Operations
            </h2>
            <p className="text-sm text-slate-500">Manage lead pipeline, sales deals, email campaigns, and automation</p>
          </div>
          <a
            {...linkProps('/crm/dashboard')}
            className="text-xs font-medium text-teal-600 hover:text-teal-700 hover:underline flex items-center gap-1"
          >
            View Sales Dashboard &rarr;
          </a>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <a
            {...linkProps('/crm/leads')}
            className="group relative rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md hover:border-teal-500/50 transition-all"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center group-hover:bg-teal-600 group-hover:text-white transition-colors">
                <svg className="w-5 h-5 fill-none stroke-current" viewBox="0 0 24 24" strokeWidth="2">
                  <circle cx="12" cy="12" r="5" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 2v3m0 14v3m10-10h-3M7 12H4" />
                </svg>
              </div>
              <span className="text-xs font-medium text-slate-400 group-hover:text-teal-600 flex items-center gap-1">
                Open Board &rarr;
              </span>
            </div>
            <h3 className="font-semibold text-slate-900 group-hover:text-teal-600 transition-colors">Lead Management</h3>
            <p className="mt-1 text-xs text-slate-500 line-clamp-2">
              Kanban lead board, custom fields, group filtering, lead conversion, and activity logs.
            </p>
          </a>

          <a
            {...linkProps('/crm/deals')}
            className="group relative rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md hover:border-teal-500/50 transition-all"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-colors">
                <svg className="w-5 h-5 fill-none stroke-current" viewBox="0 0 24 24" strokeWidth="2">
                  <circle cx="12" cy="12" r="8.5" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5v9m-2.5-6.5c0-1.2 1.12-2 2.5-2s2.5.8 2.5 2-1.12 2-2.5 2m-2.5 0c0 1.2 1.12 2 2.5 2s2.5-.8 2.5-2m-5 0h5" />
                </svg>
              </div>
              <span className="text-xs font-medium text-slate-400 group-hover:text-blue-600 flex items-center gap-1">
                View Pipeline &rarr;
              </span>
            </div>
            <h3 className="font-semibold text-slate-900 group-hover:text-blue-600 transition-colors">Deal Pipeline</h3>
            <p className="mt-1 text-xs text-slate-500 line-clamp-2">
              Track sales stages, win/loss conversion, value aggregation, and pipeline progress.
            </p>
          </a>

          <a
            {...linkProps('/crm/campaigns')}
            className="group relative rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md hover:border-teal-500/50 transition-all"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                <svg className="w-5 h-5 fill-none stroke-current" viewBox="0 0 24 24" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <span className="text-xs font-medium text-slate-400 group-hover:text-indigo-600 flex items-center gap-1">
                Campaigns &rarr;
              </span>
            </div>
            <h3 className="font-semibold text-slate-900 group-hover:text-indigo-600 transition-colors">Email Campaigns</h3>
            <p className="mt-1 text-xs text-slate-500 line-clamp-2">
              Segmented email dispatch, batch sending progress, open pixel tracking, and unsubscribe links.
            </p>
          </a>

          <a
            {...linkProps('/crm/capture-sources')}
            className="group relative rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md hover:border-teal-500/50 transition-all"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center group-hover:bg-amber-600 group-hover:text-white transition-colors">
                <svg className="w-5 h-5 fill-none stroke-current" viewBox="0 0 24 24" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <span className="text-xs font-medium text-slate-400 group-hover:text-amber-600 flex items-center gap-1">
                Forms & Webhooks &rarr;
              </span>
            </div>
            <h3 className="font-semibold text-slate-900 group-hover:text-amber-600 transition-colors">Web Forms & Captures</h3>
            <p className="mt-1 text-xs text-slate-500 line-clamp-2">
              Embeddable HTML form capture, webhook integration, and auto-ingestion into lead board.
            </p>
          </a>

          <a
            {...linkProps('/crm/workflow-rules')}
            className="group relative rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md hover:border-teal-500/50 transition-all"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center group-hover:bg-purple-600 group-hover:text-white transition-colors">
                <svg className="w-5 h-5 fill-none stroke-current" viewBox="0 0 24 24" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <span className="text-xs font-medium text-slate-400 group-hover:text-purple-600 flex items-center gap-1">
                Automations &rarr;
              </span>
            </div>
            <h3 className="font-semibold text-slate-900 group-hover:text-purple-600 transition-colors">Workflow Rules</h3>
            <p className="mt-1 text-xs text-slate-500 line-clamp-2">
              Automated trigger rules for lead score updates, status changes, and activity generation.
            </p>
          </a>

          <a
            {...linkProps('/crm/dashboard')}
            className="group relative rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md hover:border-teal-500/50 transition-all"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                <svg className="w-5 h-5 fill-none stroke-current" viewBox="0 0 24 24" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <span className="text-xs font-medium text-slate-400 group-hover:text-emerald-600 flex items-center gap-1">
                Analytics &rarr;
              </span>
            </div>
            <h3 className="font-semibold text-slate-900 group-hover:text-emerald-600 transition-colors">Sales Dashboard</h3>
            <p className="mt-1 text-xs text-slate-500 line-clamp-2">
              Overview of revenue projections, conversion rates, deals won, and team activity analytics.
            </p>
          </a>
        </div>
      </section>

      {/* Core Business Operations */}
      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-slate-700" />
            Core Business & Directory
          </h2>
          <p className="text-sm text-slate-500">Products, inventory management, parties, and directory access</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <a
            {...linkProps('/parties')}
            className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md hover:border-slate-400 transition-all"
          >
            <div className="w-10 h-10 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center mb-3 group-hover:bg-slate-800 group-hover:text-white transition-colors">
              <svg className="w-5 h-5 fill-none stroke-current" viewBox="0 0 24 24" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <h3 className="font-semibold text-slate-900">Parties & Contacts</h3>
            <p className="mt-1 text-xs text-slate-500">Address book for customer contacts, vendors, and organizations.</p>
          </a>

          <a
            {...linkProps('/products')}
            className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md hover:border-slate-400 transition-all"
          >
            <div className="w-10 h-10 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center mb-3 group-hover:bg-slate-800 group-hover:text-white transition-colors">
              <svg className="w-5 h-5 fill-none stroke-current" viewBox="0 0 24 24" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
            <h3 className="font-semibold text-slate-900">Product Catalog</h3>
            <p className="mt-1 text-xs text-slate-500">Manage sellable products, SKUs, pricing, and unit definitions.</p>
          </a>

          <a
            {...linkProps('/inventory')}
            className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md hover:border-slate-400 transition-all"
          >
            <div className="w-10 h-10 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center mb-3 group-hover:bg-slate-800 group-hover:text-white transition-colors">
              <svg className="w-5 h-5 fill-none stroke-current" viewBox="0 0 24 24" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <h3 className="font-semibold text-slate-900">Stock & Locations</h3>
            <p className="mt-1 text-xs text-slate-500">Multi-location stock levels, inventory transfers, and receipt logging.</p>
          </a>
        </div>
      </section>

      {/* Organization Administration */}
      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-slate-400" />
            Administration & Team
          </h2>
          <p className="text-sm text-slate-500">Colleague management, role definitions, and system security</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <a
            {...linkProps('/team')}
            className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md hover:border-slate-400 transition-all"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center shrink-0 group-hover:bg-slate-800 group-hover:text-white transition-colors">
                <svg className="w-5 h-5 fill-none stroke-current" viewBox="0 0 24 24" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-slate-900">Team Directory</h3>
                <p className="text-xs text-slate-500">Invite colleagues and manage team membership.</p>
              </div>
            </div>
          </a>

          <a
            {...linkProps('/roles')}
            className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md hover:border-slate-400 transition-all"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center shrink-0 group-hover:bg-slate-800 group-hover:text-white transition-colors">
                <svg className="w-5 h-5 fill-none stroke-current" viewBox="0 0 24 24" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-slate-900">Roles & Permissions</h3>
                <p className="text-xs text-slate-500">Configure access control and security permissions.</p>
              </div>
            </div>
          </a>
        </div>
      </section>
    </div>
  );
}

