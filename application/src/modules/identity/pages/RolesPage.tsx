import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ERROR_CODES,
  IDENTITY_PATHS,
  PERMISSIONS_PATH,
  ROLE_FIELDS,
  emptyPage,
  listPath,
  listQueryString,
  type CreateRoleRequest,
  type ListQuery,
  type PermissionsResponse,
  type RoleListResponse,
  type RoleResponse,
  type RoleSummary,
  type UpdateRoleRequest,
} from '@erp/shared';
import { DataTable, Field, FormError } from '@erp/shared/ui';
import { ApiFailure, api } from '../../../api/client';
import { useSession } from '../../../session/SessionProvider';
import { hasPermission } from '../../../session/permissions';

const ROLES_WRITE = 'identity:roles:write';

/**
 * Roles: what each one grants, and choosing that a whole module is simply not part of it.
 *
 * "Deny a whole module" is not a separate switch from denying its individual actions — it is
 * the state of holding none of that module's permission strings. The "select all" / "clear"
 * control on each module's group is what makes reaching that state one click rather than
 * unchecking every action inside it by hand.
 */
export function RolesPage() {
  const { session } = useSession();
  const canWrite = hasPermission(session, ROLES_WRITE);
  const [query, setQuery] = useState<ListQuery>({});
  const [editing, setEditing] = useState<RoleResponse | undefined>();
  const queryClient = useQueryClient();

  const permissions = useQuery({
    queryKey: ['permissions'],
    queryFn: () => api.get<PermissionsResponse>(PERMISSIONS_PATH),
  });

  const roles = useQuery({
    queryKey: ['identity', 'roles', listQueryString(query)],
    queryFn: () => api.get<RoleListResponse>(listPath(IDENTITY_PATHS.roles, query)),
  });

  const failure = roles.error instanceof ApiFailure ? roles.error : undefined;

  const groups = useMemo(() => groupByModule(permissions.data?.permissions ?? []), [permissions.data]);

  const remove = useMutation({
    mutationFn: (id: string) => api.delete<void>(IDENTITY_PATHS.role(id)),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['identity', 'roles'] }),
  });
  const removeFailure = remove.error instanceof ApiFailure ? remove.error : undefined;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-slate-900">Roles</h1>
        <p className="text-sm text-slate-600">
          A role is a named set of permissions. Somebody can hold several at once.
        </p>
      </header>

      {canWrite && (
        <RoleForm
          // Remounts on every switch between roles (or back to "create"), which is what
          // resets its internal fields — otherwise editing one role after another would
          // keep showing the first role's name and permissions.
          key={editing?.id ?? 'new'}
          groups={groups}
          editing={editing}
          onDone={() => {
            setEditing(undefined);
            void queryClient.invalidateQueries({ queryKey: ['identity', 'roles'] });
          }}
          onCancel={() => setEditing(undefined)}
        />
      )}

      {removeFailure && <FormError>{removeFailure.message}</FormError>}

      <DataTable
        caption="Roles"
        columns={[
          { id: ROLE_FIELDS.name, header: 'Name', cell: ({ row }) => row.original.name },
          {
            id: 'permissions',
            header: 'Permissions',
            enableSorting: false,
            cell: ({ row }) =>
              row.original.permissions.length === 0
                ? 'None'
                : `${row.original.permissions.length} permission${row.original.permissions.length === 1 ? '' : 's'}`,
          },
          ...(canWrite
            ? [
                {
                  id: 'actions',
                  header: 'Actions',
                  enableSorting: false,
                  cell: ({ row }: { row: { original: RoleSummary } }) => (
                    <div className="flex gap-3">
                      <button
                        type="button"
                        className="text-sm font-medium text-slate-900 underline"
                        onClick={() => setEditing(row.original)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="text-sm font-medium text-red-700 underline disabled:opacity-50"
                        disabled={remove.isPending}
                        onClick={() => remove.mutate(row.original.id)}
                      >
                        Delete
                      </button>
                    </div>
                  ),
                },
              ]
            : []),
        ]}
        rows={roles.data?.items ?? []}
        rowId={(role) => role.id}
        page={roles.data?.page ?? emptyPage()}
        query={query}
        onQueryChange={setQuery}
        status={roles.isPending ? 'loading' : roles.isError ? 'error' : 'ready'}
        error={failure?.message}
        onRetry={() => void roles.refetch()}
        searchLabel="Search by name"
        empty={
          <div className="flex flex-col gap-1">
            <p className="font-medium text-slate-900">No roles yet.</p>
            <p>Create the first one using the form above.</p>
          </div>
        }
      />
    </div>
  );
}

function groupByModule(permissions: string[]): Array<{ module: string; permissions: string[] }> {
  const byModule = new Map<string, string[]>();
  for (const permission of [...permissions].sort()) {
    const module = permission.split(':')[0] ?? permission;
    const group = byModule.get(module);
    if (group) group.push(permission);
    else byModule.set(module, [permission]);
  }
  return [...byModule.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([module, list]) => ({ module, permissions: list }));
}

/**
 * Creates a role, or edits one — the same form either way, because the two differ only in
 * which request they send and what they say on the button.
 */
function RoleForm({
  groups,
  editing,
  onDone,
  onCancel,
}: {
  groups: Array<{ module: string; permissions: string[] }>;
  editing: RoleResponse | undefined;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(editing?.name ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set(editing?.permissions ?? []));

  const save = useMutation({
    mutationFn: () =>
      editing
        ? api.patch<RoleResponse>(IDENTITY_PATHS.role(editing.id), {
            name,
            permissions: [...selected],
          } satisfies UpdateRoleRequest)
        : api.post<RoleResponse>(IDENTITY_PATHS.roles, {
            name,
            permissions: [...selected],
          } satisfies CreateRoleRequest),
    onSuccess: () => {
      setName('');
      setSelected(new Set());
      onDone();
    },
  });

  const failure = save.error instanceof ApiFailure ? save.error : undefined;
  const fields = failure?.fields ?? {};

  function toggle(permission: string): void {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(permission)) next.delete(permission);
      else next.add(permission);
      return next;
    });
  }

  return (
    <form
      noValidate
      aria-labelledby="role-form-heading"
      className="flex flex-col gap-4 rounded-md border border-slate-200 bg-white p-4"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <h2 id="role-form-heading" className="text-sm font-medium text-slate-900">
        {editing ? `Editing "${editing.name}"` : 'Create a role'}
      </h2>

      <div className="max-w-sm">
        <Field id="role-name" label="Name" value={name} error={fields.name} onChange={setName} />
      </div>

      <fieldset className="flex flex-col gap-4">
        <legend className="text-sm font-medium text-slate-900">Permissions</legend>
        {groups.map((group) => {
          const allSelected = group.permissions.every((permission) => selected.has(permission));
          return (
            <div key={group.module} className="flex flex-col gap-2 rounded-md border border-slate-200 p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium capitalize text-slate-900">{group.module}</span>
                <button
                  type="button"
                  className="text-xs font-medium text-slate-600 underline hover:text-slate-900"
                  onClick={() =>
                    setSelected((current) => {
                      const next = new Set(current);
                      for (const permission of group.permissions) {
                        if (allSelected) next.delete(permission);
                        else next.add(permission);
                      }
                      return next;
                    })
                  }
                >
                  {allSelected ? 'Clear' : 'Select all'}
                </button>
              </div>

              <div className="flex flex-col gap-1.5">
                {group.permissions.map((permission) => (
                  <label key={permission} className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={selected.has(permission)}
                      onChange={() => toggle(permission)}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    {permission}
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </fieldset>

      {failure && failure.code !== ERROR_CODES.validationFailed && (
        <FormError>{failure.message}</FormError>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={save.isPending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Create role'}
        </button>
        {editing && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
