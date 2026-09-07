import React, { useState, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MARKETING_PATHS,
  type BrandSummary,
  type ScheduledPostListResponse,
  type ScheduledPostStatus,
  type ScheduledPostSummary,
  type SocialAccountListResponse,
  type SocialPlatform,
} from '@erp/shared';
import { Button, Modal } from '@erp/shared/ui';
import { api, ApiFailure } from '../../../api/client';
import { StatusPill } from '../components/MarketingPrimitives';
import { PostComposerModal } from '../components/PostComposerModal';
import { InstagramGridPreviewModal } from '../components/InstagramGridPreviewModal';

export interface SocialCalendarPageProps {
  brand: BrandSummary;
}

type CalendarView = 'month' | 'week' | 'day';

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

const STATUS_CONFIGS: Record<
  ScheduledPostStatus,
  { bg: string; border: string; text: string; dot: string; label: string }
> = {
  DRAFT: { bg: 'bg-zinc-50', border: 'border-zinc-300', text: 'text-zinc-700', dot: 'bg-zinc-400', label: 'Draft' },
  SCHEDULED: { bg: 'bg-blue-50', border: 'border-blue-300', text: 'text-blue-800', dot: 'bg-blue-500', label: 'Scheduled' },
  PUBLISHING: { bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-800', dot: 'bg-amber-500', label: 'Publishing' },
  PUBLISHED: { bg: 'bg-emerald-50', border: 'border-emerald-300', text: 'text-emerald-800', dot: 'bg-emerald-500', label: 'Published' },
  FAILED: { bg: 'bg-rose-50', border: 'border-rose-300', text: 'text-rose-800', dot: 'bg-rose-500', label: 'Failed' },
  CANCELLED: { bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-500', dot: 'bg-slate-300', label: 'Cancelled' },
};

export function SocialCalendarPage({ brand }: SocialCalendarPageProps) {
  const queryClient = useQueryClient();

  // Navigation and view state
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [activeView, setActiveView] = useState<CalendarView>('month');

  // Filters
  const [platformFilter, setPlatformFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Modals state
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [isInstagramPreviewOpen, setIsInstagramPreviewOpen] = useState(false);
  /**
   * The post whose "Reschedule..." dialog is open.
   *
   * The calendar had exactly one way to move a post - HTML5 `draggable` - so a keyboard-only
   * user could not reschedule at all, which is ticket 05's headline feature unavailable to
   * them. The dialog is a primary affordance rather than a fallback: it is also faster than
   * dragging across a dense month view, which is why calendar products keep both.
   */
  const [reschedulingPost, setReschedulingPost] = useState<ScheduledPostSummary | null>(null);
  const [composerDate, setComposerDate] = useState<string | undefined>(undefined);

  // Drag-and-drop feedback
  const [draggedPostId, setDraggedPostId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Fetch brand's connected social accounts
  const { data: accountsData } = useQuery<SocialAccountListResponse>({
    queryKey: ['social-accounts', brand.id],
    queryFn: () => api.get<SocialAccountListResponse>(MARKETING_PATHS.brandSocialAccounts(brand.id)),
  });
  const accounts = accountsData?.items ?? [];

  // Fetch scheduled posts
  const { data: postsData, isLoading: isLoadingPosts } = useQuery<ScheduledPostListResponse>({
    queryKey: ['scheduled-posts', brand.id],
    queryFn: () => api.get<ScheduledPostListResponse>(`${MARKETING_PATHS.posts}?brandId=${brand.id}`),
    refetchInterval: 5000,
  });
  const posts = postsData?.items ?? [];

  // Filter posts based on active filters
  const filteredPosts = useMemo(() => {
    return posts.filter((post) => {
      if (platformFilter !== 'all') {
        const p = post.socialAccount?.platform;
        if (p !== platformFilter) return false;
      }
      if (statusFilter !== 'all') {
        if (post.status !== statusFilter) return false;
      }
      return true;
    });
  }, [posts, platformFilter, statusFilter]);

  // Reschedule Mutation
  const rescheduleMutation = useMutation({
    mutationFn: async ({ postId, newScheduledAt }: { postId: string; newScheduledAt: string }) => {
      return api.patch(MARKETING_PATHS.post(postId), {
        scheduledAt: newScheduledAt,
      });
    },
    onSuccess: (_, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['scheduled-posts', brand.id] });
      const formatted = new Date(vars.newScheduledAt).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      setToastMessage(`Post successfully rescheduled to ${formatted}`);
      setTimeout(() => setToastMessage(null), 3500);
    },
    onError: (err) => {
      setToastMessage(`Reschedule failed: ${err instanceof ApiFailure ? err.message : String(err)}`);
      setTimeout(() => setToastMessage(null), 4000);
    },
  });

  // Publish Now Mutation
  const publishNowMutation = useMutation({
    mutationFn: async (postId: string) => {
      return api.post(MARKETING_PATHS.publishPostNow(postId), {});
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['scheduled-posts', brand.id] });
      setToastMessage('Post published immediately!');
      setTimeout(() => setToastMessage(null), 3000);
    },
  });

  // Cancel Post Mutation
  const cancelPostMutation = useMutation({
    mutationFn: async (postId: string) => {
      return api.delete(MARKETING_PATHS.post(postId));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['scheduled-posts', brand.id] });
      setToastMessage('Post cancelled.');
      setTimeout(() => setToastMessage(null), 3000);
    },
  });

  // Navigation handlers
  const handlePrev = () => {
    const next = new Date(currentDate);
    if (activeView === 'month') {
      next.setMonth(next.getMonth() - 1);
    } else if (activeView === 'week') {
      next.setDate(next.getDate() - 7);
    } else {
      next.setDate(next.getDate() - 1);
    }
    setCurrentDate(next);
  };

  const handleNext = () => {
    const next = new Date(currentDate);
    if (activeView === 'month') {
      next.setMonth(next.getMonth() + 1);
    } else if (activeView === 'week') {
      next.setDate(next.getDate() + 7);
    } else {
      next.setDate(next.getDate() + 1);
    }
    setCurrentDate(next);
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  /**
   * The one write that moves a post, and the only one.
   *
   * Drag, the per-post "Reschedule..." menu and the keyboard all call this - nothing issues
   * `PATCH /posts/:id` itself. The client deliberately does not decide what a legal time is:
   * the server refuses a past time or one outside the account's publishing window, and its
   * refusal is what the toast shows, so the drag and the menu cannot come to permit different
   * things.
   */
  const reschedulePost = (postId: string, scheduledAt: string) => {
    rescheduleMutation.mutate({ postId, newScheduledAt: scheduledAt });
  };

  // Drag and drop handler
  const handleDropOnDate = (targetDate: Date, targetHour?: number) => {
    if (!draggedPostId) return;
    const post = posts.find((p) => p.id === draggedPostId);
    if (!post) return;

    const newDate = new Date(targetDate);
    if (targetHour !== undefined) {
      newDate.setHours(targetHour, 0, 0, 0);
    } else {
      // Preserve existing hour & minute
      const original = new Date(post.scheduledAt);
      newDate.setHours(original.getHours(), original.getMinutes(), 0, 0);
    }

    reschedulePost(post.id, newDate.toISOString());
    setDraggedPostId(null);
  };

  // Open composer with target date
  const openComposerForDate = (date: Date, hour = 10) => {
    const target = new Date(date);
    target.setHours(hour, 0, 0, 0);
    target.setMinutes(target.getMinutes() - target.getTimezoneOffset());
    setComposerDate(target.toISOString().slice(0, 16));
    setIsComposerOpen(true);
  };

  // Calculate calendar grid days for Month View
  const monthDays = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    const firstDayOfMonth = new Date(year, month, 1);
    const lastDayOfMonth = new Date(year, month + 1, 0);

    // Monday-based index (0: Mon, ..., 6: Sun)
    let startDay = firstDayOfMonth.getDay() - 1;
    if (startDay === -1) startDay = 6;

    const days: Array<{ date: Date; isCurrentMonth: boolean }> = [];

    // Preceding days from previous month
    for (let i = startDay; i > 0; i--) {
      const d = new Date(year, month, 1 - i);
      days.push({ date: d, isCurrentMonth: false });
    }

    // Days in current month
    for (let i = 1; i <= lastDayOfMonth.getDate(); i++) {
      const d = new Date(year, month, i);
      days.push({ date: d, isCurrentMonth: true });
    }

    // Trailing days to fill out weeks (grid of 35 or 42 cells)
    const remaining = (7 - (days.length % 7)) % 7;
    for (let i = 1; i <= remaining; i++) {
      const d = new Date(year, month + 1, i);
      days.push({ date: d, isCurrentMonth: false });
    }

    return days;
  }, [currentDate]);

  // Calculate days for Week View
  const weekDays = useMemo(() => {
    const curr = new Date(currentDate);
    let day = curr.getDay() - 1;
    if (day === -1) day = 6;
    curr.setDate(curr.getDate() - day);

    const days: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(curr);
      d.setDate(curr.getDate() + i);
      days.push(d);
    }
    return days;
  }, [currentDate]);

  // Posts grouped by date string (YYYY-MM-DD)
  const postsByDateString = useMemo(() => {
    const map = new Map<string, ScheduledPostSummary[]>();
    filteredPosts.forEach((post) => {
      const d = new Date(post.scheduledAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(post);
    });
    return map;
  }, [filteredPosts]);

  const todayString = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  return (
    <div className="flex flex-col gap-5">
      {/* Toast Feedback */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-xs font-semibold text-white shadow-2xl transition animate-fade-in">
          <span>⚡</span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Header & Calendar Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
        {/* Date Navigation & Label */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
            <button
              type="button"
              onClick={handlePrev}
              aria-label="Previous Period"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 hover:bg-white hover:shadow-xs transition"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={handleToday}
              className="rounded-lg px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-white hover:shadow-xs transition"
            >
              Today
            </button>
            <button
              type="button"
              onClick={handleNext}
              aria-label="Next Period"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 hover:bg-white hover:shadow-xs transition"
            >
              ›
            </button>
          </div>

          <h2 className="text-base font-bold text-slate-900">
            {activeView === 'month' &&
              currentDate.toLocaleDateString([], { month: 'long', year: 'numeric' })}
            {activeView === 'week' &&
              `Week of ${weekDays[0]?.toLocaleDateString([], { month: 'short', day: 'numeric' })} - ${weekDays[6]?.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`}
            {activeView === 'day' &&
              currentDate.toLocaleDateString([], {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
          </h2>
        </div>

        {/* Filters & View Switcher */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Channel Filter */}
          <select
            aria-label="Filter by channel"
            value={platformFilter}
            onChange={(e) => setPlatformFilter(e.target.value)}
            className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 shadow-2xs focus:border-blue-500 focus:outline-hidden"
          >
            <option value="all">All Channels</option>
            <option value="instagram">📸 Instagram</option>
            <option value="facebook">📘 Facebook</option>
            <option value="linkedin">💼 LinkedIn</option>
            <option value="x">🐦 X (Twitter)</option>
            <option value="tiktok">🎵 TikTok</option>
            <option value="youtube">▶️ YouTube</option>
            <option value="google_business">📍 Google Business</option>
          </select>

          {/* Status Filter */}
          <select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 shadow-2xs focus:border-blue-500 focus:outline-hidden"
          >
            <option value="all">All Statuses</option>
            <option value="SCHEDULED">🗓️ Scheduled</option>
            <option value="PUBLISHED">✅ Published</option>
            <option value="DRAFT">📝 Draft</option>
            <option value="FAILED">⚠️ Failed</option>
          </select>

          {/* View Switcher Tabs */}
          <div className="flex rounded-xl bg-slate-100 p-1 text-xs font-semibold">
            {(['month', 'week', 'day'] as CalendarView[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setActiveView(v)}
                className={`capitalize rounded-lg px-3 py-1.5 transition ${
                  activeView === v
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {v}
              </button>
            ))}
          </div>

          {/* Action Buttons */}
          <button
            type="button"
            onClick={() => setIsInstagramPreviewOpen(true)}
            className="flex items-center gap-1.5 rounded-xl border border-pink-200 bg-pink-50 px-3.5 py-1.5 text-xs font-semibold text-pink-700 hover:bg-pink-100 transition shadow-2xs"
          >
            <span>📸</span>
            <span>Instagram Grid</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setComposerDate(undefined);
              setIsComposerOpen(true);
            }}
            className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-blue-700 transition"
          >
            <span>✍️</span>
            <span>Schedule Post</span>
          </button>
        </div>
      </div>

      {/* Best-Times-to-Post Legend & Notice */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/50 px-4 py-2.5 text-xs text-amber-900">
        <div className="flex items-center gap-2">
          <span>🔥</span>
          <span>
            <strong>Engagement Heatmap Active:</strong> Drag and drop any post card to reschedule. Peak audience engagement is highlighted in golden badges.
          </span>
        </div>
        <div className="flex items-center gap-4 text-[11px] font-medium text-slate-600">
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full bg-blue-500" />
            <span>Scheduled</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
            <span>Published</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
            <span>Peak Hour</span>
          </span>
        </div>
      </div>

      {/* VIEW 1: Month View */}
      {activeView === 'month' && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
          {/* Day of week headers */}
          <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-xs font-bold uppercase tracking-wider text-slate-600">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
              <div key={day} className="py-2.5">
                {day}
              </div>
            ))}
          </div>

          {/* Month Day Cells */}
          <div className="grid grid-cols-7 divide-x divide-y divide-slate-200">
            {monthDays.map(({ date, isCurrentMonth }, idx) => {
              const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
              const dayPosts = postsByDateString.get(dateStr) ?? [];
              const isToday = dateStr === todayString;
              const isPeakEngagementDay = date.getDay() === 2 || date.getDay() === 4; // Tuesday or Thursday

              return (
                <div
                  key={idx}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handleDropOnDate(date)}
                  className={`group relative min-h-32 p-2 flex flex-col gap-1 transition ${
                    !isCurrentMonth ? 'bg-slate-50/50 opacity-60' : 'bg-white hover:bg-slate-50/70'
                  } ${isToday ? 'ring-2 ring-blue-500 ring-inset' : ''}`}
                >
                  {/* Date Header */}
                  <div className="flex items-center justify-between text-xs">
                    <span
                      className={`flex h-6 w-6 items-center justify-center rounded-full font-bold ${
                        isToday
                          ? 'bg-blue-600 text-white'
                          : isCurrentMonth
                          ? 'text-slate-800'
                          : 'text-slate-400'
                      }`}
                    >
                      {date.getDate()}
                    </span>

                    {/* Quick Add Button */}
                    <button
                      type="button"
                      onClick={() => openComposerForDate(date)}
                      title={`Schedule post for ${date.toLocaleDateString()}`}
                      className="opacity-0 group-hover:opacity-100 flex h-5 w-5 items-center justify-center rounded-md bg-slate-200 text-slate-700 hover:bg-blue-600 hover:text-white transition text-xs"
                    >
                      +
                    </button>
                  </div>

                  {/* Peak Engagement Indicator */}
                  {isCurrentMonth && isPeakEngagementDay && (
                    <span className="w-fit rounded bg-amber-100 px-1.5 py-0.2 text-[9px] font-bold text-amber-800">
                      ⚡ Peak Day
                    </span>
                  )}

                  {/* Day Posts List */}
                  <div className="flex flex-col gap-1 overflow-y-auto max-h-24 pr-0.5">
                    {dayPosts.map((post) => {
                      const platform = post.socialAccount?.platform ?? 'instagram';
                      const icon = PLATFORM_ICONS[platform] ?? '📱';
                      const statusConfig = STATUS_CONFIGS[post.status] ?? STATUS_CONFIGS.SCHEDULED;
                      const timeStr = new Date(post.scheduledAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      });

                      return (
                        <div
                          key={post.id}
                          draggable
                          onDragStart={() => setDraggedPostId(post.id)}
                          className={`rounded-lg border p-1.5 shadow-2xs transition ${statusConfig.bg} ${statusConfig.border} hover:shadow-xs`}
                        >
                          <div className="flex items-center justify-between text-[10px] font-semibold text-slate-700">
                            <span className="flex items-center gap-1">
                              <span aria-hidden="true">{icon}</span>
                              <span>{timeStr}</span>
                            </span>
                            <StatusPill status={post.status} size="sm" />
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setComposerDate(new Date(post.scheduledAt).toISOString().slice(0, 16));
                              setIsComposerOpen(true);
                            }}
                            className="mt-0.5 line-clamp-1 w-full cursor-grab text-left text-[10px] font-medium text-slate-900 active:cursor-grabbing focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
                          >
                            {post.content}
                          </button>
                          <button
                            type="button"
                            onClick={() => setReschedulingPost(post)}
                            aria-label={`Reschedule post: ${post.content.slice(0, 60)}`}
                            className="mt-1 w-full rounded border border-slate-300 bg-white/70 py-0.5 text-[10px] font-semibold text-slate-700 hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
                          >
                            Reschedule...
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* VIEW 2: Week View */}
      {activeView === 'week' && (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-xs">
          <div className="min-w-[700px]">
            {/* Day Columns Header */}
            <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center divide-x divide-slate-200">
              {weekDays.map((date, idx) => {
                const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                const isToday = dateStr === todayString;

                return (
                  <div
                    key={idx}
                    className={`py-3 px-2 flex flex-col items-center gap-1 ${
                      isToday ? 'bg-blue-50/80 font-bold' : ''
                    }`}
                  >
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      {date.toLocaleDateString([], { weekday: 'short' })}
                    </span>
                    <span
                      className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold ${
                        isToday ? 'bg-blue-600 text-white' : 'text-slate-800'
                      }`}
                    >
                      {date.getDate()}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Time Slots Grid (08:00 to 20:00) */}
            <div className="flex flex-col divide-y divide-slate-100">
              {[8, 10, 12, 14, 16, 18, 20].map((hour) => {
                const isOptimalHour = hour === 10 || hour === 14;

                return (
                  <div key={hour} className="grid grid-cols-7 divide-x divide-slate-100 min-h-20">
                    {weekDays.map((date, dayIdx) => {
                      const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                      const dayPosts = postsByDateString.get(dateStr) ?? [];
                      // filter posts that land in this time block
                      const slotPosts = dayPosts.filter((p) => {
                        const h = new Date(p.scheduledAt).getHours();
                        return h >= hour && h < hour + 2;
                      });

                      return (
                        <div
                          key={dayIdx}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => handleDropOnDate(date, hour)}
                          className={`group relative p-1.5 flex flex-col gap-1 transition ${
                            isOptimalHour ? 'bg-amber-50/20' : 'hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-center justify-between text-[10px] text-slate-400">
                            <span>{hour}:00</span>
                            {isOptimalHour && (
                              <span className="rounded bg-amber-100 px-1 py-0.2 text-[8px] font-bold text-amber-700">
                                🔥 Peak
                              </span>
                            )}
                          </div>

                          {/* Posts in this slot */}
                          {slotPosts.map((post) => {
                            const platform = post.socialAccount?.platform ?? 'instagram';
                            const icon = PLATFORM_ICONS[platform] ?? '📱';
                            const statusConfig = STATUS_CONFIGS[post.status] ?? STATUS_CONFIGS.SCHEDULED;

                            return (
                              <div
                                key={post.id}
                                draggable
                                onDragStart={() => setDraggedPostId(post.id)}
                                className={`cursor-grab active:cursor-grabbing rounded-lg border p-1.5 shadow-2xs ${statusConfig.bg} ${statusConfig.border}`}
                              >
                                <div className="flex items-center gap-1 text-[10px] font-semibold text-slate-800">
                                  <span aria-hidden="true">{icon}</span>
                                  <span className="truncate">
                                    {new Date(post.scheduledAt).toLocaleTimeString([], {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })}
                                  </span>
                                </div>
                                <p className="line-clamp-2 text-[10px] text-slate-900 mt-0.5">
                                  {post.content}
                                </p>
                                <button
                                  type="button"
                                  onClick={() => setReschedulingPost(post)}
                                  aria-label={`Reschedule post: ${post.content.slice(0, 60)}`}
                                  className="mt-1 w-full rounded border border-slate-300 bg-white/70 py-0.5 text-[10px] font-semibold text-slate-700 hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
                                >
                                  Reschedule...
                                </button>
                              </div>
                            );
                          })}

                          {/* Quick Add Slot */}
                          <button
                            type="button"
                            onClick={() => openComposerForDate(date, hour)}
                            className="opacity-0 group-hover:opacity-100 mt-auto rounded border border-dashed border-slate-300 py-0.5 text-center text-[10px] text-slate-500 hover:border-blue-500 hover:text-blue-600"
                          >
                            + Add at {hour}:00
                          </button>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* VIEW 3: Day View */}
      {activeView === 'day' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Day Timeline Posts */}
          <div className="lg:col-span-2 flex flex-col gap-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    {currentDate.toLocaleDateString([], {
                      weekday: 'long',
                      month: 'long',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Detailed schedule breakdown & publishing status
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => openComposerForDate(currentDate)}
                  className="rounded-xl bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 transition"
                >
                  + Add Post Today
                </button>
              </div>

              {/* Day Posts List */}
              <div className="mt-4 flex flex-col gap-3">
                {(() => {
                  const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;
                  const dayPosts = postsByDateString.get(dateStr) ?? [];

                  if (dayPosts.length === 0) {
                    return (
                      <div className="rounded-xl border border-dashed border-slate-300 p-12 text-center text-xs text-slate-500">
                        No posts scheduled for this day. Click "+ Add Post Today" or drag posts from the month view.
                      </div>
                    );
                  }

                  return dayPosts.map((post) => {
                    const platform = post.socialAccount?.platform ?? 'instagram';
                    const icon = PLATFORM_ICONS[platform] ?? '📱';
                    const statusConfig = STATUS_CONFIGS[post.status] ?? STATUS_CONFIGS.SCHEDULED;

                    return (
                      <div
                        key={post.id}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50/40 p-4 shadow-2xs hover:bg-slate-50 transition"
                      >
                        <div className="flex items-start gap-3 min-w-0">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white border border-slate-200 text-lg shadow-2xs">
                            {icon}
                          </span>
                          <div className="flex flex-col min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-slate-900 capitalize">
                                {platform}
                              </span>
                              <span className="text-slate-300">•</span>
                              <span className="text-xs font-semibold text-blue-600">
                                {new Date(post.scheduledAt).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                              <span
                                className={`rounded-full px-2 py-0.2 text-[10px] font-bold ${statusConfig.bg} ${statusConfig.text}`}
                              >
                                {statusConfig.label}
                              </span>
                            </div>
                            <p className="mt-1 line-clamp-2 text-xs text-slate-800 font-medium">
                              {post.content}
                            </p>
                          </div>
                        </div>

                        {/* Action buttons */}
                        <div className="flex items-center gap-2 shrink-0">
                          {post.status !== 'PUBLISHED' && post.status !== 'CANCELLED' && (
                            <>
                              <button
                                type="button"
                                onClick={() => publishNowMutation.mutate(post.id)}
                                className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 transition"
                              >
                                Publish Now
                              </button>
                              <button
                                type="button"
                                onClick={() => cancelPostMutation.mutate(post.id)}
                                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-rose-50 hover:text-rose-700 transition"
                              >
                                Cancel
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          </div>

          {/* Day Best-Times Heatmap Side Rail */}
          <div className="flex flex-col gap-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                  ⚡ Hourly Engagement Heatmap
                </h4>
                <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                  AI Optimal
                </span>
              </div>
              <p className="text-[11px] text-slate-500">
                Audience engagement metrics for this day:
              </p>

              <div className="flex flex-col gap-2">
                {[
                  { time: '09:00 AM', score: 82, boost: '+36%' },
                  { time: '11:00 AM', score: 91, boost: '+42%' },
                  { time: '02:00 PM', score: 98, boost: '+48%', peak: true },
                  { time: '05:00 PM', score: 88, boost: '+39%' },
                  { time: '08:00 PM', score: 79, boost: '+28%' },
                ].map((slot, idx) => (
                  <div
                    key={idx}
                    className={`flex items-center justify-between rounded-xl p-3 border text-xs transition ${
                      slot.peak
                        ? 'border-amber-300 bg-amber-50/60 shadow-xs'
                        : 'border-slate-200 bg-white'
                    }`}
                  >
                    <div className="flex flex-col">
                      <span className="font-bold text-slate-900">{slot.time}</span>
                      <span className="text-[10px] text-emerald-600 font-semibold">
                        {slot.boost} engagement
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => openComposerForDate(currentDate, parseInt(slot.time, 10))}
                      className="rounded-lg bg-slate-900 px-3 py-1 text-[11px] font-semibold text-white hover:bg-blue-600 transition"
                    >
                      Schedule Here
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Post Composer Modal */}
      <PostComposerModal
        brand={brand}
        accounts={accounts}
        isOpen={isComposerOpen}
        onClose={() => setIsComposerOpen(false)}
        initialDate={composerDate}
        onPostCreated={() => {
          void queryClient.invalidateQueries({ queryKey: ['scheduled-posts', brand.id] });
        }}
      />

      {/* Instagram Grid Preview Modal */}
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

      {reschedulingPost && (
        <RescheduleDialog
          post={reschedulingPost}
          pending={rescheduleMutation.isPending}
          onClose={() => setReschedulingPost(null)}
          onSubmit={(scheduledAt) => {
            reschedulePost(reschedulingPost.id, scheduledAt);
            setReschedulingPost(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * The non-drag path, and the one the keyboard uses.
 *
 * A plain `datetime-local` with a real label - no drag surface, no pointer geometry. It hands
 * an ISO string to the same `reschedulePost` the drop handler calls, so the two affordances
 * cannot diverge in what they do or in what the server is asked to accept.
 */
function RescheduleDialog({
  post,
  pending,
  onClose,
  onSubmit,
}: {
  post: ScheduledPostSummary;
  pending: boolean;
  onClose: () => void;
  onSubmit: (scheduledAt: string) => void;
}) {
  const [value, setValue] = useState(() => localInputValue(post.scheduledAt));

  const submit = () => {
    const parsed = new Date(value);
    if (isNaN(parsed.getTime())) return;
    onSubmit(parsed.toISOString());
  };

  return (
    <Modal
      onClose={onClose}
      title="Reschedule post"
      description={post.content.slice(0, 120)}
      icon="🗓️"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={pending}>
            Reschedule
          </Button>
        </>
      }
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="flex flex-col gap-1.5"
      >
        <label htmlFor="reschedule-at" className="text-sm font-medium text-slate-700">
          New date and time
        </label>
        <input
          id="reschedule-at"
          type="datetime-local"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-describedby="reschedule-at-hint"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
        />
        <span id="reschedule-at-hint" className="text-xs text-slate-500">
          The server checks the new time against the account's publishing window and refuses a
          time in the past.
        </span>
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}

/** An ISO instant as the local `YYYY-MM-DDTHH:mm` a `datetime-local` input holds. */
function localInputValue(iso: string): string {
  const date = new Date(iso);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}
