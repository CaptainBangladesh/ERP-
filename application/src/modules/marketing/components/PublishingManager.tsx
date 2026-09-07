import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MARKETING_PATHS,
  type AutolistDetailResponse,
  type AutolistListResponse,
  type AutolistResponse,
  type AutolistSummary,
  type BrandSummary,
  type CreateAutolistItemRequest,
  type CreateAutolistRequest,
  type CreateScheduledPostRequest,
  type CycleAutolistResponse,
  type PublishPostResponse,
  type ScheduledPostListResponse,
  type ScheduledPostResponse,
  type ScheduledPostStatus,
  type ScheduledPostSummary,
  type SocialAccountListResponse,
  type SyncMetricsResponse,
} from '@erp/shared';
import { Button, Field, Modal, Select } from '@erp/shared/ui';
import { api, ApiFailure } from '../../../api/client';
import { PostComposerModal } from './PostComposerModal';
import { InstagramGridPreviewModal } from './InstagramGridPreviewModal';

interface PublishingManagerProps {
  brand: BrandSummary;
}

const POST_STATUS_BADGES: Record<
  ScheduledPostStatus,
  { bg: string; text: string; label: string; icon: string }
> = {
  DRAFT: { bg: 'bg-zinc-100 border-zinc-200', text: 'text-zinc-700', label: 'Draft', icon: '📝' },
  SCHEDULED: { bg: 'bg-blue-50 border-blue-200', text: 'text-blue-800', label: 'Scheduled', icon: '🗓️' },
  PUBLISHING: { bg: 'bg-amber-50 border-amber-200', text: 'text-amber-800', label: 'Publishing', icon: '⚡' },
  PUBLISHED: { bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-800', label: 'Published', icon: '✅' },
  FAILED: { bg: 'bg-rose-50 border-rose-200', text: 'text-rose-800', label: 'Failed', icon: '⚠️' },
  CANCELLED: { bg: 'bg-zinc-100 border-zinc-200', text: 'text-zinc-500', label: 'Cancelled', icon: '🚫' },
};

const PLATFORM_ICONS: Record<string, string> = {
  instagram: '📸',
  facebook: '📘',
  tiktok: '🎵',
  linkedin: '💼',
  x: '🐦',
  youtube: '▶️',
  pinterest: '📌',
  threads: '🧵',
  bluesky: '🦋',
  google_business: '📍',
};

export function PublishingManager({ brand }: PublishingManagerProps) {
  const queryClient = useQueryClient();
  const [activeSubTab, setActiveSubTab] = useState<'posts' | 'autolists'>('posts');

  // Post Composer State
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [isInstagramPreviewOpen, setIsInstagramPreviewOpen] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [postContent, setPostContent] = useState('');
  const [scheduledAtTime, setScheduledAtTime] = useState<string>(() => {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  });
  const [composerError, setComposerError] = useState<string | null>(null);

  // Autolist Modal State
  const [isAutolistModalOpen, setIsAutolistModalOpen] = useState(false);
  const [autolistName, setAutolistName] = useState('');
  const [autolistDescription, setAutolistDescription] = useState('');
  const [autolistRepeatMode, setAutolistRepeatMode] = useState<'RECYCLE' | 'ONCE'>('RECYCLE');
  const [autolistTraversalMode, setAutolistTraversalMode] = useState<'FIFO' | 'SHUFFLE'>('FIFO');
  const [autolistCollisionMinutes, setAutolistCollisionMinutes] = useState(90);

  // Selected Autolist detail state
  const [selectedAutolistId, setSelectedAutolistId] = useState<string | null>(null);
  const [newAutolistItemContent, setNewAutolistItemContent] = useState('');

  // 1. Fetch connected social accounts for the brand
  const { data: accountsData } = useQuery<SocialAccountListResponse>({
    queryKey: ['social-accounts', brand.id],
    queryFn: () => api.get<SocialAccountListResponse>(MARKETING_PATHS.brandSocialAccounts(brand.id)),
  });
  const accounts = accountsData?.items ?? [];

  // 2. Fetch scheduled posts
  const { data: postsData, isLoading: isLoadingPosts } = useQuery<ScheduledPostListResponse>({
    queryKey: ['scheduled-posts', brand.id],
    queryFn: () => api.get<ScheduledPostListResponse>(`${MARKETING_PATHS.posts}?brandId=${brand.id}`),
    refetchInterval: 5000,
  });
  const posts = postsData?.items ?? [];

  // 3. Fetch autolists
  const { data: autolistsData, isLoading: isLoadingAutolists } = useQuery<AutolistListResponse>({
    queryKey: ['autolists', brand.id],
    queryFn: () => api.get<AutolistListResponse>(`${MARKETING_PATHS.autolists}?brandId=${brand.id}`),
  });
  const autolists = autolistsData?.items ?? [];

  // 4. Fetch selected autolist detail (with items)
  const { data: autolistDetail } = useQuery<AutolistDetailResponse>({
    queryKey: ['autolist-detail', selectedAutolistId],
    queryFn: () => api.get<AutolistDetailResponse>(MARKETING_PATHS.autolist(selectedAutolistId!)),
    enabled: Boolean(selectedAutolistId),
  });

  // Mutations
  const createPostMutation = useMutation({
    mutationFn: async (payload: CreateScheduledPostRequest) => {
      return api.post<ScheduledPostResponse>(MARKETING_PATHS.posts, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduled-posts', brand.id] });
      setIsComposerOpen(false);
      setPostContent('');
      setComposerError(null);
    },
    onError: (err) => {
      setComposerError(err instanceof ApiFailure ? err.message : String(err));
    },
  });

  const publishNowMutation = useMutation({
    mutationFn: async (postId: string) => {
      return api.post<PublishPostResponse>(MARKETING_PATHS.publishPostNow(postId), {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduled-posts', brand.id] });
    },
  });

  const syncMetricsMutation = useMutation({
    mutationFn: async (postId: string) => {
      return api.post<SyncMetricsResponse>(MARKETING_PATHS.syncPostMetrics(postId), {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduled-posts', brand.id] });
    },
  });

  const cancelPostMutation = useMutation({
    mutationFn: async (postId: string) => {
      return api.delete<ScheduledPostResponse>(MARKETING_PATHS.post(postId));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduled-posts', brand.id] });
    },
  });

  const createAutolistMutation = useMutation({
    mutationFn: async (payload: CreateAutolistRequest) => {
      return api.post<AutolistResponse>(MARKETING_PATHS.autolists, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['autolists', brand.id] });
      setIsAutolistModalOpen(false);
      setAutolistName('');
      setAutolistDescription('');
    },
  });

  const cycleAutolistMutation = useMutation({
    mutationFn: async (autolistId: string) => {
      return api.post<CycleAutolistResponse>(MARKETING_PATHS.cycleAutolist(autolistId), {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduled-posts', brand.id] });
      queryClient.invalidateQueries({ queryKey: ['autolist-detail', selectedAutolistId] });
    },
  });

  const addAutolistItemMutation = useMutation({
    mutationFn: async ({ autolistId, payload }: { autolistId: string; payload: CreateAutolistItemRequest }) => {
      return api.post(MARKETING_PATHS.autolistItems(autolistId), payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['autolists', brand.id] });
      queryClient.invalidateQueries({ queryKey: ['autolist-detail', selectedAutolistId] });
      setNewAutolistItemContent('');
    },
  });

  const handleCreatePost = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAccountId && accounts.length > 0) {
      setComposerError('Please select a connected social channel.');
      return;
    }
    const accountId = selectedAccountId || (accounts[0]?.id ?? '');
    if (!accountId) {
      setComposerError('No connected channels available. Connect an account first.');
      return;
    }

    createPostMutation.mutate({
      brandId: brand.id,
      socialAccountId: accountId,
      content: postContent,
      scheduledAt: new Date(scheduledAtTime).toISOString(),
    });
  };

  const submitAutolist = () => {
    createAutolistMutation.mutate({
      brandId: brand.id,
      name: autolistName,
      description: autolistDescription || undefined,
      repeatMode: autolistRepeatMode,
      traversalMode: autolistTraversalMode,
      activeSlots: [
        { dayOfWeek: 1, time: '10:00' },
        { dayOfWeek: 3, time: '14:00' },
        { dayOfWeek: 5, time: '16:00' },
      ],
      collisionWindowMinutes: Number(autolistCollisionMinutes),
    });
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Sub-header Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex gap-2 rounded-lg bg-slate-100 p-1 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setActiveSubTab('posts')}
            className={`rounded-md px-3.5 py-1.5 transition ${
              activeSubTab === 'posts' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            🗓️ Scheduled Posts ({posts.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('autolists')}
            className={`rounded-md px-3.5 py-1.5 transition ${
              activeSubTab === 'autolists' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            ♻️ Evergreen Autolists ({autolists.length})
          </button>
        </div>

        {activeSubTab === 'posts' ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsInstagramPreviewOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-pink-200 bg-pink-50 px-3 py-2 text-xs font-semibold text-pink-700 hover:bg-pink-100 shadow-xs transition"
            >
              <span>📸</span>
              <span>Instagram Grid</span>
            </button>
            <button
              type="button"
              onClick={() => setIsComposerOpen(true)}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-blue-700"
            >
              <span>✍️</span>
              <span>Schedule Post</span>
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setIsAutolistModalOpen(true)}
            className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700"
          >
            <span>➕</span>
            <span>Create Autolist</span>
          </button>
        )}
      </div>

      {/* VIEW 1: Scheduled Posts */}
      {activeSubTab === 'posts' && (
        <div className="flex flex-col gap-4">
          {isLoadingPosts ? (
            <div className="p-12 text-center text-sm text-slate-500">Loading scheduled posts...</div>
          ) : posts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center shadow-xs">
              <span className="text-3xl">🗓️</span>
              <h3 className="mt-3 text-base font-semibold text-slate-900">No Posts Scheduled Yet</h3>
              <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto">
                Schedule a single or multi-channel post with platform formatting, media, and automated publishing.
              </p>
              <button
                type="button"
                onClick={() => setIsComposerOpen(true)}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
              >
                Schedule First Post
              </button>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
              <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                <thead className="bg-slate-50 font-semibold text-slate-700">
                  <tr>
                    <th className="px-4 py-3">Content</th>
                    <th className="px-4 py-3">Channel</th>
                    <th className="px-4 py-3">Scheduled For</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Metrics</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-800">
                  {posts.map((post) => {
                    const statusConfig = POST_STATUS_BADGES[post.status] ?? POST_STATUS_BADGES.SCHEDULED;
                    const platform = post.socialAccount?.platform ?? 'instagram';
                    const icon = PLATFORM_ICONS[platform] ?? '📱';

                    return (
                      <tr key={post.id} className="hover:bg-slate-50 transition">
                        <td className="px-4 py-3 max-w-xs">
                          <p className="line-clamp-2 font-medium text-slate-900">{post.content}</p>
                          {post.externalPostId && (
                            <span className="text-[10px] text-blue-600 font-mono">
                              Ext ID: {post.externalPostId}
                            </span>
                          )}
                          {post.failureReason && (
                            <p className="text-[11px] text-rose-600 font-medium mt-0.5">
                              ⚠️ {post.failureReason}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-800">
                            <span>{icon}</span>
                            <span className="capitalize">{platform}</span>
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                          {new Date(post.scheduledAt).toLocaleString([], {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${statusConfig.bg} ${statusConfig.text}`}
                          >
                            <span>{statusConfig.icon}</span>
                            <span>{statusConfig.label}</span>
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {post.status === 'PUBLISHED' ? (
                            <div className="flex items-center gap-2">
                              <span className="text-slate-600">
                                👀 {(post.metrics as any)?.impressions ?? 0}
                              </span>
                              <span className="text-slate-600">
                                ❤️ {(post.metrics as any)?.likes ?? 0}
                              </span>
                              <button
                                type="button"
                                onClick={() => syncMetricsMutation.mutate(post.id)}
                                title="Sync Metrics"
                                className="text-slate-400 hover:text-blue-600"
                              >
                                🔄
                              </button>
                            </div>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-right">
                          <div className="flex items-center justify-end gap-2">
                            {post.status !== 'PUBLISHED' && post.status !== 'CANCELLED' && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => publishNowMutation.mutate(post.id)}
                                  className="rounded-md bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-100"
                                >
                                  Publish Now
                                </button>
                                <button
                                  type="button"
                                  onClick={() => cancelPostMutation.mutate(post.id)}
                                  className="rounded-md bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-rose-50 hover:text-rose-700"
                                >
                                  Cancel
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* VIEW 2: Evergreen Autolists */}
      {activeSubTab === 'autolists' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Autolists Sidebar / List */}
          <div className="flex flex-col gap-3 md:col-span-1">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Autolist Buckets</h3>
            {isLoadingAutolists ? (
              <div className="p-4 text-xs text-slate-400">Loading autolists...</div>
            ) : autolists.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-xs text-slate-500">
                No autolists created yet.
              </div>
            ) : (
              autolists.map((list) => (
                <div
                  key={list.id}
                  onClick={() => setSelectedAutolistId(list.id)}
                  className={`cursor-pointer rounded-xl border p-4 transition ${
                    selectedAutolistId === list.id
                      ? 'border-blue-500 bg-blue-50/40 shadow-xs'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-slate-900">{list.name}</h4>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                      {list.itemCount} items
                    </span>
                  </div>
                  {list.description && (
                    <p className="mt-1 line-clamp-2 text-xs text-slate-600">{list.description}</p>
                  )}
                  <div className="mt-3 flex items-center gap-2 text-[11px] font-medium text-slate-500">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5">Mode: {list.traversalMode}</span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5">Buffer: {list.collisionWindowMinutes}m</span>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Autolist Item Content Management */}
          <div className="flex flex-col gap-4 md:col-span-2">
            {selectedAutolistId && autolistDetail ? (
              <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
                <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">{autolistDetail.name}</h3>
                    <p className="text-xs text-slate-500">
                      Traversal: <span className="font-semibold text-slate-700">{autolistDetail.traversalMode}</span> |
                      Repeat: <span className="font-semibold text-slate-700">{autolistDetail.repeatMode}</span> |
                      Collision Window: <span className="font-semibold text-slate-700">{autolistDetail.collisionWindowMinutes} mins</span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => cycleAutolistMutation.mutate(selectedAutolistId)}
                    disabled={cycleAutolistMutation.isPending}
                    className="flex items-center gap-2 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700 disabled:opacity-50"
                  >
                    <span>🔄</span>
                    <span>Cycle Now</span>
                  </button>
                </div>

                {/* Add Item to Autolist */}
                <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                  <label className="text-xs font-semibold text-slate-700">Add Evergreen Post to Bucket</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newAutolistItemContent}
                      onChange={(e) => setNewAutolistItemContent(e.target.value)}
                      placeholder="Enter evergreen tip, quote, or insight..."
                      className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-hidden"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (!newAutolistItemContent.trim()) return;
                        addAutolistItemMutation.mutate({
                          autolistId: selectedAutolistId,
                          payload: { content: newAutolistItemContent.trim() },
                        });
                      }}
                      className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                    >
                      Add Item
                    </button>
                  </div>
                </div>

                {/* Items in Autolist */}
                <div className="flex flex-col gap-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Content Rotation ({autolistDetail.items.length})
                  </h4>
                  {autolistDetail.items.length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-400">
                      This autolist is empty. Add evergreen posts above to begin recycling.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                      {autolistDetail.items.map((item, idx) => (
                        <div key={item.id} className="flex items-center justify-between p-3 text-xs">
                          <div className="flex items-center gap-3">
                            <span className="font-mono text-[11px] text-slate-400">#{idx + 1}</span>
                            <span className="font-medium text-slate-800">{item.content}</span>
                          </div>
                          <div className="flex items-center gap-3 text-slate-500">
                            <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px]">
                              Published: {item.publishCount}x
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center text-xs text-slate-500">
                Select an Autolist on the left or create a new one to manage evergreen recycling queues.
              </div>
            )}
          </div>
        </div>
      )}

      {/* POST COMPOSER MODAL */}
      <PostComposerModal
        brand={brand}
        accounts={accounts}
        isOpen={isComposerOpen}
        onClose={() => setIsComposerOpen(false)}
        onPostCreated={() => {
          void queryClient.invalidateQueries({ queryKey: ['scheduled-posts', brand.id] });
        }}
      />

      {/* INSTAGRAM GRID PREVIEW MODAL */}
      <InstagramGridPreviewModal
        brand={brand}
        isOpen={isInstagramPreviewOpen}
        onClose={() => setIsInstagramPreviewOpen(false)}
        posts={posts}
        onScheduleClick={() => {
          setIsInstagramPreviewOpen(false);
          setIsComposerOpen(true);
        }}
      />

      {/* CREATE AUTOLIST MODAL */}
      {isAutolistModalOpen && (
        <Modal
          onClose={() => setIsAutolistModalOpen(false)}
          title="Create Evergreen Autolist"
          description="A recycling queue of posts that fills gaps in the calendar without colliding with one-off campaigns."
          icon="♻️"
          footer={
            <>
              <Button variant="secondary" onClick={() => setIsAutolistModalOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => submitAutolist()}
                disabled={createAutolistMutation.isPending}
              >
                {createAutolistMutation.isPending ? 'Creating…' : 'Create Autolist'}
              </Button>
            </>
          }
        >
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              submitAutolist();
            }}
            className="flex flex-col gap-4"
          >
            <Field
              id="autolist-name"
              label="Autolist name"
              value={autolistName}
              onChange={setAutolistName}
              hint="e.g. Evergreen Quotes, Weekly Product Tips"
            />

            <Field
              id="autolist-description"
              label="Description"
              value={autolistDescription}
              onChange={setAutolistDescription}
              hint="Optional queue purpose or notes."
            />

            <div className="grid grid-cols-2 gap-3">
              <Select
                id="autolist-traversal"
                label="Traversal mode"
                value={autolistTraversalMode}
                onChange={(value) => setAutolistTraversalMode(value as typeof autolistTraversalMode)}
                options={[
                  { value: 'FIFO', label: 'FIFO (Sequential)' },
                  { value: 'SHUFFLE', label: 'Shuffle (Randomize)' },
                ]}
              />

              <Select
                id="autolist-repeat"
                label="Repeat mode"
                value={autolistRepeatMode}
                onChange={(value) => setAutolistRepeatMode(value as typeof autolistRepeatMode)}
                options={[
                  { value: 'RECYCLE', label: 'Recycle (Continuous)' },
                  { value: 'ONCE', label: 'Once (Stop on End)' },
                ]}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="autolist-collision" className="text-sm font-medium text-slate-700">
                Collision buffer window (minutes)
              </label>
              <input
                id="autolist-collision"
                type="number"
                min={15}
                max={360}
                value={autolistCollisionMinutes}
                onChange={(e) => setAutolistCollisionMinutes(Number(e.target.value))}
                aria-describedby="autolist-collision-hint"
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
              />
              <span id="autolist-collision-hint" className="text-xs text-slate-500">
                Avoids posting evergreen items within {autolistCollisionMinutes}m of one-off campaigns.
              </span>
            </div>

            <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
          </form>
        </Modal>
      )}
    </div>
  );
}
