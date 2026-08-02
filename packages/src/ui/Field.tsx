import { useState, type Ref } from 'react';

/**
 * A labelled input that can carry a message about itself.
 *
 * Hand-built with Tailwind, like everything else: the frontend dependency rule bars
 * anything that ships markup or CSS.
 *
 * The accessibility wiring is the point of extracting it. `aria-invalid` and
 * `aria-describedby` are what make a validation message reach somebody using a screen
 * reader, and they are exactly the two attributes that get forgotten when every form writes
 * its own inputs. Ticket 03 wrote it inside identity and said it would move here when a
 * second module needed a form; ticket 04 is that move, and `MoneyInput` and `QuantityInput`
 * are built on it rather than beside it.
 *
 * A `password` field gets its reveal toggle here rather than from whoever renders it, so
 * every password input in every later module has one by construction. A component that had
 * to be *remembered* would be missing from the fortieth form.
 */
export function Field({
  id,
  label,
  value,
  onChange,
  onBlur,
  error,
  hint,
  type = 'text',
  autoComplete,
  inputRef,
  prefix,
  inputMode,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string;
  hint?: string;
  type?: 'text' | 'email' | 'password';
  autoComplete?: string;
  inputRef?: Ref<HTMLInputElement>;
  /**
   * Fixed text inside the box, ahead of what is typed — a currency symbol, and so far
   * nothing else. `aria-hidden`, because it is part of the field's meaning rather than a
   * second thing to announce, and the label already carries that meaning.
   */
  prefix?: string;
  /** The keyboard a phone offers. `decimal` for an amount, so the point is reachable. */
  inputMode?: 'decimal' | 'numeric';
}) {
  const [revealed, setRevealed] = useState(false);
  /**
   * Caps Lock is the classic silent failure of a masked box: the password looks identical
   * either way, so the only feedback is a refusal that blames the password. Only shown
   * while the field has focus — a warning about a keyboard nobody is typing on is noise.
   */
  const [capsLock, setCapsLock] = useState(false);
  const [focused, setFocused] = useState(false);

  const isPassword = type === 'password';
  const warnAboutCapsLock = isPassword && focused && capsLock;
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

      <div className="relative">
        {prefix && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-sm text-slate-500"
          >
            {prefix}
          </span>
        )}

        <input
          id={id}
          name={id}
          ref={inputRef}
          type={isPassword && revealed ? 'text' : type}
          value={value}
          inputMode={inputMode}
          autoComplete={autoComplete}
          // A revealed password is an ordinary text box as far as the browser is
          // concerned, so the helpfulness has to be switched off by hand — otherwise it
          // gets autocapitalised, autocorrected, and underlined as a spelling mistake.
          autoCapitalize={isPassword ? 'off' : undefined}
          autoCorrect={isPassword ? 'off' : undefined}
          spellCheck={isPassword ? false : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          onChange={(event) => onChange(event.target.value)}
          // Read from the event rather than tracked as a keypress of its own, so it is
          // right even when Caps Lock was already on before the field was reached.
          onKeyDown={(event) => setCapsLock(event.getModifierState('CapsLock'))}
          onKeyUp={(event) => setCapsLock(event.getModifierState('CapsLock'))}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            onBlur?.();
          }}
          // The left padding clears the prefix when there is one. Measured in characters
          // rather than pixels so a two-character code — `Kč`, or a bare `USD` where no
          // narrow symbol exists — does not sit under the caret.
          style={prefix ? { paddingLeft: `${prefix.length + 1.5}ch` } : undefined}
          className={`w-full rounded-md border py-2 pl-3 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-900/20 ${
            isPassword ? 'pr-11' : 'pr-3'
          } ${error ? 'border-red-500' : 'border-slate-300'}`}
        />

        {isPassword && (
          <button
            // Not a submit button. Inside a form, a button without this reloads the page.
            type="button"
            // The accessible name changes rather than carrying `aria-pressed` as well:
            // announcing "hide password, pressed" says the same thing twice and leaves a
            // screen reader user working out which half to believe.
            aria-label={revealed ? 'Hide password' : 'Show password'}
            // Deliberately toggles rather than revealing while held. Somebody checking a
            // long password needs both hands, and needs it to stay visible while they read.
            onClick={() => setRevealed(!revealed)}
            className="absolute inset-y-0 right-0 flex items-center rounded-r-md px-3 text-slate-500 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20"
          >
            {revealed ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        )}
      </div>

      {/*
        A warning, not a validation failure — so no `aria-invalid`, no red, and no place in
        `aria-describedby`. Nothing is wrong yet; something is about to go wrong.
        `role="status"` announces it at the moment it starts mattering.
      */}
      {warnAboutCapsLock && (
        <p role="status" className="text-xs text-amber-700">
          Caps Lock is on.
        </p>
      )}

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

/**
 * Inline rather than from an icon package — the dependency rule bars anything shipping
 * markup. `aria-hidden` because the button beside them already has a name; announcing the
 * graphic too would read the control out twice.
 */
function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.7 5.1A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a18.4 18.4 0 0 1-2.4 3.4M6.2 6.2A18.3 18.3 0 0 0 2 12s3.6 7 10 7a10.4 10.4 0 0 0 5.8-1.8" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="m2 2 20 20" />
    </svg>
  );
}
