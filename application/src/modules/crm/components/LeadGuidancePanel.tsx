import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ACTIVITY_PATHS,
  LEAD_GUIDANCE_PATHS,
  PLAYBOOK_PATHS,
  type CreateActivityRequest,
  type GuidedNextAction,
  type LeadGuidanceResponse,
  type PlaybookListResponse,
  type ResolvedScript,
  type ScriptCategory,
} from '@erp/shared';
import { Select } from '@erp/shared/ui';
import { ApiFailure, api } from '../../../api/client';
import { BoltIcon, CheckIcon, CopyIcon } from '../icons';

const CATEGORY_LABELS: Record<ScriptCategory, string> = {
  opener: 'Opener',
  discovery: 'Discovery',
  objection: 'Objection',
  closing: 'Closing',
  general: 'General',
};

const CATEGORY_CLASSES: Record<ScriptCategory, string> = {
  opener: 'bg-sky-100 text-sky-700',
  discovery: 'bg-violet-100 text-violet-700',
  objection: 'bg-amber-100 text-amber-700',
  closing: 'bg-emerald-100 text-emerald-700',
  general: 'bg-slate-100 text-slate-600',
};

/**
 * The guided-selling surface on the lead: the one next-best-action, the lead's playbook
 * position, and the scripts relevant to where the lead is now — each rendered with the lead's
 * own data merged in and a one-click copy.
 *
 * `canWrite` (`crm:leads:write`) gates the acts that change the lead's workflow — starting or
 * advancing a play, and logging the recommended step as a task assigned to the current rep.
 * Everyone who can open the workspace can read the guidance.
 */
export function LeadGuidancePanel({
  leadId,
  canWrite,
  currentUserId,
}: {
  leadId: string;
  canWrite: boolean;
  currentUserId?: string;
}) {
  const queryClient = useQueryClient();

  const guidance = useQuery({
    queryKey: ['crm', 'guidance', leadId],
    queryFn: () => api.get<LeadGuidanceResponse>(LEAD_GUIDANCE_PATHS.guidance(leadId)),
  });

  const playbooks = useQuery({
    queryKey: ['crm', 'playbooks', 'list'],
    queryFn: () => api.get<PlaybookListResponse>(PLAYBOOK_PATHS.playbooks),
    enabled: canWrite,
  });

  const [selectedPlaybook, setSelectedPlaybook] = useState('');
  const [logged, setLogged] = useState(false);

  function refreshGuidance() {
    void queryClient.invalidateQueries({ queryKey: ['crm', 'guidance', leadId] });
  }

  const enroll = useMutation({
    mutationFn: (playbookId: string) =>
      api.post(LEAD_GUIDANCE_PATHS.enroll(leadId), { playbookId }),
    onSuccess: () => {
      setSelectedPlaybook('');
      refreshGuidance();
    },
  });

  const advance = useMutation({
    mutationFn: () => api.post(LEAD_GUIDANCE_PATHS.advance(leadId)),
    onSuccess: refreshGuidance,
  });

  const unenroll = useMutation({
    mutationFn: () => api.delete(LEAD_GUIDANCE_PATHS.unenroll(leadId)),
    onSuccess: refreshGuidance,
  });

  const logTask = useMutation({
    mutationFn: (action: GuidedNextAction) =>
      api.post(ACTIVITY_PATHS.activities, {
        type: 'task',
        notes: taskNotes(action),
        dueAt: todayIso(),
        leadId,
        ...(currentUserId ? { assignedToUserId: currentUserId } : {}),
      } satisfies CreateActivityRequest),
    onSuccess: () => {
      setLogged(true);
      window.setTimeout(() => setLogged(false), 2500);
      void queryClient.invalidateQueries({ queryKey: ['crm', 'activities'] });
    },
  });

  if (guidance.isPending) {
    return <p className="p-6 text-sm text-slate-500">Loading guidance…</p>;
  }
  if (guidance.isError) {
    const failure = guidance.error instanceof ApiFailure ? guidance.error : undefined;
    return (
      <p role="alert" className="p-6 text-sm font-semibold text-rose-600">
        {failure?.message ?? 'Could not load guidance.'}
      </p>
    );
  }

  const { nextBestAction, enrollment, scripts } = guidance.data;

  return (
    <div className="flex flex-col gap-4">
      {/* ── Next best action ── */}
      <section
        aria-label="Next best action"
        className="flex flex-col gap-3 rounded-2xl border border-teal-200 bg-teal-50/60 p-5"
      >
        <div className="flex items-center gap-2">
          <span className="text-teal-600">
            <BoltIcon size={16} />
          </span>
          <h3 className="text-xs font-bold uppercase tracking-wide text-teal-700">Next best action</h3>
        </div>

        <div className="flex flex-col gap-1">
          <p className="text-sm font-bold text-slate-900">{nextBestAction.title}</p>
          <p className="text-sm text-slate-700">{nextBestAction.instruction}</p>
          {nextBestAction.reason && (
            <p className="text-xs text-slate-500">{nextBestAction.reason}</p>
          )}
        </div>

        {nextBestAction.script && <ScriptCard script={nextBestAction.script} />}

        {canWrite && nextBestAction.kind !== 'none' && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={logTask.isPending}
              onClick={() => logTask.mutate(nextBestAction)}
              className="inline-flex items-center gap-1.5 rounded-md bg-teal-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-teal-700 disabled:opacity-50"
            >
              {logged ? (
                <>
                  <CheckIcon size={14} /> Task added
                </>
              ) : (
                'Log this as a task for me'
              )}
            </button>

            {nextBestAction.kind === 'playbook-step' && (
              <button
                type="button"
                disabled={advance.isPending}
                onClick={() => advance.mutate()}
                className="inline-flex items-center gap-1.5 rounded-md border border-teal-300 bg-white px-3 py-1.5 text-xs font-bold text-teal-700 hover:bg-teal-50 disabled:opacity-50"
              >
                Mark step done →
              </button>
            )}
          </div>
        )}
      </section>

      {/* ── Playbook position ── */}
      <section
        aria-label="Playbook"
        className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs"
      >
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Playbook</h3>

        {enrollment ? (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-bold text-slate-900">{enrollment.playbookName}</p>
              <span className="text-xs font-semibold text-slate-500">
                {enrollment.completedSteps} of {enrollment.totalSteps} done
              </span>
            </div>

            <ProgressBar completed={enrollment.completedSteps} total={enrollment.totalSteps} />

            {enrollment.currentStep ? (
              <p className="text-sm text-slate-700">
                <span className="font-semibold">Now:</span> {enrollment.currentStep.title}
              </p>
            ) : (
              <p className="text-sm font-semibold text-emerald-700">Play complete.</p>
            )}

            {canWrite && (
              <div className="flex flex-wrap items-center gap-2">
                {enrollment.currentStep && (
                  <button
                    type="button"
                    disabled={advance.isPending}
                    onClick={() => advance.mutate()}
                    className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-700 disabled:opacity-50"
                  >
                    Advance
                  </button>
                )}
                <button
                  type="button"
                  disabled={unenroll.isPending}
                  onClick={() => unenroll.mutate()}
                  className="text-xs font-semibold text-slate-500 hover:text-rose-600 disabled:opacity-50"
                >
                  Leave play
                </button>
              </div>
            )}
          </div>
        ) : canWrite ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-slate-600">This lead is on no play yet.</p>
            {(playbooks.data?.items.length ?? 0) === 0 ? (
              <p className="text-xs text-slate-500">
                No playbooks yet — a manager can create them on the Playbooks page.
              </p>
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-48 flex-1">
                  <Select
                    id="start-play"
                    label="Start a play"
                    value={selectedPlaybook}
                    options={[
                      { value: '', label: 'Choose a playbook…' },
                      ...(playbooks.data?.items ?? []).map((p) => ({ value: p.id, label: p.name })),
                    ]}
                    onChange={setSelectedPlaybook}
                  />
                </div>
                <button
                  type="button"
                  disabled={!selectedPlaybook || enroll.isPending}
                  onClick={() => selectedPlaybook && enroll.mutate(selectedPlaybook)}
                  className="rounded-md bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-slate-700 disabled:opacity-50"
                >
                  Start
                </button>
              </div>
            )}
            {enroll.error instanceof ApiFailure && (
              <p role="alert" className="text-xs font-semibold text-rose-600">
                {enroll.error.message}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-600">This lead is on no play.</p>
        )}
      </section>

      {/* ── Relevant scripts ── */}
      <section aria-label="Scripts" className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs">
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">
          Scripts for this lead
        </h3>

        {scripts.length === 0 ? (
          <p className="text-sm text-slate-500">
            No scripts fit this lead yet. A manager can add them on the Playbooks page.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {scripts.map((script) => (
              <ScriptCard key={script.id} script={script} withHeader />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ScriptCard({ script, withHeader = false }: { script: ResolvedScript; withHeader?: boolean }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(script.resolvedBody);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied; the text is on screen to copy by hand.
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {withHeader && <span className="text-sm font-bold text-slate-900">{script.title}</span>}
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${CATEGORY_CLASSES[script.category]}`}
          >
            {CATEGORY_LABELS[script.category]}
          </span>
        </div>
        <button
          type="button"
          onClick={copy}
          aria-label="Copy script"
          className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-100"
        >
          {copied ? (
            <>
              <CheckIcon size={12} /> Copied
            </>
          ) : (
            <>
              <CopyIcon size={12} /> Copy
            </>
          )}
        </button>
      </div>
      <p className="whitespace-pre-wrap text-sm text-slate-700">{script.resolvedBody}</p>
    </div>
  );
}

function ProgressBar({ completed, total }: { completed: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((completed / total) * 100);
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div className="h-full rounded-full bg-teal-500 transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** The recommendation, turned into the notes of the task it becomes. */
function taskNotes(action: GuidedNextAction): string {
  return action.instruction ? `${action.title} — ${action.instruction}` : action.title;
}

/** Today, as the `YYYY-MM-DD` a task's due date takes. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
