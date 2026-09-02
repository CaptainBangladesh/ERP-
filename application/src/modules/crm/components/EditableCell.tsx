import { useEffect, useRef, useState } from 'react';

/**
 * A table cell you can act on with one click and change with two.
 *
 * The two things people do with a cell on this board are *use* it and *fix* it, and they are
 * not equally common — an email address is clicked to write to somebody far more often than
 * it is retyped. So a single click follows the link, which is what the cell looks like it
 * does, and editing is the deliberate second click. Nothing is hidden behind that gesture
 * alone: hovering a cell reveals a pencil, which is also where the keyboard lands.
 *
 * Committing is forgiving about *how*: Enter, Tab, or clicking away all save, because all
 * three are things people do when they believe they are finished. Escape is the only way out
 * without saving, and a value that did not change saves nothing at all.
 */
export function EditableText({
  value,
  label,
  placeholder = '—',
  type = 'text',
  href,
  icon,
  display,
  canWrite,
  className = '',
  onSave,
}: {
  value: string | null;
  /** What a screen reader calls this cell — "Email of Priya Kapoor". */
  label: string;
  placeholder?: string;
  type?: 'text' | 'email' | 'tel';
  /** Makes the resting cell a link. `mailto:`, `tel:`, or an external address. */
  href?: (value: string) => string;
  /**
   * A glyph before the value, so a column is recognisable at a glance rather than by reading
   * its heading. Decorative only — it is never the sole carrier of what the cell means, which
   * is why it is hidden from screen readers and the `label` says the same thing in words.
   */
  icon?: string;
  /**
   * A shorter thing to *show* — a URL without its `https://www.`, say. Only ever affects the
   * resting cell: the editor and everything sent to the server stay the value as stored, so
   * shortening can never quietly rewrite what somebody typed.
   */
  display?: (value: string) => string;
  canWrite: boolean;
  className?: string;
  onSave: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);

  // A value changed elsewhere — the detail panel, another editor — should show here once the
  // cell is not being typed into. Reseeding mid-edit would delete what somebody is writing.
  useEffect(() => {
    if (!editing) {
      setDraft(value ?? '');
      try {
        localStorage.removeItem(`erp_autosave_cell_${label}`);
      } catch {}
    }
  }, [value, editing, label]);

  useEffect(() => {
    if (editing && draft && draft !== (value ?? '')) {
      try {
        localStorage.setItem(`erp_autosave_cell_${label}`, draft);
      } catch {}
    }
  }, [editing, draft, value, label]);

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  function commit() {
    const next = draft.trim();
    if (type === 'email' && next && !next.includes('@')) {
      setError('Enter a valid email address');
      setDraft(value ?? '');
      setEditing(false);
      return;
    }
    setError(undefined);
    setEditing(false);
    if (next === (value ?? '')) return;
    onSave(next);
  }

  function cancel() {
    setDraft(value ?? '');
    setError(undefined);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-1 w-full">
        <input
          ref={input}
          autoFocus
          type={type}
          aria-label={label}
          value={draft}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit();
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              cancel();
            }
          }}
          className="w-full rounded border border-teal-600 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-teal-600"
        />
      </div>
    );
  }

  const glyph = icon ? (
    <span aria-hidden="true" className={`shrink-0 ${value ? '' : 'opacity-30'}`}>
      {icon}
    </span>
  ) : null;

  const resting =
    value === null || value === '' ? (
      <span className="text-slate-400">{placeholder}</span>
    ) : href ? (
      <a
        href={href(value)}
        rel="noopener noreferrer"
        draggable={false}
        onClick={(event) => event.stopPropagation()}
        className={`min-w-0 truncate hover:underline ${className}`}
        title={href(value)}
      >
        {display ? display(value) : value}
      </a>
    ) : (
      <span className={`min-w-0 truncate ${className}`}>{display ? display(value) : value}</span>
    );

  return (
    <span className="flex flex-col gap-0.5 min-w-0">
      <span
        onDoubleClick={() => {
          if (!canWrite) return;
          setError(undefined);
          setEditing(true);
        }}
        className={`group/cell flex min-w-0 items-center gap-1 ${
          canWrite ? 'cursor-pointer select-none rounded p-0.5 hover:bg-slate-100/70' : ''
        }`}
      >
        {glyph}
        {resting}
        {canWrite && (
          <button
            type="button"
            aria-label={`Edit ${label}`}
            title="Edit — or double-click the cell"
            onClick={(event) => {
              event.stopPropagation();
              setError(undefined);
              setEditing(true);
            }}
            /*
              Revealed on hover and on focus, which is what the note at the top of this file
              has always claimed and what the other cell below already did. Drawn at rest, it
              was a second mark in every editable cell on every row — a column of pencils
              beside a column of addresses, none of which anybody reads — and it made a cell
              that is *already* editable by double-click look like it needed the button.

              `opacity` rather than `hidden`: the button keeps its space, so revealing it does
              not shift the text beside it, and it keeps its tab stop, so the keyboard reaches
              editing whether or not a pointer ever hovers the row.
            */
            className="shrink-0 rounded px-1 min-w-[20px] text-center text-slate-400 opacity-0 transition group-hover/cell:opacity-100 hover:bg-slate-100 hover:text-slate-600 focus:opacity-100 focus:outline-none focus:ring-1 focus:ring-teal-600"
          >
            ✎
          </button>
        )}
      </span>
      {error && <span role="alert" className="text-xs text-rose-600 font-medium">{error}</span>}
    </span>
  );
}

/**
 * The same idea for a fixed set of choices. Resting as text rather than as a permanent
 * dropdown keeps a row of cells reading as a row rather than as a form, and means an
 * accidental click cannot change a value.
 */
export function EditableSelect({
  value,
  label,
  placeholder = '—',
  options,
  icon,
  canWrite,
  render,
  onSave,
}: {
  value: string | null;
  label: string;
  placeholder?: string;
  options: { value: string; label: string }[];
  /** Decorative, as on `EditableText` — the `label` carries the meaning. */
  icon?: string;
  canWrite: boolean;
  /** How the chosen option looks at rest — a coloured pill, say. Plain text if not given. */
  render?: (option: { value: string; label: string }) => React.ReactNode;
  onSave: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const chosen = options.find((option) => option.value === value);

  const resting = (
    <>
      {icon && (
        <span aria-hidden="true" className={`shrink-0 ${chosen ? '' : 'opacity-30'}`}>
          {icon}
        </span>
      )}
      {chosen ? (
        render ? (
          render(chosen)
        ) : (
          <span className="truncate">{chosen.label}</span>
        )
      ) : (
        <span className="text-slate-400">{placeholder}</span>
      )}
    </>
  );

  if (!canWrite) return <span className="flex items-center gap-1">{resting}</span>;

  if (editing) {
    return (
      <select
        autoFocus
        aria-label={label}
        value={value ?? ''}
        onChange={(event) => {
          setEditing(false);
          if (event.target.value !== (value ?? '')) onSave(event.target.value);
        }}
        onBlur={() => setEditing(false)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setEditing(false);
        }}
        className="w-full cursor-pointer rounded border border-teal-600 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-teal-600"
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  return (
    <span
      className="group/cell flex min-w-0 items-center gap-1"
      onDoubleClick={() => setEditing(true)}
    >
      {resting}
      <button
        type="button"
        aria-label={`Edit ${label}`}
        title="Edit — or double-click the cell"
        onClick={() => setEditing(true)}
        className="shrink-0 rounded p-0.5 text-slate-300 opacity-0 transition group-hover/cell:opacity-100 hover:bg-slate-100 hover:text-slate-600 focus:opacity-100 focus:outline-none focus:ring-1 focus:ring-teal-600"
      >
        ✎
      </button>
    </span>
  );
}
