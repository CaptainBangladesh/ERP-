import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LEAD_FIELD_PATHS,
  LEAD_PATHS,
  LEAD_SUBMISSION_PATHS,
  type CreateLeadFieldRequest,
  type LeadFieldResponse,
  type LeadFieldSummary,
  type LeadResponse,
  type LeadSubmissionListResponse,
  type LeadSubmissionSummary,
} from '@erp/shared';
import { ApiFailure, api } from '../../../api/client';
import { navigate } from '../../../app/location';
import { LEAD_VOCABULARY_KEY } from '../vocabulary';

/**
 * The Survey tab: every capture-form submission this lead has sent, in full.
 *
 * A lead accumulates submissions rather than being overwritten by the latest one, so this is a
 * list of submissions and not a view of the lead's fields — which is what the previous cut
 * showed, and why an answer that mapped to no field appeared to have never been given. Mapped
 * answers are marked as such; an unmapped one can be promoted into a custom field so the next
 * submission carrying it lands somewhere structured.
 */

interface LeadSurveyTabProps {
  lead: LeadResponse;
  customFieldDefinitions: LeadFieldSummary[];
  canWrite: boolean;
}

export function LeadSurveyTab({ lead, customFieldDefinitions, canWrite }: LeadSurveyTabProps) {
  const submissions = useQuery({
    queryKey: ['crm', 'leads', 'submissions', lead.id],
    queryFn: () => api.get<LeadSubmissionListResponse>(LEAD_SUBMISSION_PATHS.byLead(lead.id)),
    enabled: Boolean(lead.id),
  });

  const items = submissions.data?.items ?? [];

  return (
    <section aria-label="Survey" className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 className="text-sm font-bold text-slate-900">Survey submissions</h3>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-700">
            {items.length} {items.length === 1 ? 'submission' : 'submissions'}
          </span>
        </div>

        {submissions.isPending && (
          <p role="status" className="py-4 text-center text-xs text-slate-500">
            Loading survey submissions…
          </p>
        )}

        {submissions.error && (
          <p role="alert" className="py-4 text-center text-xs font-semibold text-rose-600">
            This lead’s survey submissions could not be loaded.
          </p>
        )}

        {!submissions.isPending && !submissions.error && items.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <p className="text-xs text-slate-500">
              This lead has not answered a form yet. Submissions to your capture forms land here.
            </p>
            {/* The tab is a record, not a builder — so it says where the forms themselves live,
                rather than leaving somebody looking for a button that is on another screen. */}
            <button
              type="button"
              onClick={() => navigate('/crm/capture-sources')}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-700 transition hover:bg-slate-50"
            >
              Set up a form or Google Form
            </button>
          </div>
        )}

        <ul className="flex flex-col gap-2.5">
          {items.map((submission) => (
            <SubmissionCard
              key={submission.id}
              lead={lead}
              submission={submission}
              customFieldDefinitions={customFieldDefinitions}
              canWrite={canWrite}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}

function SubmissionCard({
  lead,
  submission,
  customFieldDefinitions,
  canWrite,
}: {
  lead: LeadResponse;
  submission: LeadSubmissionSummary;
  customFieldDefinitions: LeadFieldSummary[];
  canWrite: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const queryClient = useQueryClient();

  /**
   * Promoting an answer is the two existing writes, in order: define the field, then set this
   * lead's value for it. There is no endpoint for "promote" and there should not be — the
   * pieces already exist, and a third path to creating a field is a third place for the rules
   * about keys and types to drift.
   */
  const promote = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: unknown }) => {
      // An unmapped answer's key is whatever the form called it, which for a Google Form is a
      // stable item id like `entry_104`. That is the right thing to *map from* and a poor thing
      // to name a field, so the field gets a readable key and the mapping stays the source's.
      const fieldKey = fieldKeyFor(key);
      const known = customFieldDefinitions.find((field) => field.key === fieldKey);
      if (!known) {
        await api.post<LeadFieldResponse>(LEAD_FIELD_PATHS.leadFields, {
          key: fieldKey,
          label: labelFor(key),
          type: 'text',
        } satisfies CreateLeadFieldRequest);
      }
      return api.patch<LeadResponse>(LEAD_PATHS.lead(lead.id), {
        customValues: { ...(lead.customValues ?? {}), [fieldKey]: String(value ?? '') },
      });
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['crm', 'leads', 'detail', lead.id], updated);
      void queryClient.invalidateQueries({ queryKey: LEAD_VOCABULARY_KEY });
      void queryClient.invalidateQueries({ queryKey: ['crm', 'leads'] });
    },
  });

  const failure = promote.error instanceof ApiFailure ? promote.error : undefined;
  const answers = Object.entries(submission.rawPayload);

  return (
    <li className="rounded-xl border border-slate-200 bg-slate-50/60">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((open) => !open)}
        className="flex w-full items-center justify-between gap-3 p-3.5 text-left"
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-xs font-bold text-slate-900">{submission.formName}</span>
          <span className="text-[11px] text-slate-500">
            {new Date(submission.submittedAt).toLocaleString(undefined, {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
            {' · '}
            {answers.length} {answers.length === 1 ? 'answer' : 'answers'}
          </span>
        </span>
        <span aria-hidden="true" className="text-xs font-bold text-slate-400">
          {expanded ? '⌃' : '⌄'}
        </span>
      </button>

      {expanded && (
        <div className="flex flex-col gap-2 border-t border-slate-200 p-3.5">
          {answers.length === 0 && (
            <p className="text-xs text-slate-500">This submission carried no answers.</p>
          )}

          {answers.map(([key, value]) => {
            /**
             * Mapped-ness is a property of the answer's own key, not of the field's.
             * A webhook source maps `entry_104` onto `budget`, so asking whether `entry_104`
             * is a known field name would call every Google Form answer unmapped.
             */
            const mappedTo = submission.mappedFields[key];
            const isMapped = Boolean(mappedTo);
            const definition = customFieldDefinitions.find(
              (field) => field.key === (mappedTo ?? key),
            );
            return (
              <div key={key} className="flex flex-col gap-1 rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-900">
                    {definition?.label ?? labelFor(mappedTo ?? key)}
                  </span>
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                      isMapped
                        ? 'border-teal-200 bg-teal-50 text-teal-700'
                        : 'border-slate-200 bg-slate-50 text-slate-500'
                    }`}
                  >
                    {isMapped ? 'Mapped to a field' : 'Not mapped'}
                  </span>
                </div>

                <p className="break-words text-xs text-slate-700">{renderAnswer(value)}</p>

                {!isMapped && canWrite && (
                  <div className="pt-1">
                    <button
                      type="button"
                      disabled={promote.isPending}
                      onClick={() => promote.mutate({ key, value })}
                      className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                    >
                      Save as a field
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {failure && (
            <p role="alert" className="text-xs font-semibold text-rose-600">
              {failure.message}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * A field key for an answer the form named itself.
 *
 * Google's `entry_104` says nothing to anyone reading a lead later, so it is not what the field
 * is called; the readable label is derived the same way and the two stay in step.
 */
function fieldKeyFor(answerKey: string): string {
  return labelFor(answerKey).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/** A form's own key, made readable, for an answer no field has named yet. */
function labelFor(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function renderAnswer(value: unknown): string {
  if (value === undefined || value === null || value === '') return '— no answer —';
  if (Array.isArray(value)) return value.map(String).join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}
