import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DEAL_PATHS,
  DEFAULT_CURRENCY,
  ERROR_CODES,
  IDENTITY_PATHS,
  Money,
  PARTY_PATHS,
  STAGE_OUTCOMES,
  STAGE_PATHS,
  listPath,
  type CreateDealRequest,
  type CreateStageRequest,
  type DealListResponse,
  type DealResponse,
  type DealSummary,
  type PartyListResponse,
  type PartySummary,
  type SettableStageOutcome,
  type StageListResponse,
  type StageResponse,
  type StageSummary,
  type UpdateDealRequest,
  type UpdateStageRequest,
  type UserListResponse,
  type UserSummary,
} from '@erp/shared';
import { Field, FormError, MoneyInput, MoneyText, Select } from '@erp/shared/ui';
import { ApiFailure, api } from '../../../api/client';
import { useSession } from '../../../session/SessionProvider';
import { hasPermission } from '../../../session/permissions';

const STAGE_OUTCOME_LABELS: Record<SettableStageOutcome, string> = { won: 'Won', lost: 'Lost' };

/**
 * The deals board — a company's own pipeline, as Stage columns, with Deals moving between them.
 *
 * Everything about assignment and party lookup composes a second call exactly the way `crm`'s
 * Lead screens already do: `GET /api/identity/users` for a name beside `assignedToUserId`, and
 * Parties' own list for a name beside `partyId`. `crm`'s backend resolves neither.
 *
 * The empty state — zero Stages — is the first thing a fresh company sees, since nothing here
 * is seeded: "create your first stage" is the whole of what the board offers until one exists.
 */
export function DealsPage() {
  const { session } = useSession();
  const canWriteDeals = hasPermission(session, 'crm:deals:write');
  const canWriteStages = hasPermission(session, 'crm:stages:write');
  const canReadUsers = hasPermission(session, 'identity:users:read');
  const canReadParties = hasPermission(session, 'parties:parties:read');

  const [editingLabels, setEditingLabels] = useState(false);
  const [addingDeal, setAddingDeal] = useState(false);
  const queryClient = useQueryClient();

  const stagesQuery = useQuery({
    queryKey: ['crm', 'stages', 'list'],
    queryFn: () => api.get<StageListResponse>(listPath(STAGE_PATHS.stages, { pageSize: 200 })),
  });

  const dealsQuery = useQuery({
    queryKey: ['crm', 'deals', 'list'],
    queryFn: () => api.get<DealListResponse>(listPath(DEAL_PATHS.deals, { pageSize: 200 })),
  });

  const partiesQuery = useQuery({
    queryKey: ['parties', 'directory'],
    queryFn: () => api.get<PartyListResponse>(listPath(PARTY_PATHS.parties, { pageSize: 200 })),
    enabled: canReadParties,
  });

  const usersQuery = useQuery({
    queryKey: ['identity', 'users', 'all'],
    queryFn: () => api.get<UserListResponse>(listPath(IDENTITY_PATHS.users, { pageSize: 200 })),
    enabled: canReadUsers,
  });

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['crm', 'stages'] });
    void queryClient.invalidateQueries({ queryKey: ['crm', 'deals'] });
  }

  const stages = stagesQuery.data?.items ?? [];
  const deals = dealsQuery.data?.items ?? [];
  const parties = partiesQuery.data?.items ?? [];
  const users = usersQuery.data?.items ?? [];

  const partyName = useMemo(() => new Map(parties.map((party) => [party.id, party.name])), [parties]);
  const userName = useMemo(() => new Map(users.map((user) => [user.id, user.name])), [users]);

  const dealsByStage = useMemo(() => {
    const grouped = new Map<string, DealSummary[]>(stages.map((stage) => [stage.id, []]));
    for (const deal of deals) grouped.get(deal.stageId)?.push(deal);
    return grouped;
  }, [stages, deals]);

  const loading = stagesQuery.isPending || dealsQuery.isPending;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold text-slate-900">Deals</h1>
          <p className="text-sm text-slate-600">
            Your pipeline, in your own stages. Landing a deal on a won or lost stage is how it
            closes — there is nothing else to click.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {canWriteStages && (
            <button
              type="button"
              onClick={() => setEditingLabels((open) => !open)}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-slate-50"
            >
              {editingLabels ? 'Close labels' : 'Edit labels'}
            </button>
          )}
          {canWriteDeals && stages.length > 0 && (
            <button
              type="button"
              onClick={() => setAddingDeal((open) => !open)}
              className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
            >
              {addingDeal ? 'Cancel' : 'Add deal'}
            </button>
          )}
        </div>
      </header>

      {editingLabels && (
        <EditLabelsPanel stages={stages} onChanged={refresh} onClose={() => setEditingLabels(false)} />
      )}

      {addingDeal && stages.length > 0 && (
        <AddDealPanel
          stages={stages}
          parties={parties}
          users={users}
          onAdded={() => {
            setAddingDeal(false);
            refresh();
          }}
          onCancel={() => setAddingDeal(false)}
        />
      )}

      {loading ? (
        <p role="status" className="rounded-md border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
          Loading the deals board…
        </p>
      ) : stages.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-slate-300 bg-white p-12 text-center">
          <h2 className="text-lg font-semibold text-slate-900">Create your first stage</h2>
          <p className="max-w-md text-sm text-slate-600">
            Nothing here is seeded. Add the stages your own sales process actually uses — you can
            rename, reorder and mark one won and one lost at any time.
          </p>
          {canWriteStages && (
            <button
              type="button"
              onClick={() => setEditingLabels(true)}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
            >
              Edit labels
            </button>
          )}
        </div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-2">
          {stages.map((stage) => (
            <StageColumn
              key={stage.id}
              stage={stage}
              stages={stages}
              deals={dealsByStage.get(stage.id) ?? []}
              partyName={partyName}
              userName={userName}
              users={users}
              canWrite={canWriteDeals}
              onChanged={refresh}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StageColumn({
  stage,
  stages,
  deals,
  partyName,
  userName,
  users,
  canWrite,
  onChanged,
}: {
  stage: StageSummary;
  stages: StageSummary[];
  deals: DealSummary[];
  partyName: Map<string, string>;
  userName: Map<string, string>;
  users: UserSummary[];
  canWrite: boolean;
  onChanged: () => void;
}) {
  // Exact, the way every total on this platform is: summed as Money rather than as
  // floating-point numbers, so a column of many deals never drifts a penny from what adding
  // them by hand would give.
  const total = deals.reduce((sum, deal) => sum.plus(Money.fromValue(deal.amount)), Money.zero());

  const move = useMutation({
    mutationFn: ({ dealId, stageId }: { dealId: string; stageId: string }) =>
      api.patch<DealResponse>(DEAL_PATHS.deal(dealId), { stageId } satisfies UpdateDealRequest),
    onSuccess: onChanged,
  });

  const reassign = useMutation({
    mutationFn: ({ dealId, userId }: { dealId: string; userId: string }) =>
      api.patch<DealResponse>(DEAL_PATHS.deal(dealId), { assignedToUserId: userId } satisfies UpdateDealRequest),
    onSuccess: onChanged,
  });

  return (
    <section
      aria-label={stage.name}
      className="flex w-80 flex-shrink-0 flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4"
    >
      <header className="flex items-center justify-between gap-2 border-b border-slate-200 pb-2">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-slate-900">{stage.name}</h2>
          {stage.outcome && (
            <span
              className={
                'rounded px-2 py-0.5 text-xs font-semibold ' +
                (stage.outcome === 'won' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800')
              }
            >
              {STAGE_OUTCOME_LABELS[stage.outcome]}
            </span>
          )}
        </div>
        <span className="rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-medium text-slate-700">
          {deals.length}
        </span>
      </header>

      <p className="text-xs font-medium text-slate-500">
        Total: <MoneyText value={total.toValue()} />
      </p>

      <div className="flex flex-col gap-3">
        {deals.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-200 p-4 text-center text-xs text-slate-400">
            No deals here.
          </p>
        ) : (
          deals.map((deal) => (
            <article key={deal.id} className="flex flex-col gap-2 rounded-md border border-slate-200 bg-white p-3 shadow-sm">
              <p className="font-medium text-slate-900">{deal.name}</p>
              <p className="text-sm font-semibold text-slate-900">
                <MoneyText value={deal.amount} />
              </p>
              <dl className="flex flex-col gap-0.5 text-xs text-slate-600">
                <div>Party: {partyName.get(deal.partyId) ?? deal.partyId}</div>
                <div>
                  Assigned:{' '}
                  {deal.assignedToUserId ? userName.get(deal.assignedToUserId) ?? 'Somebody no longer here' : 'Nobody yet'}
                </div>
                {deal.expectedCloseDate && <div>Expected close: {deal.expectedCloseDate}</div>}
              </dl>

              {canWrite && (
                <div className="mt-1 flex flex-col gap-2 border-t border-slate-100 pt-2">
                  <Select
                    id={`move-${deal.id}`}
                    label="Stage"
                    value={deal.stageId}
                    disabled={move.isPending}
                    options={stages.map((option) => ({ value: option.id, label: option.name }))}
                    onChange={(stageId) => {
                      if (stageId && stageId !== deal.stageId) move.mutate({ dealId: deal.id, stageId });
                    }}
                  />
                  {users.length > 0 && (
                    <Select
                      id={`assign-${deal.id}`}
                      label="Assigned to"
                      value={deal.assignedToUserId ?? ''}
                      placeholder="Unassigned"
                      disabled={reassign.isPending}
                      options={users.map((user) => ({ value: user.id, label: user.name }))}
                      onChange={(userId) => {
                        if (userId) reassign.mutate({ dealId: deal.id, userId });
                      }}
                    />
                  )}
                </div>
              )}
            </article>
          ))
        )}
      </div>
    </section>
  );
}

/**
 * "Edit labels" — the one place a company's pipeline itself changes: add, rename, reorder, and
 * mark at most one Stage each `won`/`lost`.
 *
 * Reordering has no endpoint of its own: `order` in a `PATCH` is read as "move to this
 * position", so the up/down buttons below are two ordinary edits, not a special action.
 */
function EditLabelsPanel({
  stages,
  onChanged,
  onClose,
}: {
  stages: StageSummary[];
  onChanged: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [outcome, setOutcome] = useState('');
  const [error, setError] = useState<string>();

  function onFailure(err: unknown) {
    setError(err instanceof ApiFailure ? err.message : 'That did not work.');
  }

  const add = useMutation({
    mutationFn: () =>
      api.post<StageResponse>(STAGE_PATHS.stages, {
        name,
        ...(outcome ? { outcome: outcome as SettableStageOutcome } : {}),
      } satisfies CreateStageRequest),
    onSuccess: () => {
      setName('');
      setOutcome('');
      setError(undefined);
      onChanged();
    },
    onError: onFailure,
  });

  const change = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateStageRequest }) =>
      api.patch<StageResponse>(STAGE_PATHS.stage(id), body),
    onSuccess: () => {
      setError(undefined);
      onChanged();
    },
    onError: onFailure,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(STAGE_PATHS.stage(id)),
    onSuccess: () => {
      setError(undefined);
      onChanged();
    },
    onError: onFailure,
  });

  const ordered = [...stages].sort((a, b) => a.order - b.order);

  return (
    <section aria-labelledby="edit-labels" className="flex flex-col gap-4 rounded-md border border-slate-200 bg-white p-4">
      <header className="flex items-center justify-between border-b border-slate-200 pb-2">
        <h2 id="edit-labels" className="text-base font-medium text-slate-900">
          Edit labels
        </h2>
        <button type="button" onClick={onClose} className="text-xs font-medium text-slate-600 hover:text-slate-900">
          Close
        </button>
      </header>

      {error && <FormError>{error}</FormError>}

      <ul className="flex flex-col gap-2">
        {ordered.length === 0 && <li className="text-sm text-slate-500">No stages yet.</li>}
        {ordered.map((stage, index) => (
          <StageRow
            key={stage.id}
            stage={stage}
            isFirst={index === 0}
            isLast={index === ordered.length - 1}
            pending={change.isPending || remove.isPending}
            onMove={(position) => change.mutate({ id: stage.id, body: { order: position } })}
            onRename={(newName) => change.mutate({ id: stage.id, body: { name: newName } })}
            onSetOutcome={(value) => change.mutate({ id: stage.id, body: { outcome: value } })}
            onDelete={() => remove.mutate(stage.id)}
          />
        ))}
      </ul>

      <form
        noValidate
        aria-labelledby="add-stage"
        className="flex flex-col gap-3 border-t border-slate-200 pt-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) add.mutate();
        }}
      >
        <h3 id="add-stage" className="text-sm font-medium text-slate-900">
          Add a stage
        </h3>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-48 flex-1">
            <Field id="new-stage-name" label="Name" value={name} onChange={setName} />
          </div>
          <div className="w-44">
            <Select
              id="new-stage-outcome"
              label="Outcome"
              value={outcome}
              placeholder="In flight"
              options={STAGE_OUTCOMES.map((value) => ({ value, label: STAGE_OUTCOME_LABELS[value] }))}
              onChange={setOutcome}
            />
          </div>
          <button
            type="submit"
            disabled={add.isPending || !name.trim()}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {add.isPending ? 'Adding…' : 'Add stage'}
          </button>
        </div>
      </form>
    </section>
  );
}

function StageRow({
  stage,
  isFirst,
  isLast,
  pending,
  onMove,
  onRename,
  onSetOutcome,
  onDelete,
}: {
  stage: StageSummary;
  isFirst: boolean;
  isLast: boolean;
  pending: boolean;
  onMove: (position: number) => void;
  onRename: (name: string) => void;
  onSetOutcome: (outcome: SettableStageOutcome) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(stage.name);

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-md border border-slate-100 bg-slate-50 p-2.5">
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={pending || isFirst}
          aria-label={`Move ${stage.name} up`}
          onClick={() => onMove(stage.order - 1)}
          className="rounded border border-slate-300 px-1.5 py-0.5 text-xs text-slate-700 disabled:opacity-30"
        >
          ↑
        </button>
        <button
          type="button"
          disabled={pending || isLast}
          aria-label={`Move ${stage.name} down`}
          onClick={() => onMove(stage.order + 1)}
          className="rounded border border-slate-300 px-1.5 py-0.5 text-xs text-slate-700 disabled:opacity-30"
        >
          ↓
        </button>
      </div>

      {editing ? (
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() && name !== stage.name) onRename(name);
            setEditing(false);
          }}
        >
          <div className="w-40">
            <Field id={`rename-${stage.id}`} label="Name" value={name} onChange={setName} />
          </div>
          <button type="submit" className="text-xs font-medium text-slate-900 underline">
            Save
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => {
            setName(stage.name);
            setEditing(true);
          }}
          className="font-medium text-slate-900 underline decoration-slate-300 underline-offset-2"
        >
          {stage.name}
        </button>
      )}

      <span className="text-xs text-slate-500">Position {stage.order}</span>

      {stage.outcome ? (
        <span className="rounded bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-800">
          Means: {STAGE_OUTCOME_LABELS[stage.outcome]}
        </span>
      ) : (
        <span className="flex items-center gap-1 text-xs text-slate-500">
          <button type="button" disabled={pending} onClick={() => onSetOutcome('won')} className="underline">
            Mark won
          </button>
          ·
          <button type="button" disabled={pending} onClick={() => onSetOutcome('lost')} className="underline">
            Mark lost
          </button>
        </span>
      )}

      <button
        type="button"
        disabled={pending}
        onClick={onDelete}
        className="ml-auto rounded px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
      >
        Delete
      </button>
    </li>
  );
}

function AddDealPanel({
  stages,
  parties,
  users,
  onAdded,
  onCancel,
}: {
  stages: StageSummary[];
  parties: PartySummary[];
  users: UserSummary[];
  onAdded: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [partyId, setPartyId] = useState('');
  const [stageId, setStageId] = useState(stages[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [expectedCloseDate, setExpectedCloseDate] = useState('');
  const [assignedToUserId, setAssignedToUserId] = useState('');

  const add = useMutation({
    mutationFn: () =>
      api.post<DealResponse>(DEAL_PATHS.deals, {
        name,
        partyId,
        stageId,
        amount,
        ...(expectedCloseDate ? { expectedCloseDate } : {}),
        ...(assignedToUserId ? { assignedToUserId } : {}),
      } satisfies CreateDealRequest),
    onSuccess: onAdded,
  });

  const failure = add.error instanceof ApiFailure ? add.error : undefined;
  const fields = failure?.fields ?? {};

  return (
    <form
      noValidate
      aria-labelledby="add-deal"
      className="flex flex-col gap-4 rounded-md border border-slate-200 bg-white p-4"
      onSubmit={(event) => {
        event.preventDefault();
        add.mutate();
      }}
    >
      <h2 id="add-deal" className="text-sm font-medium text-slate-900">
        Add a deal
      </h2>

      {failure && failure.code !== ERROR_CODES.validationFailed && <FormError>{failure.message}</FormError>}

      <div className="flex flex-wrap gap-4">
        <div className="min-w-56 flex-1">
          <Field id="deal-name" label="Name" value={name} error={fields.name} onChange={setName} />
        </div>
        <div className="min-w-56 flex-1">
          <Select
            id="deal-party"
            label="Party"
            value={partyId}
            placeholder="Choose a party…"
            error={fields.partyId}
            options={parties.map((party) => ({ value: party.id, label: party.name }))}
            onChange={setPartyId}
          />
        </div>
        <div className="min-w-44 flex-1">
          <Select
            id="deal-stage"
            label="Stage"
            value={stageId}
            error={fields.stageId}
            options={stages.map((stage) => ({ value: stage.id, label: stage.name }))}
            onChange={setStageId}
          />
        </div>
        <div className="min-w-44 flex-1">
          <MoneyInput
            id="deal-amount"
            label="Amount"
            value={amount}
            error={fields.amount}
            onChange={setAmount}
            currency={DEFAULT_CURRENCY}
          />
        </div>
        <div className="min-w-44 flex-1">
          <Field
            id="deal-close-date"
            label="Expected close date"
            type="date"
            value={expectedCloseDate}
            error={fields.expectedCloseDate}
            onChange={setExpectedCloseDate}
          />
        </div>
        {users.length > 0 && (
          <div className="min-w-44 flex-1">
            <Select
              id="deal-assignee"
              label="Assigned to"
              value={assignedToUserId}
              placeholder="Unassigned"
              options={users.map((user) => ({ value: user.id, label: user.name }))}
              onChange={setAssignedToUserId}
            />
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={add.isPending || !name.trim() || !partyId || !stageId}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {add.isPending ? 'Adding…' : 'Create deal'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
