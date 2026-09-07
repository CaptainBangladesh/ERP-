/**
 * Hook formulas, and the substitution that fills them.
 *
 * Decision 14o: the placeholders are a fixed, closed key set replaced by literal string
 * substitution. There is no Handlebars here, no `eval`, no `new Function`, and no property
 * lookup driven by the template string — a templating library evaluated over tenant-supplied
 * text is an injection surface bought for no benefit, and the benefit here is three
 * placeholders.
 *
 * The frameworks themselves are public copywriting structures, not anybody's proprietary
 * asset.
 */

/** The whole key set. Anything not in here is left in the text exactly as written. */
export const TEMPLATE_KEYS = ['subject', 'brand', 'cta'] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export type TemplateValues = Partial<Record<TemplateKey, string>>;

export interface HookFormula {
  readonly id: string;
  readonly name: string;
  /** What the framework is for, in one line, so the picker is not five acronyms. */
  readonly description: string;
  readonly skeleton: string;
}

export const HOOK_FORMULAS: readonly HookFormula[] = [
  {
    id: 'aida',
    name: 'AIDA',
    description: 'Attention, interest, desire, action — the default for an offer.',
    skeleton: [
      'Still doing {subject} the hard way?',
      '',
      'Most teams lose hours to it every week without noticing.',
      '',
      '{brand} turns that into something you set once and forget.',
      '',
      '{cta}',
    ].join('\n'),
  },
  {
    id: 'pas',
    name: 'PAS',
    description: 'Problem, agitate, solve — strongest when the pain is already felt.',
    skeleton: [
      '{subject} is costing you more than you think.',
      '',
      'Every week it goes unfixed, the cleanup gets bigger and somebody else pays for it.',
      '',
      "Here is how {brand} ends it.",
      '',
      '{cta}',
    ].join('\n'),
  },
  {
    id: 'listicle',
    name: 'Listicle',
    description: 'A numbered list — the most reliably saved and shared shape.',
    skeleton: [
      '3 things nobody tells you about {subject}:',
      '',
      '1. ',
      '2. ',
      '3. ',
      '',
      '{cta}',
    ].join('\n'),
  },
  {
    id: 'contrarian',
    name: 'Contrarian',
    description: 'Take the accepted advice apart, then say what to do instead.',
    skeleton: [
      'Everyone says {subject} is a solved problem.',
      '',
      'It is not, and here is what the usual advice leaves out.',
      '',
      'What we do at {brand} instead:',
      '',
      '{cta}',
    ].join('\n'),
  },
  {
    id: 'curiosity-gap',
    name: 'Curiosity gap',
    description: 'Open a loop worth closing — pay it off in the post, never in the click.',
    skeleton: [
      'We changed one thing about {subject} and the numbers moved within a fortnight.',
      '',
      'It was not the thing you would guess.',
      '',
      '{cta}',
    ].join('\n'),
  },
];

/**
 * Fill a skeleton, literally, in one pass.
 *
 * A single left-to-right scan for the three known tokens — no regular expression built from
 * input, no lookup keyed by anything the template says, and no second pass, so a value that
 * happens to look like a placeholder is inserted as text rather than expanded again. A key
 * with no value keeps its placeholder, so the user sees what is still theirs to write instead
 * of finding a silent blank.
 */
export function applyTemplate(skeleton: string, values: TemplateValues): string {
  const source = skeleton ?? '';
  let out = '';
  let index = 0;

  while (index < source.length) {
    const open = source.indexOf('{', index);
    if (open < 0) {
      out += source.slice(index);
      break;
    }

    const close = source.indexOf('}', open);
    const key = close < 0 ? '' : source.slice(open + 1, close);
    const known = (TEMPLATE_KEYS as readonly string[]).includes(key)
      ? (key as TemplateKey)
      : undefined;
    const value = known ? values[known] : undefined;

    out += source.slice(index, open);

    if (known && typeof value === 'string' && value.length > 0) {
      out += value;
      index = close + 1;
    } else {
      // Not one of ours, or nothing to put there: keep the brace and carry on past it.
      out += '{';
      index = open + 1;
    }
  }

  return out;
}

/**
 * What applying a formula does to a draft that is not empty.
 *
 * It never overwrites: the existing text is kept and the filled skeleton is appended beneath
 * it, because the one thing a composer must not do is eat something somebody typed.
 */
export function appendTemplate(existing: string, filled: string): string {
  const current = existing ?? '';
  if (current.trim().length === 0) return filled;
  return `${current.replace(/\s+$/, '')}\n\n${filled}`;
}
