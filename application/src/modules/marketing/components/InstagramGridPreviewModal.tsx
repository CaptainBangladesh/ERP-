import React, { useState, useMemo } from 'react';
import type { BrandSummary, ScheduledPostSummary } from '@erp/shared';
import { Button, Modal } from '@erp/shared/ui';

export interface InstagramGridPreviewModalProps {
  brand: BrandSummary;
  isOpen: boolean;
  onClose: () => void;
  posts: ScheduledPostSummary[];
  onScheduleClick?: () => void;
}

// Fallback high-aesthetic tile imagery for visual harmony when brand has few posts
const FALLBACK_GRID_IMAGES = [
  'https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1507238691740-187a5b1d37b8?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1497215728101-856f4ea42174?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=600&q=80',
];

interface GridItem {
  id: string;
  isReal: boolean;
  content: string;
  mediaUrl: string;
  status: string;
  scheduledAt?: string;
  likes: number;
  comments: number;
  isReel?: boolean;
  isCarousel?: boolean;
}

export function InstagramGridPreviewModal({
  brand,
  isOpen,
  onClose,
  posts,
  onScheduleClick,
}: InstagramGridPreviewModalProps) {
  const [viewMode, setViewMode] = useState<'grid' | 'feed'>('grid');
  const [selectedItem, setSelectedItem] = useState<GridItem | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const handle = brand.slug
    ? brand.slug.replace(/[^a-zA-Z0-9_.-]/g, '')
    : brand.name.toLowerCase().replace(/[^a-zA-Z0-9_.-]/g, '');

  // Filter Instagram posts (or all posts if no platform specified)
  const igPosts = useMemo(() => {
    return posts.filter(
      (p) => !p.socialAccount || p.socialAccount.platform === 'instagram',
    );
  }, [posts]);

  // Construct standard 9-12 grid items
  const initialItems = useMemo<GridItem[]>(() => {
    const items: GridItem[] = igPosts.map((p, idx) => {
      const fallback =
        FALLBACK_GRID_IMAGES[idx % FALLBACK_GRID_IMAGES.length] ?? FALLBACK_GRID_IMAGES[0] ?? '';
      const media = p.mediaUrls && p.mediaUrls[0] ? p.mediaUrls[0] : fallback;

      return {
        id: p.id,
        isReal: true,
        content: p.content,
        mediaUrl: media,
        status: p.status,
        scheduledAt: p.scheduledAt,
        likes: (p.metrics as any)?.likes ?? Math.floor(180 + (idx * 37) % 650),
        comments: Math.floor(12 + (idx * 7) % 85),
        isCarousel: (p.mediaUrls?.length ?? 0) > 1,
        isReel: p.content.toLowerCase().includes('reel') || p.content.toLowerCase().includes('video'),
      };
    });

    // Fill up to 9 items with aesthetic placeholders if needed
    const targetCount = Math.max(9, Math.ceil(items.length / 3) * 3);
    for (let i = items.length; i < targetCount; i++) {
      items.push({
        id: `mock-${i}`,
        isReal: false,
        content: `Aesthetic brand moodboard visual #${i + 1}. Minimalist palette & editorial storytelling. #brand #aesthetic`,
        mediaUrl:
          FALLBACK_GRID_IMAGES[i % FALLBACK_GRID_IMAGES.length] ?? FALLBACK_GRID_IMAGES[0] ?? '',
        status: 'PUBLISHED',
        likes: Math.floor(320 + (i * 43) % 800),
        comments: Math.floor(18 + (i * 9) % 95),
        isCarousel: i % 3 === 0,
      });
    }

    return items;
  }, [igPosts]);

  const [gridItems, setGridItems] = useState<GridItem[]>(initialItems);

  // Sync when initialItems changes
  React.useEffect(() => {
    setGridItems(initialItems);
  }, [initialItems]);

  // Drag and drop tile swap simulation
  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  /**
   * Reorder by one position, the keyboard's way in.
   *
   * The same array move the drop handler performs, so the two affordances cannot disagree
   * about what "reorder" means — the grid was drag-only, which left a keyboard user unable to
   * rearrange it at all.
   */
  const moveTile = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= gridItems.length) return;
    const updated = [...gridItems];
    const [moved] = updated.splice(index, 1);
    if (!moved) return;
    updated.splice(target, 0, moved);
    setGridItems(updated);
  };

  const handleDrop = (targetIndex: number) => {
    if (draggedIndex === null || draggedIndex === targetIndex) return;
    const updated = [...gridItems];
    const [moved] = updated.splice(draggedIndex, 1);
    if (moved) {
      updated.splice(targetIndex, 0, moved);
      setGridItems(updated);
    }
    setDraggedIndex(null);
  };

  if (!isOpen) return null;

  const activeDisplayItem = selectedItem || gridItems[0];

  return (
    <Modal
      onClose={onClose}
      title="Instagram 9-Grid Simulator & Feed Preview"
      description="Aesthetic harmony checker: verify scheduled post layout before publishing."
      icon="📸"
      size="xl"
      footer={
        <>
          <span className="mr-auto text-xs text-slate-500">
            Previewing Instagram aesthetic for <strong>{brand.name}</strong>
          </span>
          <Button variant="primary" onClick={onClose}>
            Done Previewing
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-end">
          <div
            role="group"
            aria-label="Preview mode"
            className="flex rounded-lg bg-slate-200/70 p-1 text-xs font-semibold"
          >
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              aria-pressed={viewMode === 'grid'}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1 transition ${
                viewMode === 'grid'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span aria-hidden="true">▦</span>
              <span>3x3 Grid</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('feed')}
              aria-pressed={viewMode === 'feed'}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1 transition ${
                viewMode === 'feed'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span aria-hidden="true">📱</span>
              <span>Mobile Feed</span>
            </button>
          </div>
        </div>

        {/* Modal Content */}
        <div>
          {viewMode === 'grid' ? (
            <div className="mx-auto max-w-xl flex flex-col gap-6">
              {/* Instagram Profile Header Mockup */}
              <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
                <div className="flex items-center gap-6">
                  {/* Avatar with IG Gradient Ring */}
                  <div className="relative p-0.5 rounded-full bg-gradient-to-tr from-amber-400 via-rose-500 to-purple-600">
                    <div className="flex h-18 w-18 items-center justify-center rounded-full bg-white p-0.5">
                      <div className="flex h-full w-full items-center justify-center rounded-full bg-slate-900 text-white font-bold text-lg">
                        {brand.name.slice(0, 2).toUpperCase()}
                      </div>
                    </div>
                  </div>

                  {/* Profile Info & Metrics */}
                  <div className="flex-1 flex flex-col gap-2 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-bold text-slate-900 truncate">@{handle}</span>
                      <span className="text-blue-500 text-xs" title="Verified Brand">
                        ☑️
                      </span>
                    </div>

                    <div className="flex items-center gap-6 text-xs text-slate-600">
                      <div>
                        <strong className="text-slate-900">{gridItems.length}</strong> posts
                      </div>
                      <div>
                        <strong className="text-slate-900">14.8K</strong> followers
                      </div>
                      <div>
                        <strong className="text-slate-900">382</strong> following
                      </div>
                    </div>

                    <div className="text-xs">
                      <p className="font-semibold text-slate-900">{brand.name}</p>
                      <p className="text-slate-600">
                        Official {brand.name} social channel. Innovation, products & community.
                      </p>
                      <a
                        href="#smartlink"
                        onClick={(e) => e.preventDefault()}
                        className="font-semibold text-blue-600 hover:underline"
                      >
                        bio.link/{handle}
                      </a>
                    </div>
                  </div>
                </div>

                {/* Profile Action Buttons */}
                <div className="flex gap-2 text-xs font-semibold pt-1">
                  <button
                    type="button"
                    className="flex-1 rounded-lg bg-slate-100 py-1.5 text-slate-800 hover:bg-slate-200 transition"
                  >
                    Following
                  </button>
                  <button
                    type="button"
                    className="flex-1 rounded-lg bg-slate-100 py-1.5 text-slate-800 hover:bg-slate-200 transition"
                  >
                    Message
                  </button>
                  <button
                    type="button"
                    onClick={() => setGridItems(initialItems)}
                    title="Reset arrangement"
                    className="rounded-lg bg-slate-100 px-3 py-1.5 text-slate-600 hover:bg-slate-200 transition"
                  >
                    ↺ Reset Order
                  </button>
                </div>

                {/* Story Highlights Tray */}
                <div className="flex items-center gap-4 overflow-x-auto pt-2 border-t border-slate-100">
                  {['Highlights', 'New Drops', 'Reviews', 'Team', 'FAQ'].map((story, idx) => (
                    <div key={idx} className="flex flex-col items-center gap-1">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-slate-300 bg-slate-100 text-xs">
                        {['✨', '🚀', '⭐', '👥', '💡'][idx]}
                      </div>
                      <span className="text-[10px] text-slate-600">{story}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Notice Ribbon */}
              <div className="flex items-center justify-between rounded-xl bg-blue-50 border border-blue-200 px-4 py-2 text-xs text-blue-800">
                <span className="flex items-center gap-1.5">
                  <span>💡</span>
                  <span>
                    <strong>Drag</strong> tiles below, or use the arrow buttons on a tile, to test visual colour flow.
                  </span>
                </span>
                {onScheduleClick && (
                  <button
                    type="button"
                    onClick={onScheduleClick}
                    className="font-bold text-blue-700 hover:underline"
                  >
                    + Schedule New Post
                  </button>
                )}
              </div>

              {/* 3x3 Tile Grid */}
              <div className="grid grid-cols-3 gap-1 rounded-2xl overflow-hidden border border-slate-300 bg-slate-200 shadow-md">
                {gridItems.map((item, idx) => (
                  <div
                    key={item.id}
                    draggable
                    onDragStart={() => handleDragStart(idx)}
                    onDragOver={handleDragOver}
                    onDrop={() => handleDrop(idx)}
                    className="group relative aspect-square overflow-hidden bg-slate-900 transition"
                  >
                    {/*
                      The drag is a convenience; this is the tile.
                      A tile used to be a `div` with an `onClick`, so the only way to open one —
                      or to reorder the grid — was with a mouse. The move controls beside it are
                      the non-drag path 13.3b requires: same reorder, reachable by Tab.
                    */}
                    <button
                      type="button"
                      onClick={() => setSelectedItem(item)}
                      aria-label={`Preview tile ${idx + 1} of ${gridItems.length}: ${item.content.slice(0, 60)}`}
                      className="absolute inset-0 z-20 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white"
                    />

                    <div className="absolute bottom-1 left-1 z-30 flex gap-1 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => moveTile(idx, -1)}
                        disabled={idx === 0}
                        aria-label={`Move tile ${idx + 1} earlier`}
                        className="rounded bg-white/90 px-1.5 py-0.5 text-[10px] font-bold text-slate-800 shadow-xs disabled:opacity-40"
                      >
                        <span aria-hidden="true">↑</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => moveTile(idx, 1)}
                        disabled={idx === gridItems.length - 1}
                        aria-label={`Move tile ${idx + 1} later`}
                        className="rounded bg-white/90 px-1.5 py-0.5 text-[10px] font-bold text-slate-800 shadow-xs disabled:opacity-40"
                      >
                        <span aria-hidden="true">↓</span>
                      </button>
                    </div>
                    <img
                      src={item.mediaUrl}
                      alt={item.content}
                      className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                    />

                    {/* Status Badges */}
                    {item.status === 'SCHEDULED' && (
                      <div className="absolute top-2 left-2 z-10 rounded-md bg-blue-600/90 backdrop-blur-xs px-2 py-0.5 text-[10px] font-bold text-white shadow-xs">
                        🗓️ Scheduled
                      </div>
                    )}

                    {/* Format Icons (Reels, Carousels) */}
                    {item.isReel && (
                      <div className="absolute top-2 right-2 z-10 text-white drop-shadow-md text-xs">
                        🎬
                      </div>
                    )}
                    {item.isCarousel && (
                      <div className="absolute top-2 right-2 z-10 text-white drop-shadow-md text-xs">
                        📑
                      </div>
                    )}

                    {/* Hover Overlay with Likes & Comments */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-950/60 opacity-0 transition group-hover:opacity-100 text-white p-3 text-center">
                      <div className="flex items-center gap-4 text-xs font-bold">
                        <span>❤️ {item.likes}</span>
                        <span>💬 {item.comments}</span>
                      </div>
                      <p className="line-clamp-2 text-[10px] text-slate-200">
                        {item.content}
                      </p>
                      {item.scheduledAt && (
                        <span className="text-[9px] text-blue-300">
                          {new Date(item.scheduledAt).toLocaleDateString([], {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* Mobile Feed Mockup View */
            <div className="mx-auto max-w-sm flex flex-col gap-4">
              <div className="overflow-hidden rounded-3xl border-4 border-slate-900 bg-white shadow-2xl">
                {/* Mobile Top Bar */}
                <div className="flex items-center justify-between bg-slate-900 px-6 py-2 text-[10px] font-bold text-white">
                  <span>9:41</span>
                  <div className="flex items-center gap-1.5">
                    <span>📶</span>
                    <span>🔋</span>
                  </div>
                </div>

                {/* Post Header */}
                <div className="flex items-center justify-between p-3 border-b border-slate-100">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-tr from-amber-400 via-rose-500 to-purple-600 p-0.5">
                      <div className="flex h-full w-full items-center justify-center rounded-full bg-slate-900 text-[10px] font-bold text-white">
                        {brand.name.slice(0, 2).toUpperCase()}
                      </div>
                    </div>
                    <div className="flex flex-col">
                      <div className="flex items-center gap-1">
                        <span className="text-xs font-bold text-slate-900">@{handle}</span>
                        <span className="text-blue-500 text-[10px]">☑️</span>
                      </div>
                      <span className="text-[9px] text-slate-500">San Francisco, California</span>
                    </div>
                  </div>
                  <span className="text-slate-400 font-bold text-sm">•••</span>
                </div>

                {/* Feed Image */}
                <div className="aspect-square bg-slate-900 overflow-hidden">
                  <img
                    src={activeDisplayItem?.mediaUrl}
                    alt="Active post"
                    className="h-full w-full object-cover"
                  />
                </div>

                {/* Action Icons Row */}
                <div className="flex items-center justify-between px-3.5 py-2.5">
                  <div className="flex items-center gap-4 text-base text-slate-800">
                    <button type="button" className="hover:text-rose-600 transition">
                      ❤️
                    </button>
                    <button type="button" className="hover:text-blue-600 transition">
                      💬
                    </button>
                    <button type="button" className="hover:text-slate-600 transition">
                      ✈️
                    </button>
                  </div>
                  <button type="button" className="text-base text-slate-800">
                    🔖
                  </button>
                </div>

                {/* Likes count & caption */}
                <div className="flex flex-col gap-1 px-3.5 pb-4 text-xs">
                  <span className="font-bold text-slate-900">
                    {activeDisplayItem?.likes.toLocaleString()} likes
                  </span>
                  <p className="text-slate-800 leading-relaxed">
                    <strong className="text-slate-900 mr-1.5">@{handle}</strong>
                    {activeDisplayItem?.content}
                  </p>
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider mt-1">
                    {activeDisplayItem?.status === 'SCHEDULED'
                      ? `🗓️ Scheduled for ${new Date(activeDisplayItem.scheduledAt || Date.now()).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
                      : 'Published • 2 hours ago'}
                  </span>
                </div>

                {/* Mobile Bottom Tab Bar */}
                <div className="flex items-center justify-around border-t border-slate-100 bg-slate-50 py-2.5 text-base text-slate-700">
                  <span>🏠</span>
                  <span>🔍</span>
                  <span>➕</span>
                  <span>🎬</span>
                  <span>👤</span>
                </div>
              </div>
            </div>
          )}
        </div>

      </div>
    </Modal>
  );
}
