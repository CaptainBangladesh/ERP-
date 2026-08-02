import { Decimal, type Rounding, type RoundingMode } from './decimal.js';

/**
 * How much of something there is — exactly, and fractionally.
 *
 * Fractional because a unit of measure is not always a thing you can count: 2.5 kg of flour
 * and 0.75 hours of labour are ordinary stock movements, and a quantity that had to be a
 * whole number would force every such module to invent its own workaround.
 *
 * It carries no unit of measure, deliberately. A unit is the Products module's concept — it
 * has rules, a table and a screen — and putting one here would make the shared package hold
 * domain meaning, which is the thing the shared package rule exists to prevent. A quantity
 * is a number; what it counts is the caller's business.
 *
 * The contrast with `Money` is the point: money refuses cross-currency arithmetic because it
 * knows its currency. Nothing here can refuse adding kilograms to hours, and the module that
 * owns units of measure is the one that will.
 */

/**
 * The decimal places a quantity is stored at.
 *
 * Six is enough for the fractional cases that arise — grams within kilograms, minutes within
 * hours — without inviting a quantity that is really a rounding error. It matches the
 * `numeric(_, 6)` columns the ledger will use, so a value that survives this survives the
 * database.
 */
export const QUANTITY_SCALE = 6;

export class Quantity {
  private constructor(readonly amount: Decimal) {}

  static readonly ZERO = new Quantity(Decimal.ZERO);

  static of(amount: Decimal): Quantity {
    return new Quantity(amount);
  }

  /** From decimal text. Throws `DecimalFormatError` on anything that is not one. */
  static parse(amount: string): Quantity {
    return new Quantity(Decimal.parse(amount));
  }

  /** A whole number of something. */
  static fromInteger(amount: number | bigint): Quantity {
    return new Quantity(Decimal.fromInteger(amount));
  }

  /**
   * A stored column on its way out, surviving a value that is not there — the same edge
   * `Money.wire` handles, for the same reason. See docs/tenancy.md.
   */
  static wire(amount: string | null | undefined): string | null {
    return amount === null || amount === undefined ? null : Quantity.parse(amount).toValue();
  }

  /** Exact. */
  plus(other: Quantity): Quantity {
    return new Quantity(this.amount.plus(other.amount));
  }

  /** Exact. */
  minus(other: Quantity): Quantity {
    return new Quantity(this.amount.minus(other.amount));
  }

  /** Exact. */
  times(factor: Decimal): Quantity {
    return new Quantity(this.amount.times(factor));
  }

  /** Rounded as instructed, because division cannot be exact. */
  dividedBy(divisor: Decimal, rounding: Rounding): Quantity {
    return new Quantity(this.amount.dividedBy(divisor, rounding));
  }

  /** To the scale a quantity is stored at — the explicit point where a computed one lands. */
  round(rounding: RoundingMode): Quantity {
    return new Quantity(this.amount.round(QUANTITY_SCALE, rounding));
  }

  compare(other: Quantity): -1 | 0 | 1 {
    return this.amount.compare(other.amount);
  }

  equals(other: Quantity): boolean {
    return this.amount.equals(other.amount);
  }

  isZero(): boolean {
    return this.amount.isZero();
  }

  isNegative(): boolean {
    return this.amount.isNegative();
  }

  isPositive(): boolean {
    return this.amount.isPositive();
  }

  /**
   * The wire form: canonical decimal text at whatever scale the value actually has.
   *
   * Unlike money, a quantity is *not* padded to its storage scale. `3` boxes should read as
   * `3` and not `3.000000`; the trailing zeros money carries are a currency convention rather
   * than a numeric one.
   */
  toValue(): string {
    return this.amount.toString();
  }

  toJSON(): string {
    return this.toValue();
  }

  toString(): string {
    return this.toValue();
  }
}
