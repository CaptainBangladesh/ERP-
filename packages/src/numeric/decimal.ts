/**
 * Exact decimal arithmetic, in both workspaces.
 *
 * A JavaScript `number` is an IEEE 754 double. `0.1 + 0.2` is not `0.3`, `48000.10 / 365 * 30`
 * is not the figure anybody agreed to pay, and a stock valuation summed from a thousand
 * movements drifts. Every monetary value and every quantity in this system is one of these
 * instead, from the `numeric` column it is stored in to the input box it is typed into.
 *
 * A value is a `bigint` of scaled units and an integer scale: `48000.10` is `4800010n` at
 * scale 2. `bigint` is arbitrary precision and native, so there is no dependency here and no
 * precision limit short of memory.
 *
 * **Rounding happens only where it is asked for.** `plus`, `minus` and `times` are exact —
 * the scale grows as the arithmetic requires and nothing is discarded. `dividedBy` and
 * `round` *demand* a scale and a rounding mode, because division is the one operation that
 * cannot be exact and a default would be a rounding rule nobody chose. That is ADR 0004's
 * "rounding happens only at explicit, defined points", enforced by the signature rather than
 * promised by a comment.
 *
 * Instances are immutable. Every operation returns a new value.
 */

/**
 * How a value that cannot be represented at the requested scale is resolved.
 *
 * `half-even` — banker's rounding — is the default *choice* everywhere in this codebase, but
 * never a default *argument*: it is the only mode that does not accumulate a bias when a long
 * sequence of values is rounded, which is exactly what a ledger does.
 */
export type RoundingMode =
  /** Ties away from zero. `2.5` → `3`, `-2.5` → `-3`. What most people mean by "round". */
  | 'half-up'
  /** Ties toward zero. `2.5` → `2`, `-2.5` → `-2`. */
  | 'half-down'
  /** Ties to the neighbour whose last digit is even. `2.5` → `2`, `3.5` → `4`. */
  | 'half-even'
  /** Toward zero, always. Truncation. */
  | 'down'
  /** Away from zero, always. */
  | 'up'
  /** Toward positive infinity. */
  | 'ceiling'
  /** Toward negative infinity. */
  | 'floor';

/** How a value is rounded to a given number of decimal places. */
export interface Rounding {
  /** Decimal places. Must be a non-negative integer. */
  readonly scale: number;
  readonly rounding: RoundingMode;
}

/**
 * A cap on how long a decimal a caller may hand us.
 *
 * Query strings and request bodies are caller-supplied, and `bigint` will cheerfully
 * multiply a million-digit number for as long as it takes. Forty significant digits is
 * comfortably more than any column in this system holds — the widest is `numeric(14, 2)` —
 * and refusing beyond it turns a denial-of-service into a validation message.
 */
export const MAX_DECIMAL_DIGITS = 40;

/** Input that is not a decimal at all, or is one nobody could have meant. */
export class DecimalFormatError extends Error {
  constructor(readonly input: string, reason: string) {
    super(`'${abbreviate(input)}' is not a decimal number: ${reason}`);
    this.name = 'DecimalFormatError';
  }
}

export class DivisionByZeroError extends Error {
  constructor() {
    super('Division by zero. There is no value this could return, so it refuses instead.');
    this.name = 'DivisionByZeroError';
  }
}

/** Optional sign, at least one digit, optionally a point and at least one more digit. */
const DECIMAL = /^([+-]?)(\d+)(?:\.(\d+))?$/;

export class Decimal {
  /**
   * Private so that every value in the system arrives through `parse` or arithmetic, and the
   * invariant — units and scale agree, and a zero is never negative — holds by construction.
   */
  private constructor(
    private readonly units: bigint,
    /** Decimal places. `4800010n` at scale 2 is `48000.10`. */
    readonly scale: number,
  ) {}

  static readonly ZERO = new Decimal(0n, 0);
  static readonly ONE = new Decimal(1n, 0);

  /**
   * A decimal from its canonical text, or a refusal naming what was wrong with it.
   *
   * Text rather than a `number` deliberately, and there is no `fromNumber`: accepting a
   * double would mean the value had already lost precision before it arrived, and a
   * conversion that quietly does that is worse than no conversion at all. Whole numbers that
   * genuinely are integers go through `fromInteger`.
   */
  static parse(text: string): Decimal {
    if (typeof text !== 'string') {
      throw new DecimalFormatError(String(text), 'it is not text');
    }

    const trimmed = text.trim();
    if (trimmed.length === 0) throw new DecimalFormatError(text, 'it is empty');
    if (trimmed.length > MAX_DECIMAL_DIGITS + 2) {
      throw new DecimalFormatError(
        trimmed,
        `it is longer than ${MAX_DECIMAL_DIGITS} digits`,
      );
    }

    const match = DECIMAL.exec(trimmed);
    if (!match) {
      throw new DecimalFormatError(
        trimmed,
        'expected digits, optionally signed, with at most one decimal point and no exponent',
      );
    }

    const [, sign = '', whole = '', fraction = ''] = match;
    if (whole.length + fraction.length > MAX_DECIMAL_DIGITS) {
      throw new DecimalFormatError(trimmed, `it is longer than ${MAX_DECIMAL_DIGITS} digits`);
    }

    const magnitude = BigInt(whole + fraction);
    return new Decimal(sign === '-' ? -magnitude : magnitude, fraction.length);
  }

  /** The same, answering `undefined` rather than throwing. For validating caller input. */
  static tryParse(text: string): Decimal | undefined {
    try {
      return Decimal.parse(text);
    } catch {
      return undefined;
    }
  }

  /** A whole number. Safe because an integer count has no fraction to lose. */
  static fromInteger(value: number | bigint): Decimal {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) {
      throw new DecimalFormatError(
        String(value),
        'it is not a safe integer — pass text or a bigint',
      );
    }
    return new Decimal(BigInt(value), 0);
  }

  /**
   * The same value carried at more decimal places. Exact and always widening: asking for
   * fewer places than the value has would mean discarding digits, which is `round`'s job and
   * requires saying how.
   */
  rescale(scale: number): Decimal {
    assertScale(scale);
    if (scale < this.scale) {
      throw new RangeError(
        `Cannot rescale ${this.toString()} from ${this.scale} places to ${scale} without ` +
          `discarding digits. Use round(scale, mode) and say how it should be rounded.`,
      );
    }
    return new Decimal(this.units * pow10(scale - this.scale), scale);
  }

  /** Exact. The result carries whichever operand had more decimal places. */
  plus(other: Decimal): Decimal {
    const scale = Math.max(this.scale, other.scale);
    return new Decimal(this.at(scale) + other.at(scale), scale);
  }

  /** Exact. */
  minus(other: Decimal): Decimal {
    const scale = Math.max(this.scale, other.scale);
    return new Decimal(this.at(scale) - other.at(scale), scale);
  }

  /** Exact. The result's scale is the sum of the operands' — `1.5 × 1.5` is `2.25`. */
  times(other: Decimal): Decimal {
    return new Decimal(this.units * other.units, this.scale + other.scale);
  }

  /**
   * The one operation that cannot be exact, so the one that insists on being told what to do
   * about it. There is no overload without a `Rounding`.
   */
  dividedBy(other: Decimal, rounding: Rounding): Decimal {
    if (other.isZero()) throw new DivisionByZeroError();
    assertScale(rounding.scale);

    // (a/10^as) / (b/10^bs) at `scale` places  =  a·10^(bs+scale) / (b·10^as)
    const numerator = this.units * pow10(other.scale + rounding.scale);
    const denominator = other.units * pow10(this.scale);

    return new Decimal(divide(numerator, denominator, rounding.rounding), rounding.scale);
  }

  /** To a given number of decimal places, by a named rule. Widening is exact. */
  round(scale: number, rounding: RoundingMode): Decimal {
    assertScale(scale);
    if (scale >= this.scale) return this.rescale(scale);
    return new Decimal(divide(this.units, pow10(this.scale - scale), rounding), scale);
  }

  /**
   * The same value at the fewest decimal places that hold it exactly. `2500.000000` → `2500`.
   *
   * Exact, and therefore not `round`: no digit that carries information is discarded, only
   * zeros that were an artifact of how the value was arrived at. Division is where they come
   * from — it takes the scale it was told to round to, whether or not the answer needed it —
   * so this is the counterpart to `dividedBy` rather than a formatting nicety.
   *
   * Deliberately not applied on the way out of `toValue`: `2.50` as an amount of money is
   * meant to read that way, and a quantity parsed from `3.000` is reporting the precision it
   * was given. Trimming is something a caller asks for when the trailing zeros are noise.
   */
  trimmed(): Decimal {
    let units = this.units;
    let scale = this.scale;

    while (scale > 0 && units % 10n === 0n) {
      units /= 10n;
      scale -= 1;
    }

    return new Decimal(units, scale);
  }

  negated(): Decimal {
    return new Decimal(-this.units, this.scale);
  }

  absolute(): Decimal {
    return this.units < 0n ? this.negated() : this;
  }

  /** `-1`, `0` or `1`, comparing by value — `1.50` and `1.5` compare equal. */
  compare(other: Decimal): -1 | 0 | 1 {
    const scale = Math.max(this.scale, other.scale);
    const mine = this.at(scale);
    const theirs = other.at(scale);
    if (mine < theirs) return -1;
    return mine > theirs ? 1 : 0;
  }

  /** By value, not by representation. `1.50` equals `1.5`. */
  equals(other: Decimal): boolean {
    return this.compare(other) === 0;
  }

  isZero(): boolean {
    return this.units === 0n;
  }

  isNegative(): boolean {
    return this.units < 0n;
  }

  isPositive(): boolean {
    return this.units > 0n;
  }

  /**
   * The canonical text. Never exponential, never a lost digit, and always parseable back to
   * an equal value at the same scale — which is what "values survive database to API to
   * browser and back without alteration" means in practice.
   */
  toString(): string {
    const negative = this.units < 0n;
    const digits = (negative ? -this.units : this.units).toString();

    if (this.scale === 0) return negative ? `-${digits}` : digits;

    const padded = digits.padStart(this.scale + 1, '0');
    const point = padded.length - this.scale;
    const text = `${padded.slice(0, point)}.${padded.slice(point)}`;

    // A zero is never signed: `-0.00` and `0.00` are the same value and printing them
    // differently would make a display flicker between them.
    return negative && this.units !== 0n ? `-${text}` : text;
  }

  toJSON(): string {
    return this.toString();
  }

  /** This value's units at a scale it is known to fit in. Internal to the arithmetic above. */
  private at(scale: number): bigint {
    return this.units * pow10(scale - this.scale);
  }
}

/**
 * Integer division, rounded by a named rule.
 *
 * Sign is taken off the front and put back on at the end, so each mode is stated in terms of
 * one question — does the magnitude go up or stay — which is the only way `ceiling` and
 * `floor` stay right for negative values.
 */
function divide(numerator: bigint, denominator: bigint, rounding: RoundingMode): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const top = numerator < 0n ? -numerator : numerator;
  const bottom = denominator < 0n ? -denominator : denominator;

  const quotient = top / bottom;
  const remainder = top % bottom;
  if (remainder === 0n) return negative ? -quotient : quotient;

  const magnitude = roundsAway(quotient, remainder, bottom, rounding, negative)
    ? quotient + 1n
    : quotient;

  return negative ? -magnitude : magnitude;
}

function roundsAway(
  quotient: bigint,
  remainder: bigint,
  denominator: bigint,
  rounding: RoundingMode,
  negative: boolean,
): boolean {
  // Doubled rather than halved so the comparison stays in integers: there is no half of an
  // odd bigint, and reaching for a float here would defeat the entire point of the file.
  const doubled = remainder * 2n;

  switch (rounding) {
    case 'down':
      return false;
    case 'up':
      return true;
    case 'floor':
      return negative;
    case 'ceiling':
      return !negative;
    case 'half-up':
      return doubled >= denominator;
    case 'half-down':
      return doubled > denominator;
    case 'half-even':
      if (doubled !== denominator) return doubled > denominator;
      return quotient % 2n === 1n;
  }
}

const POWERS: bigint[] = [1n];

/** `10n ** n`, cached, because the arithmetic above asks for the same handful constantly. */
function pow10(exponent: number): bigint {
  if (exponent < 0) throw new RangeError(`Negative exponent: ${exponent}`);
  for (let index = POWERS.length; index <= exponent; index += 1) {
    POWERS[index] = POWERS[index - 1]! * 10n;
  }
  return POWERS[exponent]!;
}

function assertScale(scale: number): void {
  if (!Number.isInteger(scale) || scale < 0 || scale > MAX_DECIMAL_DIGITS) {
    throw new RangeError(
      `A scale is a whole number of decimal places between 0 and ${MAX_DECIMAL_DIGITS}; ` +
        `got ${scale}.`,
    );
  }
}

function abbreviate(input: string): string {
  return input.length > 32 ? `${input.slice(0, 32)}…` : input;
}
