import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CAPTURE_SOURCE_PATHS,
  type CaptureSourceListResponse,
  type CaptureSourceResponse,
  type FormConfigField,
  type FormSubmitBehavior,
  type FormTemplate,
} from '@erp/shared';
import { Field, FormError, Select } from '@erp/shared/ui';
import { ApiFailure, api, apiUrl } from '../../../api/client';
import { useLeadFields, useLeadGroups, useLeadSources } from '../vocabulary';

interface WebFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLeadCreated?: () => void;
}

const PRESET_TEMPLATES: FormTemplate[] = [
  {
    id: 'preset-contact',
    name: 'Standard Contact Form',
    description: 'Basic contact form collecting Name, Email, Organization, and Phone.',
    fields: [
      { key: 'name', label: 'Full Name', required: true, order: 1, type: 'text', columnName: 'Name' },
      { key: 'email', label: 'Email Address', required: true, order: 2, type: 'email', columnName: 'Email' },
      { key: 'organisationName', label: 'Organization / Company', required: false, order: 3, type: 'text', columnName: 'Organization' },
      { key: 'phone', label: 'Phone Number', required: false, order: 4, type: 'tel', columnName: 'Phone' },
    ],
  },
  {
    id: 'preset-social',
    name: 'Social Media Lead Capture',
    description: 'Optimized for social media ads with Name, Email, Phone, and Social Link.',
    fields: [
      { key: 'name', label: 'Full Name', required: true, order: 1, type: 'text', columnName: 'Name' },
      { key: 'email', label: 'Email Address', required: true, order: 2, type: 'email', columnName: 'Email' },
      { key: 'phone', label: 'Phone Number', required: true, order: 3, type: 'tel', columnName: 'Phone' },
      { key: 'fb_link', label: 'Facebook / Social Profile', required: false, order: 4, type: 'url', columnName: 'FB link' },
    ],
  },
];

export function WebFormModal({ isOpen, onClose, onLeadCreated }: WebFormModalProps) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'builder' | 'share' | 'google-forms' | 'preview'>('builder');

  const { active: customFields } = useLeadFields();
  const { groups } = useLeadGroups();
  const { sources } = useLeadSources();

  // Load capture sources list
  const sourcesQuery = useQuery({
    queryKey: ['crm', 'capture-sources'],
    queryFn: () => api.get<CaptureSourceListResponse>(CAPTURE_SOURCE_PATHS.sources),
    enabled: isOpen,
  });

  const webForms = (sourcesQuery.data?.items ?? []).filter((s) => s.kind === 'form');
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);

  // Form State
  const [name, setName] = useState('Website Lead Form');
  const [defaultGroupId, setDefaultGroupId] = useState('');
  const [defaultSourceId, setDefaultSourceId] = useState('');
  const [formFields, setFormFields] = useState<FormConfigField[]>([]);
  const [submitKind, setSubmitKind] = useState<'message' | 'redirect'>('message');
  const [submitText, setSubmitText] = useState('Thank you for reaching out! We will contact you shortly.');
  const [submitUrl, setSubmitUrl] = useState('https://example.com/thank-you');

  // Copy state
  const [copiedType, setCopiedType] = useState<'link' | 'embed' | 'script' | null>(null);

  // Templates state
  const [savedTemplates, setSavedTemplates] = useState<FormTemplate[]>(() => {
    try {
      const stored = localStorage.getItem('crm_webform_templates');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [newTemplateName, setNewTemplateName] = useState('');
  const [showSaveTemplateModal, setShowSaveTemplateModal] = useState(false);

  // Preview Submission state
  const [previewValues, setPreviewValues] = useState<Record<string, string>>({});
  const [previewSuccess, setPreviewSuccess] = useState(false);
  const [previewSubmitting, setPreviewSubmitting] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const activeFormSource = webForms.find((s) => s.id === selectedSourceId) || (webForms.length > 0 ? webForms[0] : undefined);

  // Initialize or set active source
  useEffect(() => {
    if (webForms.length > 0 && webForms[0] && !selectedSourceId) {
      setSelectedSourceId(webForms[0].id);
    }
  }, [webForms, selectedSourceId]);

  useEffect(() => {
    if (activeFormSource) {
      setName(activeFormSource.name);
      setDefaultGroupId(activeFormSource.defaultGroupId || '');
      setDefaultSourceId(activeFormSource.defaultSourceId || '');
      const config = (activeFormSource.config as any) || {};
      if (config.fields && Array.isArray(config.fields)) {
        setFormFields(config.fields);
      }
      if (config.submitBehavior) {
        setSubmitKind(config.submitBehavior.kind || 'message');
        if (config.submitBehavior.kind === 'message') {
          setSubmitText(config.submitBehavior.text || 'Thank you for reaching out!');
        } else {
          setSubmitUrl(config.submitBehavior.url || 'https://example.com/thank-you');
        }
      }
    } else {
      // Default initial fields if creating brand new
      setFormFields([
        { key: 'name', label: 'Full Name', required: true, order: 1, type: 'text', columnName: 'Name' },
        { key: 'email', label: 'Email Address', required: true, order: 2, type: 'email', columnName: 'Email' },
        { key: 'phone', label: 'Phone Number', required: false, order: 3, type: 'tel', columnName: 'Phone' },
      ]);
    }
  }, [selectedSourceId]);

  // All possible columns on the table
  const availableColumns = [
    { key: 'name', label: 'Full Name', type: 'text', columnName: 'Name' },
    { key: 'email', label: 'Email Address', type: 'email', columnName: 'Email' },
    { key: 'organisationName', label: 'Organization Name', type: 'text', columnName: 'Organization' },
    { key: 'phone', label: 'Phone Number', type: 'tel', columnName: 'Phone' },
    ...customFields.map((cf) => ({
      key: cf.key,
      label: cf.label,
      type: cf.type || 'text',
      columnName: cf.label,
    })),
  ];

  const saveSourceMutation = useMutation({
    mutationFn: async () => {
      const submitBehavior: FormSubmitBehavior =
        submitKind === 'message'
          ? { kind: 'message', text: submitText || 'Thank you!' }
          : { kind: 'redirect', url: submitUrl };

      const payload = {
        name,
        kind: 'form' as const,
        config: { fields: formFields, submitBehavior },
        ...(defaultGroupId ? { defaultGroupId } : {}),
        ...(defaultSourceId ? { defaultSourceId } : {}),
      };

      if (activeFormSource) {
        return api.patch<CaptureSourceResponse>(CAPTURE_SOURCE_PATHS.source(activeFormSource.id), payload);
      }
      return api.post<CaptureSourceResponse>(CAPTURE_SOURCE_PATHS.sources, payload);
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['crm', 'capture-sources'] });
      setSelectedSourceId(saved.id);
      if (onLeadCreated) onLeadCreated();
    },
  });

  if (!isOpen) return null;

  function toggleColumnField(key: string, defaultLabel: string, defaultType: string, columnName: string) {
    setFormFields((prev) => {
      const exists = prev.some((f) => f.key === key);
      if (exists) {
        return prev.filter((f) => f.key !== key);
      }
      return [
        ...prev,
        {
          key,
          label: defaultLabel,
          required: false,
          order: prev.length + 1,
          type: defaultType,
          columnName,
        },
      ];
    });
  }

  function toggleFieldRequired(key: string) {
    setFormFields((prev) =>
      prev.map((f) => (f.key === key ? { ...f, required: !f.required } : f)),
    );
  }

  function updateFieldLabel(key: string, newLabel: string) {
    setFormFields((prev) =>
      prev.map((f) => (f.key === key ? { ...f, label: newLabel } : f)),
    );
  }

  function applyTemplate(template: FormTemplate) {
    setFormFields(template.fields);
  }

  function handleSaveTemplate() {
    if (!newTemplateName.trim()) return;
    const newTpl: FormTemplate = {
      id: `custom-${Date.now()}`,
      name: newTemplateName.trim(),
      fields: formFields,
      createdAt: new Date().toISOString(),
    };
    const updated = [...savedTemplates, newTpl];
    setSavedTemplates(updated);
    localStorage.setItem('crm_webform_templates', JSON.stringify(updated));
    setNewTemplateName('');
    setShowSaveTemplateModal(false);
  }

  const publicFormUrl = activeFormSource
    ? `${window.location.origin}/public/crm/form/${activeFormSource.token}`
    : `${window.location.origin}/public/crm/form/preview`;

  // The absolute URL a Google Form posts to: contract path, and the configured API origin via
  // `apiUrl` — not `window.location.origin`, which is wherever this UI is open rather than where
  // the API runs. Same fix, and same reason, as `CaptureSourcesPage.submitUrlFor`.
  const publicSubmitUrl = apiUrl(CAPTURE_SOURCE_PATHS.publicSubmit(activeFormSource?.token ?? 'token_here'));

  const iframeSnippet = `<iframe src="${publicFormUrl}" width="100%" height="650" frameborder="0"></iframe>`;

  const googleAppsScript = `/**
 * Google Apps Script for Google Forms -> CRM Leads Auto-Sync
 * Paste this in Google Form -> Script Editor -> set trigger onFormSubmit
 */
function onFormSubmit(e) {
  var itemResponses = e.response.getItemResponses();
  var payload = {};

  for (var i = 0; i < itemResponses.length; i++) {
    var item = itemResponses[i];
    var title = item.getItem().getTitle().toLowerCase();
    var answer = item.getResponse();

    if (title.indexOf('name') !== -1) {
      payload['name'] = answer;
    } else if (title.indexOf('email') !== -1) {
      payload['email'] = answer;
    } else if (title.indexOf('phone') !== -1) {
      payload['phone'] = answer;
    } else if (title.indexOf('org') !== -1 || title.indexOf('company') !== -1) {
      payload['organisationName'] = answer;
    } else if (title.indexOf('fb') !== -1 || title.indexOf('facebook') !== -1) {
      payload['fb_link'] = answer;
    } else {
      var key = title.replace(/[^a-z0-9_]/g, '_');
      payload[key] = answer;
    }
  }

  UrlFetchApp.fetch("${publicSubmitUrl}", {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload)
  });
}`;

  function copyToClipboard(text: string, type: 'link' | 'embed' | 'script') {
    void navigator.clipboard.writeText(text);
    setCopiedType(type);
    setTimeout(() => setCopiedType(null), 2500);
  }

  async function handleTestSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeFormSource) return;
    setPreviewSubmitting(true);
    setPreviewError(null);
    setPreviewSuccess(false);

    try {
      await api.post(`${CAPTURE_SOURCE_PATHS.publicSubmit(activeFormSource.token!)}`, previewValues);
      setPreviewSuccess(true);
      setPreviewValues({});
      void queryClient.invalidateQueries({ queryKey: ['crm', 'leads'] });
      if (onLeadCreated) onLeadCreated();
    } catch (err) {
      if (err instanceof ApiFailure) {
        setPreviewError(err.message);
      } else {
        setPreviewError('Failed to submit test lead.');
      }
    } finally {
      setPreviewSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-xl border border-slate-200 bg-white shadow-2xl overflow-hidden">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🌐</span>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Web Form & Lead Capture Builder</h2>
              <p className="text-xs text-slate-500">
                Configure form questions mapped 1:1 to your table columns, share on social media or website.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition"
          >
            ✕
          </button>
        </header>

        {/* Top Control Bar: Select Form & Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-white px-6 py-3">
          <div className="flex items-center gap-3">
            <label htmlFor="select-webform" className="text-xs font-semibold text-slate-700">Form:</label>
            <select
              id="select-webform"
              value={selectedSourceId || ''}
              onChange={(e) => setSelectedSourceId(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-800 focus:border-teal-600 focus:outline-hidden"
            >
              {webForms.map((wf) => (
                <option key={wf.id} value={wf.id}>
                  {wf.name} ({wf.submissionCount} submissions)
                </option>
              ))}
              <option value="">+ Create New Web Form</option>
            </select>
          </div>

          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setActiveTab('builder')}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                activeTab === 'builder'
                  ? 'bg-white text-teal-800 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              1. Questions & Columns
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('share')}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                activeTab === 'share'
                  ? 'bg-white text-teal-800 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              2. Share & Embed
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('google-forms')}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                activeTab === 'google-forms'
                  ? 'bg-white text-teal-800 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              3. Google Forms
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('preview')}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                activeTab === 'preview'
                  ? 'bg-white text-teal-800 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              4. Live Test Preview
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
          {activeTab === 'builder' && (
            <div className="flex flex-col gap-6">
              {/* Form Info & Templates Bar */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                <Field
                  id="form-title"
                  label="Form Title *"
                  value={name}
                  onChange={setName}
                />
                <Select
                  id="default-group"
                  label="Default Table Group"
                  value={defaultGroupId}
                  onChange={setDefaultGroupId}
                  options={[
                    { value: '', label: '-- None (Top of Board) --' },
                    ...groups.map((g) => ({ value: g.id, label: g.name })),
                  ]}
                />
                <Select
                  id="default-source"
                  label="Default Lead Source"
                  value={defaultSourceId}
                  onChange={setDefaultSourceId}
                  options={[
                    { value: '', label: '-- None --' },
                    ...sources.map((s) => ({ value: s.id, label: s.name })),
                  ]}
                />
              </div>

              {/* Saved & Preset Templates Selector */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-teal-200 bg-teal-50/50 p-4">
                <div>
                  <div className="text-xs font-bold text-teal-900">Form Templates</div>
                  <p className="text-[11px] text-teal-700">
                    Apply pre-built question sets or save your customized column mapping as a reusable template.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    onChange={(e) => {
                      const allTpls = [...PRESET_TEMPLATES, ...savedTemplates];
                      const selected = allTpls.find((t) => t.id === e.target.value);
                      if (selected) applyTemplate(selected);
                    }}
                    defaultValue=""
                    className="rounded-md border border-teal-300 bg-white px-3 py-1.5 text-xs font-semibold text-teal-900"
                  >
                    <option value="" disabled>Load Template…</option>
                    <optgroup label="Preset Templates">
                      {PRESET_TEMPLATES.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </optgroup>
                    {savedTemplates.length > 0 && (
                      <optgroup label="My Saved Templates">
                        {savedTemplates.map((t) => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>

                  <button
                    type="button"
                    onClick={() => setShowSaveTemplateModal(true)}
                    className="rounded-md border border-teal-700 bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-teal-800"
                  >
                    Save as Template
                  </button>
                </div>
              </div>

              {/* Question to Column 1:1 Mapping Section */}
              <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Form Questions ➔ Table Columns Mapping</h3>
                    <p className="text-xs text-slate-500">
                      Select which columns appear as questions on your web form. Submissions feed 1:1 into these columns.
                    </p>
                  </div>
                  <span className="rounded bg-teal-100 px-2.5 py-1 text-xs font-bold text-teal-800">
                    {formFields.length} Questions Enabled
                  </span>
                </div>

                <div className="flex flex-col gap-3.5 pt-2">
                  {availableColumns.map((col) => {
                    const activeField = formFields.find((f) => f.key === col.key);
                    const isChecked = Boolean(activeField);

                    return (
                      <div
                        key={col.key}
                        className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3.5 transition ${
                          isChecked
                            ? 'border-teal-300 bg-teal-50/20'
                            : 'border-slate-200 bg-slate-50/50 hover:bg-white'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-[220px]">
                          <input
                            type="checkbox"
                            id={`col-chk-${col.key}`}
                            checked={isChecked}
                            onChange={() => toggleColumnField(col.key, col.label, col.type, col.columnName)}
                            className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                          />
                          <label htmlFor={`col-chk-${col.key}`} className="cursor-pointer text-xs font-bold text-slate-900">
                            {col.label}
                          </label>
                        </div>

                        {/* Visual 1:1 Mapping Badge */}
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-400">➔</span>
                          <span className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-teal-100/60 px-3 py-1 text-[11px] font-semibold text-teal-900">
                            <span>📊 Column:</span>
                            <span className="font-bold">{col.columnName}</span>
                          </span>
                        </div>

                        {/* Question Customization Options */}
                        {isChecked && (
                          <div className="flex items-center gap-3">
                            <input
                              type="text"
                              value={activeField?.label || col.label}
                              onChange={(e) => updateFieldLabel(col.key, e.target.value)}
                              placeholder="Question text on form"
                              className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-800 focus:border-teal-600 focus:outline-hidden"
                            />

                            <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={activeField?.required || false}
                                onChange={() => toggleFieldRequired(col.key)}
                                className="rounded border-slate-300 text-teal-600"
                              />
                              <span>Required</span>
                            </label>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Submission Result Settings */}
                <div className="mt-4 border-t border-slate-200 pt-4 flex flex-col gap-3">
                  <div className="text-xs font-bold text-slate-800">After Form Submission</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Select
                      id="submit-kind-select"
                      label="Submission Action"
                      value={submitKind}
                      onChange={(val) => setSubmitKind(val as 'message' | 'redirect')}
                      options={[
                        { value: 'message', label: 'Display Thank-You Message' },
                        { value: 'redirect', label: 'Redirect to Landing Page URL' },
                      ]}
                    />
                    {submitKind === 'message' ? (
                      <Field
                        id="submit-text-msg"
                        label="Thank-You Message"
                        value={submitText}
                        onChange={setSubmitText}
                      />
                    ) : (
                      <Field
                        id="submit-url-redirect"
                        label="Redirect URL"
                        value={submitUrl}
                        onChange={setSubmitUrl}
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'share' && (
            <div className="flex flex-col gap-6">
              {/* Shareable Social Link Card */}
              <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">📢</span>
                    <h3 className="text-sm font-bold text-slate-900">Share on Social Media & Direct Link</h3>
                  </div>
                  <a
                    href={publicFormUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-semibold text-teal-700 hover:underline"
                  >
                    Open Live Form ↗
                  </a>
                </div>

                <p className="text-xs text-slate-600">
                  Share this public web form link on Facebook, Twitter, LinkedIn, Instagram bio, or WhatsApp. Anyone who fills it out will be captured as a Lead in your table!
                </p>

                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={publicFormUrl}
                    className="flex-1 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-mono text-slate-800"
                  />
                  <button
                    type="button"
                    onClick={() => copyToClipboard(publicFormUrl, 'link')}
                    className="rounded-md bg-teal-700 px-4 py-2 text-xs font-semibold text-white transition hover:bg-teal-800"
                  >
                    {copiedType === 'link' ? '✓ Copied Link!' : 'Copy Link'}
                  </button>
                </div>

                {/* Quick Social Share Buttons */}
                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <span className="text-xs text-slate-500 font-medium">Quick Share:</span>
                  <a
                    href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(publicFormUrl)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded bg-[#1877F2] px-3 py-1 text-xs font-semibold text-white transition hover:opacity-90"
                  >
                    Facebook
                  </a>
                  <a
                    href={`https://twitter.com/intent/tweet?url=${encodeURIComponent(publicFormUrl)}&text=${encodeURIComponent('Fill out our form:')}`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded bg-[#1DA1F2] px-3 py-1 text-xs font-semibold text-white transition hover:opacity-90"
                  >
                    Twitter / X
                  </a>
                  <a
                    href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(publicFormUrl)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded bg-[#0A66C2] px-3 py-1 text-xs font-semibold text-white transition hover:opacity-90"
                  >
                    LinkedIn
                  </a>
                  <a
                    href={`https://api.whatsapp.com/send?text=${encodeURIComponent(`Check out our form: ${publicFormUrl}`)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded bg-[#25D366] px-3 py-1 text-xs font-semibold text-white transition hover:opacity-90"
                  >
                    WhatsApp
                  </a>
                </div>
              </div>

              {/* Website Embed HTML Snippet */}
              <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
                <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                  <span className="text-xl">💻</span>
                  <h3 className="text-sm font-bold text-slate-900">Place Form on Your Website (HTML Embed)</h3>
                </div>

                <p className="text-xs text-slate-600">
                  Copy and paste this HTML iframe code snippet into your website, WordPress, Webflow, Wix, or custom landing page:
                </p>

                <pre className="rounded-lg border border-slate-300 bg-slate-900 p-4 text-xs font-mono text-emerald-400 whitespace-pre-wrap overflow-x-auto">
                  {iframeSnippet}
                </pre>

                <div className="flex justify-between items-center">
                  <span className="text-xs text-slate-500">
                    Embed width automatically scales to 100% of your page container.
                  </span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(iframeSnippet, 'embed')}
                    className="rounded-md bg-teal-700 px-4 py-2 text-xs font-semibold text-white transition hover:bg-teal-800"
                  >
                    {copiedType === 'embed' ? '✓ Copied Embed Code!' : 'Copy Embed Code'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'google-forms' && (
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
                <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
                  <span className="text-2xl">📝</span>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Google Forms Auto-Sync Integration</h3>
                    <p className="text-xs text-slate-500">
                      Use Google Forms to capture leads and automatically stream submissions into your Leads table columns.
                    </p>
                  </div>
                </div>

                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900 flex flex-col gap-2">
                  <div className="font-bold">How it works:</div>
                  <ol className="list-decimal pl-4 flex flex-col gap-1 text-[11px]">
                    <li>Open your Google Form ➔ click top right <strong>⋮ (3 dots)</strong> ➔ <strong>Script editor</strong>.</li>
                    <li>Paste the Google Apps Script snippet below into the editor and click Save.</li>
                    <li>Go to <strong>Triggers (alarm clock icon)</strong> ➔ Add Trigger ➔ Select Event Type: <strong>On form submit</strong>.</li>
                    <li>Whenever someone submits your Google Form, their answers map directly into your table columns!</li>
                  </ol>
                </div>

                <div className="flex flex-col gap-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-slate-800">Your Google Apps Script Snippet:</span>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(googleAppsScript, 'script')}
                      className="rounded bg-teal-700 px-3 py-1 text-xs font-semibold text-white transition hover:bg-teal-800"
                    >
                      {copiedType === 'script' ? '✓ Copied Script!' : 'Copy Script'}
                    </button>
                  </div>

                  <pre className="rounded-lg border border-slate-300 bg-slate-900 p-4 text-xs font-mono text-emerald-400 whitespace-pre-wrap overflow-x-auto">
                    {googleAppsScript}
                  </pre>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'preview' && (
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-6 shadow-xs max-w-xl mx-auto w-full">
                <header className="border-b border-slate-200 pb-3">
                  <h3 className="text-base font-bold text-slate-900">{name || 'Contact Us'}</h3>
                  <p className="text-xs text-slate-500">Live preview — submit a test lead to see it land in your table!</p>
                </header>

                {previewError && <FormError>{previewError}</FormError>}

                {previewSuccess ? (
                  <div className="flex flex-col items-center justify-center p-8 text-center bg-emerald-50 rounded-lg border border-emerald-200">
                    <div className="text-4xl mb-2">🎉</div>
                    <h4 className="text-base font-bold text-emerald-800">Test Lead Submitted!</h4>
                    <p className="text-xs text-slate-600 mt-1">
                      Check your Leads table on the board — the new lead row has been added into its corresponding column!
                    </p>
                    <button
                      type="button"
                      onClick={() => setPreviewSuccess(false)}
                      className="mt-4 rounded bg-teal-700 px-4 py-1.5 text-xs font-semibold text-white"
                    >
                      Submit Another Test
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleTestSubmit} className="flex flex-col gap-4">
                    {formFields.map((field) => {
                      const isRequired = field.required;
                      const label = `${field.label}${isRequired ? ' *' : ''}`;
                      const value = previewValues[field.key] || '';
                      const fieldType = field.type || (field.key === 'email' ? 'email' : field.key === 'phone' ? 'tel' : 'text');

                      if (fieldType === 'email' || field.key === 'email') {
                        return (
                          <Field
                            key={field.key}
                            id={`preview-${field.key}`}
                            label={label}
                            type="email"
                            value={value}
                            onChange={(val: string) => setPreviewValues((prev) => ({ ...prev, [field.key]: val }))}
                          />
                        );
                      }

                      return (
                        <div key={field.key} className="flex flex-col gap-1.5">
                          <label htmlFor={`preview-${field.key}`} className="text-xs font-semibold text-slate-700">
                            {label}
                          </label>
                          <input
                            id={`preview-${field.key}`}
                            type={fieldType === 'tel' || field.key === 'phone' ? 'tel' : fieldType === 'url' ? 'url' : 'text'}
                            value={value}
                            placeholder={field.placeholder || `Enter ${field.label}`}
                            onChange={(e) => setPreviewValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                            className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-teal-600 focus:outline-hidden"
                          />
                        </div>
                      );
                    })}

                    <button
                      type="submit"
                      disabled={previewSubmitting || !activeFormSource}
                      className="w-full rounded-md bg-teal-700 py-2.5 text-xs font-bold text-white transition hover:bg-teal-800 disabled:opacity-50 mt-2"
                    >
                      {previewSubmitting ? 'Submitting Test Lead…' : 'Submit Test Lead'}
                    </button>
                  </form>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-6 py-4">
          <div className="text-xs text-slate-500">
            {activeFormSource ? `Form Token: ${activeFormSource.token}` : 'New form will be saved on save.'}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-white"
            >
              Close
            </button>

            <button
              type="button"
              onClick={() => saveSourceMutation.mutate()}
              disabled={saveSourceMutation.isPending || !name.trim()}
              className="rounded-md bg-teal-700 px-5 py-2 text-xs font-bold text-white transition hover:bg-teal-800 disabled:opacity-50"
            >
              {saveSourceMutation.isPending ? 'Saving Form…' : 'Save Web Form'}
            </button>
          </div>
        </footer>
      </div>

      {/* Save Template Name Modal */}
      {showSaveTemplateModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-5 shadow-xl flex flex-col gap-4">
            <h4 className="text-sm font-bold text-slate-900">Save Web Form Template</h4>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="template-name" className="text-xs font-semibold text-slate-700">
                Template Name *
              </label>
              <input
                id="template-name"
                type="text"
                value={newTemplateName}
                onChange={(e) => setNewTemplateName(e.target.value)}
                placeholder="e.g. Real Estate Lead Gen"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-teal-600 focus:outline-hidden"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowSaveTemplateModal(false)}
                className="rounded px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveTemplate}
                disabled={!newTemplateName.trim()}
                className="rounded bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
              >
                Save Template
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
