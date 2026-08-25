import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ERROR_CODES,
  IDENTITY_PATHS,
  LEAD_PATHS,
  PARTY_PATHS,
  listPath,
  type LeadCustomValues,
  type LeadFieldSummary,
  type LeadFieldValue,
  type LeadResponse,
  type LeadSourceSummary,
  type PartyResponse,
  type UpdateLeadRequest,
  type UserListResponse,
  type UserSummary,
} from '@erp/shared';
import { Field, FormError, Select } from '@erp/shared/ui';
import { ApiFailure, api } from '../../../api/client';
import { useSession } from '../../../session/SessionProvider';
import { hasPermission } from '../../../session/permissions';
import { useLeadFields, useLeadSources, useLeadStatusLabels } from '../vocabulary';
import { ActivityTimeline } from './ActivityTimeline';
import { ConvertLeadModal } from './ConvertLeadModal';
import { CustomFieldInputs } from './CustomFieldInputs';
import { MailboxesModal } from './MailboxesModal';
import { SendEmailModal } from './SendEmailModal';

export function LeadDetail({
  leadId,
  onClose,
  onChanged,
  onNavigatePrev,
  onNavigateNext,
  hasPrev = false,
  hasNext = false,
}: {
  leadId: string;
  onClose: () => void;
  onChanged: () => void;
  onNavigatePrev?: () => void;
  onNavigateNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
}) {
  const { session } = useSession();
  const canWrite = hasPermission(session, 'crm:leads:write');
  const canReadUsers = hasPermission(session, 'identity:users:read');
  const canReadParties = hasPermission(session, 'parties:parties:read');
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'overview' | 'updates' | 'files'>('overview');
  const [converting, setConverting] = useState(false);
  const [sendEmailOpen, setSendEmailOpen] = useState(false);
  const [mailboxesOpen, setMailboxesOpen] = useState(false);

  const statusLabels = useLeadStatusLabels();
  const { sources } = useLeadSources();
  const { all: customFields } = useLeadFields();

  const lead = useQuery({
    queryKey: ['crm', 'leads', 'detail', leadId],
    queryFn: () => api.get<LeadResponse>(LEAD_PATHS.lead(leadId)),
  });

  const users = useQuery({
    queryKey: ['identity', 'users', 'all'],
    queryFn: () => api.get<UserListResponse>(listPath(IDENTITY_PATHS.users, { pageSize: 200 })),
    enabled: canReadUsers,
  });

  const linkedParty = useQuery({
    queryKey: ['parties', 'detail', lead.data?.partyId],
    queryFn: () => api.get<PartyResponse>(PARTY_PATHS.party(lead.data!.partyId!)),
    enabled: canReadParties && Boolean(lead.data?.partyId),
  });

  const change = useMutation({
    mutationFn: (act: () => Promise<LeadResponse>) => act(),
    onSuccess: (updated) => {
      queryClient.setQueryData(['crm', 'leads', 'detail', leadId], updated);
      onChanged();
    },
  });

  const deleteLead = useMutation({
    mutationFn: () => api.delete<void>(LEAD_PATHS.lead(leadId)),
    onSuccess: () => {
      onChanged();
      onClose();
    },
  });

  const failure = change.error instanceof ApiFailure ? change.error : undefined;
  const fields = failure?.fields ?? {};
  const detail = lead.data;

  if (lead.isPending) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-2xl">
          <p role="status" className="text-sm font-semibold text-slate-600">
            Loading lead details…
          </p>
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-2xl max-w-md w-full flex flex-col gap-4">
          <p role="alert" className="text-sm font-semibold text-rose-700">
            {lead.error instanceof ApiFailure ? lead.error.message : 'That lead could not be loaded.'}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="self-center rounded-md bg-slate-800 px-4 py-2 text-xs font-semibold text-white"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  const assignee = users.data?.items.find((user) => user.id === detail.assignedToUserId);

  return (
    <section
      aria-labelledby="lead-detail"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3 sm:p-6 backdrop-blur-xs"
    >
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col rounded-2xl border border-slate-200/90 bg-white shadow-2xl overflow-hidden">
        {/* Top Header Bar (Matching Screenshot-2) */}
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-white px-6 py-4">
          <div className="flex items-center gap-4">
            <h2 id="lead-detail" className="text-xl font-bold tracking-tight text-slate-900">
              {detail.name}
            </h2>

            {/* Prev / Next Navigation */}
            {(onNavigatePrev || onNavigateNext) && (
              <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 p-0.5">
                <button
                  type="button"
                  onClick={onNavigatePrev}
                  disabled={!hasPrev}
                  title="Previous Lead"
                  aria-label="Previous Lead"
                  className="rounded px-2 py-1 text-xs font-bold text-slate-700 hover:bg-white disabled:opacity-30"
                >
                  ▲
                </button>
                <button
                  type="button"
                  onClick={onNavigateNext}
                  disabled={!hasNext}
                  title="Next Lead"
                  aria-label="Next Lead"
                  className="rounded px-2 py-1 text-xs font-bold text-slate-700 hover:bg-white disabled:opacity-30"
                >
                  ▼
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* Tabs Pill Container */}
            <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-100/70 p-1 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setActiveTab('overview')}
                className={`rounded-md px-3.5 py-1 transition ${activeTab === 'overview'
                    ? 'bg-white text-slate-900 shadow-2xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                  }`}
              >
                Overview
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('updates')}
                className={`rounded-md px-3.5 py-1 transition ${activeTab === 'updates'
                    ? 'bg-white text-slate-900 shadow-2xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                  }`}
              >
                Updates
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('files')}
                className={`rounded-md px-3.5 py-1 transition ${activeTab === 'files'
                    ? 'bg-white text-slate-900 shadow-2xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                  }`}
              >
                Files
              </button>
            </div>

            {canWrite && (
              <button
                type="button"
                disabled={deleteLead.isPending}
                onClick={() => {
                  if (confirm(`Are you sure you want to delete ${detail.name}?`)) {
                    deleteLead.mutate();
                  }
                }}
                className="rounded-lg border border-rose-300 bg-rose-50 px-3.5 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-100 transition disabled:opacity-50"
              >
                {deleteLead.isPending ? 'Deleting…' : 'Delete Lead'}
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
            >
              ✕
            </button>
          </div>
        </header>

        {/* Contact Info Pills & Qualification Top Bar (Matching Screenshot-2) */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-slate-50/50 px-6 py-3">
          <div className="flex flex-wrap items-center gap-2.5 text-xs">
            {detail.email && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-teal-200 bg-teal-50 px-3 py-1 font-semibold text-teal-800">
                <span className="text-teal-600">📧</span> {detail.email}
              </span>
            )}
            {detail.organisationName && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 font-semibold text-slate-700">
                <span>🏢</span> {detail.organisationName}
              </span>
            )}
            {detail.phone && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 font-semibold text-slate-700">
                <span className="text-rose-500">📞</span> {detail.phone}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {canWrite && detail.status !== 'qualified' && (
              <button
                type="button"
                onClick={() => setConverting(true)}
                disabled={change.isPending}
                className="rounded-md bg-emerald-700 px-4 py-1.5 text-xs font-bold text-white transition hover:bg-emerald-800 shadow-xs disabled:opacity-50"
              >
                Qualified
              </button>
            )}

            {canWrite && detail.status !== 'disqualified' && (
              <button
                type="button"
                onClick={() =>
                  change.mutate(() => api.post<LeadResponse>(LEAD_PATHS.disqualify(leadId)))
                }
                disabled={change.isPending}
                className="rounded-md bg-rose-600 px-4 py-1.5 text-xs font-bold text-white transition hover:bg-rose-700 shadow-xs disabled:opacity-50"
              >
                Unqualified
              </button>
            )}
          </div>
        </div>

        {/* Pipeline Progress Stages Bar (Matching Screenshot-2) */}
        <div className="border-b border-slate-200 bg-white px-6 py-3">
          <div className="grid grid-cols-4 gap-2 text-xs font-semibold">
            {[
              { key: 'new', label: 'New Lead' },
              { key: 'attempted', label: 'Attempted to Contact' },
              { key: 'contacted', label: 'Contacted' },
              { key: 'closed', label: detail.status === 'qualified' ? 'Qualified' : detail.status === 'disqualified' ? 'Disqualified' : 'Closed' },
            ].map((stage) => {
              let isActive = false;
              let isPast = false;

              if (stage.key === 'new') {
                isActive = detail.status === 'new';
              } else if (stage.key === 'attempted') {
                isActive = detail.status === 'contacted';
                isPast = detail.status === 'qualified' || detail.status === 'disqualified';
              } else if (stage.key === 'contacted') {
                isActive = detail.status === 'contacted';
                isPast = detail.status === 'qualified' || detail.status === 'disqualified';
              } else if (stage.key === 'closed') {
                isActive = detail.status === 'qualified' || detail.status === 'disqualified';
              }

              return (
                <button
                  key={stage.key}
                  type="button"
                  disabled={!canWrite || change.isPending}
                  onClick={() => {
                    if (stage.key === 'new') {
                      change.mutate(() =>
                        api.patch<LeadResponse>(LEAD_PATHS.lead(leadId), { status: 'new' }),
                      );
                    } else if (stage.key === 'attempted' || stage.key === 'contacted') {
                      change.mutate(() =>
                        api.patch<LeadResponse>(LEAD_PATHS.lead(leadId), { status: 'contacted' }),
                      );
                    } else if (stage.key === 'closed') {
                      setConverting(true);
                    }
                  }}
                  className={`px-4 py-2.5 text-center transition rounded-lg border text-xs ${isActive
                      ? 'bg-emerald-700 text-white border-emerald-800 font-bold shadow-xs'
                      : isPast
                        ? 'bg-emerald-50 text-emerald-900 border-emerald-200 font-medium'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                >
                  {stage.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Modal Scrollable Body: Split 2-Column Grid */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
          {failure && failure.code !== ERROR_CODES.validationFailed && (
            <div className="mb-4">
              <FormError>{failure.message}</FormError>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left 2 Columns: Communication Action Bar & Activity History */}
            <div className="lg:col-span-2 flex flex-col gap-6">
              {/* Action Toolbar Box */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setSendEmailOpen(true)}
                    className="flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-xs font-bold text-white transition hover:bg-teal-800 shadow-xs"
                  >
                    <span>🚀</span> New email
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      // Trigger activity focus
                    }}
                    className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    <span>+</span> Add activity
                  </button>
                </div>

                <div className="text-xs text-slate-500 font-medium flex items-center gap-1">
                  <span>💡</span> Click "New email" to reach out and advance lead status.
                </div>
              </div>

              {/* Activity Timeline Box */}
              <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
                <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-3">
                  Activity Feed & Communication History
                </h3>
                <ActivityTimeline parentKind="lead" parentId={leadId} />
              </div>
            </div>

            {/* Right Column Sidebar: Lead Details Card (Matching Screenshot-2) */}
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
                <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-3">
                  Lead Details
                </h3>

                {/* Custom Fields Card Display */}
                <CustomValues definitions={customFields} values={detail.customValues ?? {}} />

                {canWrite && (
                  <Details
                    detail={detail}
                    fields={fields}
                    sources={sources}
                    customFields={customFields.filter((field) => field.archivedAt === null)}
                    pending={change.isPending}
                    onSave={(update) =>
                      change.mutate(() => api.patch<LeadResponse>(LEAD_PATHS.lead(leadId), update))
                    }
                  />
                )}

                {/* Lifecycle Quick Actions (Mark Contacted / Disqualify) */}
                <LifecycleActions
                  status={detail.status}
                  canWrite={canWrite}
                  pending={change.isPending}
                  onMarkContacted={() =>
                    change.mutate(() =>
                      api.patch<LeadResponse>(LEAD_PATHS.lead(leadId), {
                        status: 'contacted',
                      } satisfies UpdateLeadRequest),
                    )
                  }
                  onDisqualify={() => change.mutate(() => api.post<LeadResponse>(LEAD_PATHS.disqualify(leadId)))}
                  onReopen={() => change.mutate(() => api.post<LeadResponse>(LEAD_PATHS.reopen(leadId)))}
                />

                {/* Move to Contacts Action Card (Matching Screenshot-2) */}
                {canWrite && detail.status !== 'qualified' && detail.status !== 'disqualified' && (
                  <div className="flex flex-col gap-2 rounded-xl border border-slate-200/90 p-4 bg-slate-50/50">
                    <h4 className="text-xs font-bold text-slate-900">Move to Contacts</h4>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      Turns this lead into a real contact — the address book record the rest of the system recognises.
                    </p>
                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={() => setConverting(true)}
                        className="rounded-lg bg-[#0f172a] px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 transition shadow-2xs"
                      >
                        Move to Contacts
                      </button>
                    </div>
                  </div>
                )}

                {/* Assigned To Section (Matching Screenshot-2) */}
                {canWrite && canReadUsers && (
                  <div className="pt-3 border-t border-slate-100">
                    <Assignment
                      assignedToUserId={detail.assignedToUserId}
                      assignee={assignee}
                      users={users.data?.items ?? []}
                      pending={change.isPending}
                      onAssign={(userId) =>
                        change.mutate(() =>
                          api.patch<LeadResponse>(LEAD_PATHS.lead(leadId), {
                            assignedToUserId: userId,
                          } satisfies UpdateLeadRequest),
                        )
                      }
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <footer className="flex items-center justify-between border-t border-slate-200 bg-white px-6 py-3 text-xs text-slate-500">
          <div>
            Lead ID: <span className="font-mono text-slate-600">{detail.id}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 bg-white px-4 py-1.5 font-bold text-slate-700 hover:bg-slate-100 transition shadow-2xs"
          >
            Close
          </button>
        </footer>
      </div>

      {converting && (
        <ConvertLeadModal
          lead={detail}
          onClose={() => setConverting(false)}
          onConverted={() => {
            setConverting(false);
            void queryClient.invalidateQueries({ queryKey: ['crm', 'leads'] });
            onChanged();
          }}
        />
      )}

      {sendEmailOpen && (
        <SendEmailModal
          isOpen={sendEmailOpen}
          leadId={leadId}
          leadName={detail.name}
          leadEmail={detail.email}
          onClose={() => setSendEmailOpen(false)}
          onSuccess={() => {
            if (detail.status === 'new') {
              change.mutate(() =>
                api.patch<LeadResponse>(LEAD_PATHS.lead(leadId), {
                  status: 'contacted',
                } satisfies UpdateLeadRequest),
              );
            }
            void queryClient.invalidateQueries({ queryKey: ['crm', 'activities'] });
            void queryClient.invalidateQueries({ queryKey: ['crm', 'activities', 'lead', leadId] });
            void queryClient.invalidateQueries({ queryKey: ['crm', 'leads', 'detail', leadId] });
            onChanged();
          }}
          onOpenMailboxesModal={() => setMailboxesOpen(true)}
        />
      )}

      {mailboxesOpen && (
        <MailboxesModal
          isOpen={mailboxesOpen}
          onClose={() => setMailboxesOpen(false)}
        />
      )}
    </section>
  );
}

/** Custom field values card display matching Screenshot-2 */
function CustomValues({
  definitions,
  values,
}: {
  definitions: LeadFieldSummary[];
  values: LeadCustomValues;
}) {
  const shown = definitions.filter((definition) => !isBlank(values[definition.key]));
  if (shown.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {shown.map((definition) => (
        <div
          key={definition.key}
          className="flex items-center justify-between gap-4 rounded-xl border border-slate-200/90 bg-white p-3.5 shadow-2xs"
        >
          <span className="text-xs font-semibold text-slate-500 shrink-0">
            {definition.label}
            {definition.archivedAt && <span className="text-xs font-normal opacity-60"> (archived)</span>}
          </span>
          <div className="min-w-0 flex-1 text-right text-xs font-bold text-teal-700 break-all">
            {renderCustomValue(values[definition.key])}
          </div>
        </div>
      ))}
    </div>
  );
}

function isBlank(value: LeadFieldValue | undefined): boolean {
  if (value === undefined || value === null || value === '') return true;
  return Array.isArray(value) && value.length === 0;
}

function renderCustomValue(value: LeadFieldValue | undefined) {
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^https?:\/\//i.test(trimmed)) {
      return (
        <a
          href={trimmed}
          target="_blank"
          rel="noopener noreferrer"
          className="text-teal-600 hover:text-teal-700 hover:underline font-bold break-all"
        >
          {trimmed}
        </a>
      );
    }
    if (
      /^(facebook|fb|linkedin|instagram|twitter|x|tiktok)\.com/i.test(trimmed) ||
      /^(www\.)/i.test(trimmed)
    ) {
      const url = `https://${trimmed}`;
      return (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-teal-600 hover:text-teal-700 hover:underline font-bold break-all"
        >
          {trimmed}
        </a>
      );
    }
    return trimmed;
  }
  return String(value ?? '');
}

function Details({
  detail,
  fields,
  sources,
  customFields,
  pending,
  onSave,
}: {
  detail: LeadResponse;
  fields: Record<string, string>;
  sources: LeadSourceSummary[];
  customFields: LeadFieldSummary[];
  pending: boolean;
  onSave: (update: UpdateLeadRequest) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => draftOf(detail));

  const set = <K extends keyof typeof form>(key: K) => (value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  if (!editing) {
    return (
      <div>
        <button
          type="button"
          onClick={() => {
            setForm(draftOf(detail));
            setEditing(true);
          }}
          className="rounded-lg border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 transition shadow-2xs"
        >
          Edit details
        </button>
      </div>
    );
  }

  return (
    <form
      noValidate
      aria-labelledby="edit-lead-details"
      className="flex flex-col gap-4 rounded-xl border border-slate-200 p-4 bg-slate-50/50"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({
          name: form.name,
          ...(form.organisationName ? { organisationName: form.organisationName } : {}),
          ...(form.email ? { email: form.email } : {}),
          ...(form.phone ? { phone: form.phone } : {}),
          ...(form.sourceId ? { sourceId: form.sourceId } : {}),
          ...(customFields.length > 0 ? { customValues: form.customValues } : {}),
        });
        setEditing(false);
      }}
    >
      <h3 id="edit-lead-details" className="text-xs font-bold text-slate-900">
        Details
      </h3>

      <div className="flex flex-col gap-3">
        <Field id="detail-name" label="Name" value={form.name} error={fields.name} onChange={set('name')} />
        <Field
          id="detail-organisation"
          label="Organisation"
          value={form.organisationName}
          error={fields.organisationName}
          onChange={set('organisationName')}
        />
        <Field
          id="detail-email"
          label="Email"
          type="email"
          value={form.email}
          error={fields.email}
          onChange={set('email')}
        />
        <Field id="detail-phone" label="Phone" value={form.phone} error={fields.phone} onChange={set('phone')} />
        <Select
          id="detail-source"
          label="Source"
          value={form.sourceId}
          error={fields.sourceId}
          placeholder={sources.length === 0 ? 'No sources defined yet' : 'Not sure yet'}
          options={sources.map((source) => ({ value: source.id, label: source.name }))}
          onChange={set('sourceId')}
        />

        <CustomFieldInputs
          idPrefix="detail"
          definitions={customFields}
          values={form.customValues}
          errors={fields}
          onChange={(key, value) =>
            setForm((current) => ({
              ...current,
              customValues: { ...current.customValues, [key]: value },
            }))
          }
        />
      </div>

      <div className="flex gap-2 pt-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-bold text-white hover:bg-slate-700 disabled:opacity-50 shadow-2xs"
        >
          Save details
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="rounded-lg border border-slate-300 px-4 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function draftOf(detail: LeadResponse): {
  name: string;
  organisationName: string;
  email: string;
  phone: string;
  sourceId: string;
  customValues: LeadCustomValues;
} {
  return {
    name: detail.name,
    organisationName: detail.organisationName ?? '',
    email: detail.email ?? '',
    phone: detail.phone ?? '',
    sourceId: detail.sourceId ?? '',
    customValues: { ...detail.customValues },
  };
}

function LifecycleActions({
  status,
  canWrite,
  pending,
  onMarkContacted,
  onDisqualify,
  onReopen,
}: {
  status: LeadResponse['status'];
  canWrite: boolean;
  pending: boolean;
  onMarkContacted: () => void;
  onDisqualify: () => void;
  onReopen: () => void;
}) {
  if (!canWrite) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === 'new' && (
        <button
          type="button"
          disabled={pending}
          onClick={onMarkContacted}
          className="rounded-lg border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 shadow-2xs disabled:opacity-50"
        >
          Mark contacted
        </button>
      )}
      {status !== 'disqualified' && (
        <button
          type="button"
          disabled={pending}
          onClick={onDisqualify}
          className="rounded-lg border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 shadow-2xs disabled:opacity-50"
        >
          Disqualify
        </button>
      )}
      {status === 'disqualified' && (
        <button
          type="button"
          disabled={pending}
          onClick={onReopen}
          className="rounded-lg border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 shadow-2xs disabled:opacity-50"
        >
          Re-open
        </button>
      )}
    </div>
  );
}

function Assignment({
  assignedToUserId,
  assignee,
  users,
  pending,
  onAssign,
}: {
  assignedToUserId: string | null;
  assignee: UserSummary | undefined;
  users: readonly UserSummary[];
  pending: boolean;
  onAssign: (userId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-bold text-slate-900">Assigned to</h3>
      <p className="text-xs font-medium text-slate-600">
        {assignedToUserId ? (assignee ? assignee.name : 'Somebody no longer in this company') : 'Nobody yet'}
      </p>
      <div className="min-w-48 pt-1">
        <Select
          id="lead-assignee"
          label="Reassign"
          value={assignedToUserId ?? ''}
          placeholder="Unassigned"
          disabled={pending}
          options={users.map((user) => ({ value: user.id, label: user.name }))}
          onChange={(val) => onAssign(val)}
        />
      </div>
    </div>
  );
}
