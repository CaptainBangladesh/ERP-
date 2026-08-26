import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ERROR_CODES,
  IDENTITY_PATHS,
  RECOVERY_LINKS,
  USER_FIELDS,
  emptyPage,
  listPath,
  listQueryString,
  type InvitationListResponse,
  type InvitationSummary,
  type InviteColleagueRequest,
  type ListQuery,
  type RoleListResponse,
  type RoleSummary,
  type UserListResponse,
  type UserSummary,
} from '@erp/shared';
import { DataTable, Field, FormError, Select } from '@erp/shared/ui';
import { ApiFailure, api } from '../../../api/client';
import { useSession } from '../../../session/SessionProvider';
import { hasPermission } from '../../../session/permissions';

const USERS_WRITE = 'identity:users:write';

/**
 * Colleagues: who is in the company, which roles each holds, pending invitations, and
 * inviting somebody new.
 */
export function TeamPage() {
  const { session } = useSession();
  const canWrite = hasPermission(session, USERS_WRITE);
  const [query, setQuery] = useState<ListQuery>({});
  const queryClient = useQueryClient();

  const roles = useQuery({
    queryKey: ['identity', 'roles', 'all'],
    queryFn: () => api.get<RoleListResponse>(listPath(IDENTITY_PATHS.roles, { pageSize: 100 })),
  });

  const users = useQuery({
    queryKey: ['identity', 'users', listQueryString(query)],
    queryFn: () => api.get<UserListResponse>(listPath(IDENTITY_PATHS.users, query)),
  });

  const invitations = useQuery({
    queryKey: ['identity', 'invitations'],
    queryFn: () => api.get<InvitationListResponse>(listPath(IDENTITY_PATHS.invitations, { pageSize: 100 })),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['identity', 'users'] });
    void queryClient.invalidateQueries({ queryKey: ['identity', 'invitations'] });
  };

  const assign = useMutation({
    mutationFn: (input: { userId: string; roleId: string }) =>
      api.post<UserSummary>(IDENTITY_PATHS.userRoles(input.userId), { roleId: input.roleId }),
    onSuccess: invalidate,
  });

  const unassign = useMutation({
    mutationFn: (input: { userId: string; roleId: string }) =>
      api.delete<UserSummary>(IDENTITY_PATHS.userRole(input.userId, input.roleId)),
    onSuccess: invalidate,
  });

  const failure = users.error instanceof ApiFailure ? users.error : undefined;
  const allRoles = roles.data?.items ?? [];

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-slate-900">Team</h1>
        <p className="text-sm text-slate-600">
          Everybody with a sign-in to this company, and who is still waiting on an invitation.
        </p>
      </header>

      {canWrite && <InviteColleague roles={allRoles} onInvited={invalidate} />}

      <DataTable
        caption="Colleagues"
        columns={[
          { id: USER_FIELDS.name, header: 'Name', cell: ({ row }) => row.original.name },
          { id: USER_FIELDS.email, header: 'Email', cell: ({ row }) => row.original.email },
          {
            id: 'roles',
            header: 'Roles',
            enableSorting: false,
            cell: ({ row }) =>
              row.original.isOwner ? (
                <span className="text-slate-600">Owner — full access</span>
              ) : (
                <RoleAssignment
                  user={row.original}
                  allRoles={allRoles}
                  canWrite={canWrite}
                  onAssign={(roleId) => assign.mutate({ userId: row.original.id, roleId })}
                  onRemove={(roleId) => unassign.mutate({ userId: row.original.id, roleId })}
                />
              ),
          },
        ]}
        rows={users.data?.items ?? []}
        rowId={(user) => user.id}
        page={users.data?.page ?? emptyPage()}
        query={query}
        onQueryChange={setQuery}
        status={users.isPending ? 'loading' : users.isError ? 'error' : 'ready'}
        error={failure?.message}
        onRetry={() => void users.refetch()}
        searchLabel="Search by name or email"
        empty={
          <div className="flex flex-col gap-1">
            <p className="font-medium text-slate-900">Just you so far.</p>
            <p>Invite a colleague using the form above.</p>
          </div>
        }
      />

      <PendingInvitations invitations={invitations.data?.items ?? []} />
    </div>
  );
}

function PendingInvitations({ invitations }: { invitations: readonly InvitationSummary[] }) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyLink = (id: string) => {
    const link = `${window.location.origin}${RECOVERY_LINKS.acceptInvitation(id)}`;
    void navigator.clipboard.writeText(link);
    setCopiedId(id);
    setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 2000);
  };

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-slate-900">Pending invitations</h2>
      {invitations.length === 0 ? (
        <p className="text-sm text-slate-600">Nothing pending.</p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm text-slate-700">
          {invitations.map((invitation) => (
            <li
              key={invitation.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white p-3 shadow-2xs"
            >
              <div className="flex flex-col">
                <span className="font-medium text-slate-900">{invitation.email}</span>
                <span className="text-xs text-slate-500">
                  Expires {new Date(invitation.expiresAt).toLocaleDateString()}
                </span>
              </div>
              <button
                type="button"
                onClick={() => copyLink(invitation.id)}
                className="rounded-md border border-slate-300 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-white hover:text-slate-900 transition"
              >
                {copiedId === invitation.id ? '✓ Copied invite link' : 'Copy invite link'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The roles a colleague holds, each removable, and a picker to add one more. */
function RoleAssignment({
  user,
  allRoles,
  canWrite,
  onAssign,
  onRemove,
}: {
  user: UserSummary;
  allRoles: readonly RoleSummary[];
  canWrite: boolean;
  onAssign: (roleId: string) => void;
  onRemove: (roleId: string) => void;
}) {
  const heldIds = new Set(user.roles.map((role) => role.id));
  const available = allRoles.filter((role) => !heldIds.has(role.id));

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1.5">
        {user.roles.length === 0 && <span className="text-slate-500">No roles</span>}
        {user.roles.map((role) => (
          <span
            key={role.id}
            className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700"
          >
            {role.name}
            {canWrite && (
              <button
                type="button"
                aria-label={`Remove ${role.name} from ${user.name}`}
                onClick={() => onRemove(role.id)}
                className="text-slate-500 hover:text-slate-900"
              >
                ×
              </button>
            )}
          </span>
        ))}
      </div>

      {canWrite && available.length > 0 && (
        <Select
          id={`assign-role-${user.id}`}
          label={`Assign a role to ${user.name}`}
          value=""
          placeholder="Assign a role…"
          options={available.map((role) => ({ value: role.id, label: role.name }))}
          onChange={(roleId) => {
            if (roleId) onAssign(roleId);
          }}
        />
      )}
    </div>
  );
}

function InviteColleague({
  roles,
  onInvited,
}: {
  roles: readonly RoleSummary[];
  onInvited: () => void;
}) {
  const [emailInput, setEmailInput] = useState('');
  const [roleId, setRoleId] = useState('');

  const invite = useMutation({
    mutationFn: async () => {
      const emailList = emailInput
        .split(/[\s,;\n]+/)
        .map((e) => e.trim())
        .filter(Boolean);

      if (emailList.length === 0) {
        throw new ApiFailure(400, {
          code: ERROR_CODES.validationFailed,
          message: 'Enter at least one email address.',
          fields: { email: 'Enter their email address.' },
        });
      }

      for (const email of emailList) {
        await api.post(IDENTITY_PATHS.invitations, {
          email,
          roleId: roleId || undefined,
        } satisfies InviteColleagueRequest);
      }
    },
    onSuccess: () => {
      setEmailInput('');
      setRoleId('');
      onInvited();
    },
  });

  const failure = invite.error instanceof ApiFailure ? invite.error : undefined;
  const fields = failure?.fields ?? {};

  return (
    <form
      noValidate
      aria-labelledby="invite-colleague"
      className="flex flex-col gap-4 rounded-md border border-slate-200 bg-white p-4"
      onSubmit={(event) => {
        event.preventDefault();
        invite.mutate();
      }}
    >
      <h2 id="invite-colleague" className="text-sm font-medium text-slate-900">
        Invite teammates by email
      </h2>

      <div className="flex flex-wrap gap-4">
        <div className="min-w-56 flex-1">
          <Field
            id="invite-email"
            label="Email address(es)"
            hint="Separate multiple emails with commas (e.g. kit@company.test, alex@company.test)"
            value={emailInput}
            error={fields.email}
            onChange={setEmailInput}
          />
        </div>
        <div className="min-w-56 flex-1">
          <Select
            id="invite-role"
            label="Starting role"
            value={roleId}
            placeholder="No role yet"
            options={roles.map((role) => ({ value: role.id, label: role.name }))}
            onChange={setRoleId}
          />
        </div>
      </div>

      {failure && failure.code !== ERROR_CODES.validationFailed && (
        <FormError>{failure.message}</FormError>
      )}

      <div>
        <button
          type="submit"
          disabled={invite.isPending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {invite.isPending ? 'Sending…' : 'Send invitation(s)'}
        </button>
      </div>
    </form>
  );
}
