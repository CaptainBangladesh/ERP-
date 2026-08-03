import type { Prisma } from '@prisma/client';

/**
 * Reading a column out, and writing one back — the two conversions every module repeats.
 *
 * Both were written three times before they were written here, which is the point at which
 * something stops being a line and becomes a rule. Neither is a place a module should be
 * making a decision: getting `exactly` wrong loses money silently, and getting `defined` wrong
 * erases a field somebody did not mention.
 *
 * They live beside `PrismaService` rather than in `platform/` because they are about Prisma's
 * types specifically. A module may import them by name; `src/prisma` is flat and has no entry
 * point to reach past.
 */

/**
 * A `numeric` column as text a `Decimal` can parse.
 *
 * `toFixed()` and never `toString()`, and the difference is not stylistic: decimal.js prints
 * values past a certain size in exponential notation, and `Decimal.parse` refuses an exponent.
 * So `toString()` works on every value anybody tests with and fails on a large one in
 * production. See docs/api-conventions.md.
 *
 * The nullable overload carries an absence one step without pretending it cannot happen: a
 * field restricted beyond company scope is genuinely missing from the row the tenancy
 * extension returns, while Prisma's generated type still says it is present. `Money.wire` is
 * what turns that into the `null` the contract promises. See docs/tenancy.md.
 */
export function exactly(value: Prisma.Decimal): string;
export function exactly(value: Prisma.Decimal | null | undefined): string | null | undefined;
export function exactly(value: Prisma.Decimal | null | undefined): string | null | undefined {
  return value === null || value === undefined ? value : value.toFixed();
}

/**
 * One field of a `PATCH`, included only if it was sent.
 *
 * Tested against `undefined` specifically rather than for truthiness, so that a field whose
 * legitimate value is falsy — a `status` of `''` would be refused, but a `quantity` of `0` or
 * a `stockable` of `false` will not be — is not silently dropped by the helper every module
 * uses.
 */
export function defined<K extends string, V>(key: K, value: V): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}
