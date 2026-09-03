import type { LeadFieldSummary, LeadSubmissionSummary } from '@erp/shared';

/**
 * Reading a capture-form submission back into something a person can read.
 *
 * Two screens need the same answers said the same way — the Survey tab lists them all, and the
 * workspace's "what we know" rail shows the top few beside the next action — so the naming and
 * formatting rules live here rather than in whichever component needed them first.
 */

/**
 * What to call an answer.
 *
 * A submission's keys are the form's, not ours: a Google Form asks `entry_104`, and the capture
 * source maps that onto a Lead field. So the label comes from the *mapped* field's definition
 * where there is one, and is derived from the raw key only when nothing maps it.
 */
export function answerLabel(
  key: string,
  submission: LeadSubmissionSummary,
  definitions: LeadFieldSummary[],
): string {
  const mappedTo = submission.mappedFields[key];
  const definition = definitions.find((field) => field.key === (mappedTo ?? key));
  return definition?.label ?? humanise(mappedTo ?? key);
}

/**
 * A form's own key, made readable: `entry_104` → `Entry 104`, `fleet_size` → `Fleet Size`.
 *
 * A webhook posts each answer under its full question *title*, which a person already spaced and
 * capitalised — "Does the merchant have a dedicated website?". Title-casing that mangles it
 * ("UI/UX" → "Ui/Ux"), so a key that already contains a space is left exactly as it reads; only
 * the machine keys with no spaces get rewritten.
 */
export function humanise(key: string): string {
  const trimmed = key.trim();
  if (/\s/.test(trimmed)) return trimmed;
  return trimmed
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

/**
 * A field key for an answer the form named itself.
 *
 * `entry_104` is the right thing to *map from* and a poor thing to name a field after, so
 * promoting an answer derives its key from the same readable label the tab already shows.
 */
export function fieldKeyFor(answerKey: string): string {
  return humanise(answerKey).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/**
 * An answer split into the individual values it holds.
 *
 * A multi-select or a Google Form grid arrives as several values in one field, and jamming them
 * into `"Yes, Yes, No"` is exactly the unreadable blob a researcher complained about — each is
 * its own thing and reads better on its own line.
 */
export function answerParts(value: unknown): string[] {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value.map(String).filter((part) => part.trim() !== '');
  if (typeof value === 'boolean') return [value ? 'Yes' : 'No'];
  const single = String(value);
  return single.trim() === '' ? [] : [single];
}

/**
 * Whether an answer is a web address worth making clickable.
 *
 * Deliberately liberal: a lead pastes `bddream.shop` or `www.facebook.com/…` as often as a full
 * `https://` URL, and all three should open. The trailing-TLD requirement keeps plain numbers
 * (`3.5`, `314k`) and prose from being mistaken for links.
 */
export function isUrl(value: string): boolean {
  const trimmed = value.trim();
  if (/\s/.test(trimmed)) return false;
  if (/^https?:\/\/\S+$/i.test(trimmed)) return true;
  if (/^www\.\S+\.\S+$/i.test(trimmed)) return true;
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/\S*)?$/i.test(trimmed);
}

/** Whether an answer is an email address, so it can open the mail client. */
export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/**
 * The first web address inside an answer, pulled out of whatever surrounds it.
 *
 * A pasted link often arrives with a trailing newline or a word beside it, which makes the strict
 * `isUrl` test fail — and a value that fails that test used to be rendered as raw text, which is
 * how a 300-character TikTok share link ended up running off the side of the page. Grabbing the
 * URL token means it becomes a real, tidy link instead.
 */
export function firstUrlIn(value: string): string | undefined {
  const httpMatch = value.match(/https?:\/\/[^\s]+/i);
  if (httpMatch) return httpMatch[0];
  const trimmed = value.trim();
  return isUrl(trimmed) ? trimmed : undefined;
}

/** The href a linkable answer points to, with a protocol (or `mailto:`) filled in. */
export function hrefFor(value: string): string {
  const trimmed = value.trim();
  if (isEmail(trimmed)) return `mailto:${trimmed}`;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed.replace(/^\/+/, '')}`;
}

/**
 * A URL trimmed down to what a person reads at a glance: host and path, no protocol, no query.
 *
 * The raw share links a form collects (a TikTok URL runs to a few hundred characters of tracking
 * parameters) blow the layout apart and tell the reader nothing; the destination does.
 */
export function prettyUrl(value: string): string {
  const trimmed = value.trim();
  if (isEmail(trimmed)) return trimmed;
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    const path = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');
    const shown = url.hostname.replace(/^www\./i, '') + path;
    return shown.length > 48 ? `${shown.slice(0, 47)}…` : shown;
  } catch {
    // Even an unparseable value must never be shown at full length — that is the layout-breaker.
    return trimmed.length > 48 ? `${trimmed.slice(0, 47)}…` : trimmed;
  }
}

/** Initials for an avatar tile — two letters at most, from the first and last word. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0]![0] ?? '';
  const last = words.length > 1 ? words[words.length - 1]![0] ?? '' : '';
  return (first + last).toUpperCase();
}

/**
 * A stable colour for an avatar, chosen from the name.
 *
 * Deterministic so a lead keeps the same tile everywhere it appears — the worklist card and the
 * header have to agree, or the two read as different people.
 */
const AVATAR_COLOURS = [
  'bg-teal-700',
  'bg-indigo-600',
  'bg-violet-600',
  'bg-amber-600',
  'bg-rose-600',
  'bg-sky-700',
  'bg-emerald-700',
];

export function avatarColour(seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 100_000;
  }
  return AVATAR_COLOURS[hash % AVATAR_COLOURS.length]!;
}
