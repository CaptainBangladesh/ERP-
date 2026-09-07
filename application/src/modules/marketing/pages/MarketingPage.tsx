import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import {
  ERROR_CODES,
  MARKETING_FIELDS,
  MARKETING_PATHS,
  emptyPage,
  listPath,
  listQueryString,
  type BrandListResponse,
  type BrandSummary,
  type CreateMarketingRequest,
  type ListQuery,
  type MarketingListResponse,
  type MarketingResponse,
  type MarketingStatus,
  type MarketingSummary,
} from '@erp/shared';
import { DataTable, Field, FormError } from '@erp/shared/ui';
import { ApiFailure, api } from '../../../api/client';
import { BrandSwitcher } from '../components/BrandSwitcher';
import { SocialAccountsVault } from '../components/SocialAccountsVault';
import { JobQueueMonitor } from '../components/JobQueueMonitor';
import { PublishingManager } from '../components/PublishingManager';
import { SocialCalendarPage } from './SocialCalendarPage';
import { CampaignsManager } from '../components/CampaignsManager';
import { LeadGenManager } from '../components/LeadGenManager';
import { SocialInboxManager } from '../components/SocialInboxManager';
import { TrackingManager } from '../components/TrackingManager';

/**
 * Marketing & Social Media Command Center.
 *
 * Provides Brand multi-tenancy workspace isolation, AES-256-GCM encrypted OAuth credential
 * vault across 10 social networks, background task queues, and campaign records.
 */
export function MarketingPage({
  initialTab = 'vault',
}: {
  initialTab?: 'vault' | 'calendar' | 'publishing' | 'campaigns' | 'leadgen' | 'inbox' | 'analytics' | 'records' | 'queue';
} = {}) {
  const [activeTab, setActiveTab] = useState<'vault' | 'calendar' | 'publishing' | 'campaigns' | 'leadgen' | 'inbox' | 'analytics' | 'records' | 'queue'>(() => {
    if (typeof window !== 'undefined' && window.location.pathname.includes('/calendar')) {
      return 'calendar';
    }
    return initialTab;
  });
  const [activeBrandId, setActiveBrandId] = useState<string | null>(null);
  const [query, setQuery] = useState<ListQuery>({});
  const queryClient = useQueryClient();

  // Load Brands
  const brandsQuery = useQuery({
    queryKey: ['marketing', 'brands'],
    queryFn: () => api.get<BrandListResponse>(MARKETING_PATHS.brands),
  });

  const brands = brandsQuery.data?.items ?? [];
  const activeBrand =
    brands.find((b) => b.id === activeBrandId) ?? brands[0] ?? null;

  // Load Legacy/General Marketing records
  const marketing = useQuery({
    queryKey: ['marketing', 'list', listQueryString(query)],
    queryFn: () =>
      api.get<MarketingListResponse>(listPath(MARKETING_PATHS.marketings, query)),
  });

  const failure = marketing.error instanceof ApiFailure ? marketing.error : undefined;

  const columns = useMemo<Array<ColumnDef<MarketingSummary, unknown>>>(
    () => [
      { id: MARKETING_FIELDS.name, header: 'Name', cell: ({ row }) => row.original.name },
      {
        id: MARKETING_FIELDS.status,
        header: 'Status',
        cell: ({ row }) => STATUS_LABELS[row.original.status],
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <header className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-slate-900">Marketing</h1>
            <span className="rounded-md bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700 border border-blue-200">
              Multi-Network Suite
            </span>
          </div>
          <p className="text-sm text-slate-600">
            Brand workspace isolation, encrypted OAuth vaults, and multi-network campaigns.
          </p>
        </header>

        {/* Brand Switcher Component */}
        <BrandSwitcher
          brands={brands}
          activeBrand={activeBrand}
          onSelectBrand={(b) => setActiveBrandId(b.id)}
          onBrandCreated={(newBrand) => {
            setActiveBrandId(newBrand.id);
            void queryClient.invalidateQueries({ queryKey: ['marketing', 'brands'] });
          }}
        />
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-slate-200 text-sm font-medium text-slate-600">
        <button
          type="button"
          onClick={() => setActiveTab('vault')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 transition ${
            activeTab === 'vault'
              ? 'border-slate-900 font-semibold text-slate-900'
              : 'border-transparent hover:border-slate-300 hover:text-slate-800'
          }`}
        >
          <span>🔐</span>
          <span>Brand & OAuth Vault</span>
          {activeBrand && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
              {activeBrand.name}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('calendar')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 transition ${
            activeTab === 'calendar'
              ? 'border-slate-900 font-semibold text-slate-900'
              : 'border-transparent hover:border-slate-300 hover:text-slate-800'
          }`}
        >
          <span>🗓️</span>
          <span>Calendar & Planner</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('publishing')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 transition ${
            activeTab === 'publishing'
              ? 'border-slate-900 font-semibold text-slate-900'
              : 'border-transparent hover:border-slate-300 hover:text-slate-800'
          }`}
        >
          <span>🚀</span>
          <span>Publishing & Autolists</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('records')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 transition ${
            activeTab === 'records'
              ? 'border-slate-900 font-semibold text-slate-900'
              : 'border-transparent hover:border-slate-300 hover:text-slate-800'
          }`}
        >
          <span>📋</span>
          <span>Campaign Records</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
            {marketing.data?.items.length ?? 0}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('campaigns')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 transition ${
            activeTab === 'campaigns'
              ? 'border-slate-900 font-semibold text-slate-900'
              : 'border-transparent hover:border-slate-300 hover:text-slate-800'
          }`}
        >
          <span>🎯</span>
          <span>Campaigns & Attribution</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('leadgen')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 transition ${
            activeTab === 'leadgen'
              ? 'border-slate-900 font-semibold text-slate-900'
              : 'border-transparent hover:border-slate-300 hover:text-slate-800'
          }`}
        >
          <span>🧲</span>
          <span>Inbound & CRM</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('inbox')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 transition ${
            activeTab === 'inbox'
              ? 'border-slate-900 font-semibold text-slate-900'
              : 'border-transparent hover:border-slate-300 hover:text-slate-800'
          }`}
        >
          <span>💬</span>
          <span>Social Inbox & DMs</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('analytics')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 transition ${
            activeTab === 'analytics'
              ? 'border-slate-900 font-semibold text-slate-900'
              : 'border-transparent hover:border-slate-300 hover:text-slate-800'
          }`}
        >
          <span>📊</span>
          <span>Tracking & Analytics</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('queue')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 transition ${
            activeTab === 'queue'
              ? 'border-slate-900 font-semibold text-slate-900'
              : 'border-transparent hover:border-slate-300 hover:text-slate-800'
          }`}
        >
          <span>⚡</span>
          <span>Queue & Tasks</span>
        </button>
      </div>

      {/* Tab 1: Brand & OAuth Vault */}
      {activeTab === 'vault' && (
        <>
          {activeBrand ? (
            <SocialAccountsVault brand={activeBrand} />
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center shadow-xs">
              <span className="text-3xl">🏢</span>
              <h3 className="mt-3 text-base font-semibold text-slate-900">No Brand Workspaces Yet</h3>
              <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto">
                Create your first client Brand workspace above to manage connected social accounts and OAuth credentials securely.
              </p>
            </div>
          )}
        </>
      )}

      {/* Tab: Calendar & Planner */}
      {activeTab === 'calendar' && (
        <>
          {activeBrand ? (
            <SocialCalendarPage brand={activeBrand} />
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center shadow-xs">
              <span className="text-3xl">🗓️</span>
              <h3 className="mt-3 text-base font-semibold text-slate-900">No Brand Selected</h3>
              <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto">
                Select or create a Brand workspace above to view the publishing calendar and drag-and-drop schedule.
              </p>
            </div>
          )}
        </>
      )}

      {/* Tab 2: Publishing & Autolists */}
      {activeTab === 'publishing' && (
        <>
          {activeBrand ? (
            <PublishingManager brand={activeBrand} />
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center shadow-xs">
              <span className="text-3xl">🚀</span>
              <h3 className="mt-3 text-base font-semibold text-slate-900">Select or Create a Brand</h3>
              <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto">
                Select a Brand workspace above to manage scheduled posts and recurring Autolists.
              </p>
            </div>
          )}
        </>
      )}

      {/* Tab: Campaigns & Attribution */}
      {activeTab === 'campaigns' && (
        <>
          {activeBrand ? (
            <CampaignsManager brandId={activeBrand.id} brandName={activeBrand.name} />
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center shadow-xs">
              <span className="text-3xl">🎯</span>
              <h3 className="mt-3 text-base font-semibold text-slate-900">Select or Create a Brand</h3>
              <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto">
                Select a Brand workspace to create campaigns, generate UTM links, and manage SmartLinks.
              </p>
            </div>
          )}
        </>
      )}

      {/* Tab: Inbound & CRM Handoff (Ticket 07) */}
      {activeTab === 'leadgen' && (
        <>
          {activeBrand ? (
            <LeadGenManager brandId={activeBrand.id} brandName={activeBrand.name} />
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center shadow-xs">
              <span className="text-3xl">🧲</span>
              <h3 className="mt-3 text-base font-semibold text-slate-900">Select or Create a Brand</h3>
              <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto">
                Select a Brand workspace to create web forms, ad lead webhooks, and nurture sequences.
              </p>
            </div>
          )}
        </>
      )}

      {/* Tab: Social Inbox & DM Automation (Ticket 08) */}
      {activeTab === 'inbox' && (
        <>
          {activeBrand ? (
            <SocialInboxManager brandId={activeBrand.id} brandName={activeBrand.name} />
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center shadow-xs">
              <span className="text-3xl">💬</span>
              <h3 className="mt-3 text-base font-semibold text-slate-900">Select or Create a Brand</h3>
              <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto">
                Select a Brand workspace to view social direct messages, respond to customers, and configure keyword DM flows.
              </p>
            </div>
          )}
        </>
      )}

      {/* Tab: Tracking Pixel & Visitor Analytics (Ticket 09) */}
      {activeTab === 'analytics' && (
        <>
          {activeBrand ? (
            <TrackingManager brandId={activeBrand.id} brandName={activeBrand.name} />
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center shadow-xs">
              <span className="text-3xl">📊</span>
              <h3 className="mt-3 text-base font-semibold text-slate-900">Select or Create a Brand</h3>
              <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto">
                Select a Brand workspace to configure website tracking pixels and view visitor analytics.
              </p>
            </div>
          )}
        </>
      )}

      {/* Tab 3: Queue & Tasks */}
      {activeTab === 'queue' && <JobQueueMonitor />}

      {/* Tab 4: Records Table & Form (preserves original scaffold & existing tests) */}
      <div className={activeTab === 'records' ? 'flex flex-col gap-8' : 'hidden'}>
        <AddMarketing
          onAdded={() => {
            void queryClient.invalidateQueries({ queryKey: ['marketing'] });
            setQuery({});
          }}
        />

        <DataTable
          caption="Marketing"
          columns={columns}
          rows={marketing.data?.items ?? []}
          rowId={(row) => row.id}
          page={marketing.data?.page ?? emptyPage()}
          query={query}
          onQueryChange={setQuery}
          status={marketing.isPending ? 'loading' : marketing.isError ? 'error' : 'ready'}
          error={failure?.message}
          onRetry={() => void marketing.refetch()}
          searchLabel="Search by name"
          empty={
            <div className="flex flex-col gap-1">
              <p className="font-medium text-slate-900">Nothing here yet.</p>
              <p>Add your first marketing using the form above.</p>
            </div>
          }
        />
      </div>
    </div>
  );
}

const STATUS_LABELS = {
  active: 'Active',
  inactive: 'Inactive',
} as const satisfies Record<MarketingStatus, string>;

function AddMarketing({ onAdded }: { onAdded: (created: MarketingResponse) => void }) {
  const [name, setName] = useState('');

  const add = useMutation({
    mutationFn: () =>
      api.post<MarketingResponse>(MARKETING_PATHS.marketings, {
        name,
      } satisfies CreateMarketingRequest),
    onSuccess: (created) => {
      setName('');
      onAdded(created);
    },
  });

  const failure = add.error instanceof ApiFailure ? add.error : undefined;
  const fields = failure?.fields ?? {};

  return (
    <form
      noValidate
      aria-labelledby="add-marketing"
      className="flex flex-col gap-4 rounded-md border border-slate-200 bg-white p-4"
      onSubmit={(event) => {
        event.preventDefault();
        add.mutate();
      }}
    >
      <h2 id="add-marketing" className="text-sm font-medium text-slate-900">
        Add a marketing
      </h2>

      <div className="flex flex-wrap gap-4">
        <div className="min-w-56 flex-1">
          <Field id="marketing-name" label="Name" value={name} error={fields.name} onChange={setName} />
        </div>
      </div>

      {failure && failure.code !== ERROR_CODES.validationFailed && (
        <FormError>{failure.message}</FormError>
      )}

      <div>
        <button
          type="submit"
          disabled={add.isPending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {add.isPending ? 'Adding…' : 'Add marketing'}
        </button>
      </div>
    </form>
  );
}
