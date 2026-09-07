import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ACTIVITY_TYPES,
  LEAD_STATUSES,
  PLAYBOOK_PATHS,
  SCRIPT_CATEGORIES,
  SCRIPT_PATHS,
  type ActivityType,
  type CreatePlaybookRequest,
  type CreateScriptRequest,
  type LeadStatus,
  type PlaybookListResponse,
  type PlaybookStepInput,
  type PlaybookSummary,
  type ScriptCategory,
  type ScriptListResponse,
  type ScriptSummary,
} from '@erp/shared';
import { ERROR_CODES } from '@erp/shared';
import { Field, FormError, Select } from '@erp/shared/ui';
import { ApiFailure, api } from '../../../api/client';
import { useSession } from '../../../session/SessionProvider';
import { hasPermission } from '../../../session/permissions';

const CATEGORY_LABELS: Record<ScriptCategory, string> = {
  opener: 'Opener',
  discovery: 'Discovery',
  objection: 'Objection',
  closing: 'Closing',
  general: 'General',
};

const STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  qualified: 'Qualified',
  disqualified: 'Disqualified',
};

const ACTIVITY_LABELS: Record<ActivityType, string> = {
  call: 'Call',
  email: 'Email',
  meeting: 'Meeting',
  note: 'Note',
  task: 'Task',
};

/**
 * The manager's authoring surface for the content-and-guidance track: the company's spoken
 * scripts, and the playbooks that sequence them. Deliberately lean — create and remove, not a
 * browsable library — because the scripts do their real work in context on the lead, not here.
 */
export function PlaybooksPage() {
  const { session } = useSession();

  if (!hasPermission(session, 'crm:playbooks:write')) {
    return (
      <div className="p-6">
        <p className="text-sm text-slate-600">You do not have access to author scripts and playbooks.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-slate-900">Scripts &amp; Playbooks</h1>
        <p className="text-sm text-slate-600">
          Author the call and objection scripts your reps deliver, and the playbooks that sequence
          them. Scripts merge in a lead's own details with tags like{' '}
          <code className="rounded bg-slate-100 px-1 text-xs">{'{{lead.name}}'}</code>, and surface
          on each lead in its Guidance tab.
        </p>
      </header>

      <ScriptsSection />
      <PlaybooksSection />
    </div>
  );
}

// ─── scripts ────────────────────────────────────────────────────────────────────────

function ScriptsSection() {
  const queryClient = useQueryClient();
  const scripts = useQuery({
    queryKey: ['crm', 'scripts', 'list'],
    queryFn: () => api.get<ScriptListResponse>(SCRIPT_PATHS.scripts),
  });

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['crm', 'scripts'] });
  }

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(SCRIPT_PATHS.script(id)),
    onSuccess: refresh,
  });

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-slate-900">Scripts</h2>

      <AddScript onAdded={refresh} />

      {scripts.data && scripts.data.items.length === 0 && (
        <p className="text-sm text-slate-500">No scripts yet. Add your first one above.</p>
      )}

      <div className="flex flex-col gap-3">
        {(scripts.data?.items ?? []).map((script) => (
          <ScriptRow key={script.id} script={script} onDelete={() => remove.mutate(script.id)} />
        ))}
      </div>
    </section>
  );
}

function ScriptRow({ script, onDelete }: { script: ScriptSummary; onDelete: () => void }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-slate-900">{script.title}</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">
            {CATEGORY_LABELS[script.category]}
          </span>
          <span className="text-xs text-slate-500">
            {script.leadStatus ? STATUS_LABELS[script.leadStatus as LeadStatus] ?? script.leadStatus : 'Any status'}
          </span>
        </div>
        <button
          type="button"
          onClick={onDelete}
          className="text-xs font-medium text-rose-600 hover:text-rose-900"
        >
          Delete
        </button>
      </div>
      <p className="whitespace-pre-wrap text-sm text-slate-600">{script.body}</p>
    </div>
  );
}

function AddScript({ onAdded }: { onAdded: () => void }) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<ScriptCategory>('opener');
  const [leadStatus, setLeadStatus] = useState('');
  const [body, setBody] = useState('');

  const add = useMutation({
    mutationFn: () =>
      api.post(SCRIPT_PATHS.scripts, {
        title,
        category,
        body,
        leadStatus: leadStatus === '' ? null : leadStatus,
      } satisfies CreateScriptRequest),
    onSuccess: () => {
      setTitle('');
      setBody('');
      setLeadStatus('');
      setCategory('opener');
      onAdded();
    },
  });

  const failure = add.error instanceof ApiFailure ? add.error : undefined;
  const fields = failure?.fields ?? {};

  return (
    <form
      noValidate
      className="flex flex-col gap-4 rounded-md border border-slate-200 bg-white p-4"
      onSubmit={(event) => {
        event.preventDefault();
        add.mutate();
      }}
    >
      <div className="flex flex-wrap gap-4">
        <div className="min-w-56 flex-1">
          <Field id="script-title" label="Title" value={title} error={fields.title} onChange={setTitle} />
        </div>
        <div className="min-w-40">
          <Select
            id="script-category"
            label="Category"
            value={category}
            options={SCRIPT_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))}
            onChange={(v) => setCategory(v as ScriptCategory)}
          />
        </div>
        <div className="min-w-40">
          <Select
            id="script-status"
            label="Relevant when"
            value={leadStatus}
            options={[
              { value: '', label: 'Any status' },
              ...LEAD_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] })),
            ]}
            onChange={setLeadStatus}
          />
        </div>
      </div>

      <LabeledTextarea
        id="script-body"
        label="Script"
        value={body}
        onChange={setBody}
        error={fields.body}
        rows={4}
        hint="Use {{lead.name}}, {{lead.organisationName}}, {{lead.email}}, {{lead.phone}} or {{custom.<field>}} to merge in the lead's data. Add |fallback for a default, e.g. {{lead.name|there}}."
      />

      {failure && failure.code !== ERROR_CODES.validationFailed && <FormError>{failure.message}</FormError>}

      <div>
        <button
          type="submit"
          disabled={add.isPending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {add.isPending ? 'Adding…' : 'Add script'}
        </button>
      </div>
    </form>
  );
}

// ─── playbooks ──────────────────────────────────────────────────────────────────────

function PlaybooksSection() {
  const queryClient = useQueryClient();
  const playbooks = useQuery({
    queryKey: ['crm', 'playbooks', 'list'],
    queryFn: () => api.get<PlaybookListResponse>(PLAYBOOK_PATHS.playbooks),
  });
  const scripts = useQuery({
    queryKey: ['crm', 'scripts', 'list'],
    queryFn: () => api.get<ScriptListResponse>(SCRIPT_PATHS.scripts),
  });

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['crm', 'playbooks'] });
  }

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(PLAYBOOK_PATHS.playbook(id)),
    onSuccess: refresh,
  });

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-slate-900">Playbooks</h2>

      <AddPlaybook scripts={scripts.data?.items ?? []} onAdded={refresh} />

      {playbooks.data && playbooks.data.items.length === 0 && (
        <p className="text-sm text-slate-500">No playbooks yet. Build your first one above.</p>
      )}

      <div className="flex flex-col gap-3">
        {(playbooks.data?.items ?? []).map((playbook) => (
          <PlaybookRow
            key={playbook.id}
            playbook={playbook}
            scripts={scripts.data?.items ?? []}
            onDelete={() => remove.mutate(playbook.id)}
          />
        ))}
      </div>
    </section>
  );
}

function PlaybookRow({
  playbook,
  scripts,
  onDelete,
}: {
  playbook: PlaybookSummary;
  scripts: ScriptSummary[];
  onDelete: () => void;
}) {
  const scriptTitle = (id: string | null) => (id ? scripts.find((s) => s.id === id)?.title ?? 'Script' : null);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col">
          <span className="text-sm font-bold text-slate-900">{playbook.name}</span>
          {playbook.description && <span className="text-xs text-slate-500">{playbook.description}</span>}
        </div>
        <button type="button" onClick={onDelete} className="text-xs font-medium text-rose-600 hover:text-rose-900">
          Delete
        </button>
      </div>
      <ol className="flex flex-col gap-1.5">
        {playbook.steps.map((step) => (
          <li key={step.id} className="flex gap-2 text-sm">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-600">
              {step.order}
            </span>
            <div className="flex flex-col">
              <span className="font-semibold text-slate-800">{step.title}</span>
              <span className="text-slate-600">{step.instruction}</span>
              <span className="text-xs text-slate-400">
                {[scriptTitle(step.scriptId), step.activityType ? ACTIVITY_LABELS[step.activityType] : null]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

const EMPTY_STEP: PlaybookStepInput = { title: '', instruction: '', scriptId: null, activityType: null };

function AddPlaybook({ scripts, onAdded }: { scripts: ScriptSummary[]; onAdded: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState<PlaybookStepInput[]>([{ ...EMPTY_STEP }]);

  function updateStep(index: number, patch: Partial<PlaybookStepInput>) {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function reset() {
    setName('');
    setDescription('');
    setSteps([{ ...EMPTY_STEP }]);
  }

  const add = useMutation({
    mutationFn: () =>
      api.post(PLAYBOOK_PATHS.playbooks, {
        name,
        description: description === '' ? null : description,
        steps: steps.map((s) => ({
          title: s.title,
          instruction: s.instruction,
          scriptId: s.scriptId || null,
          activityType: s.activityType || null,
        })),
      } satisfies CreatePlaybookRequest),
    onSuccess: () => {
      reset();
      onAdded();
    },
  });

  const failure = add.error instanceof ApiFailure ? add.error : undefined;
  const fields = failure?.fields ?? {};

  return (
    <form
      noValidate
      className="flex flex-col gap-4 rounded-md border border-slate-200 bg-white p-4"
      onSubmit={(event) => {
        event.preventDefault();
        add.mutate();
      }}
    >
      <div className="flex flex-wrap gap-4">
        <div className="min-w-56 flex-1">
          <Field id="playbook-name" label="Playbook name" value={name} error={fields.name} onChange={setName} />
        </div>
        <div className="min-w-56 flex-1">
          <Field
            id="playbook-description"
            label="Description (optional)"
            value={description}
            onChange={setDescription}
          />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Steps</span>
        {fields.steps && <p className="text-xs font-semibold text-rose-600">{fields.steps}</p>}

        {steps.map((step, index) => (
          <div key={index} className="flex flex-col gap-2 rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500">Step {index + 1}</span>
              {steps.length > 1 && (
                <button
                  type="button"
                  onClick={() => setSteps((prev) => prev.filter((_, i) => i !== index))}
                  className="text-xs font-medium text-rose-600 hover:text-rose-900"
                >
                  Remove
                </button>
              )}
            </div>
            <Field
              id={`step-title-${index}`}
              label="What the rep does"
              value={step.title}
              onChange={(v) => updateStep(index, { title: v })}
            />
            <LabeledTextarea
              id={`step-instruction-${index}`}
              label="Instruction"
              value={step.instruction}
              onChange={(v) => updateStep(index, { instruction: v })}
              rows={2}
            />
            <div className="flex flex-wrap gap-3">
              <div className="min-w-48 flex-1">
                <Select
                  id={`step-script-${index}`}
                  label="Script (optional)"
                  value={step.scriptId ?? ''}
                  options={[
                    { value: '', label: 'None' },
                    ...scripts.map((s) => ({ value: s.id, label: s.title })),
                  ]}
                  onChange={(v) => updateStep(index, { scriptId: v || null })}
                />
              </div>
              <div className="min-w-40">
                <Select
                  id={`step-activity-${index}`}
                  label="Logs as (optional)"
                  value={step.activityType ?? ''}
                  options={[
                    { value: '', label: 'None' },
                    ...ACTIVITY_TYPES.map((t) => ({ value: t, label: ACTIVITY_LABELS[t] })),
                  ]}
                  onChange={(v) => updateStep(index, { activityType: (v || null) as ActivityType | null })}
                />
              </div>
            </div>
          </div>
        ))}

        <button
          type="button"
          onClick={() => setSteps((prev) => [...prev, { ...EMPTY_STEP }])}
          className="self-start rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
        >
          + Add step
        </button>
      </div>

      {failure && failure.code !== ERROR_CODES.validationFailed && <FormError>{failure.message}</FormError>}

      <div>
        <button
          type="submit"
          disabled={add.isPending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {add.isPending ? 'Creating…' : 'Create playbook'}
        </button>
      </div>
    </form>
  );
}

// ─── shared bits ────────────────────────────────────────────────────────────────────

function LabeledTextarea({
  id,
  label,
  value,
  onChange,
  error,
  rows = 3,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  rows?: number;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-semibold text-slate-700">
        {label}
      </label>
      <textarea
        id={id}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
      />
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
      {error && <p className="text-xs font-semibold text-rose-600">{error}</p>}
    </div>
  );
}
