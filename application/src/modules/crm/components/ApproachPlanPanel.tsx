import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  APPROACH_PLAN_PATHS,
  type ApproachPlanResponse,
  type SaveApproachPlanRequest,
} from '@erp/shared';
import { ApiFailure, api } from '../../../api/client';

interface PlanFieldSpec {
  key: keyof SaveApproachPlanRequest;
  label: string;
  hint: string;
  rows: number;
}

/**
 * The four structured intent fields of the approach plan, plus the free-notes block. Structured
 * enough to prompt a rep on what a plan should hold and to scan across leads; the notes block is
 * the escape hatch for everything the fields don't.
 */
const STRUCTURED_FIELDS: PlanFieldSpec[] = [
  { key: 'angle', label: 'Angle', hint: 'The story or wedge we lead with on this prospect.', rows: 3 },
  { key: 'decisionMakers', label: 'Decision-makers', hint: 'Who has to say yes, and what we know about them.', rows: 3 },
  { key: 'objections', label: 'Objections to expect', hint: 'What we expect to hear, and how we answer it.', rows: 3 },
  { key: 'nextSteps', label: 'Next steps', hint: 'The concrete moves we plan next — intent, not logged history.', rows: 3 },
];

type PlanForm = Record<keyof SaveApproachPlanRequest, string>;

const EMPTY_FORM: PlanForm = { angle: '', decisionMakers: '', objections: '', nextSteps: '', notes: '' };

function toForm(plan: ApproachPlanResponse | undefined): PlanForm {
  if (!plan) return EMPTY_FORM;
  return {
    angle: plan.angle ?? '',
    decisionMakers: plan.decisionMakers ?? '',
    objections: plan.objections ?? '',
    nextSteps: plan.nextSteps ?? '',
    notes: plan.notes ?? '',
  };
}

/** A blank string is sent as null so it clears the field rather than storing "". */
function toRequest(form: PlanForm): SaveApproachPlanRequest {
  const blankToNull = (v: string) => (v.trim() === '' ? null : v);
  return {
    angle: blankToNull(form.angle),
    decisionMakers: blankToNull(form.decisionMakers),
    objections: blankToNull(form.objections),
    nextSteps: blankToNull(form.nextSteps),
    notes: blankToNull(form.notes),
  };
}

/**
 * The lead's approach plan — how we'll approach *this* prospect. Intent, kept distinct from the
 * activity timeline (which is history). `canWrite` (`crm:leads:write`) gates editing; a rep who can
 * only read sees the plan without the inputs.
 */
export function ApproachPlanPanel({ leadId, canWrite }: { leadId: string; canWrite: boolean }) {
  const queryClient = useQueryClient();
  const plan = useQuery({
    queryKey: ['crm', 'approach-plan', leadId],
    queryFn: () => api.get<ApproachPlanResponse>(APPROACH_PLAN_PATHS.byLead(leadId)),
  });

  const [form, setForm] = useState<PlanForm>(EMPTY_FORM);
  const [dirty, setDirty] = useState(false);

  // Load the fetched plan into the form once it arrives, unless the rep has unsaved edits.
  useEffect(() => {
    if (plan.data && !dirty) setForm(toForm(plan.data));
  }, [plan.data, dirty]);

  const save = useMutation({
    mutationFn: () => api.put<ApproachPlanResponse>(APPROACH_PLAN_PATHS.byLead(leadId), toRequest(form)),
    onSuccess: (saved) => {
      setDirty(false);
      queryClient.setQueryData(['crm', 'approach-plan', leadId], saved);
    },
  });

  function update(key: keyof PlanForm, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  if (plan.isLoading) {
    return <p className="p-4 text-sm text-slate-500">Loading the approach plan…</p>;
  }

  const failure = save.error instanceof ApiFailure ? save.error : undefined;
  const fields = failure?.fields ?? {};
  const lastSaved = plan.data?.updatedAt ? new Date(plan.data.updatedAt) : null;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-slate-900">Approach plan</h2>
        <p className="text-sm text-slate-600">
          How we'll approach this prospect — the intent behind the outreach, kept apart from the
          activity timeline. One plan per lead.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {STRUCTURED_FIELDS.map((spec) => (
          <PlanField
            key={spec.key}
            id={`plan-${spec.key}`}
            label={spec.label}
            hint={spec.hint}
            rows={spec.rows}
            value={form[spec.key]}
            error={fields[spec.key]}
            readOnly={!canWrite}
            onChange={(v) => update(spec.key, v)}
          />
        ))}
      </div>

      <PlanField
        id="plan-notes"
        label="Notes"
        hint="Anything the fields above don't hold."
        rows={5}
        value={form.notes}
        error={fields.notes}
        readOnly={!canWrite}
        onChange={(v) => update('notes', v)}
      />

      {canWrite && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate()}
            className="rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {save.isPending ? 'Saving…' : 'Save plan'}
          </button>
          {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
          {!dirty && lastSaved && (
            <span className="text-xs text-slate-400">Last saved {lastSaved.toLocaleString()}</span>
          )}
        </div>
      )}

      {failure && !Object.keys(fields).length && (
        <p role="alert" className="text-xs font-semibold text-rose-600">
          {failure.message}
        </p>
      )}
    </div>
  );
}

function PlanField({
  id,
  label,
  hint,
  rows,
  value,
  error,
  readOnly,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  rows: number;
  value: string;
  error?: string;
  readOnly: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-xs font-semibold text-slate-700">
        {label}
      </label>
      {readOnly ? (
        <p className="min-h-[2.5rem] whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          {value || <span className="text-slate-400">—</span>}
        </p>
      ) : (
        <textarea
          id={id}
          rows={rows}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
        />
      )}
      {hint && !readOnly && <p className="text-xs text-slate-400">{hint}</p>}
      {error && <p className="text-xs font-semibold text-rose-600">{error}</p>}
    </div>
  );
}
