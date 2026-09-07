import { NETWORK_LIMITS, containsLink, type SocialPlatform } from '@erp/shared';

/**
 * The composer's linter.
 *
 * A pure function over the draft — no network call, no model, no persisted result per
 * keystroke (14n). Everything it produces is a `warning` and nothing else: readability,
 * spam-words, emoji density and shouting are heuristics with real false positives, and a
 * heuristic that can refuse a publish becomes a support ticket the first day a client's brand
 * voice is legitimately loud. The publish path never reads any of this.
 */

export type LintCode =
  | 'readability'
  | 'spam_words'
  | 'emoji_density'
  | 'all_caps'
  | 'link_handling';

export interface LintWarning {
  readonly code: LintCode;
  /** Always `warning`. The type says so because the rule does. */
  readonly severity: 'warning';
  readonly message: string;
}

/**
 * Words that trip promotional filters and reader scepticism in roughly equal measure.
 *
 * A short, boring list on purpose: a long one flags every legitimate offer a marketing team
 * ever writes, and a linter people learn to ignore is worse than no linter.
 */
const SPAM_WORDS = [
  'act now',
  'buy now',
  'click here',
  'congratulations',
  'don’t miss',
  'free money',
  'guaranteed',
  'limited time',
  'no obligation',
  'once in a lifetime',
  'risk free',
  'urgent',
  'winner',
  '100% free',
];

/** Above this the copy reads like a contract rather than a caption. */
const HARD_READING_GRADE = 12;

/** Emoji as a share of visible characters, above which the post is decoration. */
const EMOJI_DENSITY_LIMIT = 0.1;

/** Words in caps, as a share of words, before it reads as shouting. */
const CAPS_SHARE_LIMIT = 0.3;

/** Below this many words the heuristics are noise, so they stay quiet. */
const MIN_WORDS_FOR_STYLE = 12;

const EMOJI = /\p{Extended_Pictographic}/gu;
const WORD = /[A-Za-z’']+/g;

export function lintDraft(
  content: string,
  platforms: readonly SocialPlatform[] = [],
): LintWarning[] {
  const warnings: LintWarning[] = [];
  const text = content ?? '';
  const trimmed = text.trim();
  if (trimmed.length === 0) return warnings;

  const words = trimmed.match(WORD) ?? [];

  const warn = (code: LintCode, message: string): void => {
    warnings.push({ code, severity: 'warning', message });
  };

  if (words.length >= MIN_WORDS_FOR_STYLE) {
    const grade = fleschKincaidGrade(trimmed, words);
    if (grade > HARD_READING_GRADE) {
      warn(
        'readability',
        `This reads at about a grade ${Math.round(grade)} level. Shorter sentences and shorter words land better in a feed.`,
      );
    }
  }

  const lower = trimmed.toLowerCase();
  const flagged = SPAM_WORDS.filter((phrase) => lower.includes(phrase));
  if (flagged.length > 0) {
    warn(
      'spam_words',
      `Phrases that read as promotional: ${flagged.join(', ')}. They tend to depress reach.`,
    );
  }

  const visible = trimmed.replace(/\s/gu, '');
  EMOJI.lastIndex = 0;
  const emojiCount = (trimmed.match(EMOJI) ?? []).length;
  if (visible.length > 0 && emojiCount / visible.length > EMOJI_DENSITY_LIMIT) {
    warn(
      'emoji_density',
      `${emojiCount} emoji in ${visible.length} characters. Past roughly one in ten the copy is harder to read, especially with a screen reader.`,
    );
  }

  if (words.length >= MIN_WORDS_FOR_STYLE) {
    const shouting = words.filter(
      (word) => word.length > 2 && word === word.toUpperCase() && word !== word.toLowerCase(),
    );
    if (shouting.length / words.length > CAPS_SHARE_LIMIT) {
      warn(
        'all_caps',
        `${shouting.length} of ${words.length} words are in capitals. Screen readers spell those out letter by letter.`,
      );
    }
  }

  // Per-network, and only when there is actually a link to talk about.
  if (containsLink(trimmed)) {
    for (const platform of platforms) {
      const limits = NETWORK_LIMITS[platform];
      if (!limits) continue;
      if (limits.linkHandling === 'clickable') continue;
      warn('link_handling', `${limits.label}: ${limits.linkNote}`);
    }
  }

  return warnings;
}

/**
 * Flesch–Kincaid grade level.
 *
 * 0.39 × (words ÷ sentences) + 11.8 × (syllables ÷ words) − 15.59, with the syllable count
 * approximated by vowel groups. Approximate on purpose: it is a nudge in a composer, and the
 * exact figure would still be an estimate of something no formula measures directly.
 */
export function fleschKincaidGrade(text: string, words: readonly string[] = []): number {
  const tokens = words.length > 0 ? words : text.match(WORD) ?? [];
  if (tokens.length === 0) return 0;

  const sentences = Math.max(1, (text.match(/[.!?]+(\s|$)/g) ?? []).length);
  const syllables = tokens.reduce((sum, word) => sum + syllablesIn(word), 0);

  return 0.39 * (tokens.length / sentences) + 11.8 * (syllables / tokens.length) - 15.59;
}

function syllablesIn(word: string): number {
  const cleaned = word.toLowerCase().replace(/[^a-z]/g, '');
  if (cleaned.length === 0) return 0;
  if (cleaned.length <= 3) return 1;

  const trimmed = cleaned.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups?.length ?? 1);
}
