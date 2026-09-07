import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MARKETING_PATHS,
  type AdWebhookResponse,
  type CreateLeadCaptureFormRequest,
  type CreateNurtureSequenceRequest,
  type LeadCaptureFormListResponse,
  type LeadCaptureFormSummary,
  type LeadCaptureSubmissionListResponse,
  type NurtureSequenceListResponse,
  type NurtureSequenceSummary,
} from '@erp/shared';
import { api } from '../../../api/client';

export function LeadGenManager({
  brandId,
  brandName,
}: {
  brandId: string;
  brandName: string;
}) {
  const queryClient = useQueryClient();
  const [activeSection, setActiveSection] = useState<'forms' | 'webhooks' | 'nurture'>('forms');

  // Modals & Drawers
  const [showFormModal, setShowFormModal] = useState(false);
  const [showNurtureModal, setShowNurtureModal] = useState(false);
  const [selectedFormForSubmissions, setSelectedFormForSubmissions] = useState<LeadCaptureFormSummary | null>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);

  // New Form State
  const [newForm, setNewForm] = useState<Partial<CreateLeadCaptureFormRequest>>({
    name: '',
    description: '',
  });

  // New Nurture Sequence State
  const [newSequence, setNewSequence] = useState<Partial<CreateNurtureSequenceRequest>>({
    name: '',
    description: '',
    triggerEvent: 'marketing.lead.captured',
  });

  // Webhook Test Simulation State
  const [webhookPlatform, setWebhookPlatform] = useState<'meta' | 'google'>('meta');
  const [testLeadName, setTestLeadName] = useState('Alex Rivera');
  const [testLeadEmail, setTestLeadEmail] = useState('alex.rivera@example.com');
  const [testLeadCompany, setTestLeadCompany] = useState('Rivera Technologies');
  const [webhookResult, setWebhookResult] = useState<AdWebhookResponse | null>(null);

  // 1. Fetch Forms
  const formsQuery = useQuery({
    queryKey: ['marketing', 'forms', brandId],
    queryFn: () => api.get<LeadCaptureFormListResponse>(`${MARKETING_PATHS.forms}?brandId=${brandId}`),
  });

  // 2. Fetch Nurture Sequences
  const nurtureQuery = useQuery({
    queryKey: ['marketing', 'nurture-sequences', brandId],
    queryFn: () =>
      api.get<NurtureSequenceListResponse>(
        `${MARKETING_PATHS.nurtureSequences}?brandId=${brandId}`,
      ),
  });

  // 3. Fetch Submissions for selected form
  const submissionsQuery = useQuery({
    queryKey: ['marketing', 'form-submissions', selectedFormForSubmissions?.id],
    queryFn: () =>
      api.get<LeadCaptureSubmissionListResponse>(
        MARKETING_PATHS.formSubmissions(selectedFormForSubmissions!.id),
      ),
    enabled: Boolean(selectedFormForSubmissions),
  });

  // Create Form Mutation
  const createFormMutation = useMutation({
    mutationFn: (data: CreateLeadCaptureFormRequest) =>
      api.post<LeadCaptureFormSummary>(MARKETING_PATHS.forms, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['marketing', 'forms', brandId] });
      setShowFormModal(false);
      setNewForm({ name: '', description: '' });
    },
  });

  // Create Nurture Sequence Mutation
  const createNurtureMutation = useMutation({
    mutationFn: (data: CreateNurtureSequenceRequest) =>
      api.post<NurtureSequenceSummary>(MARKETING_PATHS.nurtureSequences, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['marketing', 'nurture-sequences', brandId] });
      setShowNurtureModal(false);
      setNewSequence({ name: '', description: '', triggerEvent: 'marketing.lead.captured' });
    },
  });

  // Toggle Form Active Status
  const toggleFormMutation = useMutation({
    mutationFn: ({ formId, isActive }: { formId: string; isActive: boolean }) =>
      api.patch<LeadCaptureFormSummary>(MARKETING_PATHS.form(formId), { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['marketing', 'forms', brandId] });
    },
  });

  // Simulate Webhook Mutation
  const testWebhookMutation = useMutation({
    mutationFn: async () => {
      const payload =
        webhookPlatform === 'meta'
          ? {
              field_data: [
                { name: 'full_name', values: [testLeadName] },
                { name: 'email', values: [testLeadEmail] },
                { name: 'company_name', values: [testLeadCompany] },
              ],
              campaign_name: 'Meta Ads Q3 Retargeting',
            }
          : {
              user_column_data: [
                { column_id: 'FULL_NAME', string_value: testLeadName },
                { column_id: 'EMAIL', string_value: testLeadEmail },
                { column_id: 'COMPANY_NAME', string_value: testLeadCompany },
              ],
              campaign_name: 'Google Ads Search Brand Campaign',
            };

      return api.post<AdWebhookResponse>(
        `${MARKETING_PATHS.adWebhooks(webhookPlatform)}?brandId=${brandId}`,
        payload,
      );
    },
    onSuccess: (data) => {
      setWebhookResult(data);
    },
  });

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    setTimeout(() => setCopiedText(null), 2500);
  };

  const forms = formsQuery.data?.items ?? [];
  const sequences = nurtureQuery.data?.items ?? [];
  const submissions = submissionsQuery.data?.items ?? [];

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-6 shadow-xs sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-2xl">🧲</span>
            <h2 className="text-lg font-bold text-slate-900">Inbound Lead Gen & CRM Handoff</h2>
            <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
              Closed-Loop Bridge Active
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Embed responsive web capture forms, sync paid Meta/Google lead ad webhooks, and qualify inbound leads into Sales CRM with full UTM attribution.
          </p>
        </div>

        {/* Section Navigation Tabs */}
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
          <button
            type="button"
            onClick={() => setActiveSection('forms')}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
              activeSection === 'forms'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            📋 Web Forms ({forms.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('webhooks')}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
              activeSection === 'webhooks'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            ⚡ Ad Webhooks
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('nurture')}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
              activeSection === 'nurture'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            ✉️ Nurture Sequences ({sequences.length})
          </button>
        </div>
      </div>

      {/* SECTION 1: LEAD CAPTURE WEB FORMS */}
      {activeSection === 'forms' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
              Active Lead Capture Forms
            </h3>
            <button
              type="button"
              onClick={() => setShowFormModal(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white shadow-xs hover:bg-slate-800"
            >
              <span>+</span>
              <span>New Web Form</span>
            </button>
          </div>

          {forms.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center">
              <span className="text-4xl">📝</span>
              <h4 className="mt-3 text-sm font-semibold text-slate-800">No web forms created yet</h4>
              <p className="mt-1 text-xs text-slate-500">
                Create a form to embed on your website or landing pages. All inbound submissions instantly sync to CRM Leads.
              </p>
              <button
                type="button"
                onClick={() => setShowFormModal(true)}
                className="mt-4 inline-flex items-center gap-1 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
              >
                Create First Form
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {forms.map((form) => (
                <div
                  key={form.id}
                  className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 shadow-xs"
                >
                  <div>
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="font-semibold text-slate-900">{form.name}</h4>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {form.description || 'General lead generation form'}
                        </p>
                      </div>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          form.isActive
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {form.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 text-xs">
                      <div>
                        <span className="text-slate-400">Total Submissions:</span>
                        <p className="font-bold text-slate-800">{form.submitCount} leads</p>
                      </div>
                      <div>
                        <span className="text-slate-400">Fields Configured:</span>
                        <p className="font-bold text-slate-800">
                          {form.schemaFields?.length ?? 4} fields
                        </p>
                      </div>
                    </div>

                    {/* Embed Code Snippet */}
                    <div className="mt-3">
                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <span>Public API Endpoint:</span>
                        <button
                          type="button"
                          onClick={() =>
                            copyToClipboard(
                              `${window.location.origin}${MARKETING_PATHS.publicFormSubmit(form.id)}`,
                              `api-${form.id}`,
                            )
                          }
                          className="font-medium text-indigo-600 hover:text-indigo-800"
                        >
                          {copiedText === `api-${form.id}` ? '✓ Copied URL' : 'Copy Endpoint'}
                        </button>
                      </div>
                      <pre className="mt-1 overflow-x-auto rounded bg-slate-900 p-2 text-xs text-emerald-400">
                        POST {MARKETING_PATHS.publicFormSubmit(form.id)}
                      </pre>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                    <button
                      type="button"
                      onClick={() =>
                        copyToClipboard(
                          form.embedCode ||
                            `<form action="${window.location.origin}${MARKETING_PATHS.publicFormSubmit(form.id)}" method="POST"></form>`,
                          `embed-${form.id}`,
                        )
                      }
                      className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 hover:text-slate-900"
                    >
                      <span>📋</span>
                      <span>
                        {copiedText === `embed-${form.id}` ? 'Code Copied!' : 'Copy Embed Snippet'}
                      </span>
                    </button>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          toggleFormMutation.mutate({
                            formId: form.id,
                            isActive: !form.isActive,
                          })
                        }
                        className="rounded border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                      >
                        {form.isActive ? 'Deactivate' : 'Activate'}
                      </button>

                      <button
                        type="button"
                        onClick={() => setSelectedFormForSubmissions(form)}
                        className="rounded bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
                      >
                        View Leads ({form.submitCount})
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* SECTION 2: AD PLATFORM WEBHOOKS (META & GOOGLE) */}
      {activeSection === 'webhooks' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Webhook Configuration Guide */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
            <div className="flex items-center gap-2">
              <span className="text-xl">🌐</span>
              <h3 className="font-bold text-slate-900">Lead Ad Webhooks Integration</h3>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Configure these webhook URLs inside Meta Ads Manager or Google Ads Lead Form assets. When prospects submit forms on Facebook, Instagram, or Google Search, leads are ingested in real-time.
            </p>

            <div className="mt-4 space-y-4">
              {/* Meta Webhook */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-semibold text-slate-800 text-xs">
                    <span className="text-base">📱</span>
                    <span>Meta Lead Ads Webhook (Facebook / Instagram)</span>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      copyToClipboard(
                        `${window.location.origin}${MARKETING_PATHS.adWebhooks('facebook')}?brandId=${brandId}`,
                        'meta-webhook',
                      )
                    }
                    className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
                  >
                    {copiedText === 'meta-webhook' ? '✓ Copied' : 'Copy URL'}
                  </button>
                </div>
                <input
                  type="text"
                  readOnly
                  value={`${typeof window !== 'undefined' ? window.location.origin : ''}${MARKETING_PATHS.adWebhooks('facebook')}?brandId=${brandId}`}
                  className="mt-2 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700"
                />
              </div>

              {/* Google Webhook */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-semibold text-slate-800 text-xs">
                    <span className="text-base">🔍</span>
                    <span>Google Ads Lead Form Webhook</span>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      copyToClipboard(
                        `${window.location.origin}${MARKETING_PATHS.adWebhooks('google')}?brandId=${brandId}`,
                        'google-webhook',
                      )
                    }
                    className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
                  >
                    {copiedText === 'google-webhook' ? '✓ Copied' : 'Copy URL'}
                  </button>
                </div>
                <input
                  type="text"
                  readOnly
                  value={`${typeof window !== 'undefined' ? window.location.origin : ''}${MARKETING_PATHS.adWebhooks('google')}?brandId=${brandId}`}
                  className="mt-2 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700"
                />
              </div>
            </div>
          </div>

          {/* Webhook Live Simulator */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
            <div className="flex items-center gap-2">
              <span className="text-xl">🧪</span>
              <h3 className="font-bold text-slate-900">Simulate Inbound Ad Lead</h3>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Send a test lead ad webhook payload into the pipeline to verify automatic CRM lead qualification and timeline attribution.
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-700">Platform</label>
                <div className="mt-1 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setWebhookPlatform('meta')}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium border ${
                      webhookPlatform === 'meta'
                        ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                        : 'border-slate-200 text-slate-600'
                    }`}
                  >
                    Facebook / Meta Leadgen
                  </button>
                  <button
                    type="button"
                    onClick={() => setWebhookPlatform('google')}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium border ${
                      webhookPlatform === 'google'
                        ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                        : 'border-slate-200 text-slate-600'
                    }`}
                  >
                    Google Lead Form
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-700">Lead Full Name</label>
                <input
                  type="text"
                  value={testLeadName}
                  onChange={(e) => setTestLeadName(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5 text-xs"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-700">Lead Email</label>
                <input
                  type="email"
                  value={testLeadEmail}
                  onChange={(e) => setTestLeadEmail(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5 text-xs"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-700">Company</label>
                <input
                  type="text"
                  value={testLeadCompany}
                  onChange={(e) => setTestLeadCompany(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5 text-xs"
                />
              </div>

              <button
                type="button"
                onClick={() => testWebhookMutation.mutate()}
                disabled={testWebhookMutation.isPending}
                className="mt-2 w-full rounded-lg bg-indigo-600 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {testWebhookMutation.isPending ? 'Sending Test...' : 'Simulate Inbound Webhook'}
              </button>

              {webhookResult && (
                <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
                  <p className="font-bold">✓ Webhook Ingested & Handoff Successful!</p>
                  <p className="mt-1">
                    Platform: <span className="font-semibold">{webhookResult.platform}</span>
                  </p>
                  <p>
                    CRM Lead ID: <span className="font-mono">{webhookResult.leadId}</span>
                  </p>
                  <p>
                    Status:{' '}
                    <span className="font-semibold">
                      {webhookResult.isNewLead ? 'New Lead Created' : 'Existing Lead Enriched'}
                    </span>
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* SECTION 3: NURTURE SEQUENCES */}
      {activeSection === 'nurture' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
              Drip Email Sequences
            </h3>
            <button
              type="button"
              onClick={() => setShowNurtureModal(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white shadow-xs hover:bg-slate-800"
            >
              <span>+</span>
              <span>New Nurture Flow</span>
            </button>
          </div>

          {sequences.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center">
              <span className="text-4xl">✉️</span>
              <h4 className="mt-3 text-sm font-semibold text-slate-800">No nurture sequences yet</h4>
              <p className="mt-1 text-xs text-slate-500">
                Automate welcome emails and follow-up drips triggered by inbound lead events.
              </p>
              <button
                type="button"
                onClick={() => setShowNurtureModal(true)}
                className="mt-4 inline-flex items-center gap-1 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
              >
                Create First Sequence
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {sequences.map((seq) => (
                <div
                  key={seq.id}
                  className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="font-semibold text-slate-900">{seq.name}</h4>
                      <p className="mt-0.5 text-xs text-slate-500">
                        Trigger: <span className="font-mono text-slate-700">{seq.triggerEvent}</span>
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        seq.status === 'ACTIVE'
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      {seq.status}
                    </span>
                  </div>

                  {/* Steps list */}
                  <div className="mt-4 space-y-2">
                    <span className="text-xs font-medium text-slate-400">Sequence Steps:</span>
                    {seq.steps?.map((step, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-700">
                            {idx + 1}
                          </span>
                          <span className="font-medium text-slate-800">{step.emailSubject}</span>
                        </div>
                        <span className="text-slate-400">
                          {step.delayMinutes === 0
                            ? 'Instant'
                            : `+${Math.round(step.delayMinutes / 60)}h`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* MODAL 1: CREATE FORM */}
      {showFormModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-slate-900">Create Inbound Lead Capture Form</h3>
            <p className="mt-1 text-xs text-slate-500">
              Form submissions automatically create and update Sales CRM Leads with UTM attribution.
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-700">Form Name</label>
                <input
                  type="text"
                  placeholder="e.g. Free Consultation Request"
                  value={newForm.name}
                  onChange={(e) => setNewForm({ ...newForm, name: e.target.value })}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5 text-xs"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-700">Description</label>
                <input
                  type="text"
                  placeholder="e.g. Embedded on marketing landing page"
                  value={newForm.description ?? ''}
                  onChange={(e) => setNewForm({ ...newForm, description: e.target.value })}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5 text-xs"
                />
              </div>

              <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                <span className="font-semibold text-slate-700">Included Form Fields:</span>
                <ul className="mt-1 list-disc pl-4 space-y-0.5 text-slate-500">
                  <li>Full Name (required)</li>
                  <li>Work Email (required)</li>
                  <li>Phone Number (optional)</li>
                  <li>Company / Organization (optional)</li>
                </ul>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowFormModal(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() =>
                  createFormMutation.mutate({
                    brandId,
                    name: newForm.name || 'Untitled Form',
                    description: newForm.description,
                  })
                }
                disabled={!newForm.name || createFormMutation.isPending}
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {createFormMutation.isPending ? 'Creating...' : 'Create Form'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: CREATE NURTURE SEQUENCE */}
      {showNurtureModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-slate-900">Create Nurture Email Flow</h3>
            <p className="mt-1 text-xs text-slate-500">
              Set up automated email steps sent to leads after capture.
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-700">Sequence Name</label>
                <input
                  type="text"
                  placeholder="e.g. Inbound Demo Nurture"
                  value={newSequence.name}
                  onChange={(e) => setNewSequence({ ...newSequence, name: e.target.value })}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5 text-xs"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-700">Trigger Event</label>
                <select
                  value={newSequence.triggerEvent}
                  onChange={(e) => setNewSequence({ ...newSequence, triggerEvent: e.target.value })}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5 text-xs"
                >
                  <option value="marketing.lead.captured">marketing.lead.captured (Any Lead)</option>
                  <option value="form_submit">Web Form Submit Only</option>
                </select>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowNurtureModal(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() =>
                  createNurtureMutation.mutate({
                    brandId,
                    name: newSequence.name || 'Untitled Nurture Flow',
                    triggerEvent: newSequence.triggerEvent || 'marketing.lead.captured',
                  })
                }
                disabled={!newSequence.name || createNurtureMutation.isPending}
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {createNurtureMutation.isPending ? 'Creating...' : 'Create Sequence'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DRAWER / MODAL: VIEW SUBMISSIONS */}
      {selectedFormForSubmissions && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-2xl max-h-[80vh] flex flex-col rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Submissions: {selectedFormForSubmissions.name}
                </h3>
                <p className="text-xs text-slate-500">
                  Showing captured leads from this form handed off to CRM
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedFormForSubmissions(null)}
                className="text-slate-400 hover:text-slate-600 text-lg"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 flex-1 overflow-y-auto space-y-3">
              {submissions.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-500">
                  No submissions captured for this form yet.
                </div>
              ) : (
                submissions.map((sub) => (
                  <div
                    key={sub.id}
                    className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <span className="font-semibold text-slate-800">
                        {(sub.mappedFields?.name as string) || (sub.rawPayload?.email as string) || 'Anonymous'}
                      </span>
                      <p className="text-slate-500">
                        Email: {(sub.mappedFields?.email as string) || (sub.rawPayload?.email as string) || 'none'}
                      </p>
                      <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-400">
                        <span>UTM: {sub.utmSource || 'direct'} / {sub.utmMedium || 'none'} / {sub.utmCampaign || 'none'}</span>
                      </div>
                    </div>

                    <div className="text-right">
                      <span className="text-[10px] text-slate-400">
                        {new Date(sub.submittedAt).toLocaleDateString()}
                      </span>
                      {sub.crmLeadId && (
                        <p className="mt-0.5 font-semibold text-emerald-600">
                          CRM Lead Linked ✓
                        </p>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
