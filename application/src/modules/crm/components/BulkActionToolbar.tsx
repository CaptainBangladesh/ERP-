import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * What a board selection can be spent on.
 *
 * It floats at the foot of the viewport rather than sitting in the flow at the top, and that is
 * the whole of the redesign. The previous bar was a sticky strip above the table: it appeared by
 * pushing the board down, so ticking a checkbox moved the row under the cursor, and it competed
 * for the eye with the column headers immediately below it. A selection is a *mode*, not a
 * section of the page — it belongs on a layer above the work, near the pointer that made it, and
 * gone the instant the selection is.
 *
 * Everything on it is an icon over a word. The bare `<select>`s it replaces read as fields to
 * fill in, which is wrong twice: they look like part of a form the board does not have, and a
 * dropdown gives no clue that "Assign owner" and "Delete" are the same kind of thing. Icons put
 * the actions on one row at one weight, and the count sits at the left so the sentence reads
 * "9 leads selected — email them, assign them, move them".
 *
 * Every act here is reversible by repeating it with a different value. The two that are not —
 * Delete, and a mass email once it is out — ask again before they happen; Delete inline here,
 * the email in its own dialog.
 *
 * The dropdowns are popovers with a visually-hidden `<select>` behind each. The select is not a
 * fallback — it *is* the control: it holds the tab stop and the accessible name, and the popover
 * beside it is the sighted affordance, taken out of the tab order so a keyboard meets one thing
 * per menu instead of two that look different and do the same job.
 *
 * `BulkNotice` sits above it, in the same fixed stack. Moving the bar down here and leaving its
 * feedback at the top of the page would have been half a change: the reason the bar is at the
 * foot of the viewport is that the pointer is, and so are the eyes.
 */
export function BulkActionToolbar({
  count,
  groups,
  users,
  isBusy,
  onMassEmail,
  onAddToSequence,
  onAssign,
  onMove,
  onExport,
  onArchive,
  onDelete,
  onClear,
}: {
  count: number;
  groups: { id: string; name: string }[];
  users: { id: string; name: string }[];
  isBusy: boolean;
  onMassEmail: () => void;
  onAddToSequence: () => void;
  /** The complete set to assign every selected lead to. `[]` takes them all off. */
  onAssign: (userIds: string[]) => void;
  onMove: (groupId: string) => void;
  onExport: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const [openMenu, setOpenMenu] = useState<'assign' | 'move'>();
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  // A confirmation is about the selection it was asked for. Change the selection and it lapses.
  useEffect(() => {
    setIsConfirmingDelete(false);
    setOpenMenu(undefined);
  }, [count]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (barRef.current && !barRef.current.contains(event.target as Node)) setOpenMenu(undefined);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpenMenu(undefined);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return (
    <div
      ref={barRef}
      role="toolbar"
      aria-label="Actions for the selected leads"
      className="flex items-center gap-1 rounded-2xl border border-slate-700 bg-slate-900 px-3 py-2 text-white shadow-lg"
    >
      <span className="mr-2 flex items-center gap-2 whitespace-nowrap pl-1 pr-2 text-xs font-semibold text-slate-200">
        <span className="flex size-5 items-center justify-center rounded-full bg-teal-500 text-[10px] font-bold text-slate-900 tabular-nums">
          {count}
        </span>
        {count === 1 ? 'lead' : 'leads'} selected
      </span>

      <ToolbarButton icon="✉" label="Mass email" onClick={onMassEmail} disabled={isBusy} />
      <ToolbarButton icon="≡" label="Add to sequence" onClick={onAddToSequence} disabled={isBusy} />

      <AssignMenu
        isOpen={openMenu === 'assign'}
        onToggle={() => setOpenMenu((open) => (open === 'assign' ? undefined : 'assign'))}
        disabled={isBusy}
        users={users}
        onApply={(userIds) => {
          onAssign(userIds);
          setOpenMenu(undefined);
        }}
      />

      <ToolbarMenu
        icon="→"
        label="Move to"
        selectLabel="Move selected leads to group"
        isOpen={openMenu === 'move'}
        onToggle={() => setOpenMenu((open) => (open === 'move' ? undefined : 'move'))}
        disabled={isBusy || groups.length === 0}
        options={groups}
        onPick={(id) => {
          onMove(id);
          setOpenMenu(undefined);
        }}
      />

      <ToolbarButton icon="⭳" label="Export" onClick={onExport} disabled={isBusy} />
      <ToolbarButton icon="⧉" label="Archive" onClick={onArchive} disabled={isBusy} />

      {isConfirmingDelete ? (
        <span className="flex items-center gap-2 rounded-lg bg-rose-950/60 px-2 py-1 text-xs font-semibold text-rose-200">
          Delete {count} for good?
          <button
            type="button"
            onClick={onDelete}
            disabled={isBusy}
            className="rounded-md bg-rose-600 px-2 py-1 text-xs font-bold text-white transition hover:bg-rose-500 disabled:opacity-50"
          >
            {isBusy ? 'Deleting…' : 'Delete'}
          </button>
          <button
            type="button"
            onClick={() => setIsConfirmingDelete(false)}
            className="font-medium text-slate-300 hover:text-white"
          >
            Keep
          </button>
        </span>
      ) : (
        <ToolbarButton
          icon="🗑"
          label="Delete"
          tone="danger"
          onClick={() => setIsConfirmingDelete(true)}
          disabled={isBusy}
        />
      )}

      <span aria-hidden="true" className="mx-1 h-6 w-px bg-slate-700" />

      <button
        type="button"
        aria-label="Clear selection"
        onClick={onClear}
        className="rounded-lg px-2 py-2 text-sm text-slate-400 transition hover:bg-slate-800 hover:text-white"
      >
        ✕
      </button>
    </div>
  );
}

/**
 * What the last bulk act did, in the same corner of the screen as the bar that did it.
 *
 * A component of its own rather than a slot on the toolbar, because the two acts most worth
 * reporting — Archive and Delete — end with nothing selected, and a notice living inside the
 * toolbar would be unmounted by the very thing it had to describe.
 *
 * Dismissable, and not on a timer: "Archived 8 of 9. 1 refused" is a sentence somebody may want
 * to finish reading, and a message that removes itself while being read is worse than one that
 * waits to be dismissed.
 */
export function BulkNotice({ children, onDismiss }: { children: string; onDismiss: () => void }) {
  return (
    <p
      role="status"
      aria-live="polite"
      className="flex max-w-md items-start gap-2 rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-xs font-semibold text-teal-900 shadow-md"
    >
      {children}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="ml-auto shrink-0 rounded px-1 text-teal-700 transition hover:bg-teal-100 hover:text-teal-900"
      >
        ✕
      </button>
    </p>
  );
}

/** The fixed stack both of them live in, so there is one place that decides where "here" is. */
export function BulkLayer({ children }: { children: ReactNode }) {
  return (
    <div className="fixed bottom-6 left-1/2 z-40 flex w-max max-w-[92vw] -translate-x-1/2 flex-col items-center gap-2">
      {children}
    </div>
  );
}

/** Taking a lead off somebody is a choice, not the absence of one, so it needs a value of its
 *  own — sharing the placeholder's empty string would make the two indistinguishable. */
export const UNASSIGN = '__unassign__';

function ToolbarButton({
  icon,
  label,
  onClick,
  disabled,
  tone = 'normal',
  decorative = false,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'normal' | 'danger';
  /** This button is the visible face of a real control elsewhere; the pointer only. */
  decorative?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      {...(decorative ? { tabIndex: -1, 'aria-hidden': true } : {})}
      className={`flex min-w-[62px] flex-col items-center gap-0.5 rounded-lg px-2.5 py-1.5 text-[10px] font-semibold transition disabled:opacity-40 ${
        tone === 'danger'
          ? 'text-rose-300 hover:bg-rose-950/60 hover:text-rose-200'
          : 'text-slate-300 hover:bg-slate-800 hover:text-white'
      }`}
    >
      <span aria-hidden="true" className="text-sm leading-none">
        {icon}
      </span>
      {label}
    </button>
  );
}

/**
 * The Assign-owner menu, multi-select — a lead can be worked by several people, and a bulk assign
 * should be able to say so in one act. Ticking people builds a set without closing the menu;
 * "Assign to N" applies it to every selected lead (replacing whatever they had). "Unassigned"
 * clears them all, and applies at once because there is nothing left to add to it.
 *
 * Behind it is the same visually-hidden `<select>` the other menu keeps — the tab stop and the
 * accessible name — but single-choice, because a native multi-select is a poor keyboard control;
 * choosing one person there assigns exactly that person, which is the sensible one-key default.
 */
function AssignMenu({
  isOpen,
  onToggle,
  disabled,
  users,
  onApply,
}: {
  isOpen: boolean;
  onToggle: () => void;
  disabled?: boolean;
  users: { id: string; name: string }[];
  onApply: (userIds: string[]) => void;
}) {
  const [pending, setPending] = useState<string[]>([]);

  // Start each visit from the current selection's blank slate — a set left over from last time
  // would silently widen the next assign.
  useEffect(() => {
    if (isOpen) setPending([]);
  }, [isOpen]);

  const toggle = (id: string) =>
    setPending((set) => (set.includes(id) ? set.filter((x) => x !== id) : [...set, id]));

  return (
    <div className="relative">
      <select
        aria-label="Assign selected leads to"
        value=""
        disabled={disabled}
        onChange={(event) => {
          if (!event.target.value) return;
          onApply(event.target.value === UNASSIGN ? [] : [event.target.value]);
        }}
        className="sr-only"
      >
        <option value="" disabled>
          Assign owner
        </option>
        <option value={UNASSIGN}>Unassigned</option>
        {users.map((user) => (
          <option key={user.id} value={user.id}>
            {user.name}
          </option>
        ))}
      </select>

      {/*
        Unlike the single-choice menus, this trigger is a real, focusable button (not the
        aria-hidden "face" pattern): the popover is the *only* way to pick several people, so a
        keyboard has to be able to open it. The hidden <select> above stays as the one-key path to
        assign a single owner.
      */}
      <ToolbarButton icon="◎" label="Assign owner" onClick={onToggle} disabled={disabled} />

      {isOpen && (
        <div className="absolute bottom-full left-1/2 mb-2 flex max-h-72 w-56 -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-800 shadow-lg">
          <div className="max-h-52 overflow-y-auto p-1">
            <button
              type="button"
              onClick={() => onApply([])}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-xs font-semibold text-slate-600 transition hover:bg-slate-100"
            >
              <span className="flex size-4 shrink-0 items-center justify-center rounded border border-dashed border-slate-300 text-[9px] text-slate-400">
                ✕
              </span>
              Unassigned
            </button>

            {users.length === 0 ? (
              <p className="px-3 py-2 text-xs text-slate-500">Nobody to assign yet.</p>
            ) : (
              users.map((user) => {
                const checked = pending.includes(user.id);
                return (
                  <button
                    key={user.id}
                    type="button"
                    aria-pressed={checked}
                    onClick={() => toggle(user.id)}
                    className={`flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-xs font-semibold transition ${
                      checked ? 'bg-teal-50 text-teal-900' : 'hover:bg-slate-100'
                    }`}
                  >
                    <span
                      className={`flex size-4 shrink-0 items-center justify-center rounded border text-[9px] ${
                        checked ? 'border-teal-600 bg-teal-600 text-white' : 'border-slate-300 text-transparent'
                      }`}
                    >
                      ✓
                    </span>
                    <span className="truncate">{user.name}</span>
                  </button>
                );
              })
            )}
          </div>

          <div className="border-t border-slate-100 p-1.5">
            <button
              type="button"
              disabled={pending.length === 0}
              onClick={() => onApply(pending)}
              className="w-full rounded-lg bg-teal-700 px-2 py-1.5 text-xs font-bold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {pending.length === 0
                ? 'Pick people to assign'
                : `Assign to ${pending.length} ${pending.length === 1 ? 'person' : 'people'}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ToolbarMenu({
  icon,
  label,
  selectLabel,
  isOpen,
  onToggle,
  disabled,
  options,
  onPick,
}: {
  icon: ReactNode;
  label: string;
  /** What the hidden `<select>` is called. Keyboard and screen-reader users get this, not the popover. */
  selectLabel: string;
  isOpen: boolean;
  onToggle: () => void;
  disabled?: boolean;
  options: { id: string; name: string }[];
  onPick: (id: string) => void;
}) {
  return (
    <div className="relative">
      <select
        aria-label={selectLabel}
        value=""
        disabled={disabled}
        onChange={(event) => event.target.value && onPick(event.target.value)}
        className="sr-only"
      >
        <option value="" disabled>
          {label}
        </option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>

      {/*
        The select above is the control; this is its face. So the button is taken *out* of the
        tab order and hidden from the accessibility tree, leaving exactly one stop per menu
        rather than two that look like different controls and do the same thing. The earlier
        cut had it the other way round — `tabIndex={-1}` on the select — which left the claim
        that a keyboard reaches this menu true of nothing.
      */}
      <ToolbarButton
        icon={icon}
        label={label}
        onClick={onToggle}
        disabled={disabled}
        decorative
      />

      {isOpen && (
        <div className="absolute bottom-full left-1/2 mb-2 max-h-64 w-52 -translate-x-1/2 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 text-slate-800 shadow-lg">
          {options.length === 0 ? (
            <p className="px-3 py-2 text-xs text-slate-500">Nothing to choose yet.</p>
          ) : (
            options.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => onPick(option.id)}
                className="flex w-full items-center rounded-lg px-3 py-1.5 text-left text-xs font-semibold transition hover:bg-slate-100"
              >
                {option.name}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
