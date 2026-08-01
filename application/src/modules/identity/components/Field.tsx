/**
 * A labelled input that can carry a message about itself.
 *
 * Hand-built with Tailwind, like everything else: the frontend dependency rule bars
 * anything that ships markup or CSS.
 *
 * The accessibility wiring is the point of extracting it. `aria-invalid` and
 * `aria-describedby` are what make a validation message reach somebody using a screen
 * reader, and they are exactly the two attributes that get forgotten when every form writes
 * its own inputs. Ticket 04 moves this into the shared workspace when a second module needs
 * a form.
 */
export function Field({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  type = 'text',
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  type?: 'text' | 'email' | 'password';
  autoComplete?: string;
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

      <input
        id={id}
        name={id}
        type={type}
        value={value}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        onChange={(event) => onChange(event.target.value)}
        className={`rounded-md border px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-900/20 ${
          error ? 'border-red-500' : 'border-slate-300'
        }`}
      />

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
