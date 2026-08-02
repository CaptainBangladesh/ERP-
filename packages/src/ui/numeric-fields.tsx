import { useState } from 'react';
import { Decimal } from '../numeric/decimal.js';
import { DEFAULT_CURRENCY, MONEY_SCALE, type MoneyValue } from '../numeric/money.js';
import { QUANTITY_SCALE } from '../numeric/quantity.js';
import { Field } from './Field.js';
import { currencySymbol, formatMoney, formatQuantity, isPartialDecimal } from './format.js';

/**
 * The inputs and displays for the two exact types, so that every module formats and validates
 * them the same way.
 *
 * The value in and out is always the **canonical decimal text** a `Decimal` parses, never a
 * `number` and never a formatted string. A component that handed a screen `1,234.50` would
 * have made the screen responsible for taking the comma back out before sending it, and one
 * screen in forty would forget.
 *
 * Checking happens twice on purpose and the two are not the same check. Here it is a
 * courtesy — telling somebody their amount is malformed while they are looking at the box.
 * On the server it is the rule. Neither substitutes for the other, and this one is allowed to
 * be lenient because it is not the one that decides.
 */

interface NumericFieldProps {
  id: string;
  label: string;
  /** Canonical decimal text, or `''`. The parent holds it; this never reformats it. */
  value: string;
  onChange: (value: string) => void;
  /** A message from the server, which wins over anything noticed here. */
  error?: string;
  hint?: string;
}

/**
 * An amount of money.
 *
 * Keystrokes are filtered to what could still become a valid amount, so a letter simply does
 * not appear rather than appearing and then being complained about. The complaint is saved
 * for blur, because telling somebody that `1.` is not a number while they are still typing
 * `1.5` is noise dressed as help.
 */
export function MoneyInput({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  currency = DEFAULT_CURRENCY,
}: NumericFieldProps & { currency?: string }) {
  return (
    <ExactField
      id={id}
      label={label}
      value={value}
      onChange={onChange}
      error={error}
      hint={hint}
      scale={MONEY_SCALE}
      prefix={currencySymbol(currency)}
      malformed={`Enter an amount, to at most ${MONEY_SCALE} decimal places.`}
    />
  );
}

/**
 * A quantity. No currency, and more decimal places, because a unit of measure is not always
 * something you can count — 2.5 kg and 0.75 hours are ordinary.
 */
export function QuantityInput({ id, label, value, onChange, error, hint }: NumericFieldProps) {
  return (
    <ExactField
      id={id}
      label={label}
      value={value}
      onChange={onChange}
      error={error}
      hint={hint}
      scale={QUANTITY_SCALE}
      malformed={`Enter a quantity, to at most ${QUANTITY_SCALE} decimal places.`}
    />
  );
}

function ExactField({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  scale,
  prefix,
  malformed,
}: NumericFieldProps & { scale: number; prefix?: string; malformed: string }) {
  const [visited, setVisited] = useState(false);

  // `-` and `1.` pass the keystroke filter and are not numbers. They are only worth
  // mentioning once the person has moved on and left one behind.
  const incomplete = visited && value !== '' && Decimal.tryParse(value) === undefined;

  return (
    <Field
      id={id}
      label={label}
      value={value}
      hint={hint}
      inputMode="decimal"
      prefix={prefix}
      error={error ?? (incomplete ? malformed : undefined)}
      onChange={(next) => {
        if (isPartialDecimal(next, scale)) onChange(next);
      }}
      onBlur={() => setVisited(true)}
    />
  );
}

/**
 * An amount, read.
 *
 * `null` — which is what a monetary field the caller may not read comes back as — renders as
 * a dash with an accessible name, rather than as an empty cell. An empty cell says "this
 * person earns nothing"; a dash announced as "hidden" says what is actually true.
 */
export function MoneyText({
  value,
  hidden = 'Hidden',
}: {
  value: MoneyValue | null | undefined;
  hidden?: string;
}) {
  if (!value) return <Withheld label={hidden} />;

  // `tabular-nums` so a column of amounts lines up on the decimal point. Digits in most
  // typefaces are proportional, which turns a column of money into a ragged edge.
  return <span className="tabular-nums">{formatMoney(value)}</span>;
}

export function QuantityText({
  value,
  hidden = 'Hidden',
}: {
  value: string | null | undefined;
  hidden?: string;
}) {
  if (value === null || value === undefined) return <Withheld label={hidden} />;
  return <span className="tabular-nums">{formatQuantity(value)}</span>;
}

function Withheld({ label }: { label: string }) {
  return (
    <span className="text-slate-400">
      <span aria-hidden="true">—</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
