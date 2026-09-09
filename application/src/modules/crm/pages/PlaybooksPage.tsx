import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ACTIVITY_TYPES,
  ERROR_CODES,
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
  type UpdatePlaybookRequest,
  type UpdateScriptRequest,
} from '@erp/shared';
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

export function ScriptsSection() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingScript, setEditingScript] = useState<ScriptSummary | null>(null);
  const [confirmDeleteScript, setConfirmDeleteScript] = useState<ScriptSummary | null>(null);

  const scripts = useQuery({
    queryKey: ['crm', 'scripts', 'list'],
    queryFn: () => api.get<ScriptListResponse>(SCRIPT_PATHS.scripts),
  });

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['crm', 'scripts'] });
  }

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(SCRIPT_PATHS.script(id)),
    onSuccess: () => {
      setConfirmDeleteScript(null);
      refresh();
    },
  });

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Scripts</h2>
          <p className="text-xs text-slate-500">
            Spoken scripts, objection handles, and elevator pitches displayed in lead guidance.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setEditingScript(null);
            setModalOpen(true);
          }}
          className="rounded-md bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white shadow-2xs hover:bg-slate-800"
        >
          + New Script
        </button>
      </div>

      {scripts.data && scripts.data.items.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center">
          <p className="text-sm text-slate-500">No scripts yet. Add your first sales script above.</p>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {(scripts.data?.items ?? []).map((script) => (
          <ScriptRow
            key={script.id}
            script={script}
            onEdit={() => {
              setEditingScript(script);
              setModalOpen(true);
            }}
            onDelete={() => setConfirmDeleteScript(script)}
          />
        ))}
      </div>

      {modalOpen && (
        <AuthorScriptModal
          script={editingScript}
          onClose={() => {
            setModalOpen(false);
            setEditingScript(null);
          }}
          onSuccess={() => {
            setModalOpen(false);
            setEditingScript(null);
            refresh();
          }}
        />
      )}

      {confirmDeleteScript && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <h3 className="text-base font-bold text-slate-900">Delete Script?</h3>
            <p className="mt-2 text-sm text-slate-600">
              Are you sure you want to delete <strong className="text-slate-900">"{confirmDeleteScript.title}"</strong>?
              This will remove it from the workspace guidance rails for all representatives.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmDeleteScript(null)}
                className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={remove.isPending}
                onClick={() => remove.mutate(confirmDeleteScript.id)}
                className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {remove.isPending ? 'Deleting…' : 'Delete Script'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function ScriptRow({
  script,
  onEdit,
  onDelete,
}: {
  script: ScriptSummary;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-4 shadow-2xs">
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
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onEdit}
            className="text-xs font-medium text-slate-600 hover:text-slate-900"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="text-xs font-medium text-rose-600 hover:text-rose-900"
          >
            Delete
          </button>
        </div>
      </div>
      <p className="whitespace-pre-wrap text-sm text-slate-600">{script.body}</p>
    </div>
  );
}

interface AuthorScriptModalProps {
  script: ScriptSummary | null;
  onClose: () => void;
  onSuccess: () => void;
}

function AuthorScriptModal({ script, onClose, onSuccess }: AuthorScriptModalProps) {
  const isEdit = Boolean(script);
  const [title, setTitle] = useState(script?.title ?? '');
  const [category, setCategory] = useState<ScriptCategory>(script?.category ?? 'opener');
  const [leadStatus, setLeadStatus] = useState<string>(script?.leadStatus ?? '');
  const [body, setBody] = useState(script?.body ?? '');

  const saveMutation = useMutation({
    mutationFn: () => {
      if (isEdit && script) {
        return api.patch(SCRIPT_PATHS.script(script.id), {
          title,
          category,
          body,
          leadStatus: leadStatus === '' ? null : leadStatus,
        } satisfies UpdateScriptRequest);
      }
      return api.post(SCRIPT_PATHS.scripts, {
        title,
        category,
        body,
        leadStatus: leadStatus === '' ? null : leadStatus,
      } satisfies CreateScriptRequest);
    },
    onSuccess,
  });

  const failure = saveMutation.error instanceof ApiFailure ? saveMutation.error : undefined;
  const fields = failure?.fields ?? {};

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 className="text-base font-bold text-slate-900">
            {isEdit ? 'Edit Sales Script' : 'Create Sales Script'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            ✕
          </button>
        </div>

        <form
          noValidate
          className="mt-4 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            saveMutation.mutate();
          }}
        >
          <div className="flex flex-wrap gap-4">
            <div className="min-w-56 flex-1">
              <Field id="script-title" label="Title" value={title} error={fields.title} onChange={setTitle} />
            </div>
            <div className="min-w-36">
              <Select
                id="script-category"
                label="Category"
                value={category}
                options={SCRIPT_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))}
                onChange={(v) => setCategory(v as ScriptCategory)}
              />
            </div>
            <div className="min-w-36">
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
            label="Script Content"
            value={body}
            onChange={setBody}
            error={fields.body}
            rows={5}
            hint="Use {{lead.name}}, {{lead.organisationName}}, {{lead.email}}, {{lead.phone}} or {{custom.<field>}} to merge lead details. Add |fallback for defaults, e.g. {{lead.name|there}}."
          />

          {failure && failure.code !== ERROR_CODES.validationFailed && (
            <FormError>{failure.message}</FormError>
          )}

          <div className="mt-2 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saveMutation.isPending}
              className="rounded-md bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {saveMutation.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Script'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── playbooks ──────────────────────────────────────────────────────────────────────

export function PlaybooksSection() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPlaybook, setEditingPlaybook] = useState<PlaybookSummary | null>(null);
  const [confirmDeletePlaybook, setConfirmDeletePlaybook] = useState<PlaybookSummary | null>(null);

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
    onSuccess: () => {
      setConfirmDeletePlaybook(null);
      refresh();
    },
  });

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Playbooks</h2>
          <p className="text-xs text-slate-500">
            Multi-step sales cadences sequencing discovery, outreach, and objection handling.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setEditingPlaybook(null);
            setModalOpen(true);
          }}
          className="rounded-md bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white shadow-2xs hover:bg-slate-800"
        >
          + New Playbook
        </button>
      </div>

      {playbooks.data && playbooks.data.items.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center">
          <p className="text-sm text-slate-500">No playbooks yet. Build your first sales sequence above.</p>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {(playbooks.data?.items ?? []).map((playbook) => (
          <PlaybookRow
            key={playbook.id}
            playbook={playbook}
            scripts={scripts.data?.items ?? []}
            onEdit={() => {
              setEditingPlaybook(playbook);
              setModalOpen(true);
            }}
            onDelete={() => setConfirmDeletePlaybook(playbook)}
          />
        ))}
      </div>

      {modalOpen && (
        <AuthorPlaybookModal
          playbook={editingPlaybook}
          scripts={scripts.data?.items ?? []}
          onClose={() => {
            setModalOpen(false);
            setEditingPlaybook(null);
          }}
          onSuccess={() => {
            setModalOpen(false);
            setEditingPlaybook(null);
            refresh();
          }}
        />
      )}

      {confirmDeletePlaybook && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <h3 className="text-base font-bold text-slate-900">Delete Playbook?</h3>
            <p className="mt-2 text-sm text-slate-600">
              Are you sure you want to delete <strong className="text-slate-900">"{confirmDeletePlaybook.name}"</strong>?
              Leads enrolled in this sequence will be unenrolled.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmDeletePlaybook(null)}
                className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={remove.isPending}
                onClick={() => remove.mutate(confirmDeletePlaybook.id)}
                className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {remove.isPending ? 'Deleting…' : 'Delete Playbook'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function PlaybookRow({
  playbook,
  scripts,
  onEdit,
  onDelete,
}: {
  playbook: PlaybookSummary;
  scripts: ScriptSummary[];
  onEdit: () => void;
  onDelete: () => void;
}) {
  const scriptTitle = (id: string | null) => (id ? scripts.find((s) => s.id === id)?.title ?? 'Script' : null);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-4 shadow-2xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col">
          <span className="text-sm font-bold text-slate-900">{playbook.name}</span>
          {playbook.description && <span className="text-xs text-slate-500">{playbook.description}</span>}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onEdit}
            className="text-xs font-medium text-slate-600 hover:text-slate-900"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="text-xs font-medium text-rose-600 hover:text-rose-900"
          >
            Delete
          </button>
        </div>
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

interface AuthorPlaybookModalProps {
  playbook: PlaybookSummary | null;
  scripts: ScriptSummary[];
  onClose: () => void;
  onSuccess: () => void;
}

function AuthorPlaybookModal({ playbook, scripts, onClose, onSuccess }: AuthorPlaybookModalProps) {
  const isEdit = Boolean(playbook);
  const [name, setName] = useState(playbook?.name ?? '');
  const [description, setDescription] = useState(playbook?.description ?? '');
  const [steps, setSteps] = useState<PlaybookStepInput[]>(
    playbook && playbook.steps.length > 0
      ? playbook.steps.map((s) => ({
          title: s.title,
          instruction: s.instruction,
          scriptId: s.scriptId,
          activityType: s.activityType,
        }))
      : [{ ...EMPTY_STEP }],
  );

  function updateStep(index: number, patch: Partial<PlaybookStepInput>) {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      const payloadSteps = steps.map((s) => ({
        title: s.title,
        instruction: s.instruction,
        scriptId: s.scriptId || null,
        activityType: s.activityType || null,
      }));

      if (isEdit && playbook) {
        return api.patch(PLAYBOOK_PATHS.playbook(playbook.id), {
          name,
          description: description === '' ? null : description,
          steps: payloadSteps,
        } satisfies UpdatePlaybookRequest);
      }

      return api.post(PLAYBOOK_PATHS.playbooks, {
        name,
        description: description === '' ? null : description,
        steps: payloadSteps,
      } satisfies CreatePlaybookRequest);
    },
    onSuccess,
  });

  const failure = saveMutation.error instanceof ApiFailure ? saveMutation.error : undefined;
  const fields = failure?.fields ?? {};

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 overflow-y-auto">
      <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-6 shadow-xl my-8">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 className="text-base font-bold text-slate-900">
            {isEdit ? 'Edit Sales Playbook' : 'Create Sales Playbook'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            ✕
          </button>
        </div>

        <form
          noValidate
          className="mt-4 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            saveMutation.mutate();
          }}
        >
          <Field id="playbook-name" label="Playbook Name" value={name} error={fields.name} onChange={setName} />
          <Field
            id="playbook-description"
            label="Description (optional)"
            value={description}
            error={fields.description}
            onChange={setDescription}
          />

          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between border-t border-slate-100 pt-3">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Ordered Steps</span>
              <button
                type="button"
                onClick={() => setSteps((prev) => [...prev, { ...EMPTY_STEP }])}
                className="rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                + Add Step
              </button>
            </div>

            {steps.map((step, index) => (
              <div
                key={index}
                className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700">Step {index + 1}</span>
                  {steps.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setSteps((prev) => prev.filter((_, i) => i !== index))}
                      className="text-xs text-rose-600 hover:text-rose-800"
                    >
                      Remove
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field
                    id={`step-${index}-title`}
                    label="Step title"
                    value={step.title}
                    onChange={(v) => updateStep(index, { title: v })}
                  />
                  <Select
                    id={`step-${index}-activity`}
                    label="Action logged"
                    value={step.activityType ?? ''}
                    options={[
                      { value: '', label: 'None' },
                      ...ACTIVITY_TYPES.map((a) => ({ value: a, label: ACTIVITY_LABELS[a] })),
                    ]}
                    onChange={(v) => updateStep(index, { activityType: (v as ActivityType) || null })}
                  />
                </div>

                <Field
                  id={`step-${index}-instruction`}
                  label="Rep instruction"
                  value={step.instruction}
                  onChange={(v) => updateStep(index, { instruction: v })}
                />

                <Select
                  id={`step-${index}-script`}
                  label="Script to deliver (optional)"
                  value={step.scriptId ?? ''}
                  options={[
                    { value: '', label: 'No script attached' },
                    ...scripts.map((s) => ({ value: s.id, label: s.title })),
                  ]}
                  onChange={(v) => updateStep(index, { scriptId: v || null })}
                />
              </div>
            ))}
          </div>

          {failure && failure.code !== ERROR_CODES.validationFailed && (
            <FormError>{failure.message}</FormError>
          )}

          <div className="mt-4 flex justify-end gap-3 border-t border-slate-100 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saveMutation.isPending}
              className="rounded-md bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {saveMutation.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Playbook'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function LabeledTextarea({
  id,
  label,
  value,
  onChange,
  error,
  rows,
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
        rows={rows ?? 4}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
      />
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
      {error && <p className="text-xs font-semibold text-rose-600">{error}</p>}
    </div>
  );
}
