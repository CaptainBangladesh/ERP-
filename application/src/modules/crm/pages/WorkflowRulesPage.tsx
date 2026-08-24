import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import {
  ERROR_CODES,
  WORKFLOW_ACTION_TYPES,
  WORKFLOW_RULE_FIELDS,
  WORKFLOW_RULE_PATHS,
  WORKFLOW_TRIGGER_TYPES,
  emptyPage,
  listPath,
  listQueryString,
  type CreateWorkflowRuleRequest,
  type ListQuery,
  type WorkflowActionType,
  type WorkflowRuleListResponse,
  type WorkflowRuleResponse,
  type WorkflowRuleSummary,
  type WorkflowTriggerType,
} from '@erp/shared';
import { DataTable, Field, FormError, Select } from '@erp/shared/ui';
import { ApiFailure, api } from '../../../api/client';
import { useSession } from '../../../session/SessionProvider';
import { hasPermission } from '../../../session/permissions';

const TRIGGER_LABELS: Record<WorkflowTriggerType, string> = {
  'deal.stage_changed': 'Deal stage changed',
  'lead.status_changed': 'Lead status changed',
};

const ACTION_LABELS: Record<WorkflowActionType, string> = {
  notify_user: 'Notify user',
  update_field: 'Update field',
  create_task: 'Create task',
};

export function WorkflowRulesPage() {
  const { session } = useSession();
  const canWrite = hasPermission(session, 'crm:workflow-rules:write');
  const [query, setQuery] = useState<ListQuery>({});
  const queryClient = useQueryClient();

  const rules = useQuery({
    queryKey: ['crm', 'workflow-rules', 'list', listQueryString(query)],
    queryFn: () => api.get<WorkflowRuleListResponse>(listPath(WORKFLOW_RULE_PATHS.rules, query)),
  });

  const failure = rules.error instanceof ApiFailure ? rules.error : undefined;

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['crm', 'workflow-rules'] });
  }

  const toggleRule = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patch<WorkflowRuleResponse>(WORKFLOW_RULE_PATHS.rule(id), { enabled }),
    onSuccess: refresh,
  });

  const deleteRule = useMutation({
    mutationFn: (id: string) => api.delete<void>(WORKFLOW_RULE_PATHS.rule(id)),
    onSuccess: refresh,
  });

  const columns = useMemo<Array<ColumnDef<WorkflowRuleSummary, unknown>>>(
    () => [
      {
        id: WORKFLOW_RULE_FIELDS.name,
        header: 'Rule Name',
        cell: ({ row }) => (
          <span className="font-medium text-slate-900">{row.original.name}</span>
        ),
      },
      {
        id: WORKFLOW_RULE_FIELDS.triggerType,
        header: 'Trigger',
        cell: ({ row }) => {
          const r = row.original;
          const label = TRIGGER_LABELS[r.triggerType] ?? r.triggerType;
          const config = r.triggerConfig;
          let detail = 'Any change';
          if (config?.toStageId) detail = `Stage ID: ${config.toStageId}`;
          if (config?.toStatus) detail = `Status: ${config.toStatus}`;
          return (
            <div className="flex flex-col text-xs">
              <span className="font-medium text-slate-900">{label}</span>
              <span className="text-slate-500">{detail}</span>
            </div>
          );
        },
      },
      {
        id: WORKFLOW_RULE_FIELDS.actionType,
        header: 'Action',
        cell: ({ row }) => {
          const r = row.original;
          const label = ACTION_LABELS[r.actionType] ?? r.actionType;
          const config = r.actionConfig;
          let detail = '';
          if (r.actionType === 'notify_user') {
            detail = config.userId ? `User: ${config.userId}` : 'Assigned User';
          } else if (r.actionType === 'update_field') {
            detail = `${config.field} = "${config.value}"`;
          } else if (r.actionType === 'create_task') {
            detail = `Notes: "${config.notes ?? ''}"`;
          }
          return (
            <div className="flex flex-col text-xs">
              <span className="font-medium text-slate-900">{label}</span>
              {detail && <span className="text-slate-500">{detail}</span>}
            </div>
          );
        },
      },
      {
        id: WORKFLOW_RULE_FIELDS.enabled,
        header: 'Status',
        cell: ({ row }) => (
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
              row.original.enabled
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-slate-100 text-slate-600'
            }`}
          >
            {row.original.enabled ? 'Enabled' : 'Disabled'}
          </span>
        ),
      },
      ...(canWrite
        ? [
            {
              id: 'actions',
              header: '',
              cell: ({ row }: { row: { original: WorkflowRuleSummary } }) => (
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      toggleRule.mutate({ id: row.original.id, enabled: !row.original.enabled })
                    }
                    className="text-xs font-medium text-slate-600 hover:text-slate-900"
                  >
                    {row.original.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteRule.mutate(row.original.id)}
                    className="text-xs font-medium text-rose-600 hover:text-rose-900"
                  >
                    Delete
                  </button>
                </div>
              ),
            },
          ]
        : []),
    ],
    [canWrite, deleteRule, toggleRule],
  );

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-slate-900">Workflow Automation Rules</h1>
        <p className="text-sm text-slate-600">
          Configure event-triggered automation rules. When a Deal changes stage or a Lead changes status,
          matching rules automatically fire actions such as notifying users, updating fields, or creating tasks.
        </p>
      </header>

      {canWrite && <AddWorkflowRule onAdded={refresh} />}

      <DataTable
        caption="Workflow Rules"
        columns={columns}
        rows={rules.data?.items ?? []}
        rowId={(rule) => rule.id}
        page={rules.data?.page ?? emptyPage()}
        query={query}
        onQueryChange={setQuery}
        status={rules.isPending ? 'loading' : rules.isError ? 'error' : 'ready'}
        error={failure?.message}
        onRetry={() => void rules.refetch()}
        searchLabel="Search by rule name"
        empty={
          <div className="flex flex-col gap-1">
            <p className="font-medium text-slate-900">No workflow rules configured yet.</p>
            <p>Create your first automation rule using the form above.</p>
          </div>
        }
      />
    </div>
  );
}

function AddWorkflowRule({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState('');
  const [triggerType, setTriggerType] = useState<WorkflowTriggerType>('deal.stage_changed');
  const [toStageId, setToStageId] = useState('');
  const [toStatus, setToStatus] = useState('');
  const [actionType, setActionType] = useState<WorkflowActionType>('notify_user');
  const [actionUserId, setActionUserId] = useState('');
  const [actionField, setActionField] = useState('');
  const [actionValue, setActionValue] = useState('');
  const [actionNotes, setActionNotes] = useState('');
  const [actionDueInDays, setActionDueInDays] = useState('1');

  const add = useMutation({
    mutationFn: () => {
      let triggerConfig: Record<string, unknown> | null = null;
      if (triggerType === 'deal.stage_changed' && toStageId) {
        triggerConfig = { toStageId };
      } else if (triggerType === 'lead.status_changed' && toStatus) {
        triggerConfig = { toStatus };
      }

      let actionConfig: Record<string, unknown> = {};
      if (actionType === 'notify_user') {
        actionConfig = actionUserId ? { userId: actionUserId } : {};
      } else if (actionType === 'update_field') {
        actionConfig = { field: actionField, value: actionValue };
      } else if (actionType === 'create_task') {
        actionConfig = { notes: actionNotes, dueInDays: parseInt(actionDueInDays, 10) || 1 };
      }

      return api.post<WorkflowRuleResponse>(WORKFLOW_RULE_PATHS.rules, {
        name,
        triggerType,
        triggerConfig,
        actionType,
        actionConfig,
        enabled: true,
      } satisfies CreateWorkflowRuleRequest);
    },
    onSuccess: () => {
      setName('');
      setToStageId('');
      setToStatus('');
      setActionUserId('');
      setActionField('');
      setActionValue('');
      setActionNotes('');
      setActionDueInDays('1');
      onAdded();
    },
  });

  const failure = add.error instanceof ApiFailure ? add.error : undefined;
  const fields = failure?.fields ?? {};

  return (
    <form
      noValidate
      aria-labelledby="add-rule"
      className="flex flex-col gap-4 rounded-md border border-slate-200 bg-white p-4"
      onSubmit={(event) => {
        event.preventDefault();
        add.mutate();
      }}
    >
      <h2 id="add-rule" className="text-sm font-medium text-slate-900">
        Add a workflow rule
      </h2>

      <div className="flex flex-wrap gap-4">
        <div className="min-w-56 flex-1">
          <Field id="rule-name" label="Rule Name" value={name} error={fields.name} onChange={setName} />
        </div>
        <div className="min-w-56 flex-1">
          <Select
            id="trigger-type"
            label="Trigger Type"
            value={triggerType}
            options={WORKFLOW_TRIGGER_TYPES.map((t) => ({ value: t, label: TRIGGER_LABELS[t] }))}
            onChange={(val) => setTriggerType(val as WorkflowTriggerType)}
          />
        </div>

        {triggerType === 'deal.stage_changed' ? (
          <div className="min-w-56 flex-1">
            <Field
              id="to-stage-id"
              label="Target Stage ID (Optional)"
              value={toStageId}
              onChange={setToStageId}
            />
          </div>
        ) : (
          <div className="min-w-56 flex-1">
            <Select
              id="to-status"
              label="Target Status (Optional)"
              value={toStatus}
              options={[
                { value: '', label: 'Any status' },
                { value: 'new', label: 'New' },
                { value: 'contacted', label: 'Contacted' },
                { value: 'qualified', label: 'Qualified' },
                { value: 'disqualified', label: 'Disqualified' },
              ]}
              onChange={setToStatus}
            />
          </div>
        )}

        <div className="min-w-56 flex-1">
          <Select
            id="action-type"
            label="Action Type"
            value={actionType}
            options={WORKFLOW_ACTION_TYPES.map((a) => ({ value: a, label: ACTION_LABELS[a] }))}
            onChange={(val) => setActionType(val as WorkflowActionType)}
          />
        </div>
      </div>

      {actionType === 'notify_user' && (
        <div className="min-w-56 flex-1">
          <Field
            id="action-user-id"
            label="User ID to Notify (Optional)"
            value={actionUserId}
            onChange={setActionUserId}
          />
        </div>
      )}

      {actionType === 'update_field' && (
        <div className="flex flex-wrap gap-4">
          <div className="min-w-56 flex-1">
            <Field
              id="action-field"
              label="Field Name (e.g. phone, email, notes)"
              value={actionField}
              error={fields.actionConfig}
              onChange={setActionField}
            />
          </div>
          <div className="min-w-56 flex-1">
            <Field
              id="action-value"
              label="New Field Value"
              value={actionValue}
              onChange={setActionValue}
            />
          </div>
        </div>
      )}

      {actionType === 'create_task' && (
        <div className="flex flex-wrap gap-4">
          <div className="min-w-56 flex-1">
            <Field
              id="action-notes"
              label="Task Notes"
              value={actionNotes}
              onChange={setActionNotes}
            />
          </div>
          <div className="w-32">
            <Field
              id="action-due-in-days"
              label="Due in Days"
              type="text"
              value={actionDueInDays}
              onChange={setActionDueInDays}
            />
          </div>
        </div>
      )}

      {failure && failure.code !== ERROR_CODES.validationFailed && (
        <FormError>{failure.message}</FormError>
      )}

      <div>
        <button
          type="submit"
          disabled={add.isPending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {add.isPending ? 'Adding…' : 'Add rule'}
        </button>
      </div>
    </form>
  );
}
