import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CAPTURE_SOURCE_PATHS,
  LEAD_FIELD_PATHS,
  LEAD_PATHS,
  LEAD_SUBMISSION_PATHS,
  type CaptureSourceListResponse,
  type CaptureSourceSummary,
  type CreateLeadFieldRequest,
  type LeadFieldResponse,
  type LeadFieldSummary,
  type LeadResponse,
  type LeadSubmissionListResponse,
  type LeadSubmissionSummary,
} from '@erp/shared';
import { ApiFailure, api } from '../../../api/client';
import { LEAD_VOCABULARY_KEY } from '../vocabulary';
import { answerLabel, answerParts, fieldKeyFor, humanise } from '../survey-answers';
import { buildMerchantProfile } from '../merchant-intel';
import { AnswerValue } from './AnswerValue';
import { MerchantProfileCard } from './MerchantProfileCard';
import { CheckIcon } from '../icons';
import { FillSurveyModal } from './FillSurveyModal';
import { ManualSurveyModal } from './ManualSurveyModal';
import { CaptureSourceModal } from './CaptureSourceModal';
import { EditMerchantProfileModal } from './EditMerchantProfileModal';

interface LeadSurveyTabProps {
  lead: LeadResponse;
  customFieldDefinitions: LeadFieldSummary[];
  canWrite: boolean;
}

export function LeadSurveyTab({ lead, customFieldDefinitions, canWrite }: LeadSurveyTabProps) {
  const queryClient = useQueryClient();
  const [isFillModalOpen, setIsFillModalOpen] = useState(false);
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [isCreateSourceModalOpen, setIsCreateSourceModalOpen] = useState(false);
  const [isEditProfileModalOpen, setIsEditProfileModalOpen] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const submissions = useQuery({
    queryKey: ['crm', 'leads', 'submissions', lead.id],
    queryFn: () => api.get<LeadSubmissionListResponse>(LEAD_SUBMISSION_PATHS.byLead(lead.id)),
    enabled: Boolean(lead.id),
  });

  const sourcesQuery = useQuery({
    queryKey: ['crm', 'capture-sources'],
    queryFn: () => api.get<CaptureSourceListResponse>(CAPTURE_SOURCE_PATHS.sources),
  });

  const items = submissions.data?.items ?? [];
  const sources = sourcesQuery.data?.items ?? [];
  const activeSources = sources.filter((s) => s.enabled);
  const profile = buildMerchantProfile(items, customFieldDefinitions);

  function handleCopyShareLink(source: CaptureSourceSummary) {
    const params = new URLSearchParams();
    if (lead.name) params.set('name', lead.name);
    if (lead.email) params.set('email', lead.email);
    if (lead.phone) params.set('phone', lead.phone);
    if (lead.organisationName) params.set('organisationName', lead.organisationName);

    if (lead.customValues) {
      for (const [k, v] of Object.entries(lead.customValues)) {
        if (v !== undefined && v !== null && v !== '') {
          params.set(k, String(v));
        }
      }
    }

    const shareUrl = `${window.location.origin}/public/crm/form/${source.token}?${params.toString()}`;
    void navigator.clipboard.writeText(shareUrl);
    setCopiedToken(source.id);
    setTimeout(() => setCopiedToken(null), 2500);
  }

  function handleSurveySubmitted() {
    void queryClient.invalidateQueries({ queryKey: ['crm', 'leads', 'submissions', lead.id] });
    void queryClient.invalidateQueries({ queryKey: ['crm', 'leads', 'detail', lead.id] });
    void queryClient.invalidateQueries({ queryKey: ['crm', 'leads'] });
  }

  return (
    <section aria-label="Survey" className="flex min-w-0 flex-col gap-4">
      {/* Workspace Action Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
        <div className="flex flex-col">
          <h3 className="text-sm font-bold text-slate-900">Survey Workspace</h3>
          <p className="text-xs text-slate-500">
            Submit, create, or pre-fill surveys directly for <strong className="text-slate-700">{lead.name}</strong>.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canWrite && (
            <>
              <button
                type="button"
                onClick={() => setIsFillModalOpen(true)}
                className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-teal-800"
              >
                + Fill Form for Lead
              </button>

              <button
                type="button"
                onClick={() => setIsManualModalOpen(true)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                + Add Manual Response
              </button>

              <button
                type="button"
                onClick={() => setIsCreateSourceModalOpen(true)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                + Create / Setup Form
              </button>
            </>
          )}
        </div>
      </div>

      {/* Merchant profile — the research read, before the raw submissions */}
      {profile.hasAnything ? (
        <MerchantProfileCard
          profile={profile}
          lead={lead}
          leadId={lead.id}
          canWrite={canWrite}
          submissions={items}
          customFieldDefinitions={customFieldDefinitions}
        />
      ) : (
        canWrite && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-slate-300 bg-white p-4 shadow-2xs">
            <div className="flex flex-col">
              <span className="text-xs font-bold text-slate-800">Merchant Profile</span>
              <span className="text-xs text-slate-500">Record research facts, socials, and website review for this lead.</span>
            </div>
            <button
              type="button"
              onClick={() => setIsEditProfileModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50 cursor-pointer"
            >
              + Create Merchant Profile
            </button>
          </div>
        )
      )}

      {/* Share Pre-filled Links Card */}
      {activeSources.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-800">Share Pre-filled Form Links</span>
            <span className="text-[11px] text-slate-500">Auto-populates lead details on open</span>
          </div>

          <div className="flex flex-col gap-2">
            {activeSources.map((source) => (
              <div
                key={source.id}
                className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-2.5"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-600">
                    {source.kind}
                  </span>
                  <span className="truncate text-xs font-semibold text-slate-900">{source.name}</span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleCopyShareLink(source)}
                    className="rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 transition hover:bg-slate-50"
                  >
                    {copiedToken === source.id ? '✓ Link Copied!' : 'Copy Pre-filled Link'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Submissions List */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 className="text-sm font-bold text-slate-900">Survey Submissions</h3>
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
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-xs text-slate-500 max-w-sm">
              This lead has not answered a form yet. You can fill out a form on behalf of this lead or send them a pre-filled link.
            </p>
            {canWrite && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsFillModalOpen(true)}
                  className="rounded-lg bg-teal-700 px-3.5 py-1.5 text-xs font-bold text-white transition hover:bg-teal-800"
                >
                  Fill Form for Lead
                </button>
                <button
                  type="button"
                  onClick={() => setIsCreateSourceModalOpen(true)}
                  className="rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50"
                >
                  Set up a form or Google Form
                </button>
              </div>
            )}
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

      {/* Modals */}
      {isFillModalOpen && (
        <FillSurveyModal
          isOpen={isFillModalOpen}
          onClose={() => setIsFillModalOpen(false)}
          onSuccess={handleSurveySubmitted}
          lead={lead}
          sources={sources}
          customFieldDefinitions={customFieldDefinitions}
        />
      )}

      {isManualModalOpen && (
        <ManualSurveyModal
          isOpen={isManualModalOpen}
          onClose={() => setIsManualModalOpen(false)}
          onSuccess={handleSurveySubmitted}
          lead={lead}
          sources={sources}
        />
      )}

      {isCreateSourceModalOpen && (
        <CaptureSourceModal
          isOpen={isCreateSourceModalOpen}
          onClose={() => setIsCreateSourceModalOpen(false)}
          onSuccess={() => {
            void queryClient.invalidateQueries({ queryKey: ['crm', 'capture-sources'] });
          }}
        />
      )}

      {isEditProfileModalOpen && (
        <EditMerchantProfileModal
          isOpen={isEditProfileModalOpen}
          onClose={() => setIsEditProfileModalOpen(false)}
          onSuccess={handleSurveySubmitted}
          lead={lead}
          profile={profile}
          submissions={items}
          customFieldDefinitions={customFieldDefinitions}
        />
      )}
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
          label: humanise(key),
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

  /**
   * The answers, most useful first: the ones a field gives structure to, then the ones that
   * carry something, then the blanks — which sink to the bottom rather than breaking up the read.
   */
  const ordered = answers
    .map(([key, value]) => ({
      key,
      value,
      /**
       * Mapped-ness is a property of the answer's own key, not of the field's. A webhook source
       * maps `entry_104` onto `budget`, so asking whether `entry_104` is a known field name would
       * call every Google Form answer unmapped.
       */
      isMapped: Boolean(submission.mappedFields[key]),
      isEmpty: answerParts(value).length === 0,
      label: answerLabel(key, submission, customFieldDefinitions),
    }))
    .sort((a, b) => {
      if (a.isEmpty !== b.isEmpty) return a.isEmpty ? 1 : -1;
      return Number(b.isMapped) - Number(a.isMapped);
    });

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

          {ordered.map(({ key, value, isMapped, isEmpty, label }) => (
            <div
              key={key}
              className={`flex flex-col gap-1.5 rounded-lg border bg-white p-3 ${
                isMapped ? 'border-slate-200 border-l-2 border-l-teal-400' : 'border-slate-200'
              } ${isEmpty ? 'opacity-70' : ''}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  {label}
                </span>
                {isMapped ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-[10px] font-bold text-teal-700">
                    <CheckIcon size={11} />
                    Mapped to a field
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-400">
                    Not mapped
                  </span>
                )}
              </div>

              <div className="min-w-0 text-sm leading-relaxed text-slate-800">
                <AnswerValue value={value} />
              </div>

              {!isMapped && !isEmpty && canWrite && (
                <div className="pt-0.5">
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
          ))}

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
