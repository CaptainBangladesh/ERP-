import { Decimal, type Rounding, type RoundingMode } from './decimal.js';

/**
 * An amount of money, which is an exact number *and* the currency it is in.
 *
 * The currency travels with the value rather than being assumed by whoever reads it. That is
 * what makes the second rule enforceable: **arithmetic across differing currencies is
 * refused**, loudly, rather than producing a number that looks right and is meaningless. A
 * bare `Decimal` on a column called `amount` cannot refuse anything.
 *
 * Multiplication and division take a plain `Decimal`, never another `Money` — money times
 * money is not money, and the type says so rather than a comment.
 *
 * ADR 0004 records why the currency of a *newly created* value comes from a constant today:
 * multi-currency is out of scope, so there is one currency and it is named in one place. The
 * expensive-to-retrofit half — the value carrying it everywhere it goes — is done.
 */

/**
 * The currency every monetary value is created in until a company can choose one.
 *
 * Assumed at exactly one point: the moment a value is first made. It is carried explicitly
 * from there on. See ADR 0004.
 */
export const DEFAULT_CURRENCY = 'GBP';

/**
 * The decimal places money is stored and displayed at.
 *
 * Two, because every currency this system supports has two minor digits — there is one.
 * A currency-to-minor-units table belongs here when a company can choose a currency, and
 * nowhere else. It is deliberately *not* the scale arithmetic happens at: intermediate values
 * keep every digit and are rounded once, at the end, on purpose.
 */
export const MONEY_SCALE = 2;

/** An ISO 4217 code: three letters, upper case. */
const CURRENCY = /^[A-Z]{3}$/;

/** How a monetary value crosses the network and how it is stored in a request body. */
export interface MoneyValue {
  /** A decimal string — never a JSON number, which is a double and loses pennies. */
  readonly amount: string;
  readonly currency: string;
}

export class CurrencyMismatchError extends Error {
  constructor(
    readonly left: string,
    readonly right: string,
  ) {
    super(
      `Cannot combine ${left} with ${right}. Money in different currencies is not ` +
        `comparable without a rate and a date, and neither is available here — so this is ` +
        `refused rather than answered wrongly.`,
    );
    this.name = 'CurrencyMismatchError';
  }
}

export class CurrencyFormatError extends Error {
  constructor(readonly input: string) {
    super(`'${input}' is not a currency code. Expected three upper-case letters, e.g. 'GBP'.`);
    this.name = 'CurrencyFormatError';
  }
}

export class Money {
  private constructor(
    readonly amount: Decimal,
    readonly currency: string,
  ) {}

  /** An amount already known to be exact — the result of arithmetic, or a parsed column. */
  static of(amount: Decimal, currency: string = DEFAULT_CURRENCY): Money {
    if (!CURRENCY.test(currency)) throw new CurrencyFormatError(currency);
    return new Money(amount, currency);
  }

  /** From decimal text. Throws `DecimalFormatError` on anything that is not one. */
  static parse(amount: string, currency: string = DEFAULT_CURRENCY): Money {
    return Money.of(Decimal.parse(amount), currency);
  }

  /** From the wire, or from a request body, as one value rather than two loose fields. */
  static fromValue(value: MoneyValue): Money {
    return Money.parse(value.amount, value.currency);
  }

  static zero(currency: string = DEFAULT_CURRENCY): Money {
    return Money.of(Decimal.ZERO.rescale(MONEY_SCALE), currency);
  }

  /**
   * A stored column on its way out, surviving the case where it is not there.
   *
   * The absence is real and the type denies it. A field restricted beyond company scope is
   * *omitted* from the row the tenancy extension returns for a caller without its grant, but
   * Prisma's generated row type still says the column is present — so a module that trusted
   * the type would put `undefined` on the wire. Every money serialiser in this system goes
   * through here, so that edge is handled once rather than remembered forty times. See
   * docs/tenancy.md.
   */
  static wire(
    amount: string | null | undefined,
    currency: string = DEFAULT_CURRENCY,
  ): MoneyValue | null {
    if (amount === null || amount === undefined) return null;
    return Money.parse(amount, currency).toValue();
  }

  /** Exact. Refuses a different currency. */
  plus(other: Money): Money {
    return new Money(this.amount.plus(this.sameCurrency(other).amount), this.currency);
  }

  /** Exact. Refuses a different currency. */
  minus(other: Money): Money {
    return new Money(this.amount.minus(this.sameCurrency(other).amount), this.currency);
  }

  /** Exact. A scalar, not money: three times £5 is £15, but £3 times £5 is nothing. */
  times(factor: Decimal): Money {
    return new Money(this.amount.times(factor), this.currency);
  }

  /** Rounded as instructed, because division cannot be exact. */
  dividedBy(divisor: Decimal, rounding: Rounding): Money {
    return new Money(this.amount.dividedBy(divisor, rounding), this.currency);
  }

  /**
   * To the currency's minor units — the explicit, defined point where a computed amount
   * becomes an amount somebody could actually be paid.
   */
  round(rounding: RoundingMode): Money {
    return new Money(this.amount.round(MONEY_SCALE, rounding), this.currency);
  }

  compare(other: Money): -1 | 0 | 1 {
    return this.amount.compare(this.sameCurrency(other).amount);
  }

  /** Same currency and same value. Money in two currencies is never equal, not even at zero. */
  equals(other: Money): boolean {
    return this.currency === other.currency && this.amount.equals(other.amount);
  }

  isZero(): boolean {
    return this.amount.isZero();
  }

  isNegative(): boolean {
    return this.amount.isNegative();
  }

  /**
   * The wire form, at the currency's scale so that `5` and `5.00` do not reach a screen as
   * two different-looking amounts. Widening only — nothing is rounded here, because anything
   * that needed rounding should have said so before it got this far.
   */
  toValue(): MoneyValue {
    const amount =
      this.amount.scale < MONEY_SCALE ? this.amount.rescale(MONEY_SCALE) : this.amount;
    return { amount: amount.toString(), currency: this.currency };
  }

  toJSON(): MoneyValue {
    return this.toValue();
  }

  toString(): string {
    return `${this.toValue().amount} ${this.currency}`;
  }

  private sameCurrency(other: Money): Money {
    if (other.currency !== this.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
    return other;
  }
}

/** True for a value that is shaped like one, whatever it claims to be. */
export function isMoneyValue(value: unknown): value is MoneyValue {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.amount === 'string' && typeof candidate.currency === 'string';
}
