import type { SocialPlatform } from '@erp/shared';

/**
 * The three things this module was copying between its own components.
 *
 * Extracted here and deliberately *not* proposed for `@erp/shared/ui`: that package states its
 * bar in its own header — "a primitive with no business meaning" — and every one of these knows
 * what a social platform, a post-length budget, or a publish state *is*. A component earns the
 * shared package when a second module needs it and it can be described without a marketing
 * noun; none of these can.
 *
 * Each also carries the accessible text its hand-rolled ancestors did not. A coloured dot and a
 * number are not a status and a count to somebody who cannot see them.
 */

const PLATFORM_LOOK: Record<string, { icon: string; label: string; className: string }> = {
  instagram: { icon: '📸', label: 'Instagram', className: 'border-pink-200 bg-pink-50 text-pink-700' },
  facebook: { icon: '📘', label: 'Facebook', className: 'border-blue-200 bg-blue-50 text-blue-700' },
  linkedin: { icon: '💼', label: 'LinkedIn', className: 'border-sky-200 bg-sky-50 text-sky-700' },
  x: { icon: '𝕏', label: 'X', className: 'border-slate-300 bg-slate-100 text-slate-800' },
  threads: { icon: '🧵', label: 'Threads', className: 'border-slate-300 bg-slate-100 text-slate-800' },
  youtube: { icon: '▶️', label: 'YouTube', className: 'border-red-200 bg-red-50 text-red-700' },
  tiktok: { icon: '🎵', label: 'TikTok', className: 'border-slate-300 bg-slate-100 text-slate-800' },
  pinterest: { icon: '📌', label: 'Pinterest', className: 'border-red-200 bg-red-50 text-red-700' },
  google_business: { icon: '🏪', label: 'Google Business', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  bluesky: { icon: '🦋', label: 'Bluesky', className: 'border-sky-200 bg-sky-50 text-sky-700' },
};

/** One connected channel, named. The emoji is decorative; the label is what is announced. */
export function PlatformChip({
  platform,
  handle,
  size = 'md',
}: {
  platform: SocialPlatform | string;
  /** The account's own handle, when the chip stands for a specific account rather than a network. */
  handle?: string;
  size?: 'sm' | 'md';
}) {
  const look = PLATFORM_LOOK[platform] ?? {
    icon: '🌐',
    label: platform,
    className: 'border-slate-300 bg-slate-100 text-slate-700',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-semibold ${look.className} ${
        size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'
      }`}
    >
      <span aria-hidden="true">{look.icon}</span>
      <span>{handle ? `${look.label} · ${handle}` : look.label}</span>
    </span>
  );
}

/**
 * How much of a platform's character budget a draft has spent.
 *
 * `role="status"` rather than a bare number, so the count reaches a screen reader as it changes
 * — and the bar is `aria-hidden`, because it says the same thing a second time in colour, which
 * is exactly the carrier that must never be the only one.
 */
export function CharacterMeter({ used, budget }: { used: number; budget?: number }) {
  if (budget === undefined) {
    return (
      <span role="status" className="text-slate-600">
        {used} characters
      </span>
    );
  }

  const over = used > budget;

  return (
    <span className="flex items-center gap-2">
      <span role="status" className={over ? 'font-bold text-rose-600' : 'text-slate-600'}>
        {used} / {budget}
        {over && <span className="sr-only"> — over the limit for this platform</span>}
      </span>
      <span aria-hidden="true" className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200">
        <span
          className={`block h-full transition-all ${over ? 'bg-rose-500' : 'bg-blue-600'}`}
          style={{ width: `${Math.min(100, (used / budget) * 100)}%` }}
        />
      </span>
    </span>
  );
}

const STATUS_LOOK: Record<string, { label: string; className: string; mark: string }> = {
  DRAFT: { label: 'Draft', className: 'border-slate-300 bg-slate-100 text-slate-700', mark: '📝' },
  SCHEDULED: { label: 'Scheduled', className: 'border-blue-200 bg-blue-50 text-blue-700', mark: '🗓️' },
  PROCESSING: { label: 'Publishing', className: 'border-amber-200 bg-amber-50 text-amber-800', mark: '⏳' },
  PUBLISHED: { label: 'Published', className: 'border-emerald-200 bg-emerald-50 text-emerald-700', mark: '✅' },
  FAILED: { label: 'Failed', className: 'border-rose-200 bg-rose-50 text-rose-700', mark: '⚠️' },
  CANCELLED: { label: 'Cancelled', className: 'border-slate-300 bg-slate-100 text-slate-500', mark: '⊘' },
};

/**
 * A publish state.
 *
 * The mark beside the word is the point: colour was the only thing distinguishing "scheduled"
 * from "failed" on the calendar, and colour is not available to everyone reading it.
 */
export function StatusPill({ status, size = 'md' }: { status: string; size?: 'sm' | 'md' }) {
  const look = STATUS_LOOK[status] ?? {
    label: status,
    className: 'border-slate-300 bg-slate-100 text-slate-700',
    mark: '•',
  };

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border font-semibold ${look.className} ${
        size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs'
      }`}
    >
      <span aria-hidden="true">{look.mark}</span>
      <span>{look.label}</span>
    </span>
  );
}
