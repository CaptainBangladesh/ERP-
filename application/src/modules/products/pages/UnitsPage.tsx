import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import {
  ERROR_CODES,
  UNIT_FIELDS,
  UNIT_PATHS,
  emptyPage,
  listPath,
  listQueryString,
  type CreateUnitGroupRequest,
  type CreateUnitRequest,
  type ListQuery,
  type UnitGroupsResponse,
  type UnitListResponse,
  type UnitSummary,
} from '@erp/shared';
import { DataTable, Field, FormError, Select } from '@erp/shared/ui';
import { ApiFailure, api } from '../../../api/client';
import { useSession } from '../../../session/SessionProvider';
import { hasPermission } from '../../../session/permissions';

/**
 * What this business measures things in.
 *
 * The screen that has to exist before the catalogue can: nothing is seeded, so a company that
 * has not said what a kilogram is cannot have a product measured in one. That is deliberate —
 * a seeded unit is a row nobody chose that every later stock movement is measured in.
 *
 * Groups are the idea worth explaining on screen, so the page does: units convert to each
 * other inside a group and nowhere else, which is what makes converting kilograms to hours a
 * refusal rather than a number.
 */
export function UnitsPage() {
  const { session } = useSession();
  const canAddUnit = hasPermission(session, 'products:units:write');
  const [query, setQuery] = useState<ListQuery>({});
  const queryClient = useQueryClient();

  const units = useQuery({
    queryKey: ['units', 'list', listQueryString(query)],
    queryFn: () => api.get<UnitListResponse>(listPath(UNIT_PATHS.units, query)),
  });

  const groups = useQuery({
    queryKey: ['units', 'groups'],
    queryFn: () => api.get<UnitGroupsResponse>(UNIT_PATHS.groups),
  });

  const failure = units.error instanceof ApiFailure ? units.error : undefined;
  const known = groups.data?.groups ?? [];

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['units'] });
  }

  const change = useMutation({
    mutationFn: (unit: UnitSummary) =>
      api.patch<UnitSummary>(UNIT_PATHS.unit(unit.id), {
        status: unit.status === 'active' ? 'inactive' : 'active',
      }),
    onSuccess: refresh,
  });

  const columns = useMemo<Array<ColumnDef<UnitSummary, unknown>>>(
    () => [
      { id: UNIT_FIELDS.code, header: 'Code', cell: ({ row }) => row.original.code },
      { id: UNIT_FIELDS.name, header: 'Name', cell: ({ row }) => row.original.name },
      {
        id: UNIT_FIELDS.groupId,
        header: 'Group',
        // The column holds an identifier rather than the name shown, so there is nothing the
        // server could sort on that would mean what the reader sees.
        enableSorting: false,
        cell: ({ row }) =>
          row.original.groupName ? `${row.original.groupName} · ×${row.original.ratio}` : '—',
      },
      {
        id: UNIT_FIELDS.status,
        header: 'Status',
        cell: ({ row }) => (row.original.status === 'active' ? 'Active' : 'Inactive'),
      },
      {
        id: 'actions',
        header: 'Actions',
        enableSorting: false,
        cell: ({ row }) => (
          <button
            type="button"
            disabled={change.isPending}
            onClick={() => change.mutate(row.original)}
            className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-50"
          >
            {row.original.status === 'active'
              ? `Deactivate ${row.original.code}`
              : `Reactivate ${row.original.code}`}
          </button>
        ),
      },
    ],
    [change],
  );

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-slate-900">Units of measure</h1>
        <p className="text-sm text-slate-600">
          What you measure things in. Nothing is set up for you — a kilogram exists here once
          you say it does.
        </p>
      </header>

      {/*
        The refusal from deactivating a unit in use is a whole-screen message rather than one
        beside a control: the button that produced it is in a table row, and a message under
        one row of a table is a message somebody scrolls past.
      */}
      {change.error instanceof ApiFailure && <FormError>{change.error.message}</FormError>}

      {canAddUnit && <AddUnit groups={known} onAdded={refresh} />}

      <Groups groups={known} canAdd={canAddUnit} onAdded={refresh} />

      <DataTable
        caption="Units of measure"
        columns={columns}
        rows={units.data?.items ?? []}
        rowId={(unit) => unit.id}
        page={units.data?.page ?? emptyPage()}
        query={query}
        onQueryChange={setQuery}
        status={units.isPending ? 'loading' : units.isError ? 'error' : 'ready'}
        error={failure?.message}
        onRetry={() => void units.refetch()}
        searchLabel="Search by code or name"
        empty={
          <div className="flex flex-col gap-1">
            <p className="font-medium text-slate-900">No units yet.</p>
            <p>Add the first one using the form above — “kg”, “each”, “hour”.</p>
          </div>
        }
      />
    </div>
  );
}

/**
 * A unit, and optionally the group it converts within.
 *
 * The ratio only appears once a group is chosen, because it only means something then: it says
 * how many of the group's base unit one of these is, and a unit belonging to no group has
 * nothing to be a ratio of. The server refuses the combination; the form declines to offer it.
 */
function AddUnit({
  groups,
  onAdded,
}: {
  groups: UnitGroupsResponse['groups'];
  onAdded: () => void;
}) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [groupId, setGroupId] = useState('');
  const [ratio, setRatio] = useState('');

  const add = useMutation({
    mutationFn: () =>
      api.post<UnitSummary>(UNIT_PATHS.units, {
        code,
        name,
        ...(groupId ? { groupId } : {}),
        ...(groupId && ratio ? { ratio } : {}),
      } satisfies CreateUnitRequest),
    onSuccess: () => {
      setCode('');
      setName('');
      setRatio('');
      onAdded();
    },
  });

  const failure = add.error instanceof ApiFailure ? add.error : undefined;
  const fields = failure?.fields ?? {};

  return (
    <form
      noValidate
      aria-labelledby="add-unit"
      className="flex flex-col gap-4 rounded-md border border-slate-200 bg-white p-4"
      onSubmit={(event) => {
        event.preventDefault();
        add.mutate();
      }}
    >
      <h2 id="add-unit" className="text-sm font-medium text-slate-900">
        Add a unit
      </h2>

      <div className="flex flex-wrap gap-4">
        <div className="min-w-40 flex-1">
          <Field
            id="unit-code"
            label="Code"
            value={code}
            error={fields.code}
            hint="The symbol, as you write it: kg, kWh, each."
            onChange={setCode}
          />
        </div>
        <div className="min-w-48 flex-1">
          <Field id="unit-name" label="Name" value={name} error={fields.name} onChange={setName} />
        </div>
        {groups.length > 0 && (
          <div className="min-w-48 flex-1">
            <Select
              id="unit-group"
              label="Group"
              value={groupId}
              placeholder="Converts to nothing"
              error={fields.groupId}
              options={groups.map((group) => ({ value: group.id, label: group.name }))}
              onChange={(chosen) => {
                setGroupId(chosen);
                if (!chosen) setRatio('');
              }}
            />
          </div>
        )}
        {groupId && (
          <div className="min-w-48 flex-1">
            <Field
              id="unit-ratio"
              label="How many of the base unit"
              value={ratio}
              error={fields.ratio}
              inputMode="decimal"
              hint="1000 for a kilogram in a group whose base is the gram."
              onChange={setRatio}
            />
          </div>
        )}
      </div>

      {failure && failure.code !== ERROR_CODES.validationFailed && (
        <FormError>{failure.message}</FormError>
      )}

      <div>
        <button
          type="submit"
          disabled={add.isPending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {add.isPending ? 'Adding…' : 'Add unit'}
        </button>
      </div>
    </form>
  );
}

/**
 * The groups, with what is in each.
 *
 * Shown as prose rather than as a second table, because what somebody needs to see here is the
 * *relationship* — a gram is one, a kilogram is a thousand of them — which a table of four
 * columns states less clearly than a sentence does.
 */
function Groups({
  groups,
  canAdd,
  onAdded,
}: {
  groups: UnitGroupsResponse['groups'];
  canAdd: boolean;
  onAdded: () => void;
}) {
  const [name, setName] = useState('');

  const add = useMutation({
    mutationFn: () =>
      api.post<UnitGroupsResponse>(UNIT_PATHS.groups, { name } satisfies CreateUnitGroupRequest),
    onSuccess: () => {
      setName('');
      onAdded();
    },
  });

  const failure = add.error instanceof ApiFailure ? add.error : undefined;

  return (
    <section
      aria-labelledby="unit-groups"
      className="flex flex-col gap-4 rounded-md border border-slate-200 bg-white p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 id="unit-groups" className="text-sm font-medium text-slate-900">
          Groups
        </h2>
        <p className="text-sm text-slate-600">
          Units convert to each other inside a group and nowhere else. That is what makes
          kilograms and grams interchangeable, and kilograms and hours not.
        </p>
      </div>

      {groups.length === 0 ? (
        <p className="text-sm text-slate-600">
          No groups yet. Units without one are still perfectly usable — they simply convert to
          nothing.
        </p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm text-slate-700">
          {groups.map((group) => (
            <li key={group.id}>
              <span className="font-medium text-slate-900">{group.name}</span>:{' '}
              {group.units.length === 0
                ? 'no units yet'
                : group.units.map((unit) => `${unit.code} (×${unit.ratio})`).join(', ')}
            </li>
          ))}
        </ul>
      )}

      {canAdd && (
        <form
          noValidate
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            add.mutate();
          }}
        >
          <div className="min-w-56">
            <Field
              id="group-name"
              label="Add a group"
              value={name}
              error={failure?.fields.name}
              onChange={setName}
            />
          </div>
          <button
            type="submit"
            disabled={add.isPending}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-50"
          >
            Add group
          </button>
        </form>
      )}
    </section>
  );
}
