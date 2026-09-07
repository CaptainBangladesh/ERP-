import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MARKETING_PATHS,
  type TrackingSiteListResponse,
  type TrackingSiteSummary,
  type TrackingAnalyticsResponse,
  type CreateTrackingSiteRequest,
} from '@erp/shared';
import { api } from '../../../api/client';

export function TrackingManager({
  brandId,
  brandName,
}: {
  brandId: string;
  brandName: string;
}) {
  const queryClient = useQueryClient();
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [showAddSiteModal, setShowAddSiteModal] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [testBeaconStatus, setTestBeaconStatus] = useState<string | null>(null);

  // Form State
  const [newSite, setNewSite] = useState<Partial<CreateTrackingSiteRequest>>({
    name: '',
    domain: '',
  });

  // Query Sites
  const sitesQuery = useQuery({
    queryKey: ['marketing', 'tracking-sites', brandId],
    queryFn: () =>
      api.get<TrackingSiteListResponse>(`${MARKETING_PATHS.trackingSites}?brandId=${brandId}`),
    enabled: Boolean(brandId),
  });

  const sites = sitesQuery.data?.items ?? [];
  const activeSite = sites.find((s) => s.id === selectedSiteId) ?? sites[0] ?? null;

  // Query Analytics for Active Site
  const analyticsQuery = useQuery({
    queryKey: ['marketing', 'tracking-analytics', activeSite?.id, brandId],
    queryFn: async () => {
      if (!activeSite) return null;
      return api.get<TrackingAnalyticsResponse>(MARKETING_PATHS.trackingSiteAnalytics(activeSite.id));
    },
    enabled: Boolean(brandId) && Boolean(activeSite),
  });

  const analytics = analyticsQuery.data;

  // Create Site Mutation
  const createSiteMutation = useMutation({
    mutationFn: (data: CreateTrackingSiteRequest) =>
      api.post<TrackingSiteSummary>(MARKETING_PATHS.trackingSites, data),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['marketing', 'tracking-sites', brandId] });
      setShowAddSiteModal(false);
      setNewSite({ name: '', domain: '' });
      setSelectedSiteId(created.id);
    },
  });

  // Delete Site Mutation
  const deleteSiteMutation = useMutation({
    mutationFn: (siteId: string) =>
      api.delete(MARKETING_PATHS.trackingSite(siteId)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['marketing', 'tracking-sites', brandId] });
      setSelectedSiteId(null);
    },
  });

  // Copy Snippet Helper
  const handleCopySnippet = (pixelKey: string) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://app.yourdomain.com';
    const snippet = `<!-- ERP First-Party Tracking Pixel -->\n<script src="${origin}${MARKETING_PATHS.pixelJs}" data-site="${pixelKey}" async defer></script>`;
    navigator.clipboard.writeText(snippet);
    setCopiedKey(pixelKey);
    setTimeout(() => setCopiedKey(null), 3000);
  };

  // Test Ping Beacon
  const handleSendTestBeacon = async (pixelKey: string) => {
    setTestBeaconStatus('Sending beacon...');
    try {
      await fetch(MARKETING_PATHS.collect, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pixelKey,
          visitorId: `test-visitor-${Date.now()}`,
          sessionId: `test-session-${Date.now()}`,
          path: '/test-landing-page',
          referrer: 'https://google.com/search?q=test',
          utmSource: 'google',
          utmMedium: 'cpc',
          utmCampaign: 'Spring_Launch_2026',
        }),
      });
      setTestBeaconStatus('✅ Test beacon ingested! Refreshing analytics...');
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['marketing', 'tracking-analytics'] });
        queryClient.invalidateQueries({ queryKey: ['marketing', 'tracking-sites'] });
        setTestBeaconStatus(null);
      }, 1500);
    } catch (err) {
      setTestBeaconStatus('❌ Error dispatching test beacon.');
      setTimeout(() => setTestBeaconStatus(null), 3000);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Top Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-indigo-100 bg-gradient-to-r from-indigo-50/70 via-white to-blue-50/70 p-5">
        <div>
          <h2 className="text-lg font-semibold text-indigo-950">
            First-Party Web Tracking & Visitor Analytics
          </h2>
          <p className="mt-1 text-sm text-indigo-800/80">
            Lightweight client snippet (&lt; 2.2 KB) with automatic UTM attribution, bot filtering, and real-time pageview aggregation for{' '}
            <span className="font-semibold text-indigo-950">{brandName}</span>.
          </p>
        </div>
        <button
          onClick={() => setShowAddSiteModal(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Register Tracked Site
        </button>
      </div>

      {/* Sites Selector & Snippets */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Sites List */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800">Tracked Domains</h3>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
              {sites.length} Active
            </span>
          </div>

          {sites.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 py-8 text-center">
              <svg className="mb-2 h-8 w-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
              </svg>
              <p className="text-sm font-medium text-slate-700">No websites registered</p>
              <p className="mt-1 text-xs text-slate-500">Add your client's landing page or e-commerce store domain.</p>
              <button
                onClick={() => setShowAddSiteModal(true)}
                className="mt-3 rounded-md bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
              >
                Register First Website
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {sites.map((s) => (
                <div
                  key={s.id}
                  onClick={() => setSelectedSiteId(s.id)}
                  className={`cursor-pointer rounded-lg border p-3 transition-all ${
                    (activeSite?.id === s.id)
                      ? 'border-indigo-500 bg-indigo-50/50 shadow-sm'
                      : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-900">{s.name}</span>
                    <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 border border-emerald-200">
                      {s.isActive ? 'Active' : 'Paused'}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500 font-mono">{s.domain}</p>
                  <div className="mt-2 flex items-center justify-between text-xs text-slate-600">
                    <span>{s._count?.pageViews ?? 0} Pageviews</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Delete tracking site "${s.name}"?`)) {
                          deleteSiteMutation.mutate(s.id);
                        }
                      }}
                      className="text-red-600 hover:text-red-700"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pixel Snippet Card */}
        <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          {activeSite ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">
                    Client Installation Snippet: <span className="text-indigo-600">{activeSite.name}</span>
                  </h3>
                  <p className="text-xs text-slate-500">
                    Paste this snippet inside the <code className="font-mono text-slate-700">&lt;head&gt;</code> tag of your website.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleSendTestBeacon(activeSite.pixelKey)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    🚀 Send Test Beacon
                  </button>
                  <button
                    onClick={() => handleCopySnippet(activeSite.pixelKey)}
                    className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 transition-colors"
                  >
                    {copiedKey === activeSite.pixelKey ? '✓ Copied!' : '📋 Copy Snippet'}
                  </button>
                </div>
              </div>

              {testBeaconStatus && (
                <div className="rounded-md bg-slate-100 p-2.5 text-xs text-slate-800 font-medium">
                  {testBeaconStatus}
                </div>
              )}

              <div className="relative rounded-lg bg-slate-900 p-4 font-mono text-xs text-emerald-400 overflow-x-auto">
                <pre>{`<!-- ERP First-Party Tracking Pixel -->
<script
  src="${typeof window !== 'undefined' ? window.location.origin : 'https://app.yourdomain.com'}${MARKETING_PATHS.pixelJs}"
  data-site="${activeSite.pixelKey}"
  async defer
></script>`}</pre>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs text-slate-600 bg-slate-50 p-3 rounded-lg border border-slate-200">
                <div>
                  <span className="font-semibold text-slate-700">Pixel Key:</span>{' '}
                  <span className="font-mono text-slate-900">{activeSite.pixelKey}</span>
                </div>
                <div>
                  <span className="font-semibold text-slate-700">Target Domain:</span>{' '}
                  <span className="font-mono text-slate-900">{activeSite.domain}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">
              Select or create a website to view its tracking code.
            </div>
          )}
        </div>
      </div>

      {/* Analytics Dashboard */}
      <div className="flex flex-col gap-5">
        {/* Metric Cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Total Pageviews</span>
              <span className="rounded-md bg-blue-50 p-1.5 text-blue-600">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              </span>
            </div>
            <p className="mt-2 text-2xl font-bold text-slate-900">{analytics?.totalPageviews ?? 0}</p>
            <p className="mt-1 text-xs text-slate-500">Total hits recorded</p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Unique Visitors</span>
              <span className="rounded-md bg-emerald-50 p-1.5 text-emerald-600">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </span>
            </div>
            <p className="mt-2 text-2xl font-bold text-slate-900">{analytics?.totalVisitors ?? 0}</p>
            <p className="mt-1 text-xs text-slate-500">Distinct first-party IDs</p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Active Sessions</span>
              <span className="rounded-md bg-purple-50 p-1.5 text-purple-600">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </span>
            </div>
            <p className="mt-2 text-2xl font-bold text-slate-900">{analytics?.totalSessions ?? 0}</p>
            <p className="mt-1 text-xs text-slate-500">30-min window clusters</p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Pages / Session</span>
              <span className="rounded-md bg-amber-50 p-1.5 text-amber-600">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </span>
            </div>
            <p className="mt-2 text-2xl font-bold text-slate-900">
              {analytics && analytics.totalSessions > 0
                ? (analytics.totalPageviews / analytics.totalSessions).toFixed(1)
                : '0.0'}
            </p>
            <p className="mt-1 text-xs text-slate-500">Engagement depth</p>
          </div>
        </div>

        {/* Daily Breakdown & Campaigns */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Daily Table */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-800">Daily Visitor & Pageview Breakdown</h3>
            <p className="text-xs text-slate-500 mb-3">Daily aggregated traffic history</p>

            {(!analytics?.daily || analytics.daily.length === 0) ? (
              <p className="py-8 text-center text-xs text-slate-500">No daily traffic recorded yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-600">
                  <thead className="border-b border-slate-200 bg-slate-50 text-slate-700 font-semibold">
                    <tr>
                      <th className="py-2 px-3">Date</th>
                      <th className="py-2 px-3">Pageviews</th>
                      <th className="py-2 px-3">Unique Visitors</th>
                      <th className="py-2 px-3">Sessions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {analytics.daily.map((d) => (
                      <tr key={d.date} className="hover:bg-slate-50">
                        <td className="py-2 px-3 font-medium text-slate-900">{d.date}</td>
                        <td className="py-2 px-3 text-indigo-600 font-semibold">{d.pageviews}</td>
                        <td className="py-2 px-3 text-emerald-600 font-medium">{d.visitors}</td>
                        <td className="py-2 px-3 text-purple-600">{d.sessions}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Campaign Attribution */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-800">Campaign Attribution (UTM)</h3>
            <p className="text-xs text-slate-500 mb-3">Traffic grouped by UTM Campaign tag</p>

            {(!analytics?.campaigns || analytics.campaigns.length === 0) ? (
              <p className="py-8 text-center text-xs text-slate-500">No campaign UTM tags recorded.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-600">
                  <thead className="border-b border-slate-200 bg-slate-50 text-slate-700 font-semibold">
                    <tr>
                      <th className="py-2 px-3">Campaign</th>
                      <th className="py-2 px-3">Pageviews</th>
                      <th className="py-2 px-3">Visitors</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {analytics.campaigns.map((c) => (
                      <tr key={c.utmCampaign} className="hover:bg-slate-50">
                        <td className="py-2 px-3 font-medium text-slate-900">{c.utmCampaign}</td>
                        <td className="py-2 px-3 text-indigo-600 font-semibold">{c.pageviews}</td>
                        <td className="py-2 px-3 text-emerald-600">{c.visitors}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Top Pages & Referrers */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Top Pages */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-800">Top Visited URLs</h3>
            <p className="text-xs text-slate-500 mb-3">Most popular destination paths</p>

            {(!analytics?.topPages || analytics.topPages.length === 0) ? (
              <p className="py-6 text-center text-xs text-slate-500">No page views recorded.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {analytics.topPages.map((p) => (
                  <div key={p.path} className="flex items-center justify-between text-xs py-1 border-b border-slate-100">
                    <span className="font-mono text-slate-800 truncate max-w-[280px]">{p.path}</span>
                    <span className="font-semibold text-indigo-600">{p.pageviews} views</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Top Referrers & Devices */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-800">Traffic Referrers & Devices</h3>
            <p className="text-xs text-slate-500 mb-3">Origin sources and hardware distribution</p>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <h4 className="text-xs font-semibold text-slate-700 mb-2">Top Referrers</h4>
                {(!analytics?.topReferrers || analytics.topReferrers.length === 0) ? (
                  <p className="text-xs text-slate-400">Direct / No Referrer</p>
                ) : (
                  <div className="flex flex-col gap-1 text-xs">
                    {analytics.topReferrers.map((r) => (
                      <div key={r.referrer} className="flex justify-between text-slate-600 py-0.5">
                        <span className="truncate max-w-[120px]">{r.referrer}</span>
                        <span className="font-medium text-slate-900">{r.pageviews}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h4 className="text-xs font-semibold text-slate-700 mb-2">Device Breakdown</h4>
                {(!analytics?.devices || analytics.devices.length === 0) ? (
                  <p className="text-xs text-slate-400">No device data</p>
                ) : (
                  <div className="flex flex-col gap-1 text-xs">
                    {analytics.devices.map((d) => (
                      <div key={d.device} className="flex justify-between text-slate-600 py-0.5 capitalize">
                        <span>{d.device}</span>
                        <span className="font-medium text-slate-900">{d.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Add Tracked Site Modal */}
      {showAddSiteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="text-base font-semibold text-slate-900">Register Tracked Website</h3>
              <button
                onClick={() => setShowAddSiteModal(false)}
                className="text-slate-400 hover:text-slate-600 text-lg"
              >
                &times;
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (newSite.name && newSite.domain) {
                  createSiteMutation.mutate({
                    brandId,
                    name: newSite.name,
                    domain: newSite.domain,
                    isActive: true,
                  });
                }
              }}
              className="mt-4 flex flex-col gap-4"
            >
              <div>
                <label className="block text-xs font-semibold text-slate-700">Site / Application Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Apex Athletics Online Store"
                  value={newSite.name}
                  onChange={(e) => setNewSite({ ...newSite, name: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Domain Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. store.apexathletics.com"
                  value={newSite.domain}
                  onChange={(e) => setNewSite({ ...newSite, domain: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                />
                <p className="mt-1 text-xs text-slate-500">
                  Do not include http:// or slashes.
                </p>
              </div>

              <div className="mt-3 flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={() => setShowAddSiteModal(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createSiteMutation.isPending}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {createSiteMutation.isPending ? 'Registering...' : 'Register Domain'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
