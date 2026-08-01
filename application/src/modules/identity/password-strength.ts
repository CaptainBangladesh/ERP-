import { PASSWORD_MIN_LENGTH } from '@erp/shared';

/**
 * How guessable a password looks, as advice rather than as a rule.
 *
 * Deliberately length-dominant, and deliberately not a composition check. NIST 800-63B
 * recommends *against* "must contain a number and a symbol": those rules are satisfied by
 * `Password1!`, which is among the first guesses any attacker makes, and they push people
 * toward short passwords they have to write down. Length, avoiding the obvious, and
 * avoiding words about yourself are what actually help.
 *
 * The only hard rule is the server's minimum length. Nothing here blocks a submission —
 * a meter that refuses a password is a rule wearing a costume, and the user is entitled to
 * decide their own risk once they have been told.
 */

export type StrengthBand = 'weak' | 'fair' | 'good' | 'strong';

export interface PasswordAssessment {
  band: StrengthBand;
  /** One thing to do next. Never a list — a list of demands is what people give up on. */
  advice: string;
}

const BANDS: StrengthBand[] = ['weak', 'fair', 'good', 'strong'];

/**
 * A short list, and honestly not a breach corpus.
 *
 * Checking against the real thing means either shipping megabytes of dictionary or sending
 * a hash of the password to a third party on every keystroke, and neither is worth it for
 * advisory text. These are the handful that appear at the top of every leaked list, so
 * catching them costs nothing.
 */
const NOTORIOUS = [
  'password', 'passw0rd', 'qwerty', 'qwertyuiop', 'letmein', 'welcome', 'admin',
  'iloveyou', 'abc123', 'monkey', 'dragon', 'football', 'baseball', 'sunshine',
  'princess', 'trustno1', 'starwars', 'whatever', 'changeme',
];

export function assessPassword(
  password: string,
  /**
   * Words the person has already typed on this form — their name, their company, their
   * email. A password built from them looks strong by every mechanical measure and is the
   * first thing anybody who knows the person would try.
   */
  context: readonly string[] = [],
): PasswordAssessment | undefined {
  if (!password) return undefined;

  if (password.length < PASSWORD_MIN_LENGTH) {
    return {
      band: 'weak',
      advice: `At least ${PASSWORD_MIN_LENGTH} characters — length matters more than anything else.`,
    };
  }

  const lower = password.toLowerCase();

  if (contextWords(context).some((word) => lower.includes(word))) {
    return {
      band: 'weak',
      advice: 'Avoid your name, your company, or your email address.',
    };
  }

  if (NOTORIOUS.some((common) => lower.includes(common))) {
    return { band: 'weak', advice: 'This contains one of the most-guessed passwords.' };
  }

  const distinct = new Set(lower).size;

  // Length stops counting for anything once there is almost nothing being repeated.
  // Sixteen a's is sixteen characters long and takes one guess, so this overrides length
  // rather than nudging it down a band.
  if (distinct <= 2) {
    return {
      band: 'weak',
      advice: 'Repeating one or two characters is as guessable as a short password.',
    };
  }

  if (isRunOfOneSequence(lower)) {
    return { band: 'weak', advice: 'Runs like "abcdef" or "123456" are guessed early.' };
  }

  // Length is otherwise the dominant term, because it is the one that actually multiplies
  // the work an attacker has to do.
  let band: StrengthBand =
    password.length >= 20 ? 'strong' : password.length >= 16 ? 'good' : 'fair';
  let advice = 'A few more words would make this considerably harder to guess.';

  // A small alphabet caps how much length can earn, however long the password gets.
  if (distinct < 5 && band !== 'fair') {
    band = 'fair';
    advice = 'Built from only a few different characters — vary them, or add words.';
  }

  if (band === 'strong') advice = 'Long and unpredictable. Nothing more needed.';

  return { band, advice };
}

/** Long enough to be meaningful — "ada" would match half the passwords ever chosen. */
function contextWords(context: readonly string[]): string[] {
  return context
    .flatMap((entry) => entry.toLowerCase().split(/[^a-z0-9]+/))
    .filter((word) => word.length >= 4);
}

/** True when the whole string is one ascending or descending run of characters. */
function isRunOfOneSequence(value: string): boolean {
  if (value.length < 4) return false;

  const step = value.charCodeAt(1) - value.charCodeAt(0);
  if (step !== 1 && step !== -1) return false;

  return [...value].every(
    (_, index) => index === 0 || value.charCodeAt(index) - value.charCodeAt(index - 1) === step,
  );
}

export const STRENGTH_LABELS: Record<StrengthBand, string> = {
  weak: 'Weak',
  fair: 'Fair',
  good: 'Good',
  strong: 'Strong',
};

export function strengthSteps(band: StrengthBand): number {
  return BANDS.indexOf(band) + 1;
}
