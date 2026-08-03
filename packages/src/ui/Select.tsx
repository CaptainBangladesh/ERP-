/**
 * A labelled dropdown, with the same accessibility wiring as `Field`.
 *
 * Here rather than in a module for the reason everything else here is: it knows nothing about
 * what it is choosing between. A status, a unit of measure, a supplier and a party's
 * organisation are the same control with different options, and the fourth screen to write it
 * by hand is the one that forgets `aria-describedby` — which is the whole reason a validation
 * message reaches somebody using a screen reader.
 *
 * It earns its place by the rule the rest of the shared package follows: parties wrote one of
 * these inside its own screen in ticket 05, and products is the second module to need it.
 */
export function Select({
  id,
  label,
  value,
  onChange,
  options,
  placeholder,
  error,
  hint,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  /**
   * The option meaning "nothing chosen", and what it says — "Any status" on a filter, "Choose
   * a unit…" on a form. Left out entirely when every choice is a real one.
   */
  placeholder?: string;
  error?: string;
  hint?: string;
  disabled?: boolean;
}) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : undefined, hint ? hintId : undefined]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-slate-900">
        {label}
      </label>

      <select
        id={id}
        name={id}
        value={value}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        onChange={(event) => onChange(event.target.value)}
        className={`w-full rounded-md border px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-900/20 disabled:bg-slate-50 disabled:text-slate-500 ${
          error ? 'border-red-500' : 'border-slate-300'
        }`}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      {hint && !error && (
        <p id={hintId} className="text-xs text-slate-500">
          {hint}
        </p>
      )}

      {error && (
        <p id={errorId} className="text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
