import { Decimal } from '../numeric/decimal.js';
import { MONEY_SCALE, type MoneyValue } from '../numeric/money.js';

/**
 * Turning exact values into something a person reads, without ever turning them into a
 * double on the way.
 *
 * `Intl.NumberFormat` would be the obvious tool and is not used for the digits. Its `format`
 * takes a `number`, which is the one thing these values must never become — `999999999999.99`
 * does not survive the trip. So the grouping is done here on the text, and `Intl` is asked
 * only for the currency symbol, which is a question about language rather than about
 * arithmetic.
 */

/**
 * `48000.1` → `48,000.10`.
 *
 * Padded up to `minimumFractionDigits` and rounded down to `maximumFractionDigits` — and
 * rounding here is a *display* decision, made at the last possible moment on a value that is
 * already final. Nothing computed from a formatted string; it exists to be read.
 */
export function formatDecimal(
  amount: string,
  options: { minimumFractionDigits?: number; maximumFractionDigits?: number } = {},
): string {
  const parsed = Decimal.tryParse(amount);
  // Not our business to refuse: a screen given something unformattable should show it
  // verbatim rather than blank, because a blank cell reads as "no value" and this is one.
  if (!parsed) return amount;

  const minimum = options.minimumFractionDigits ?? 0;
  const maximum = Math.max(options.maximumFractionDigits ?? parsed.scale, minimum);

  const scaled =
    parsed.scale > maximum
      ? parsed.round(maximum, 'half-even')
      : parsed.rescale(Math.max(parsed.scale, minimum));

  const text = scaled.toString();
  const negative = text.startsWith('-');
  const magnitude = negative ? text.slice(1) : text;
  const [whole = '', fraction] = magnitude.split('.');

  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const rendered = fraction === undefined ? grouped : `${grouped}.${fraction}`;

  return negative ? `-${rendered}` : rendered;
}

/** `{ amount: '48000.1', currency: 'GBP' }` → `£48,000.10`. */
export function formatMoney(value: MoneyValue): string {
  const digits = formatDecimal(value.amount, {
    minimumFractionDigits: MONEY_SCALE,
    maximumFractionDigits: MONEY_SCALE,
  });

  const symbol = currencySymbol(value.currency);
  const negative = digits.startsWith('-');
  const magnitude = negative ? digits.slice(1) : digits;

  // The sign goes outside the symbol — `-£5.00`, not `£-5.00` — because that is how a
  // negative amount is written and the other way reads as a typo.
  return `${negative ? '-' : ''}${symbol}${magnitude}`;
}

/** A quantity, grouped but not padded: `3` stays `3`, not `3.000000`. */
export function formatQuantity(amount: string): string {
  return formatDecimal(amount);
}

const SYMBOLS = new Map<string, string>();

/**
 * The symbol for a currency code, from the browser rather than from a table we would have to
 * keep. Falls back to the code itself, which is never wrong — only terse.
 */
export function currencySymbol(currency: string): string {
  const cached = SYMBOLS.get(currency);
  if (cached !== undefined) return cached;

  let symbol = currency;
  try {
    const parts = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
    }).formatToParts(0);

    symbol = parts.find((part) => part.type === 'currency')?.value ?? currency;
  } catch {
    // An unknown code throws rather than returning something. The code is the honest answer.
  }

  SYMBOLS.set(currency, symbol);
  return symbol;
}

/**
 * What a person is allowed to have typed *so far* into a decimal box.
 *
 * Deliberately more permissive than `Decimal.parse`: `-`, `1.` and `` are all on the way to
 * a valid number and rejecting a keystroke mid-way would make the box impossible to type in.
 * The value is checked properly on submit, and by the server regardless.
 */
export function isPartialDecimal(text: string, scale: number): boolean {
  if (text === '' || text === '-') return true;
  return new RegExp(`^-?\\d*(\\.\\d{0,${scale}})?$`).test(text);
}
