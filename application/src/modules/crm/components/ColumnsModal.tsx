import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ERROR_CODES,
  LEAD_FIELD_PATHS,
  LEAD_FIELD_TYPES,
  type CreateLeadFieldRequest,
  type LeadFieldResponse,
  type LeadFieldSummary,
  type LeadFieldType,
  type UpdateLeadFieldRequest,
} from '@erp/shared';
import { Field, FormError, Select } from '@erp/shared/ui';
import { ApiFailure, api } from '../../../api/client';
import { useSession } from '../../../session/SessionProvider';
import { hasPermission } from '../../../session/permissions';
import {
  CORE_COLUMNS,
  PROVISIONED_COLUMNS,
  fieldColumnKey,
  type ColumnOption,
} from '../columns';
import { LEAD_VOCABULARY_KEY } from '../vocabulary';

/**
 * The column catalogue: everything this board could show, and a switch for each.
 *
 * Two tabs rather than one list, because the two halves answer different questions. **Core
 * CRM** is "what does a CRM normally track" — a fixed, named set that reads the same in every
 * company. **More columns** is "what does *this* company track", which is whatever fields it
 * has defined for itself and nobody else's business.
 *
 * Switching a column off only stops showing it. Nothing is deleted, so a column turned off by
 * mistake costs a click to get back and never costs data.
 */
export function ColumnsModal({
  fields,
  isVisible,
  onToggle,
  onClose,
}: {
  /** Every custom field this company has defined, archived ones included. */
  fields: LeadFieldSummary[];
  isVisible: (key: string) => boolean;
  onToggle: (key: string, on: boolean) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'core' | 'more'>('core');
  const queryClient = useQueryClient();

  const { session } = useSession();
  const canWriteFields = hasPermission(session, 'crm:lead-fields:write');

  const live = fields.filter((field) => field.archivedAt === null);
  const archived = fields.filter((field) => field.archivedAt !== null);
  const provisionedKeys = new Set(PROVISIONED_COLUMNS.map((column) => column.key));

  /** The company's own fields — the two the Core tab already names by hand are not repeated. */
  const own = live.filter((field) => !provisionedKeys.has(field.key));

  /**
   * Switching on a column the Lead record has no room for defines the field that will hold it.
   * Done here, on an explicit click, rather than anywhere a board is merely looked at.
   */
  const defineField = useMutation({
    mutationFn: (label: string) =>
      api.post<LeadFieldResponse>(LEAD_FIELD_PATHS.leadFields, {
        label,
        type: 'text',
      } satisfies CreateLeadFieldRequest),
    onSuccess: (field) => {
      void queryClient.invalidateQueries({ queryKey: LEAD_VOCABULARY_KEY });
      onToggle(fieldColumnKey(field), true);
    },
  });

  function toggleProvisioned(column: (typeof PROVISIONED_COLUMNS)[number], on: boolean) {
    const columnKey = `field:${column.key}`;
    if (!on) {
      onToggle(columnKey, false);
      return;
    }
    // Already defined — perhaps switched on before, or named by hand under Lead Fields.
    if (live.some((field) => field.key === column.key)) {
      onToggle(columnKey, true);
      return;
    }
    defineField.mutate(column.fieldLabel);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/30 p-4 pt-24 backdrop-blur-xs">
      <div className="flex max-h-[70vh] w-full max-w-md flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-2 pt-2">
          <div role="tablist" aria-label="Column catalogue" className="flex flex-1">
            <Tab id="core" active={tab} onPick={setTab} label="Core CRM" />
            <Tab id="more" active={tab} onPick={setTab} label="More columns" />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="m-1 rounded p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          {tab === 'core' ? (
            <>
              <p className="mb-4 text-xs text-slate-500">Core columns for your CRM board</p>
              <ul className="flex flex-col">
                {CORE_COLUMNS.map((column) => (
                  <ColumnRow
                    key={column.key}
                    column={column}
                    checked={isVisible(column.key)}
                    onChange={(on) => onToggle(column.key, on)}
                  />
                ))}
                {PROVISIONED_COLUMNS.map((column) => (
                  <ColumnRow
                    key={column.key}
                    column={column}
                    checked={isVisible(`field:${column.key}`)}
                    busy={defineField.isPending && defineField.variables === column.fieldLabel}
                    onChange={(on) => toggleProvisioned(column, on)}
                  />
                ))}
              </ul>
            </>
          ) : (
            <>
              <p className="mb-4 text-xs text-slate-500">
                Fields your company defined for itself. Each one can have its own column.
              </p>
              {own.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center">
                  <p className="text-sm font-medium text-slate-700">No fields of your own yet.</p>
                  <p className="mt-1 text-xs text-slate-500">
                    A deal size, a referrer, a LinkedIn profile — define one below and it
                    becomes a column here and a box on every lead.
                  </p>
                </div>
              ) : (
                <ul className="flex flex-col">
                  {own.map((field) => (
                    <FieldRow
                      key={field.id}
                      field={field}
                      checked={isVisible(fieldColumnKey(field))}
                      canWrite={canWriteFields}
                      onToggle={(on) => onToggle(fieldColumnKey(field), on)}
                      onArchived={() => onToggle(fieldColumnKey(field), false)}
                    />
                  ))}
                </ul>
              )}

              {canWriteFields && (
                <NewFieldForm onDefined={(field) => onToggle(fieldColumnKey(field), true)} />
              )}

              {archived.length > 0 && (
                <details className="mt-4 border-t border-slate-200 pt-3">
                  <summary className="cursor-pointer text-xs font-semibold text-slate-500">
                    Retired fields ({archived.length})
                  </summary>
                  <p className="mt-1 mb-2 text-xs text-slate-500">
                    No longer offered on a lead. What was captured under them is still stored,
                    and bringing one back shows it again.
                  </p>
                  <ul className="flex flex-col">
                    {archived.map((field) => (
                      <FieldRow
                        key={field.id}
                        field={field}
                        checked={false}
                        canWrite={canWriteFields}
                        onToggle={() => {}}
                        onArchived={() => {}}
                      />
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * One of the company's own fields: whether it has a column, what it is called, whether a lead
 * may be saved without it, and whether it is still offered at all.
 *
 * All four live in this row because they are the whole of what there is to do to a field, and
 * splitting them across two screens only meant remembering which screen. Renaming is safe to
 * put this close to hand: the key every stored value is filed under is derived once by the
 * server and never rewritten, so a corrected label cannot orphan what has already been
 * captured. Retiring is likewise not deletion — the values stay readable.
 */
function FieldRow({
  field,
  checked,
  canWrite,
  onToggle,
  onArchived,
}: {
  field: LeadFieldSummary;
  checked: boolean;
  canWrite: boolean;
  onToggle: (on: boolean) => void;
  /** Told when the field stops being offered, so its column can be dropped with it. */
  onArchived: () => void;
}) {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState(field.label);
  const archived = field.archivedAt !== null;

  function settled() {
    void queryClient.invalidateQueries({ queryKey: LEAD_VOCABULARY_KEY });
  }

  const change = useMutation({
    mutationFn: (body: UpdateLeadFieldRequest) =>
      api.patch<LeadFieldResponse>(LEAD_FIELD_PATHS.leadField(field.id), body),
    onSuccess: settled,
  });

  const retireOrRestore = useMutation({
    mutationFn: () =>
      api.post<LeadFieldResponse>(
        archived ? LEAD_FIELD_PATHS.restore(field.id) : LEAD_FIELD_PATHS.archive(field.id),
      ),
    onSuccess: () => {
      settled();
      if (!archived) onArchived();
    },
  });

  return (
    <li className="flex items-center gap-3 rounded-lg px-1 py-2 transition hover:bg-slate-50">
      <input
        type="checkbox"
        checked={checked}
        disabled={archived}
        aria-label={`Show ${field.label} as a column`}
        onChange={(event) => onToggle(event.target.checked)}
        className="size-5 shrink-0 rounded border-slate-300 text-teal-700 focus:ring-teal-500 disabled:opacity-30"
      />
      <span
        aria-hidden="true"
        className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-slate-500 text-lg text-white"
      >
        ⊞
      </span>

      <span className="min-w-0 flex-1">
        {canWrite && !archived ? (
          <input
            aria-label={`Name of ${field.label}`}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            onBlur={() => {
              if (label.trim() && label.trim() !== field.label) {
                change.mutate({ label: label.trim() });
              } else {
                setLabel(field.label);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') {
                setLabel(field.label);
                event.currentTarget.blur();
              }
            }}
            className="w-full rounded border border-transparent px-1 py-0.5 text-sm font-semibold text-slate-900 hover:border-slate-200 focus:border-teal-600 focus:bg-white focus:outline-none"
          />
        ) : (
          <span className="block px-1 text-sm font-semibold text-slate-900">{field.label}</span>
        )}

        <span className="flex items-center gap-3 px-1 text-xs text-slate-500">
          <span>A {field.type} field on every lead</span>
          {canWrite && !archived && (
            <label className="flex cursor-pointer items-center gap-1">
              <input
                type="checkbox"
                checked={field.required}
                aria-label={`${field.label} is required`}
                onChange={(event) => change.mutate({ required: event.target.checked })}
                className="size-3.5 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
              />
              <span>Required</span>
            </label>
          )}
        </span>
      </span>

      {canWrite && (
        <button
          type="button"
          onClick={() => retireOrRestore.mutate()}
          disabled={retireOrRestore.isPending}
          className="shrink-0 rounded px-2 py-1 text-xs font-medium text-slate-500 transition hover:bg-slate-200 hover:text-slate-800 disabled:opacity-40"
        >
          {archived ? 'Bring back' : 'Retire'}
        </button>
      )}
    </li>
  );
}

/**
 * Defining a field without leaving the board.
 *
 * A column you want and a field that does not exist yet are the same thought a second apart,
 * and sending somebody to another screen between them loses it. What is asked for here is the
 * minimum a definition needs — what to call it and what shape it holds; everything else about
 * a field — renaming it, requiring it, retiring it — is done on its own row above, so there
 * is one place to go for all of it rather than a second screen to remember.
 *
 * The new column is switched on straight away: nobody defines a field in a column picker and
 * then wants it hidden.
 */
function NewFieldForm({ onDefined }: { onDefined: (field: LeadFieldResponse) => void }) {
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [type, setType] = useState<LeadFieldType>('text');
  const [options, setOptions] = useState('');

  const takesOptions = type === 'select' || type === 'multiselect';

  const define = useMutation({
    mutationFn: () =>
      api.post<LeadFieldResponse>(LEAD_FIELD_PATHS.leadFields, {
        label: label.trim(),
        type,
        ...(takesOptions
          ? {
              options: options
                .split(',')
                .map((option) => option.trim())
                .filter(Boolean),
            }
          : {}),
      } satisfies CreateLeadFieldRequest),
    onSuccess: (field) => {
      void queryClient.invalidateQueries({ queryKey: LEAD_VOCABULARY_KEY });
      setLabel('');
      setOptions('');
      setType('text');
      setOpen(false);
      onDefined(field);
    },
  });

  const failure = define.error instanceof ApiFailure ? define.error : undefined;
  const fields = failure?.fields ?? {};
  const ready = label.trim().length > 0 && (!takesOptions || options.trim().length > 0);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 w-full rounded-lg border border-dashed border-slate-300 py-2.5 text-xs font-semibold text-teal-700 transition hover:border-teal-500 hover:bg-teal-50"
      >
        + Add a custom field
      </button>
    );
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) define.mutate();
      }}
      className="mt-3 flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3"
    >
      <Field
        id="new-field-label"
        label="Field name"
        value={label}
        error={fields.label}
        onChange={setLabel}
      />

      <Select
        id="new-field-type"
        label="Holds"
        value={type}
        error={fields.type}
        options={LEAD_FIELD_TYPES.map((option) => ({ value: option, label: TYPE_LABELS[option] }))}
        onChange={(chosen) => setType(chosen as LeadFieldType)}
      />

      {takesOptions && (
        <Field
          id="new-field-options"
          label="Choices, separated by commas"
          value={options}
          error={fields.options}
          onChange={setOptions}
        />
      )}

      {failure && failure.code !== ERROR_CODES.validationFailed && (
        <FormError>{failure.message}</FormError>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-200"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!ready || define.isPending}
          className="rounded bg-teal-700 px-3 py-1 text-xs font-semibold text-white transition hover:bg-teal-800 disabled:opacity-40"
        >
          {define.isPending ? 'Adding…' : 'Add field'}
        </button>
      </div>
    </form>
  );
}

/** What each type is called to somebody choosing one, rather than what the API calls it. */
const TYPE_LABELS: Record<LeadFieldType, string> = {
  text: 'Text',
  number: 'A number',
  date: 'A date',
  boolean: 'Yes or no',
  select: 'One of a list',
  multiselect: 'Any of a list',
  checkbox: 'Yes or no',
};

function Tab({
  id,
  active,
  label,
  onPick,
}: {
  id: 'core' | 'more';
  active: 'core' | 'more';
  label: string;
  onPick: (id: 'core' | 'more') => void;
}) {
  const selected = active === id;

  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={() => onPick(id)}
      className={`flex-1 border-b-2 px-4 py-3 text-sm font-semibold transition ${
        selected
          ? 'border-teal-600 text-slate-900'
          : 'border-transparent text-slate-400 hover:text-slate-600'
      }`}
    >
      {label}
    </button>
  );
}

function ColumnRow({
  column,
  checked,
  busy = false,
  onChange,
}: {
  column: ColumnOption;
  checked: boolean;
  busy?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <li>
      <label className="flex cursor-pointer items-center gap-3 rounded-lg px-1 py-2.5 transition hover:bg-slate-50">
        <input
          type="checkbox"
          checked={checked}
          disabled={busy}
          onChange={(event) => onChange(event.target.checked)}
          className="size-5 rounded border-slate-300 text-teal-700 focus:ring-teal-500"
        />
        <span
          aria-hidden="true"
          className={`flex size-10 shrink-0 items-center justify-center rounded-lg text-lg text-white ${column.tone}`}
        >
          {column.icon}
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-slate-900">{column.label}</span>
          <span className="block text-xs text-slate-500">
            {busy ? 'Setting this up…' : column.description}
          </span>
        </span>
      </label>
    </li>
  );
}
