import { useState } from 'react';
import {
  CAPTURE_SOURCE_PATHS,
  type CaptureSourceConfig,
  type CaptureSourceKind,
  type CaptureSourceResponse,
  type CaptureSourceSummary,
  type FormConfigField,
  type FormSubmitBehavior,
} from '@erp/shared';
import { Field, FormError, Select } from '@erp/shared/ui';
import { ApiFailure, api } from '../../../api/client';
import { useLeadFields, useLeadGroups, useLeadSources } from '../vocabulary';

interface CaptureSourceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialSource?: CaptureSourceSummary;
}

export function CaptureSourceModal({
  isOpen,
  onClose,
  onSuccess,
  initialSource,
}: CaptureSourceModalProps) {
  const [kind, setKind] = useState<CaptureSourceKind>(initialSource?.kind || 'form');
  const [name, setName] = useState(initialSource?.name || '');
  const [defaultGroupId, setDefaultGroupId] = useState(initialSource?.defaultGroupId || '');
  const [defaultSourceId, setDefaultSourceId] = useState(initialSource?.defaultSourceId || '');

  // Form Config state
  const [formFields, setFormFields] = useState<FormConfigField[]>(() => {
    if (initialSource?.kind === 'form') {
      return (initialSource.config as any)?.fields || [];
    }
    return [
      { key: 'name', label: 'Full Name', required: true, order: 1 },
      { key: 'email', label: 'Email Address', required: false, order: 2 },
    ];
  });
  const [submitKind, setSubmitKind] = useState<'message' | 'redirect'>(
    (initialSource?.config as any)?.submitBehavior?.kind || 'message',
  );
  const [submitText, setSubmitText] = useState<string>(
    (initialSource?.config as any)?.submitBehavior?.text || 'Thank you for reaching out!',
  );
  const [submitUrl, setSubmitUrl] = useState<string>(
    (initialSource?.config as any)?.submitBehavior?.url || 'https://example.com/thank-you',
  );

  // Webhook Config state
  const [webhookMappings, setWebhookMappings] = useState<Array<{ inboundKey: string; leadKey: string }>>(() => {
    if (initialSource?.kind === 'webhook') {
      const mapping = (initialSource.config as any)?.fieldMapping || {};
      return Object.entries(mapping).map(([inboundKey, leadKey]) => ({
        inboundKey,
        leadKey: leadKey as string,
      }));
    }
    return [{ inboundKey: 'full_name', leadKey: 'name' }];
  });

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { active: customFields } = useLeadFields();
  const { groups } = useLeadGroups();
  const { sources } = useLeadSources();

  if (!isOpen) return null;

  function toggleFormField(key: string, label: string) {
    setFormFields((prev) => {
      const exists = prev.some((f) => f.key === key);
      if (exists) {
        return prev.filter((f) => f.key !== key);
      }
      const cf = customFields.find((item) => item.key === key);
      return [
        ...prev,
        {
          key,
          label,
          required: false,
          order: prev.length + 1,
          type: cf?.type || (key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'text'),
          ...(cf?.options ? { options: cf.options } : {}),
          columnName: cf?.label || label,
        },
      ];
    });
  }

  function toggleFieldRequired(key: string) {
    setFormFields((prev) =>
      prev.map((f) => (f.key === key ? { ...f, required: !f.required } : f)),
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      let config: CaptureSourceConfig;
      if (kind === 'form') {
        const submitBehavior: FormSubmitBehavior =
          submitKind === 'message'
            ? { kind: 'message', text: submitText || 'Thank you!' }
            : { kind: 'redirect', url: submitUrl };
        config = { fields: formFields, submitBehavior };
      } else {
        const fieldMapping: Record<string, string> = {};
        for (const m of webhookMappings) {
          if (m.inboundKey.trim() && m.leadKey.trim()) {
            fieldMapping[m.inboundKey.trim()] = m.leadKey.trim();
          }
        }
        config = { fieldMapping };
      }

      const payload = {
        name,
        kind,
        config,
        ...(defaultGroupId ? { defaultGroupId } : {}),
        ...(defaultSourceId ? { defaultSourceId } : {}),
      };

      if (initialSource) {
        await api.patch<CaptureSourceResponse>(CAPTURE_SOURCE_PATHS.source(initialSource.id), payload);
      } else {
        await api.post<CaptureSourceResponse>(CAPTURE_SOURCE_PATHS.sources, payload);
      }

      onSuccess();
      onClose();
    } catch (err) {
      if (err instanceof ApiFailure) {
        setError(err.message);
      } else {
        setError('Failed to save capture source.');
      }
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
      <div className="flex max-h-[85vh] w-full max-w-xl flex-col gap-4 overflow-y-auto rounded-lg border border-slate-200 bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 pb-3">
          <h3 className="text-base font-bold text-slate-900">
            {initialSource ? 'Edit Capture Source' : 'New Capture Source'}
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

        {error && <FormError>{error}</FormError>}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field id="source-name" label="Source Name *" value={name} onChange={setName} />

          {!initialSource && (
            <Select
              id="source-kind"
              label="Intake Kind *"
              value={kind}
              onChange={(val) => setKind(val as CaptureSourceKind)}
              options={[
                { value: 'form', label: 'Web Form (Embeddable HTML form)' },
                { value: 'webhook', label: 'Webhook (Third-party JSON POST URL)' },
              ]}
            />
          )}

          {kind === 'form' ? (
            <div className="flex flex-col gap-3 rounded-md border border-slate-200 p-3 bg-slate-50">
              <div className="text-xs font-semibold text-slate-800">Included Form Fields</div>
              <div className="flex flex-col gap-2">
                {[
                  { key: 'name', label: 'Full Name' },
                  { key: 'email', label: 'Email Address' },
                  { key: 'organisationName', label: 'Organization Name' },
                  { key: 'phone', label: 'Phone Number' },
                  ...customFields.map((cf) => ({ key: cf.key, label: cf.label })),
                ].map((field) => {
                  const activeField = formFields.find((f) => f.key === field.key);
                  const isChecked = Boolean(activeField);
                  return (
                    <div
                      key={field.key}
                      className="flex items-center justify-between rounded bg-white p-2 border border-slate-200 text-xs"
                    >
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleFormField(field.key, field.label)}
                        />
                        <span className="font-medium text-slate-800">{field.label}</span>
                      </label>

                      {isChecked && (
                        <label className="flex items-center gap-1.5 cursor-pointer text-slate-600">
                          <input
                            type="checkbox"
                            checked={activeField?.required || false}
                            onChange={() => toggleFieldRequired(field.key)}
                          />
                          <span>Required</span>
                        </label>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="mt-2 border-t border-slate-200 pt-2 flex flex-col gap-2">
                <Select
                  id="submit-behavior-kind"
                  label="After Submission"
                  value={submitKind}
                  onChange={(v) => setSubmitKind(v as 'message' | 'redirect')}
                  options={[
                    { value: 'message', label: 'Show Thank-You Message' },
                    { value: 'redirect', label: 'Redirect to URL' },
                  ]}
                />

                {submitKind === 'message' ? (
                  <Field
                    id="submit-text"
                    label="Thank-You Message"
                    value={submitText}
                    onChange={setSubmitText}
                  />
                ) : (
                  <Field
                    id="submit-url"
                    label="Redirect URL"
                    value={submitUrl}
                    onChange={setSubmitUrl}
                  />
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3 rounded-md border border-slate-200 p-3 bg-slate-50">
              <div className="text-xs font-semibold text-slate-800">Inbound Key Mapping</div>
              <div className="text-xs text-slate-500">
                Map JSON keys in inbound webhook requests onto Lead fields.
              </div>

              <div className="flex flex-col gap-2">
                {webhookMappings.map((mapping, idx) => (
                  <div key={idx} className="grid grid-cols-2 gap-2">
                    <Field
                      id={`inbound-key-${idx}`}
                      label={`Inbound JSON Key #${idx + 1}`}
                      value={mapping.inboundKey}
                      onChange={(val) =>
                        setWebhookMappings((prev) =>
                          prev.map((m, i) => (i === idx ? { ...m, inboundKey: val } : m)),
                        )
                      }
                    />
                    <Select
                      id={`lead-key-${idx}`}
                      label="Maps to Lead Field"
                      value={mapping.leadKey}
                      onChange={(val) =>
                        setWebhookMappings((prev) =>
                          prev.map((m, i) => (i === idx ? { ...m, leadKey: val } : m)),
                        )
                      }
                      options={[
                        { value: 'name', label: 'Name' },
                        { value: 'email', label: 'Email' },
                        { value: 'organisationName', label: 'Organization Name' },
                        { value: 'phone', label: 'Phone' },
                        ...customFields.map((cf) => ({ value: cf.key, label: cf.label })),
                      ]}
                    />
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={() =>
                  setWebhookMappings((prev) => [...prev, { inboundKey: '', leadKey: 'name' }])
                }
                className="self-start text-xs font-semibold text-teal-700 hover:text-teal-800"
              >
                + Add Key Mapping
              </button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 border-t border-slate-200 pt-3">
            <Select
              id="default-group-select"
              label="Default Lead Group"
              value={defaultGroupId}
              onChange={setDefaultGroupId}
              options={[
                { value: '', label: '-- None --' },
                ...groups.map((g) => ({ value: g.id, label: g.name })),
              ]}
            />
            <Select
              id="default-source-select"
              label="Default Lead Source"
              value={defaultSourceId}
              onChange={setDefaultSourceId}
              options={[
                { value: '', label: '-- None --' },
                ...sources.map((s) => ({ value: s.id, label: s.name })),
              ]}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || !name.trim()}
              className="rounded bg-teal-700 px-4 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
            >
              {isLoading ? 'Saving…' : initialSource ? 'Save Changes' : 'Create Source'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
