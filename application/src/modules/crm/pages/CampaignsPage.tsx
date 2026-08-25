import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CAMPAIGN_PATHS,
  EMAIL_TEMPLATE_PATHS,
  MAILBOX_PATHS,
  type CampaignRecipientListResponse,
  type CampaignRecipientSummary,
  type CampaignResponse,
  type CampaignSummary,
  type CreateCampaignRequest,
  type EmailTemplateSummary,
  type MailboxConnectionSummary,
  type SendCampaignBatchResponse,
} from '@erp/shared';
import { Field, FormError, Select } from '@erp/shared/ui';
import { ApiFailure, api } from '../../../api/client';
import { useSession } from '../../../session/SessionProvider';
import { hasPermission } from '../../../session/permissions';

export function CampaignsPage() {
  const { session } = useSession();
  const canWrite = hasPermission(session, 'crm:leads:write');
  const queryClient = useQueryClient();

  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const campaigns = useQuery({
    queryKey: ['crm', 'campaigns', 'list'],
    queryFn: () => api.get<{ items: CampaignSummary[] }>(CAMPAIGN_PATHS.campaigns),
  });

  const mailboxes = useQuery({
    queryKey: ['crm', 'mailboxes', 'list'],
    queryFn: () => api.get<{ items: MailboxConnectionSummary[] }>(MAILBOX_PATHS.mailboxes),
  });

  const templates = useQuery({
    queryKey: ['crm', 'email-templates', 'list'],
    queryFn: () => api.get<{ items: EmailTemplateSummary[] }>(EMAIL_TEMPLATE_PATHS.templates),
  });

  const campaignList = campaigns.data?.items ?? [];
  const selectedCampaign = campaignList.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="flex flex-col gap-6 p-6 max-w-7xl mx-auto">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Email Campaigns</h1>
          <p className="text-sm text-slate-500">
            Create segment campaigns, materialize recipients, send in bounded batches, and track email opens.
          </p>
        </div>

        {canWrite && !creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800"
          >
            + New Campaign
          </button>
        )}
      </header>

      {creating && (
        <CreateCampaignForm
          mailboxes={mailboxes.data?.items ?? []}
          templates={templates.data?.items ?? []}
          onCancel={() => setCreating(false)}
          onCreated={(created) => {
            setCreating(false);
            void queryClient.invalidateQueries({ queryKey: ['crm', 'campaigns'] });
            setSelectedId(created.id);
          }}
        />
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <MetricCard label="Total Campaigns" value={campaignList.length} />
        <MetricCard
          label="Active Sending"
          value={campaignList.filter((c) => c.status === 'sending').length}
        />
        <MetricCard
          label="Total Sent"
          value={campaignList.reduce((acc, c) => acc + c.sentCount, 0)}
        />
        <MetricCard
          label="Avg Open Rate"
          value={`${(
            (campaignList.reduce((acc, c) => acc + c.openRate, 0) / (campaignList.length || 1)) *
            100
          ).toFixed(1)}%`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 flex flex-col gap-4">
          <h2 className="text-base font-semibold text-slate-900">Campaigns</h2>
          <div className="rounded-lg border border-slate-200 bg-white shadow-sm divide-y divide-slate-200 overflow-hidden">
            {campaignList.length === 0 ? (
              <div className="p-6 text-center text-sm text-slate-500">
                No email campaigns created yet.
              </div>
            ) : (
              campaignList.map((campaign) => (
                <button
                  key={campaign.id}
                  type="button"
                  onClick={() => setSelectedId(campaign.id)}
                  className={`w-full text-left p-4 transition hover:bg-slate-50 flex flex-col gap-2 ${
                    selectedId === campaign.id ? 'bg-teal-50/60 border-l-4 border-l-teal-600' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-900 text-sm">{campaign.name}</span>
                    <StatusBadge status={campaign.status} />
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>Sent: {campaign.sentCount} / {campaign.totalLeadsCount}</span>
                    <span>Open Rate: {(campaign.openRate * 100).toFixed(1)}%</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="lg:col-span-2">
          {selectedCampaign ? (
            <CampaignDetailView
              campaign={selectedCampaign}
              canWrite={canWrite}
              onUpdated={() => {
                void queryClient.invalidateQueries({ queryKey: ['crm', 'campaigns'] });
              }}
            />
          ) : (
            <div className="rounded-lg border border-slate-200 bg-white p-12 text-center text-slate-400">
              Select a campaign from the list to view details, materialize recipients, and manage sends.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="text-2xl font-bold text-slate-900 mt-1">{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: CampaignSummary['status'] }) {
  const styles = {
    draft: 'bg-slate-100 text-slate-700',
    sending: 'bg-amber-100 text-amber-800',
    completed: 'bg-emerald-100 text-emerald-800',
  }[status];

  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider ${styles}`}>
      {status}
    </span>
  );
}

function CreateCampaignForm({
  mailboxes,
  templates,
  onCancel,
  onCreated,
}: {
  mailboxes: MailboxConnectionSummary[];
  templates: EmailTemplateSummary[];
  onCancel: () => void;
  onCreated: (campaign: CampaignResponse) => void;
}) {
  const [name, setName] = useState('');
  const [mailboxConnectionId, setMailboxConnectionId] = useState('');
  const [templateId, setTemplateId] = useState('');

  const create = useMutation({
    mutationFn: () =>
      api.post<CampaignResponse>(CAMPAIGN_PATHS.campaigns, {
        name,
        mailboxConnectionId,
        templateId,
      } satisfies CreateCampaignRequest),
    onSuccess: (res) => onCreated(res),
  });

  const failure = create.error instanceof ApiFailure ? create.error : undefined;
  const fields = failure?.fields ?? {};

  const connectedMailboxes = mailboxes.filter((m) => m.status === 'connected');

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
      className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
    >
      <h2 className="text-lg font-bold text-slate-900">Create Email Campaign</h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Field
          id="campaign-name"
          label="Campaign Name *"
          value={name}
          error={fields.name}
          onChange={setName}
        />

        <Select
          id="campaign-mailbox"
          label="Mailbox Connection *"
          value={mailboxConnectionId}
          placeholder={connectedMailboxes.length === 0 ? 'No connected mailboxes' : 'Select mailbox'}
          error={fields.mailboxConnectionId}
          options={connectedMailboxes.map((m) => ({
            value: m.id,
            label: `${m.displayName} (${m.emailAddress})`,
          }))}
          onChange={setMailboxConnectionId}
        />

        <Select
          id="campaign-template"
          label="Email Template *"
          value={templateId}
          placeholder={templates.length === 0 ? 'No templates defined' : 'Select template'}
          error={fields.templateId}
          options={templates.map((t) => ({ value: t.id, label: t.name }))}
          onChange={setTemplateId}
        />
      </div>

      {failure && <FormError>{failure.message}</FormError>}

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={create.isPending}
          className="rounded-md bg-teal-700 px-5 py-2 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:opacity-50"
        >
          {create.isPending ? 'Saving…' : 'Save Campaign Draft'}
        </button>
      </div>
    </form>
  );
}

function CampaignDetailView({
  campaign,
  canWrite,
  onUpdated,
}: {
  campaign: CampaignSummary;
  canWrite: boolean;
  onUpdated: () => void;
}) {
  const queryClient = useQueryClient();

  const recipients = useQuery({
    queryKey: ['crm', 'campaigns', campaign.id, 'recipients'],
    queryFn: () =>
      api.get<CampaignRecipientListResponse>(CAMPAIGN_PATHS.recipients(campaign.id)),
  });

  const materialize = useMutation({
    mutationFn: () => api.post<CampaignResponse>(CAMPAIGN_PATHS.materialize(campaign.id)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['crm', 'campaigns', campaign.id, 'recipients'] });
      onUpdated();
    },
  });

  const sendBatch = useMutation({
    mutationFn: () =>
      api.post<SendCampaignBatchResponse>(CAMPAIGN_PATHS.sendBatch(campaign.id), {
        batchSize: 10,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['crm', 'campaigns', campaign.id, 'recipients'] });
      onUpdated();
    },
  });

  const recipientList = recipients.data?.items ?? [];

  return (
    <div className="flex flex-col gap-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-slate-900">{campaign.name}</h2>
            <StatusBadge status={campaign.status} />
          </div>
          <p className="text-xs text-slate-500 mt-1">Created: {new Date(campaign.createdAt).toLocaleString()}</p>
        </div>

        {canWrite && (
          <div className="flex items-center gap-2">
            {campaign.status === 'draft' && (
              <button
                type="button"
                disabled={materialize.isPending}
                onClick={() => materialize.mutate()}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 disabled:opacity-50"
              >
                {materialize.isPending ? 'Materializing…' : 'Materialize Recipients'}
              </button>
            )}

            {campaign.status !== 'completed' && campaign.totalLeadsCount > 0 && (
              <button
                type="button"
                disabled={sendBatch.isPending}
                onClick={() => sendBatch.mutate()}
                className="rounded-md bg-teal-700 px-4 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-teal-800 disabled:opacity-50"
              >
                {sendBatch.isPending ? 'Sending Batch…' : 'Send Next Batch'}
              </button>
            )}
          </div>
        )}
      </header>

      {materialize.error instanceof ApiFailure && (
        <FormError>{materialize.error.message}</FormError>
      )}

      {sendBatch.error instanceof ApiFailure && (
        <FormError>{sendBatch.error.message}</FormError>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 bg-slate-50 p-4 rounded-lg">
        <div>
          <span className="text-xs text-slate-500">Total Evaluated</span>
          <p className="text-lg font-bold text-slate-800">{campaign.totalLeadsCount}</p>
        </div>
        <div>
          <span className="text-xs text-slate-500">Excluded (No Email/Unsub)</span>
          <p className="text-lg font-bold text-slate-800">{campaign.excludedCount}</p>
        </div>
        <div>
          <span className="text-xs text-slate-500">Sent Count</span>
          <p className="text-lg font-bold text-slate-800">{campaign.sentCount}</p>
        </div>
        <div>
          <span className="text-xs text-slate-500">Opened (Open Rate)</span>
          <p className="text-lg font-bold text-slate-800">
            {campaign.openedCount} ({(campaign.openRate * 100).toFixed(1)}%)
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-bold text-slate-900">Recipients Cohort</h3>

        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100 font-semibold text-slate-600 border-b border-slate-200">
                <th className="px-4 py-2.5">Lead Name</th>
                <th className="px-4 py-2.5">Email Address</th>
                <th className="px-4 py-2.5 text-center">Status</th>
                <th className="px-4 py-2.5 text-center">Open Status</th>
                <th className="px-4 py-2.5">Sent At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-slate-800">
              {recipientList.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                    No recipients materialized yet. Click "Materialize Recipients" to evaluate target leads.
                  </td>
                </tr>
              ) : (
                recipientList.map((r: CampaignRecipientSummary) => (
                  <tr key={r.id} className="hover:bg-slate-50/80">
                    <td className="px-4 py-2.5 font-medium">{r.leadName}</td>
                    <td className="px-4 py-2.5">{r.emailAddress || <span className="text-slate-400">—</span>}</td>
                    <td className="px-4 py-2.5 text-center">
                      <RecipientStatusPill status={r.status} reason={r.excludeReason} />
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {r.openedAt ? (
                        <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">
                          Opened ({r.openCount})
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-slate-500">
                      {r.sentAt ? new Date(r.sentAt).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function RecipientStatusPill({
  status,
  reason,
}: {
  status: CampaignRecipientSummary['status'];
  reason: CampaignRecipientSummary['excludeReason'];
}) {
  if (status === 'excluded') {
    return (
      <span className="inline-flex rounded bg-rose-50 px-2 py-0.5 text-rose-700 font-medium" title={reason ?? undefined}>
        Excluded ({reason || 'unknown'})
      </span>
    );
  }

  if (status === 'sent') {
    return (
      <span className="inline-flex rounded bg-emerald-50 px-2 py-0.5 text-emerald-700 font-medium">
        Sent
      </span>
    );
  }

  return (
    <span className="inline-flex rounded bg-slate-100 px-2 py-0.5 text-slate-700 font-medium">
      Pending
    </span>
  );
}
