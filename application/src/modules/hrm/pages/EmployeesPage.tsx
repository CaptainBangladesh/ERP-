import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import {
  EMPLOYEE_FIELDS,
  ERROR_CODES,
  HRM_PATHS,
  emptyPage,
  listPath,
  listQueryString,
  type EmployeeListResponse,
  type EmployeeResponse,
  type ListQuery,
} from '@erp/shared';
import { DataTable, Field, FormError, MoneyInput, MoneyText } from '@erp/shared/ui';
import { ApiFailure, api } from '../../../api/client';
import { useSession } from '../../../session/SessionProvider';
import { hasPermission } from '../../../session/permissions';

/**
 * Everybody on the payroll.
 *
 * The first screen built on the shared conventions, and it is deliberately the payroll one
 * rather than a simpler list: its salary column is restricted beyond company scope, so this
 * is where "the table sorts by any column" meets "some callers may not read this one". A
 * convention proven only against columns everybody can see would not be a convention.
 *
 * There is no paging, sorting or filtering code here. The query is a `ListQuery` in state,
 * the table hands back a new one, and the URL is built by the shared helper — so the screen
 * is the same shape every later module's list screen will be.
 */
export function EmployeesPage() {
  const { session } = useSession();
  const canAddEmployee = hasPermission(session, 'hrm:employees:write');
  const [query, setQuery] = useState<ListQuery>({});
  const queryClient = useQueryClient();

  const employees = useQuery({
    // The query string *is* the cache key: two different requests are two different answers,
    // and the shared builder sorts its parameters so the same request is always one key.
    queryKey: ['hrm', 'employees', listQueryString(query)],
    queryFn: () => api.get<EmployeeListResponse>(listPath(HRM_PATHS.employees, query)),
  });

  const failure = employees.error instanceof ApiFailure ? employees.error : undefined;

  const columns = useMemo<Array<ColumnDef<EmployeeResponse, unknown>>>(
    () => [
      {
        // The id is the field name the server sorts by, taken from the shared contract so a
        // rename breaks the build rather than the sort.
        id: EMPLOYEE_FIELDS.name,
        header: 'Name',
        accessorFn: (employee) => employee.name,
      },
      {
        id: EMPLOYEE_FIELDS.annualSalary,
        header: 'Annual salary',
        cell: ({ row }) => <MoneyText value={row.original.annualSalary} hidden="Not shown" />,
      },
      {
        id: EMPLOYEE_FIELDS.confidential,
        header: 'Confidential',
        enableSorting: false,
        cell: ({ row }) => (row.original.confidential ? 'Yes' : 'No'),
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-slate-900">People</h1>
        <p className="text-sm text-slate-600">
          Everybody this company pays. Salaries are shown only to those allowed to see them.
        </p>
      </header>

      {canAddEmployee && (
        <AddEmployee
          onAdded={() => {
            // The list is stale the moment an employee is added, and a screen showing a list
            // that does not contain what you just created is a screen nobody trusts again.
            void queryClient.invalidateQueries({ queryKey: ['hrm', 'employees'] });
            setQuery({});
          }}
        />
      )}

      <DataTable
        caption="Employees"
        columns={columns}
        rows={employees.data?.items ?? []}
        rowId={(employee) => employee.id}
        page={employees.data?.page ?? emptyPage()}
        query={query}
        onQueryChange={setQuery}
        status={employees.isPending ? 'loading' : employees.isError ? 'error' : 'ready'}
        error={failure?.message}
        onRetry={() => void employees.refetch()}
        searchLabel="Search by name"
        filters={
          <AddedSince
            value={query.filters?.[ADDED_SINCE] ?? ''}
            onChange={(since) =>
              setQuery({
                ...query,
                // Cleared means gone, not blank: an empty filter still in the object would
                // count as "narrowed" and show "nothing matches" instead of the empty state.
                filters: since ? { ...query.filters, [ADDED_SINCE]: since } : {},
                page: 1,
              })
            }
          />
        }
        empty={
          <div className="flex flex-col gap-1">
            <p className="font-medium text-slate-900">Nobody on the payroll yet.</p>
            <p>Add your first employee using the form above.</p>
          </div>
        }
      />
    </div>
  );
}

/**
 * `filter.createdAt.gte` — the platform's filter convention, spelled with the shared
 * constants so the field name and the operator are the ones the endpoint declared.
 */
const ADDED_SINCE = `${EMPLOYEE_FIELDS.createdAt}.gte`;

/**
 * A date filter, and the screen's whole contribution to filtering.
 *
 * The table takes filter controls as a slot rather than generating them, because what a
 * filter should *look* like is a question about the field — a date picker here, a status
 * dropdown in products, a location tree in inventory — and a table that tried to answer it
 * for forty modules would answer it badly for most of them. What is shared is the convention
 * the value travels under, not the control.
 */
function AddedSince({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="added-since" className="text-sm font-medium text-slate-900">
        Added since
      </label>
      <input
        id="added-since"
        name="added-since"
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-900/20"
      />
    </div>
  );
}

/**
 * The form that puts somebody on the payroll.
 *
 * Here rather than behind a button because of the empty state it has to serve: a fresh
 * account has nothing in the list, and the thing the screen should be guiding somebody to do
 * is right there rather than one click away. Nothing in this system is seeded, so an empty
 * database is the first thing every user sees.
 *
 * `MoneyInput` is what makes the amount exact from the first keystroke: the value it holds is
 * canonical decimal text, never a `number` and never a formatted string with a comma in it.
 */
function AddEmployee({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState('');
  const [annualSalary, setAnnualSalary] = useState('');

  const add = useMutation({
    mutationFn: () =>
      api.post<EmployeeResponse>(HRM_PATHS.employees, { name, annualSalary }),
    onSuccess: () => {
      setName('');
      setAnnualSalary('');
      onAdded();
    },
  });

  const failure = add.error instanceof ApiFailure ? add.error : undefined;
  const fields = failure?.fields ?? {};

  return (
    <form
      noValidate
      aria-labelledby="add-employee"
      className="flex flex-col gap-4 rounded-md border border-slate-200 bg-white p-4"
      onSubmit={(event) => {
        event.preventDefault();
        add.mutate();
      }}
    >
      <h2 id="add-employee" className="text-sm font-medium text-slate-900">
        Add an employee
      </h2>

      <div className="flex flex-wrap gap-4">
        <div className="min-w-56 flex-1">
          <Field
            id="employee-name"
            label="Name"
            value={name}
            error={fields.name}
            onChange={setName}
          />
        </div>
        <div className="min-w-56 flex-1">
          <MoneyInput
            id="employee-salary"
            label="Annual salary"
            value={annualSalary}
            error={fields.annualSalary}
            onChange={setAnnualSalary}
          />
        </div>
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
          {add.isPending ? 'Adding…' : 'Add employee'}
        </button>
      </div>
    </form>
  );
}
