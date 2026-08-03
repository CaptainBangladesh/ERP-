import { Decimal, DecimalFormatError, DEFAULT_CURRENCY, isMoneyValue, Money } from '@erp/shared';
import { accepted, refused, rule, type FieldRule, type Read } from './rule';

/**
 * The field rules every module shares.
 *
 * Small and deliberately incomplete. A rule earns a place here when a second module needs
 * it; a rule only one module needs belongs beside that module's schema, where its wording
 * and its edges are somebody's actual concern. The alternative — a validation library that
 * grows a rule per request — is the shared-package failure mode in a different file.
 */

/** Trimmed, non-empty text. The ordinary case: a name, a label, a reason. */
export function text(options: {
  missing: string;
  /** Refused above this many characters. Absent means no limit. */
  maxLength?: number;
  tooLong?: string;
}): FieldRule<string> {
  return rule(options.missing, (value) => {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (trimmed.length === 0) return refused(options.missing);

    if (options.maxLength !== undefined && trimmed.length > options.maxLength) {
      return refused(options.tooLong ?? `Use ${options.maxLength} characters or fewer.`);
    }

    return accepted(trimmed);
  });
}

/**
 * An email address, normalised on the way in.
 *
 * The pattern is deliberately permissive. An address either delivers or it does not, and a
 * stricter one's only reliable achievement is rejecting somebody's real, valid address.
 *
 * Lower-cased here rather than at the call site, so that "Ada@Northwind.test" and
 * "ada@northwind.test" are the same account. Doing it in one place is what makes the unique
 * constraint on the column mean what it appears to mean.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function email(options: {
  missing: string;
  /**
   * The message when it does not look like an address.
   *
   * Omit it to accept any non-empty text, normalised. Sign-in does exactly that on purpose:
   * it is looking an address up rather than accepting one, and telling somebody their
   * existing address is malformed would lock them out of an account they can reach.
   */
  invalid?: string;
}): FieldRule<string> {
  return rule(options.missing, (value) => {
    const normalised = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (normalised.length === 0) return refused(options.missing);
    if (options.invalid && !EMAIL.test(normalised)) return refused(options.invalid);
    return accepted(normalised);
  });
}

/**
 * A password, untrimmed and unnormalised.
 *
 * Whitespace is a legitimate character in a password and trimming one would lock somebody out
 * of an account they can type the password to.
 */
export function password(options: {
  missing: string;
  minLength: number;
  tooShort: string;
}): FieldRule<string> {
  return rule(options.missing, (value) => {
    const secret = typeof value === 'string' ? value : '';
    if (secret.length === 0) return refused(options.missing);
    return secret.length < options.minLength ? refused(options.tooShort) : accepted(secret);
  });
}

/** `true` or `false`, and nothing else — a string `'true'` from a form is not a boolean. */
export function flag(options: { missing: string }): FieldRule<boolean> {
  return rule(options.missing, (value) =>
    typeof value === 'boolean' ? accepted(value) : refused(options.missing),
  );
}

/**
 * One of a fixed set of words, refused by naming the alternatives.
 *
 * Not a `text` rule with a cross-field check afterwards: "person or organisation" is a fact
 * about the field, and putting it in the rule is what makes the message say what is *allowed*
 * rather than that something is wrong.
 *
 * The allowed set comes from the module's own contract — `PARTY_KINDS`, `CATALOGUE_STATUSES` —
 * so the values a caller may send and the values the module's screens offer are one list.
 */
export function oneOf<T extends string>(
  allowed: readonly T[],
  options: { missing: string; invalid: string },
): FieldRule<T> {
  return rule(options.missing, (value) => {
    const given = typeof value === 'string' ? value.trim() : '';
    if (given.length === 0) return refused(options.missing);

    return (allowed as readonly string[]).includes(given)
      ? accepted(given as T)
      : refused(`${options.invalid} Use one of: ${allowed.join(', ')}.`);
  });
}

/** A UUID, which is what every identifier in this system is. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An identifier, checked only for shape.
 *
 * Whether the row exists, belongs to this company, and is the right kind of thing are all
 * questions for the service, which has the database. What this stops is a malformed identifier
 * reaching Prisma, where an invalid UUID is a 500 rather than a message beside the input.
 *
 * The wording stays with the caller because the field is somebody's *choice* of something —
 * "Choose an organisation." and "Choose a unit of measure." are the same rule and different
 * sentences.
 */
export function identifier(options: { missing: string; invalid: string }): FieldRule<string> {
  return rule(options.missing, (value) => {
    const given = typeof value === 'string' ? value.trim() : '';
    if (given.length === 0) return refused(options.missing);
    return UUID.test(given) ? accepted(given) : refused(options.invalid);
  });
}

export interface DecimalOptions {
  missing: string;
  invalid: string;
  /** Decimal places allowed. Matches the column's scale, so what validates also stores. */
  scale: number;
  tooPrecise?: string;
  minimum?: Decimal;
  belowMinimum?: string;
  maximum?: Decimal;
  aboveMaximum?: string;
}

/**
 * An exact decimal, from text.
 *
 * Text and never a JSON number, at every layer: a JSON number is an IEEE 754 double and
 * cannot hold every value a `numeric` column can, so accepting one would lose precision
 * before validation had a chance to look at it. Refusing it here is what makes the rule "no
 * floating point anywhere" true rather than aspirational.
 */
export function decimal(options: DecimalOptions): FieldRule<Decimal> {
  return rule(options.missing, (value) => readDecimal(value, options));
}

function readDecimal(value: unknown, options: DecimalOptions): Read<Decimal> {
  if (typeof value !== 'string') return refused(options.invalid);
  if (value.trim().length === 0) return refused(options.missing);

  let amount: Decimal;
  try {
    amount = Decimal.parse(value);
  } catch (cause) {
    // Anything that is not a format complaint is a bug rather than bad input, and swallowing
    // it here would hide it behind a message about the user's typing.
    if (cause instanceof DecimalFormatError) return refused(options.invalid);
    throw cause;
  }

  if (amount.scale > options.scale) {
    return refused(
      options.tooPrecise ??
        `Use at most ${options.scale} decimal place${options.scale === 1 ? '' : 's'}.`,
    );
  }

  if (options.minimum && amount.compare(options.minimum) < 0) {
    return refused(options.belowMinimum ?? `Enter ${options.minimum.toString()} or more.`);
  }

  if (options.maximum && amount.compare(options.maximum) > 0) {
    return refused(options.aboveMaximum ?? `Enter ${options.maximum.toString()} or less.`);
  }

  return accepted(amount);
}

/**
 * A monetary value: an exact amount *and* the currency it is in, as one field.
 *
 * Accepts the wire shape `{ amount, currency }`, and also bare decimal text — a form that
 * only ever deals in the company's own currency should not have to send one. The currency is
 * then the platform default, which is the single point ADR 0004 records as assumed.
 */
export function money(
  options: DecimalOptions & {
    /**
     * The only currency this field accepts. Defaults to the platform's.
     *
     * Checked rather than ignored, because the column behind a monetary field carries an
     * amount and not a currency: accepting `{ amount: '100', currency: 'USD' }` and storing
     * it beside a company's pounds would be the "silently wrong" outcome the whole exact-
     * numbers rule exists to prevent. When a company can choose a currency, this is where
     * that choice is enforced.
     */
    currency?: string;
    wrongCurrency?: string;
  },
): FieldRule<Money> {
  const expected = options.currency ?? DEFAULT_CURRENCY;
  const wrongCurrency =
    options.wrongCurrency ?? `Amounts here are in ${expected}.`;

  return rule(options.missing, (value) => {
    if (typeof value === 'string') {
      const amount = readDecimal(value, options);
      return amount.ok ? accepted(Money.of(amount.value, expected)) : amount;
    }

    if (!isMoneyValue(value)) return refused(options.invalid);
    if (value.currency !== expected) return refused(wrongCurrency);

    const amount = readDecimal(value.amount, options);
    return amount.ok ? accepted(Money.of(amount.value, expected)) : amount;
  });
}

/** `YYYY-MM-DD`. Anything with a time in it is a period boundary somebody guessed at. */
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A calendar day, read as UTC midnight.
 *
 * A period is a run of dates rather than an instant, so anchoring it to UTC keeps the same
 * pay run the same length whether the server is in London or Lagos. The regex is what stops
 * anything but a bare date reaching the parser.
 *
 * Round-tripped through the parse to reject a real-looking impossible date: `2026-02-30`
 * matches the pattern and `Date` rolls it forward to March, which would silently accept a
 * period the caller did not ask for.
 */
export function day(options: { missing: string; invalid: string }): FieldRule<Date> {
  return rule(options.missing, (value) => {
    if (typeof value !== 'string' || !DAY.test(value)) return refused(options.invalid);

    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) return refused(options.invalid);
    if (parsed.toISOString().slice(0, 10) !== value) return refused(options.invalid);

    return accepted(parsed);
  });
}
