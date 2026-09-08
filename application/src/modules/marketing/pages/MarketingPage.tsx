import { useEffect, useMemo, useState, type ReactNode } from 'react';
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
  type CreateMarketingRequest,
  type ListQuery,
  type MarketingListResponse,
  type MarketingResponse,
  type MarketingStatus,
  type MarketingSummary,
} from '@erp/shared';
import { Button, DataTable, Field, FormError } from '@erp/shared/ui';
import { navigate, useLocationPath, useLocationSearch } from '../../../app/location';
import { useOptionalSession } from '../../../session/SessionProvider';
import { ApiFailure, api } from '../../../api/client';
import { BRAND_QUERY_PARAM, rememberBrandId, resolveActiveBrand, storedBrandId } from '../brand-context';
import { TabStrip, type TabDefinition } from '../components/TabStrip';
import { BrandSwitcher } from '../components/BrandSwitcher';
import { SocialAccountsVault } from '../components/SocialAccountsVault';
import { JobQueueMonitor } from '../components/JobQueueMonitor';
import { PublishingManager } from '../components/PublishingManager';
import { SocialCalendarPage } from './SocialCalendarPage';
import { CampaignsManager } from '../components/CampaignsManager';
import { LeadGenManager } from '../components/LeadGenManager';
import { SocialInboxManager } from '../components/SocialInboxManager';
import { TrackingManager } from '../components/TrackingManager';
import { ContentSourcesManager } from '../components/ContentSourcesManager';

/**
 * Every destination this workspace has, as data.
 *
 * Nine of these were nine pasted twelve-line buttons plus seven pasted empty states — about 250
 * of this file's 444 lines saying the same thing over and over. They are now one array read by
 * one `TabStrip` and one `EmptyState`, and adding a destination is an entry here.
 *
 * The grouping is the other half of 13.2e: nine top-level tabs is past what a strip carries, and
 * the category research is consistent that density is what new users struggle with. `records` is
 * the ticket-01 scaffold CRUD that sat beside the real "Campaigns & Attribution" under a
 * near-identical name; its *tab* is deleted, and it stays `hidden` rather than removed so
 * `/marketing/records` is still reachable by URL for the scaffold's own tests.
 */
const TABS = [
  { id: 'calendar', label: 'Calendar & Planner', icon: '🗓️', group: 'Plan' },
  { id: 'publishing', label: 'Publishing & Autolists', icon: '🚀', group: 'Plan' },
  { id: 'inbox', label: 'Social Inbox & DMs', icon: '💬', group: 'Engage' },
  { id: 'campaigns', label: 'Campaigns & Attribution', icon: '🎯', group: 'Grow' },
  { id: 'leadgen', label: 'Inbound & CRM', icon: '🧲', group: 'Grow' },
  { id: 'analytics', label: 'Tracking & Analytics', icon: '📊', group: 'Grow' },
  { id: 'sources', label: 'Feeds & Competitors', icon: '📰', group: 'Grow' },
  { id: 'vault', label: 'Brand & OAuth Vault', icon: '🔐', group: 'Settings' },
  { id: 'queue', label: 'Queue & Tasks', icon: '⚡', group: 'Settings' },
  { id: 'records', label: 'Campaign Records', icon: '📋', group: 'Settings', hidden: true },
] as const satisfies readonly TabDefinition[];

type TabId = (typeof TABS)[number]['id'];

const DEFAULT_TAB: TabId = 'vault';
const PANEL_ID = 'marketing-tabpanel';

/**
 * Marketing & Social Media Command Center.
 *
 * Provides Brand multi-tenancy workspace isolation, AES-256-GCM encrypted OAuth credential
 * vault across 10 social networks, background task queues, and campaign records.
 */
export function MarketingPage({ initialTab = DEFAULT_TAB }: { initialTab?: TabId } = {}) {
  const path = useLocationPath();
  const search = useLocationSearch();
  // Optional, because the storage key is namespaced by user and there is simply nothing to
  // namespace by until the session has answered. An unknown user reads and writes nothing.
  const sessionState = useOptionalSession();
  const userId = sessionState?.session?.user?.id;
  // Until the session has answered there is no key to read storage under, and writing the URL
  // before then would put `brands[0]` in it — which then out-proposes the stored brand on the
  // very next render. So the correction waits for the session, not only for the brand list.
  const isSessionSettled = !sessionState?.isRestoring;
  const [query, setQuery] = useState<ListQuery>({});
  const queryClient = useQueryClient();

  /**
   * The tab is the URL, not `useState`.
   *
   * It used to be state seeded by a one-shot `window.location.pathname` read in the initialiser,
   * which is why a client-side navigation to `/marketing/calendar` did not select the calendar,
   * why a tab could not be linked, and why the back button did nothing.
   *
   * The segment is matched against `TABS` ids and *nothing else* — never used to index an
   * object, resolve a component, or build a fetch path — so an unrecognised segment is simply a
   * segment that matched no tab. It renders the default and corrects the URL with `replace`;
   * the unknown string never reaches the DOM.
   */
  const segment = path.startsWith('/marketing/') ? path.slice('/marketing/'.length) : '';
  const matched = TABS.find((tab) => tab.id === segment);
  const activeTab: TabId = matched ? matched.id : segment === '' ? initialTab : DEFAULT_TAB;

  // Load Brands
  const brandsQuery = useQuery({
    queryKey: ['marketing', 'brands'],
    queryFn: () => api.get<BrandListResponse>(MARKETING_PATHS.brands),
  });

  const brands = useMemo(() => brandsQuery.data?.items ?? [], [brandsQuery.data]);

  /**
   * The URL proposes a brand, storage proposes one, and the server's list decides.
   *
   * `?brand=…` is what makes a shared link carry its client; that also makes the id something a
   * colleague pastes and something an attacker crafts, and every panel below drives credentialed
   * publishing with it. So it is resolved against the brands the API returned for *this session*
   * and discarded if it is not among them.
   */
  const urlBrandId = new URLSearchParams(search).get(BRAND_QUERY_PARAM);
  const { brand: activeBrand, wasProposalHonoured } = resolveActiveBrand(brands, [
    urlBrandId,
    storedBrandId(userId),
  ]);

  const goTo = (tab: TabId, brandId: string | null) => {
    // Built from a literal prefix plus an allowlisted id, so no caller-supplied string can ever
    // reach `pushState` — a protocol-relative `//host` value has nowhere to enter.
    const suffix = brandId ? `?${BRAND_QUERY_PARAM}=${encodeURIComponent(brandId)}` : '';
    return `/marketing/${tab}${suffix}`;
  };

  /**
   * Keeps the URL honest about where you actually are.
   *
   * Three cases collapse into one write: an unknown segment, a brand the list did not return,
   * and a resolved brand that simply was not in the URL yet. All are corrections rather than
   * navigations, so all use `replace` — a back button that walks through the app's own tidying
   * up is a back button that does nothing.
   */
  useEffect(() => {
    if (brandsQuery.isPending || !isSessionSettled) return;

    const needsTabFix = path.startsWith('/marketing') && !matched && segment !== '';
    const needsBrandFix = activeBrand ? urlBrandId !== activeBrand.id : Boolean(urlBrandId);
    if (!needsTabFix && !needsBrandFix && wasProposalHonoured) return;

    navigate(goTo(activeTab, activeBrand?.id ?? null), { replace: true });
  }, [
    path,
    segment,
    matched,
    urlBrandId,
    activeBrand,
    activeTab,
    wasProposalHonoured,
    brandsQuery.isPending,
    isSessionSettled,
  ]);

  /** Persisted only once it has survived resolution, so a rejected id is never written back. */
  useEffect(() => {
    if (activeBrand) rememberBrandId(userId, activeBrand.id);
  }, [activeBrand, userId]);

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
          onSelectBrand={(b) => navigate(goTo(activeTab, b.id))}
          onBrandCreated={(newBrand) => {
            void queryClient.invalidateQueries({ queryKey: ['marketing', 'brands'] });
            navigate(goTo(activeTab, newBrand.id));
          }}
        />
      </div>

      <TabStrip
        tabs={TABS}
        activeId={activeTab}
        onSelect={(id) => navigate(goTo(id as TabId, activeBrand?.id ?? null))}
        label="Marketing sections"
        panelId={PANEL_ID}
      />

      <div
        id={PANEL_ID}
        role="tabpanel"
        aria-labelledby={`marketing-tab-${activeTab}`}
        tabIndex={0}
        className="focus:outline-none"
      >
        {activeTab === 'vault' &&
          (activeBrand ? (
            <SocialAccountsVault brand={activeBrand} />
          ) : (
            <EmptyState icon="🏢" title="No Brand Workspaces Yet">
              Create your first client Brand workspace above to manage connected social accounts
              and OAuth credentials securely.
            </EmptyState>
          ))}

        {activeTab === 'calendar' &&
          (activeBrand ? (
            <SocialCalendarPage brand={activeBrand} />
          ) : (
            <EmptyState icon="🗓️" title="No Brand Selected">
              Select or create a Brand workspace above to view the publishing calendar and
              drag-and-drop schedule.
            </EmptyState>
          ))}

        {activeTab === 'publishing' &&
          (activeBrand ? (
            <PublishingManager brand={activeBrand} />
          ) : (
            <EmptyState icon="🚀" title="Select or Create a Brand">
              Select a Brand workspace above to manage scheduled posts and recurring Autolists.
            </EmptyState>
          ))}

        {activeTab === 'campaigns' &&
          (activeBrand ? (
            <CampaignsManager brandId={activeBrand.id} brandName={activeBrand.name} />
          ) : (
            <EmptyState icon="🎯" title="Select or Create a Brand">
              Select a Brand workspace to create campaigns, generate UTM links, and manage
              SmartLinks.
            </EmptyState>
          ))}

        {activeTab === 'leadgen' &&
          (activeBrand ? (
            <LeadGenManager brandId={activeBrand.id} brandName={activeBrand.name} />
          ) : (
            <EmptyState icon="🧲" title="Select or Create a Brand">
              Select a Brand workspace to create web forms, ad lead webhooks, and nurture
              sequences.
            </EmptyState>
          ))}

        {activeTab === 'inbox' &&
          (activeBrand ? (
            <SocialInboxManager brandId={activeBrand.id} brandName={activeBrand.name} />
          ) : (
            <EmptyState icon="💬" title="Select or Create a Brand">
              Select a Brand workspace to view social direct messages, respond to customers, and
              configure keyword DM flows.
            </EmptyState>
          ))}

        {activeTab === 'analytics' &&
          (activeBrand ? (
            <TrackingManager brandId={activeBrand.id} brandName={activeBrand.name} />
          ) : (
            <EmptyState icon="📊" title="Select or Create a Brand">
              Select a Brand workspace to configure website tracking pixels and view visitor
              analytics.
            </EmptyState>
          ))}

        {activeTab === 'sources' &&
          (activeBrand ? (
            <ContentSourcesManager brandId={activeBrand.id} brandName={activeBrand.name} />
          ) : (
            <EmptyState icon="📰" title="Select or Create a Brand">
              Select a Brand workspace to watch content feeds and benchmark competitor handles.
            </EmptyState>
          ))}

        {activeTab === 'queue' && <JobQueueMonitor />}

        {/*
          The scaffold's own table. Mounted rather than switched, because its tests read it from
          the workspace's root path; hidden with CSS when another destination is showing.
        */}
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
    </div>
  );
}

/** The seven pasted "no brand selected" blocks, once. */
function EmptyState({
  icon,
  title,
  children,
}: {
  icon: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center shadow-xs">
      <span className="text-3xl" aria-hidden="true">
        {icon}
      </span>
      <h3 className="mt-3 text-base font-semibold text-slate-900">{title}</h3>
      <p className="mx-auto mt-1 max-w-sm text-xs text-slate-500">{children}</p>
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
        <Button type="submit" variant="primary" size="lg" disabled={add.isPending}>
          {add.isPending ? 'Adding…' : 'Add marketing'}
        </Button>
      </div>
    </form>
  );
}
