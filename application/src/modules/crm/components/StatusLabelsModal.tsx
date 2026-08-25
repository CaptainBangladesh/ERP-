import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  LEAD_STATUSES,
  LEAD_STATUS_LABEL_PATHS,
  type LeadStatus,
  type LeadStatusLabelSummary,
  type UpdateLeadStatusLabelRequest,
} from '@erp/shared';
import { ApiFailure, api } from '../../../api/client';
import { Field, FormError } from '@erp/shared/ui';
import { LEAD_VOCABULARY_KEY, useLeadStatusLabels } from '../vocabulary';

/**
 * Renaming and recolouring the four statuses.
 *
 * Worth being explicit on the screen about what this does not do, because the affordance looks
 * like it might: the four statuses are the lifecycle the whole module runs on, so this changes
 * captions. It cannot add a fifth, and nothing here touches qualify, disqualify or the
 * automation rules that name statuses by value.
 */
export function StatusLabelsModal({ onClose }: { onClose: () => void }) {
  const labels = useLeadStatusLabels();
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<LeadStatus, string>>(() =>
    Object.fromEntries(LEAD_STATUSES.map((status) => [status, labels[status].label])) as Record<
      LeadStatus,
      string
    >,
  );

  const save = useMutation({
    mutationFn: (change: { status: LeadStatus } & UpdateLeadStatusLabelRequest) =>
      api.patch<LeadStatusLabelSummary>(LEAD_STATUS_LABEL_PATHS.label(change.status), {
        ...(change.label !== undefined ? { label: change.label } : {}),
        ...(change.color !== undefined ? { color: change.color } : {}),
      } satisfies UpdateLeadStatusLabelRequest),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: LEAD_VOCABULARY_KEY }),
  });

  const failure = save.error instanceof ApiFailure ? save.error : undefined;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
      <section
        aria-labelledby="status-labels-heading"
        className="flex w-full max-w-md flex-col gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-slate-200 pb-3">
          <h3 id="status-labels-heading" className="text-base font-bold text-slate-900">
            Edit status labels
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-slate-400 hover:text-slate-600"
          >
            ✕
          </button>
        </div>

        <p className="text-xs text-slate-500">
          Rename and recolour the four stages a lead moves through. These are captions — the
          stages themselves, and any automation that watches them, are unchanged.
        </p>

        {failure && <FormError>{failure.message}</FormError>}

        <div className="flex flex-col gap-4">
          {LEAD_STATUSES.map((status) => (
            <div key={status} className="flex items-end gap-3">
              <div className="flex-1">
                <Field
                  id={`status-label-${status}`}
                  label={DEFAULT_CAPTION[status]}
                  value={drafts[status]}
                  onChange={(value) => setDrafts((prev) => ({ ...prev, [status]: value }))}
                  onBlur={() => {
                    if (drafts[status].trim() && drafts[status] !== labels[status].label) {
                      save.mutate({ status, label: drafts[status] });
                    }
                  }}
                />
              </div>
              <label className="flex flex-col gap-1.5 pb-1">
                <span className="sr-only">{DEFAULT_CAPTION[status]} colour</span>
                <input
                  type="color"
                  value={labels[status].color}
                  onChange={(event) => save.mutate({ status, color: event.target.value })}
                  className="h-9 w-10 cursor-pointer rounded border border-slate-300 bg-white p-1"
                />
              </label>
            </div>
          ))}
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded bg-teal-700 px-4 py-2 text-xs font-semibold text-white transition hover:bg-teal-800"
          >
            Done
          </button>
        </div>
      </section>
    </div>
  );
}

/**
 * Which of the four rows a person is editing, said in the platform's own words rather than the
 * company's — the company's word is the editable value beside it, so labelling the input with it
 * would leave nothing to say which stage this is.
 */
const DEFAULT_CAPTION: Record<LeadStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  qualified: 'Qualified',
  disqualified: 'Disqualified',
};
