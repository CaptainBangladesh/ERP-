import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  LEAD_STATUS_LABEL_PATHS,
  type CreateLeadStatusLabelRequest,
  type LeadStatusKey,
  type LeadStatusLabelSummary,
  type UpdateLeadStatusLabelRequest,
} from '@erp/shared';
import { ApiFailure, api } from '../../../api/client';
import { LEAD_VOCABULARY_KEY, useLeadStatusLabels, type StatusLabel } from '../vocabulary';

/**
 * The status cell on the board: a coloured pill that opens the whole status vocabulary.
 *
 * Choosing a status and *maintaining* the statuses used to be two screens — a select in the row,
 * and an "Edit labels" dialog three clicks away in the toolbar. That split is backwards. The
 * moment a person discovers they need a stage between Contacted and Qualified is the moment they
 * are filing a lead, with the picker already open; sending them to a different dialog to add it
 * means the lead in front of them gets the nearest wrong status instead.
 *
 * So one surface does both. Pick a status, rename one, recolour one, add one, remove one —
 * without the board moving underneath.
 *
 * What it will not do is set `qualified` or `disqualified`. Those are shown, because a board
 * that hid two of its own statuses would be lying about where leads can be, but they are shown
 * as locked with the act that reaches them named: qualifying is what creates the Party link, and
 * a status set without it would be a lead claiming to be a customer that no customer record
 * exists for. The old select offered all four and the API rejected two of them, silently.
 */
export function StatusPicker({
  status,
  leadName,
  canWrite,
  onChange,
}: {
  status: LeadStatusKey;
  leadName: string;
  canWrite: boolean;
  onChange: (status: LeadStatusKey) => void;
}) {
  const vocabulary = useLeadStatusLabels();
  const current = vocabulary.of(status);

  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  /**
   * The menu is drawn into a portal on `document.body`, because the board wraps every group in
   * an `overflow-hidden` section over an `overflow-x-auto` table — either clips an absolutely
   * positioned child, so on the lower rows the menu was cut off with nowhere to grow. Flipping
   * it upward only dodged the *viewport* edge, not the section's clip. Portalled and `fixed`, it
   * escapes both; the cost is placing it by hand from the trigger's rect.
   */
  const [coords, setCoords] = useState<{ left: number; top: number; flip: boolean } | null>(null);

  const positionMenu = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const menuWidth = 288; // w-72
    const estimatedHeight = menuRef.current?.offsetHeight ?? 320;
    const gap = 6;
    const spaceBelow = window.innerHeight - rect.bottom;
    const flip = spaceBelow < estimatedHeight + gap && rect.top > spaceBelow;
    // Centre the menu on the trigger, as the old `left-1/2 -translate-x-1/2` did, then keep it
    // on-screen.
    const centred = rect.left + rect.width / 2 - menuWidth / 2;
    const left = Math.min(Math.max(8, centred), Math.max(8, window.innerWidth - menuWidth - 8));
    const top = flip ? rect.top - gap : rect.bottom + gap;
    setCoords({ left, top, flip });
  };

  useEffect(() => {
    if (!isOpen) return;

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      // The menu is portalled, so "inside" is the trigger or the menu — not `containerRef` alone.
      if (containerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setIsOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsOpen(false);
    }

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen]);

  // Place the menu against the trigger on open, and keep it there as the page scrolls or resizes
  // — a `fixed` element does not move with the document on its own.
  useLayoutEffect(() => {
    if (!isOpen) {
      setCoords(null);
      return;
    }
    positionMenu();
    const reposition = () => positionMenu();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={`Status of ${leadName}`}
        disabled={!canWrite}
        onClick={() => setIsOpen((open) => !open)}
        style={{ backgroundColor: current.color }}
        className="inline-flex w-32 items-center justify-center gap-1.5 rounded-lg px-3 py-1 text-xs font-bold text-white shadow-2xs transition hover:brightness-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/30 disabled:cursor-default disabled:hover:brightness-100"
      >
        <span className="truncate">{current.label}</span>
        {canWrite && (
          <span aria-hidden="true" className="text-[8px] opacity-80">
            ▼
          </span>
        )}
      </button>

      {isOpen &&
        createPortal(
          <StatusMenu
            menuRef={menuRef}
            coords={coords}
            vocabulary={vocabulary}
            current={current}
            onPick={(next) => {
              setIsOpen(false);
              if (next !== status) onChange(next);
            }}
            onClose={() => setIsOpen(false)}
          />,
          document.body,
        )}
    </div>
  );
}

/**
 * The three writes the vocabulary supports, and the failure they report through.
 *
 * A hook rather than three `useMutation` calls copied into each surface: the cache key to
 * invalidate is the same for all three, and a surface that forgot it would keep showing a
 * status somebody just renamed.
 */
export function useStatusVocabularyWrites() {
  const queryClient = useQueryClient();
  const [failure, setFailure] = useState<string>();

  const refresh = () => queryClient.invalidateQueries({ queryKey: LEAD_VOCABULARY_KEY });
  const report = (error: unknown) =>
    setFailure(error instanceof ApiFailure ? error.message : 'That did not save.');
  const succeeded = () => {
    setFailure(undefined);
    refresh();
  };

  const save = useMutation({
    mutationFn: ({ status, ...change }: { status: LeadStatusKey } & UpdateLeadStatusLabelRequest) =>
      api.patch<LeadStatusLabelSummary>(LEAD_STATUS_LABEL_PATHS.label(status), change),
    onSuccess: succeeded,
    onError: report,
  });

  const add = useMutation({
    mutationFn: (body: CreateLeadStatusLabelRequest) =>
      api.post<LeadStatusLabelSummary>(LEAD_STATUS_LABEL_PATHS.labels, body),
    onSuccess: succeeded,
    onError: report,
  });

  const remove = useMutation({
    mutationFn: (status: LeadStatusKey) => api.delete(LEAD_STATUS_LABEL_PATHS.label(status)),
    onSuccess: succeeded,
    onError: report,
  });

  return { save, add, remove, failure, clearFailure: () => setFailure(undefined) };
}

/** The colour a newly added status wears before anybody picks one. */
export function nextColour(index: number): string {
  return NEXT_COLOURS[index % NEXT_COLOURS.length]!;
}

/**
 * The open panel. Split out so the whole of it unmounts on close — the edit and add forms hold
 * draft text, and a draft that survives being dismissed reappears later looking like a bug.
 */
function StatusMenu({
  vocabulary,
  current,
  menuRef,
  coords,
  onPick,
  onClose,
}: {
  vocabulary: ReturnType<typeof useLeadStatusLabels>;
  current: StatusLabel;
  menuRef: RefObject<HTMLDivElement | null>;
  coords: { left: number; top: number; flip: boolean } | null;
  onPick: (status: LeadStatusKey) => void;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState<LeadStatusKey>();
  const [isAdding, setIsAdding] = useState(false);
  const { save, add, remove, failure, clearFailure } = useStatusVocabularyWrites();

  useEffect(() => {
    if (add.isSuccess) setIsAdding(false);
  }, [add.isSuccess]);

  return (
    <div
      ref={menuRef}
      role="menu"
      style={{
        position: 'fixed',
        left: coords?.left ?? -9999,
        top: coords?.top ?? -9999,
        transform: coords?.flip ? 'translateY(-100%)' : undefined,
        visibility: coords ? 'visible' : 'hidden',
      }}
      className="z-50 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg"
    >
      <div className="max-h-72 overflow-y-auto py-1">
        {vocabulary.list.map((item) =>
          editing === item.status ? (
            <StatusEditor
              key={item.status}
              item={item}
              busy={save.isPending || remove.isPending}
              onSave={(change) => {
                save.mutate({ status: item.status, ...change });
                setEditing(undefined);
              }}
              onDelete={item.isCustom ? () => remove.mutate(item.status) : undefined}
              onCancel={() => setEditing(undefined)}
            />
          ) : (
            <StatusRow
              key={item.status}
              item={item}
              isCurrent={item.status === current.status}
              onPick={() => onPick(item.status)}
              onEdit={() => {
                clearFailure();
                setEditing(item.status);
              }}
            />
          ),
        )}
      </div>

      {failure && (
        <p role="alert" className="border-t border-red-100 bg-red-50 px-3 py-2 text-[11px] font-medium text-red-700">
          {failure}
        </p>
      )}

      <div className="border-t border-slate-200 bg-slate-50/70 p-1.5">
        {isAdding ? (
          <StatusEditor
            item={{ status: '', label: '', color: nextColour(vocabulary.list.length), isCustom: true, order: 0, isSettable: true }}
            busy={add.isPending}
            onSave={(change) => add.mutate({ label: change.label ?? '', color: change.color ?? '#64748b' })}
            onCancel={() => setIsAdding(false)}
          />
        ) : (
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                clearFailure();
                setIsAdding(true);
              }}
              className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-teal-700 transition hover:bg-teal-50"
            >
              <span aria-hidden="true">+</span> Add status
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-2 py-1.5 text-[11px] font-semibold text-slate-400 transition hover:text-slate-600"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * One status in the list.
 *
 * The row is the choose action and the pencil is the edit action, rather than a mode switch at
 * the top of the panel: the common case by far is picking, and a panel that has to be put into
 * "edit mode" first makes the rare thing cost the same as the frequent one.
 */
export function StatusRow({
  item,
  isCurrent,
  onPick,
  onEdit,
}: {
  item: StatusLabel;
  isCurrent: boolean;
  onPick: () => void;
  onEdit: () => void;
}) {
  return (
    <div className="group flex items-center gap-1 px-1">
      <button
        type="button"
        role="menuitem"
        onClick={onPick}
        disabled={!item.isSettable}
        title={item.isSettable ? undefined : LOCKED_HINT[item.status] ?? 'Set by an action, not by editing.'}
        className="flex flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition enabled:hover:bg-slate-50 disabled:cursor-not-allowed"
      >
        <span
          aria-hidden="true"
          style={{ backgroundColor: item.color }}
          className={`h-3 w-3 shrink-0 rounded-full ${item.isSettable ? '' : 'opacity-40'}`}
        />
        <span className={`flex-1 truncate text-xs font-semibold ${item.isSettable ? 'text-slate-700' : 'text-slate-400'}`}>
          {item.label}
        </span>

        {isCurrent && (
          <span aria-hidden="true" className="text-xs font-bold text-teal-600">
            ✓
          </span>
        )}
        {!item.isSettable && (
          <span aria-hidden="true" className="text-[10px] text-slate-300">
            🔒
          </span>
        )}
      </button>

      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit ${item.label}`}
        className="rounded-md p-1.5 text-slate-300 opacity-0 transition hover:bg-slate-100 hover:text-slate-600 focus:opacity-100 focus:outline-none group-hover:opacity-100"
      >
        <PencilIcon />
      </button>
    </div>
  );
}

/**
 * Renaming, recolouring, or naming a new status. One component for both because they are the
 * same two fields — the only difference is whether there is a row behind them yet.
 *
 * The colour is a native `<input type="color">` plus a row of the palette the built-in statuses
 * already use. The swatches are what people actually reach for; the picker is there for the one
 * company whose brand green is a specific green.
 */
export function StatusEditor({
  item,
  busy,
  onSave,
  onDelete,
  onCancel,
}: {
  item: StatusLabel;
  busy: boolean;
  onSave: (change: { label?: string; color?: string }) => void;
  onDelete?: () => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(item.label);
  const [color, setColor] = useState(item.color);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.select(), []);

  const isNew = item.status === '';
  const canSave = label.trim().length > 0 && !busy;

  function commit() {
    if (!canSave) return;
    onSave({ label: label.trim(), color });
  }

  return (
    <div className="m-1 flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-2 shadow-2xs">
      <div className="flex items-center gap-2">
        <label className="relative shrink-0">
          <span className="sr-only">{isNew ? 'Colour for the new status' : `Colour for ${item.label}`}</span>
          <span
            aria-hidden="true"
            style={{ backgroundColor: color }}
            className="block h-7 w-7 rounded-md border border-slate-300 shadow-2xs"
          />
          <input
            type="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>

        <input
          ref={inputRef}
          type="text"
          value={label}
          maxLength={60}
          placeholder={isNew ? 'e.g. In negotiation' : undefined}
          aria-label={isNew ? 'New status name' : `Name for ${item.label}`}
          onChange={(event) => setLabel(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit();
            if (event.key === 'Escape') onCancel();
          }}
          className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
        />
      </div>

      <div className="flex flex-wrap gap-1">
        {PALETTE.map((swatch) => (
          <button
            key={swatch}
            type="button"
            aria-label={`Use ${swatch}`}
            onClick={() => setColor(swatch)}
            style={{ backgroundColor: swatch }}
            className={`h-5 w-5 rounded-full transition hover:scale-110 ${
              swatch.toLowerCase() === color.toLowerCase() ? 'ring-2 ring-slate-900 ring-offset-1' : ''
            }`}
          />
        ))}
      </div>

      <div className="flex items-center justify-between gap-2">
        {onDelete ? (
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            className="rounded-md px-1.5 py-1 text-[11px] font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50"
          >
            Remove
          </button>
        ) : (
          /*
            A built-in status has no Remove, and says why in the space where one would be —
            an absent control invites a second attempt to find it.
          */
          <span className="px-1.5 text-[11px] text-slate-400">
            {isNew ? '' : 'Built-in status'}
          </span>
        )}

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-2 py-1 text-[11px] font-semibold text-slate-500 transition hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={commit}
            disabled={!canSave}
            className="rounded-md bg-teal-700 px-2.5 py-1 text-[11px] font-bold text-white transition hover:bg-teal-800 disabled:opacity-40"
          >
            {isNew ? 'Add' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Why a status cannot be picked, said as the act that does reach it. */
const LOCKED_HINT: Record<string, string> = {
  qualified: 'Reached by moving the lead to Contacts, which creates the customer record.',
  disqualified: 'Reached by disqualifying the lead, which remembers the status it was in.',
};

/** The colours the four built-in statuses ship with, offered for the company's own stages. */
const PALETTE = [
  '#579bfc',
  '#9d5bf0',
  '#00c875',
  '#e2445c',
  '#fdab3d',
  '#0891b2',
  '#ff158a',
  '#64748b',
];

/** What a newly added status is coloured before anybody chooses — never the same twice running. */
const NEXT_COLOURS = ['#fdab3d', '#0891b2', '#ff158a', '#9d5bf0', '#00c875'];

function PencilIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}
