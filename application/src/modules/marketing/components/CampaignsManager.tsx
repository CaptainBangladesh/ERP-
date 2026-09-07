import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MARKETING_PATHS,
  type AdAccountSyncListResponse,
  type AdAccountSyncSummary,
  type AdPlatform,
  type BuildUtmResponse,
  type CreateAdAccountSyncRequest,
  type CreateMarketingCampaignRequest,
  type CreateSmartLinkRequest,
  type MarketingCampaignListResponse,
  type MarketingCampaignSummary,
  type SmartLinkListResponse,
  type SmartLinkSummary,
  type SyncAdAccountResponse,
} from '@erp/shared';
import { api } from '../../../api/client';

export function CampaignsManager({
  brandId,
  brandName,
}: {
  brandId: string;
  brandName: string;
}) {
  const queryClient = useQueryClient();
  const [activeSection, setActiveSection] = useState<'campaigns' | 'utm' | 'smartlinks' | 'ads'>('campaigns');

  // UTM Generator State
  const [utmUrl, setUtmUrl] = useState('https://example.com/collection');
  const [utmSource, setUtmSource] = useState('instagram');
  const [utmMedium, setUtmMedium] = useState('bio');
  const [utmCampaign, setUtmCampaign] = useState('spring_launch');
  const [utmTerm, setUtmTerm] = useState('');
  const [utmContent, setUtmContent] = useState('');
  const [generatedUtm, setGeneratedUtm] = useState<BuildUtmResponse | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  // Modal States
  const [showCampaignModal, setShowCampaignModal] = useState(false);
  const [showSmartLinkModal, setShowSmartLinkModal] = useState(false);
  const [showAdSyncModal, setShowAdSyncModal] = useState(false);

  // Form States
  const [newCampaign, setNewCampaign] = useState<Partial<CreateMarketingCampaignRequest>>({
    name: '',
    budget: 1500,
    status: 'ACTIVE',
  });
  const [newSmartLink, setNewSmartLink] = useState<Partial<CreateSmartLinkRequest>>({
    slug: '',
    title: `${brandName} | Official Links`,
    bio: 'Discover our new arrivals, latest posts, and exclusive offers.',
  });
  const [newAdSync, setNewAdSync] = useState<Partial<CreateAdAccountSyncRequest>>({
    platform: 'meta',
    spend: 450,
    impressions: 22000,
    clicks: 850,
    roas: 3.4,
  });

  // Queries
  const campaignsQuery = useQuery({
    queryKey: ['marketing', 'campaigns', brandId],
    queryFn: () =>
      api.get<MarketingCampaignListResponse>(
        `${MARKETING_PATHS.campaigns}?filter.brandId=${brandId}`,
      ),
    enabled: Boolean(brandId),
  });

  const smartLinksQuery = useQuery({
    queryKey: ['marketing', 'smart-links', brandId],
    queryFn: () =>
      api.get<SmartLinkListResponse>(
        `${MARKETING_PATHS.smartLinks}?filter.brandId=${brandId}`,
      ),
    enabled: Boolean(brandId),
  });

  const adSyncsQuery = useQuery({
    queryKey: ['marketing', 'ad-syncs', brandId],
    queryFn: () =>
      api.get<AdAccountSyncListResponse>(
        `${MARKETING_PATHS.adSyncs}?filter.brandId=${brandId}`,
      ),
    enabled: Boolean(brandId),
  });

  // Mutations
  const createCampaignMutation = useMutation({
    mutationFn: (data: CreateMarketingCampaignRequest) =>
      api.post<MarketingCampaignSummary>(MARKETING_PATHS.campaigns, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['marketing', 'campaigns', brandId] });
      setShowCampaignModal(false);
      setNewCampaign({ name: '', budget: 1500, status: 'ACTIVE' });
    },
  });

  const createSmartLinkMutation = useMutation({
    mutationFn: (data: CreateSmartLinkRequest) =>
      api.post<SmartLinkSummary>(MARKETING_PATHS.smartLinks, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['marketing', 'smart-links', brandId] });
      setShowSmartLinkModal(false);
      setNewSmartLink({ slug: '', title: '', bio: '' });
    },
  });

  const createAdSyncMutation = useMutation({
    mutationFn: (data: CreateAdAccountSyncRequest) =>
      api.post<AdAccountSyncSummary>(MARKETING_PATHS.adSyncs, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['marketing', 'ad-syncs', brandId] });
      setShowAdSyncModal(false);
    },
  });

  const syncAdAccountMutation = useMutation({
    mutationFn: (id: string) =>
      api.post<SyncAdAccountResponse>(MARKETING_PATHS.triggerAdSync(id), {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['marketing', 'ad-syncs', brandId] });
    },
  });

  const buildUtmMutation = useMutation({
    mutationFn: (data: any) =>
      api.post<BuildUtmResponse>(MARKETING_PATHS.buildUtm, data),
    onSuccess: (res) => {
      setGeneratedUtm(res);
    },
  });

  const handleGenerateUtm = (e: React.FormEvent) => {
    e.preventDefault();
    buildUtmMutation.mutate({
      url: utmUrl,
      source: utmSource,
      medium: utmMedium,
      campaign: utmCampaign,
      term: utmTerm || undefined,
      content: utmContent || undefined,
    });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedUrl(text);
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  const campaigns = campaignsQuery.data?.items ?? [];
  const smartLinks = smartLinksQuery.data?.items ?? [];
  const adSyncs = adSyncsQuery.data?.items ?? [];

  const totalBudget = campaigns.reduce((sum, c) => sum + c.budget, 0);
  const totalAdSpend = adSyncs.reduce((sum, a) => sum + a.spend, 0);
  const totalViews = smartLinks.reduce((sum, s) => sum + s.viewCount, 0);
  const totalClicks = smartLinks.reduce((sum, s) => sum + s.clickCount, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* KPI Overview Bar */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '1rem',
        }}
      >
        <div
          style={{
            background: 'var(--color-surface, #ffffff)',
            padding: '1.25rem',
            borderRadius: '12px',
            border: '1px solid var(--color-border, #e2e8f0)',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          }}
        >
          <div style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>
            Active Campaigns
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#0f172a', marginTop: '0.25rem' }}>
            {campaigns.length}
          </div>
          <div style={{ fontSize: '0.8rem', color: '#10b981', marginTop: '0.25rem' }}>
            Allocated: ${totalBudget.toLocaleString()}
          </div>
        </div>

        <div
          style={{
            background: 'var(--color-surface, #ffffff)',
            padding: '1.25rem',
            borderRadius: '12px',
            border: '1px solid var(--color-border, #e2e8f0)',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          }}
        >
          <div style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>
            Paid Ad Spend
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#0f172a', marginTop: '0.25rem' }}>
            ${totalAdSpend.toLocaleString()}
          </div>
          <div style={{ fontSize: '0.8rem', color: '#6366f1', marginTop: '0.25rem' }}>
            Across {adSyncs.length} ad networks
          </div>
        </div>

        <div
          style={{
            background: 'var(--color-surface, #ffffff)',
            padding: '1.25rem',
            borderRadius: '12px',
            border: '1px solid var(--color-border, #e2e8f0)',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          }}
        >
          <div style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>
            SmartLinks (Bio)
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#0f172a', marginTop: '0.25rem' }}>
            {smartLinks.length}
          </div>
          <div style={{ fontSize: '0.8rem', color: '#0284c7', marginTop: '0.25rem' }}>
            {totalViews} views • {totalClicks} clicks
          </div>
        </div>

        <div
          style={{
            background: 'var(--color-surface, #ffffff)',
            padding: '1.25rem',
            borderRadius: '12px',
            border: '1px solid var(--color-border, #e2e8f0)',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          }}
        >
          <div style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>
            Overall Bio CTR
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#0f172a', marginTop: '0.25rem' }}>
            {totalViews > 0 ? ((totalClicks / totalViews) * 100).toFixed(1) : '0.0'}%
          </div>
          <div style={{ fontSize: '0.8rem', color: '#10b981', marginTop: '0.25rem' }}>
            Attribution ready
          </div>
        </div>
      </div>

      {/* Sub-Navigation Tabs */}
      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          borderBottom: '1px solid var(--color-border, #e2e8f0)',
          paddingBottom: '0.5rem',
        }}
      >
        <button
          type="button"
          onClick={() => setActiveSection('campaigns')}
          style={{
            padding: '0.5rem 1rem',
            borderRadius: '8px',
            border: 'none',
            background: activeSection === 'campaigns' ? '#4f46e5' : 'transparent',
            color: activeSection === 'campaigns' ? '#fff' : '#475569',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          🎯 Campaigns
        </button>
        <button
          type="button"
          onClick={() => setActiveSection('utm')}
          style={{
            padding: '0.5rem 1rem',
            borderRadius: '8px',
            border: 'none',
            background: activeSection === 'utm' ? '#4f46e5' : 'transparent',
            color: activeSection === 'utm' ? '#fff' : '#475569',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          🔗 UTM Link Builder
        </button>
        <button
          type="button"
          onClick={() => setActiveSection('smartlinks')}
          style={{
            padding: '0.5rem 1rem',
            borderRadius: '8px',
            border: 'none',
            background: activeSection === 'smartlinks' ? '#4f46e5' : 'transparent',
            color: activeSection === 'smartlinks' ? '#fff' : '#475569',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          📱 SmartLinks (Bio Pages)
        </button>
        <button
          type="button"
          onClick={() => setActiveSection('ads')}
          style={{
            padding: '0.5rem 1rem',
            borderRadius: '8px',
            border: 'none',
            background: activeSection === 'ads' ? '#4f46e5' : 'transparent',
            color: activeSection === 'ads' ? '#fff' : '#475569',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          📊 Paid Ad Sync
        </button>
      </div>

      {/* ─── 1. Campaigns List Section ─── */}
      {activeSection === 'campaigns' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#0f172a' }}>
                Marketing Campaigns
              </h2>
              <p style={{ fontSize: '0.875rem', color: '#64748b' }}>
                Coordinate initiatives, track cross-channel budgets, and measure overall ROAS for {brandName}.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowCampaignModal(true)}
              style={{
                padding: '0.6rem 1.25rem',
                background: '#4f46e5',
                color: '#fff',
                borderRadius: '8px',
                border: 'none',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              + Create Campaign
            </button>
          </div>

          {campaigns.length === 0 ? (
            <div
              style={{
                padding: '3rem',
                textAlign: 'center',
                background: '#f8fafc',
                borderRadius: '12px',
                border: '1px dashed #cbd5e1',
              }}
            >
              <div style={{ fontSize: '2rem' }}>🎯</div>
              <h3 style={{ marginTop: '0.5rem', fontWeight: 600 }}>No campaigns created yet</h3>
              <p style={{ color: '#64748b', fontSize: '0.875rem', maxWidth: '400px', margin: '0.5rem auto 1rem' }}>
                Group social media schedules, UTM landing page links, and paid ads under a cohesive campaign.
              </p>
              <button
                type="button"
                onClick={() => setShowCampaignModal(true)}
                style={{
                  padding: '0.5rem 1rem',
                  background: '#4f46e5',
                  color: '#fff',
                  borderRadius: '6px',
                  border: 'none',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Create Your First Campaign
              </button>
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                gap: '1rem',
              }}
            >
              {campaigns.map((c) => {
                const percentSpent = c.budget > 0 ? Math.min(100, Math.round((c.adSpend / c.budget) * 100)) : 0;
                return (
                  <div
                    key={c.id}
                    style={{
                      background: '#fff',
                      border: '1px solid #e2e8f0',
                      borderRadius: '12px',
                      padding: '1.25rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.75rem',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0f172a' }}>{c.name}</h3>
                      <span
                        style={{
                          fontSize: '0.7rem',
                          fontWeight: 700,
                          padding: '3px 8px',
                          borderRadius: '12px',
                          background: c.status === 'ACTIVE' ? '#dcfce7' : '#f1f5f9',
                          color: c.status === 'ACTIVE' ? '#15803d' : '#475569',
                        }}
                      >
                        {c.status}
                      </span>
                    </div>

                    {c.description && (
                      <p style={{ fontSize: '0.85rem', color: '#64748b', lineHeight: 1.4 }}>
                        {c.description}
                      </p>
                    )}

                    {/* Budget & Spend Progress */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '4px' }}>
                        <span style={{ color: '#64748b' }}>Spend / Budget</span>
                        <span style={{ fontWeight: 600 }}>
                          ${c.adSpend.toLocaleString()} / ${c.budget.toLocaleString()} ({percentSpent}%)
                        </span>
                      </div>
                      <div
                        style={{
                          height: '6px',
                          width: '100%',
                          background: '#f1f5f9',
                          borderRadius: '3px',
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            height: '100%',
                            width: `${percentSpent}%`,
                            background: percentSpent > 90 ? '#ef4444' : '#4f46e5',
                            borderRadius: '3px',
                          }}
                        />
                      </div>
                    </div>

                    {/* Metrics Footer */}
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(3, 1fr)',
                        gap: '0.5rem',
                        background: '#f8fafc',
                        padding: '0.75rem',
                        borderRadius: '8px',
                        textAlign: 'center',
                        fontSize: '0.75rem',
                      }}
                    >
                      <div>
                        <div style={{ color: '#64748b' }}>Posts</div>
                        <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{c.postsCount}</div>
                      </div>
                      <div>
                        <div style={{ color: '#64748b' }}>SmartLinks</div>
                        <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{c.smartLinksCount}</div>
                      </div>
                      <div>
                        <div style={{ color: '#64748b' }}>ROAS</div>
                        <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#10b981' }}>
                          {c.roas > 0 ? `${c.roas}x` : '—'}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── 2. UTM Link Builder Section ─── */}
      {activeSection === 'utm' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem' }}>
          {/* Builder Form */}
          <div
            style={{
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: '12px',
              padding: '1.5rem',
            }}
          >
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '0.25rem' }}>
              Generate Trackable UTM Links
            </h2>
            <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '1.25rem' }}>
              Add Google Analytics campaign parameters to your landing pages for attribution reporting.
            </p>

            <form onSubmit={handleGenerateUtm} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>
                  Destination Website URL *
                </label>
                <input
                  type="text"
                  required
                  value={utmUrl}
                  onChange={(e) => setUtmUrl(e.target.value)}
                  placeholder="https://yourbrand.com/summer-sale"
                  style={{
                    width: '100%',
                    padding: '0.6rem 0.8rem',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.9rem',
                  }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>
                    Campaign Source *
                  </label>
                  <input
                    type="text"
                    required
                    value={utmSource}
                    onChange={(e) => setUtmSource(e.target.value)}
                    placeholder="instagram, google, newsletter"
                    style={{
                      width: '100%',
                      padding: '0.6rem 0.8rem',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      fontSize: '0.9rem',
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>
                    Campaign Medium *
                  </label>
                  <input
                    type="text"
                    required
                    value={utmMedium}
                    onChange={(e) => setUtmMedium(e.target.value)}
                    placeholder="bio, cpc, social, email"
                    style={{
                      width: '100%',
                      padding: '0.6rem 0.8rem',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      fontSize: '0.9rem',
                    }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>
                  Campaign Name *
                </label>
                <input
                  type="text"
                  required
                  value={utmCampaign}
                  onChange={(e) => setUtmCampaign(e.target.value)}
                  placeholder="spring_launch_2026"
                  style={{
                    width: '100%',
                    padding: '0.6rem 0.8rem',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.9rem',
                  }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>
                    Campaign Term (Keywords)
                  </label>
                  <input
                    type="text"
                    value={utmTerm}
                    onChange={(e) => setUtmTerm(e.target.value)}
                    placeholder="shoes, sneakers"
                    style={{
                      width: '100%',
                      padding: '0.6rem 0.8rem',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      fontSize: '0.9rem',
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>
                    Campaign Content (Variant)
                  </label>
                  <input
                    type="text"
                    value={utmContent}
                    onChange={(e) => setUtmContent(e.target.value)}
                    placeholder="blue_banner, video_ad"
                    style={{
                      width: '100%',
                      padding: '0.6rem 0.8rem',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      fontSize: '0.9rem',
                    }}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={buildUtmMutation.isPending}
                style={{
                  padding: '0.75rem',
                  background: '#4f46e5',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  marginTop: '0.5rem',
                }}
              >
                {buildUtmMutation.isPending ? 'Generating...' : '⚡ Generate Trackable Links'}
              </button>
            </form>
          </div>

          {/* Generated Presets & Result */}
          <div
            style={{
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: '12px',
              padding: '1.5rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
            }}
          >
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Channel Multi-Distribution Links</h3>
            <p style={{ fontSize: '0.85rem', color: '#64748b' }}>
              Pre-built trackable URL variations tailored for each marketing channel:
            </p>

            {generatedUtm ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div
                  style={{
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    padding: '0.75rem',
                  }}
                >
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#4f46e5', textTransform: 'uppercase' }}>
                    Primary Generated URL
                  </div>
                  <div
                    style={{
                      fontFamily: 'monospace',
                      fontSize: '0.85rem',
                      wordBreak: 'break-all',
                      marginTop: '4px',
                      color: '#0f172a',
                    }}
                  >
                    {generatedUtm.utmUrl}
                  </div>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(generatedUtm.utmUrl)}
                    style={{
                      marginTop: '8px',
                      padding: '4px 10px',
                      background: copiedUrl === generatedUtm.utmUrl ? '#10b981' : '#e0e7ff',
                      color: copiedUrl === generatedUtm.utmUrl ? '#fff' : '#4338ca',
                      borderRadius: '4px',
                      border: 'none',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {copiedUrl === generatedUtm.utmUrl ? '✓ Copied!' : '📋 Copy Link'}
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '350px', overflowY: 'auto' }}>
                  {generatedUtm.channelPresets?.map((p) => (
                    <div
                      key={p.channel}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        background: '#f8fafc',
                        padding: '0.6rem 0.8rem',
                        borderRadius: '6px',
                        border: '1px solid #f1f5f9',
                      }}
                    >
                      <div>
                        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#0f172a' }}>{p.channel}</div>
                        <div style={{ fontSize: '0.75rem', color: '#64748b', maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.url}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(p.url)}
                        style={{
                          padding: '4px 8px',
                          background: copiedUrl === p.url ? '#10b981' : '#f1f5f9',
                          color: copiedUrl === p.url ? '#fff' : '#475569',
                          border: 'none',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          cursor: 'pointer',
                        }}
                      >
                        {copiedUrl === p.url ? '✓' : 'Copy'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div
                style={{
                  padding: '2.5rem',
                  textAlign: 'center',
                  background: '#f8fafc',
                  borderRadius: '8px',
                  border: '1px dashed #cbd5e1',
                  color: '#64748b',
                }}
              >
                Fill the form on the left and click "Generate Trackable Links" to see your tagged channel URLs.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── 3. SmartLinks (Link-in-Bio) Section ─── */}
      {activeSection === 'smartlinks' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#0f172a' }}>
                SmartLinks (Link-in-Bio Pages)
              </h2>
              <p style={{ fontSize: '0.875rem', color: '#64748b' }}>
                High-converting mobile landing pages at <code>/b/:slug</code> with button links and shoppable photo grid.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowSmartLinkModal(true)}
              style={{
                padding: '0.6rem 1.25rem',
                background: '#4f46e5',
                color: '#fff',
                borderRadius: '8px',
                border: 'none',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              + Create SmartLink Page
            </button>
          </div>

          {smartLinks.length === 0 ? (
            <div
              style={{
                padding: '3rem',
                textAlign: 'center',
                background: '#f8fafc',
                borderRadius: '12px',
                border: '1px dashed #cbd5e1',
              }}
            >
              <div style={{ fontSize: '2rem' }}>📱</div>
              <h3 style={{ marginTop: '0.5rem', fontWeight: 600 }}>No SmartLink pages published yet</h3>
              <p style={{ color: '#64748b', fontSize: '0.875rem', maxWidth: '420px', margin: '0.5rem auto 1rem' }}>
                Create a Linktree/Metricool-style landing page for your Instagram and TikTok bios to route followers to your products.
              </p>
              <button
                type="button"
                onClick={() => setShowSmartLinkModal(true)}
                style={{
                  padding: '0.5rem 1rem',
                  background: '#4f46e5',
                  color: '#fff',
                  borderRadius: '6px',
                  border: 'none',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Create SmartLink Now
              </button>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1.25rem' }}>
              {smartLinks.map((sl) => {
                const publicUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/b/${sl.slug}`;
                return (
                  <div
                    key={sl.id}
                    style={{
                      background: '#fff',
                      border: '1px solid #e2e8f0',
                      borderRadius: '12px',
                      padding: '1.25rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.75rem',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0f172a' }}>{sl.title}</h3>
                      <span
                        style={{
                          fontSize: '0.75rem',
                          padding: '2px 8px',
                          background: sl.isActive ? '#dcfce7' : '#fee2e2',
                          color: sl.isActive ? '#15803d' : '#b91c1c',
                          borderRadius: '12px',
                          fontWeight: 600,
                        }}
                      >
                        {sl.isActive ? 'Active' : 'Draft'}
                      </span>
                    </div>

                    <div
                      style={{
                        background: '#f8fafc',
                        padding: '0.5rem 0.75rem',
                        borderRadius: '6px',
                        fontSize: '0.8rem',
                        fontFamily: 'monospace',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <span style={{ color: '#4f46e5' }}>/b/{sl.slug}</span>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(publicUrl)}
                        style={{
                          border: 'none',
                          background: 'none',
                          color: '#6366f1',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        {copiedUrl === publicUrl ? '✓ Copied' : 'Copy'}
                      </button>
                    </div>

                    {sl.bio && (
                      <p style={{ fontSize: '0.85rem', color: '#64748b', lineHeight: 1.4 }}>
                        {sl.bio}
                      </p>
                    )}

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(3, 1fr)',
                        gap: '0.5rem',
                        padding: '0.75rem',
                        background: '#f8fafc',
                        borderRadius: '8px',
                        textAlign: 'center',
                        fontSize: '0.8rem',
                      }}
                    >
                      <div>
                        <div style={{ color: '#64748b' }}>Views</div>
                        <div style={{ fontWeight: 700 }}>{sl.viewCount}</div>
                      </div>
                      <div>
                        <div style={{ color: '#64748b' }}>Clicks</div>
                        <div style={{ fontWeight: 700 }}>{sl.clickCount}</div>
                      </div>
                      <div>
                        <div style={{ color: '#64748b' }}>CTR</div>
                        <div style={{ fontWeight: 700, color: '#10b981' }}>{sl.ctr}%</div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
                      <a
                        href={`/b/${sl.slug}`}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          flex: 1,
                          textAlign: 'center',
                          padding: '0.5rem',
                          background: '#f1f5f9',
                          color: '#334155',
                          borderRadius: '6px',
                          textDecoration: 'none',
                          fontSize: '0.85rem',
                          fontWeight: 600,
                        }}
                      >
                        👁️ Live Bio Preview
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── 4. Paid Ad Performance Sync Section ─── */}
      {activeSection === 'ads' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#0f172a' }}>
                Cross-Network Paid Ad Performance
              </h2>
              <p style={{ fontSize: '0.875rem', color: '#64748b' }}>
                Unified metrics across Meta Ads, Google Ads, and TikTok Ads.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAdSyncModal(true)}
              style={{
                padding: '0.6rem 1.25rem',
                background: '#4f46e5',
                color: '#fff',
                borderRadius: '8px',
                border: 'none',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              + Connect Ad Account
            </button>
          </div>

          {adSyncs.length === 0 ? (
            <div
              style={{
                padding: '3rem',
                textAlign: 'center',
                background: '#f8fafc',
                borderRadius: '12px',
                border: '1px dashed #cbd5e1',
              }}
            >
              <div style={{ fontSize: '2rem' }}>📊</div>
              <h3 style={{ marginTop: '0.5rem', fontWeight: 600 }}>No ad accounts synced yet</h3>
              <p style={{ color: '#64748b', fontSize: '0.875rem', maxWidth: '420px', margin: '0.5rem auto 1rem' }}>
                Connect Meta Ads, Google Ads, or TikTok Ads accounts to analyze unified ROAS alongside organic social metrics.
              </p>
              <button
                type="button"
                onClick={() => setShowAdSyncModal(true)}
                style={{
                  padding: '0.5rem 1rem',
                  background: '#4f46e5',
                  color: '#fff',
                  borderRadius: '6px',
                  border: 'none',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Connect Ad Account
              </button>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem' }}>
              {adSyncs.map((sync) => (
                <div
                  key={sync.id}
                  style={{
                    background: '#fff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '12px',
                    padding: '1.25rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontSize: '1.2rem' }}>
                        {sync.platform === 'meta' ? '🟦' : sync.platform === 'google' ? '🔴' : '🎵'}
                      </span>
                      <div>
                        <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>{sync.adAccountName}</h3>
                        <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase' }}>
                          {sync.platform} Ads
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={syncAdAccountMutation.isPending}
                      onClick={() => syncAdAccountMutation.mutate(sync.id)}
                      style={{
                        padding: '4px 10px',
                        background: '#e0e7ff',
                        color: '#4338ca',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {syncAdAccountMutation.isPending ? 'Syncing...' : '🔄 Sync'}
                    </button>
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(2, 1fr)',
                      gap: '0.75rem',
                      background: '#f8fafc',
                      padding: '0.75rem',
                      borderRadius: '8px',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Spend</div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0f172a' }}>
                        ${sync.spend.toLocaleString()} {sync.currency}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: '#64748b' }}>ROAS</div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#10b981' }}>
                        {sync.roas}x
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Impressions</div>
                      <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>{sync.impressions.toLocaleString()}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: '#64748b' }}>CPC</div>
                      <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>${sync.cpc}</div>
                    </div>
                  </div>

                  <div style={{ fontSize: '0.7rem', color: '#94a3b8', textAlign: 'right' }}>
                    Last synced: {new Date(sync.syncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── Create Campaign Modal ─── */}
      {showCampaignModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: '#fff',
              padding: '1.75rem',
              borderRadius: '14px',
              maxWidth: '460px',
              width: '90%',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
            }}
          >
            <h3 style={{ fontSize: '1.2rem', fontWeight: 700 }}>Create Marketing Campaign</h3>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>
                Campaign Name *
              </label>
              <input
                type="text"
                placeholder="e.g. Summer Launch 2026"
                value={newCampaign.name}
                onChange={(e) => setNewCampaign({ ...newCampaign, name: e.target.value })}
                style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>
                Total Budget (USD)
              </label>
              <input
                type="number"
                value={newCampaign.budget}
                onChange={(e) => setNewCampaign({ ...newCampaign, budget: Number(e.target.value) })}
                style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
              <button
                type="button"
                onClick={() => setShowCampaignModal(false)}
                style={{ padding: '0.5rem 1rem', background: '#f1f5f9', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!newCampaign.name || createCampaignMutation.isPending}
                onClick={() =>
                  createCampaignMutation.mutate({
                    brandId,
                    name: newCampaign.name!,
                    budget: newCampaign.budget,
                    status: 'ACTIVE',
                  })
                }
                style={{ padding: '0.5rem 1.25rem', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }}
              >
                {createCampaignMutation.isPending ? 'Saving...' : 'Create Campaign'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Create SmartLink Modal ─── */}
      {showSmartLinkModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: '#fff',
              padding: '1.75rem',
              borderRadius: '14px',
              maxWidth: '460px',
              width: '90%',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
            }}
          >
            <h3 style={{ fontSize: '1.2rem', fontWeight: 700 }}>Create SmartLink Bio Page</h3>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>
                Page Slug (URL) *
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ fontSize: '0.85rem', color: '#64748b' }}>/b/</span>
                <input
                  type="text"
                  placeholder="vip-sale"
                  value={newSmartLink.slug}
                  onChange={(e) => setNewSmartLink({ ...newSmartLink, slug: e.target.value })}
                  style={{ flex: 1, padding: '0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                />
              </div>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>
                Page Title *
              </label>
              <input
                type="text"
                placeholder="Official Links"
                value={newSmartLink.title}
                onChange={(e) => setNewSmartLink({ ...newSmartLink, title: e.target.value })}
                style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>
                Bio Text
              </label>
              <textarea
                placeholder="Follow our socials and check out new drops."
                value={newSmartLink.bio}
                onChange={(e) => setNewSmartLink({ ...newSmartLink, bio: e.target.value })}
                rows={2}
                style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
              <button
                type="button"
                onClick={() => setShowSmartLinkModal(false)}
                style={{ padding: '0.5rem 1rem', background: '#f1f5f9', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!newSmartLink.slug || !newSmartLink.title || createSmartLinkMutation.isPending}
                onClick={() =>
                  createSmartLinkMutation.mutate({
                    brandId,
                    slug: newSmartLink.slug!,
                    title: newSmartLink.title!,
                    bio: newSmartLink.bio,
                    buttonLinks: [
                      { id: 'btn-1', title: '🛍️ Shop New Collection', url: 'https://example.com/shop' },
                      { id: 'btn-2', title: '🎁 VIP Exclusive Discount', url: 'https://example.com/discount' },
                    ],
                  })
                }
                style={{ padding: '0.5rem 1.25rem', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }}
              >
                {createSmartLinkMutation.isPending ? 'Creating...' : 'Publish Page'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Connect Ad Account Modal ─── */}
      {showAdSyncModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: '#fff',
              padding: '1.75rem',
              borderRadius: '14px',
              maxWidth: '440px',
              width: '90%',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
            }}
          >
            <h3 style={{ fontSize: '1.2rem', fontWeight: 700 }}>Connect Ad Account</h3>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>
                Platform
              </label>
              <select
                value={newAdSync.platform}
                onChange={(e) => setNewAdSync({ ...newAdSync, platform: e.target.value as AdPlatform })}
                style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              >
                <option value="meta">Meta Ads (Instagram & Facebook)</option>
                <option value="google">Google Ads (Search & Performance Max)</option>
                <option value="tiktok">TikTok Ads Manager</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>
                Initial Ad Spend ($)
              </label>
              <input
                type="number"
                value={newAdSync.spend}
                onChange={(e) => setNewAdSync({ ...newAdSync, spend: Number(e.target.value) })}
                style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
              <button
                type="button"
                onClick={() => setShowAdSyncModal(false)}
                style={{ padding: '0.5rem 1rem', background: '#f1f5f9', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={createAdSyncMutation.isPending}
                onClick={() =>
                  createAdSyncMutation.mutate({
                    brandId,
                    platform: newAdSync.platform!,
                    adAccountName: `${brandName} ${newAdSync.platform?.toUpperCase()} Ads`,
                    spend: newAdSync.spend ?? 350,
                    impressions: 15000,
                    clicks: 620,
                    roas: 3.2,
                  })
                }
                style={{ padding: '0.5rem 1.25rem', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }}
              >
                {createAdSyncMutation.isPending ? 'Connecting...' : 'Connect & Sync'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
