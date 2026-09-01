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

/** A form's own key, made readable: `entry_104` → `Entry 104`, `fleet_size` → `Fleet Size`. */
export function humanise(key: string): string {
  return key
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

export function formatAnswer(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  if (Array.isArray(value)) return value.map(String).join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

/**
 * The few answers worth showing beside the next action.
 *
 * From the most recent submission, because a lead who answered twice told us the newer thing
 * last. Mapped answers come first — they are the ones somebody thought worth structuring — and
 * the identifying ones are skipped: a rail that spends its three lines repeating the name and
 * email already in the header has told the reader nothing.
 */
const ALREADY_IN_THE_HEADER = new Set(['name', 'email', 'phone', 'organisationName']);

export function topSurveyAnswers(
  submissions: LeadSubmissionSummary[],
  definitions: LeadFieldSummary[],
  limit = 3,
): { key: string; label: string; value: string }[] {
  const newest = submissions[0];
  if (!newest) return [];

  return Object.entries(newest.rawPayload)
    .map(([key, value]) => ({
      key,
      label: answerLabel(key, newest, definitions),
      value: formatAnswer(value),
      mapped: Boolean(newest.mappedFields[key]),
    }))
    .filter((answer) => answer.value !== '')
    .filter((answer) => !ALREADY_IN_THE_HEADER.has(newest.mappedFields[answer.key] ?? answer.key))
    .sort((a, b) => Number(b.mapped) - Number(a.mapped))
    .slice(0, limit)
    .map(({ key, label, value }) => ({ key, label, value }));
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
