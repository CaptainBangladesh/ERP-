import { useEffect, useState } from 'react';
import {
  CAPTURE_SOURCE_PATHS,
  type CaptureSourceSummary,
  type CaptureSubmitResponse,
  type FormConfigField,
  type LeadFieldSummary,
  type LeadResponse,
  type PublicFormConfigResponse,
} from '@erp/shared';
import { Field, FormError, Select } from '@erp/shared/ui';
import { ApiFailure, api } from '../../../api/client';

interface FillSurveyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  lead: LeadResponse;
  sources: CaptureSourceSummary[];
  customFieldDefinitions: LeadFieldSummary[];
}

export function FillSurveyModal({
  isOpen,
  onClose,
  onSuccess,
  lead,
  sources,
  customFieldDefinitions,
}: FillSurveyModalProps) {
  // Only web forms can be filled on a lead's behalf — they have a field list to render. A webhook
  // source has no fields of its own (its shape is whatever the external tool posts), so offering
  // it here rendered an empty form whose "submit" recorded a 0-answer submission. To record a
  // response that arrived off-system, use "Add Manual Response" instead.
  const activeSources = sources.filter((s) => s.enabled && s.kind === 'form');
  const [selectedSourceId, setSelectedSourceId] = useState<string>(activeSources[0]?.id || '');
  const [sourceConfig, setSourceConfig] = useState<PublicFormConfigResponse | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [isLoadingConfig, setIsLoadingConfig] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedSource = activeSources.find((s) => s.id === selectedSourceId);

  // Helper to construct pre-filled values from lead
  function buildPreFilledValues(fields: FormConfigField[]) {
    const preFilled: Record<string, string> = {};
    for (const f of fields) {
      if (f.key === 'name') preFilled[f.key] = lead.name || '';
      else if (f.key === 'email') preFilled[f.key] = lead.email || '';
      else if (f.key === 'phone') preFilled[f.key] = lead.phone || '';
      else if (f.key === 'organisationName') preFilled[f.key] = lead.organisationName || '';
      else if (lead.customValues && lead.customValues[f.key] !== undefined) {
        preFilled[f.key] = String(lead.customValues[f.key] ?? '');
      }
    }
    return preFilled;
  }

  useEffect(() => {
    if (!selectedSource) return;

    async function loadFormConfig() {
      setIsLoadingConfig(true);
      setGeneralError(null);
      try {
        const data = await api.get<PublicFormConfigResponse>(
          CAPTURE_SOURCE_PATHS.publicForm(selectedSource!.token || ''),
        );
        setSourceConfig(data);
        setValues(buildPreFilledValues(data.fields ?? []));
      } catch (err) {
        // Fallback for webhook or errors: construct default fields from custom definitions & built-ins
        const fallbackFields: FormConfigField[] = [
          { key: 'name', label: 'Full Name', required: true },
          { key: 'email', label: 'Email', required: false },
          { key: 'phone', label: 'Phone', required: false },
          { key: 'organisationName', label: 'Organization', required: false },
          ...customFieldDefinitions.map((cf) => ({
            key: cf.key,
            label: cf.label,
            required: cf.required,
            type: cf.type,
            options: cf.options || undefined,
          })),
        ];
        setSourceConfig({
          name: selectedSource!.name,
          slug: selectedSource!.token || '',
          config: (selectedSource!.config as any) ?? {},
          fields: fallbackFields,
        });
        setValues(buildPreFilledValues(fallbackFields));
      } finally {
        setIsLoadingConfig(false);
      }
    }

    void loadFormConfig();
  }, [selectedSourceId]);

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSource) return;

    setIsSubmitting(true);
    setGeneralError(null);
    setFieldErrors({});

    try {
      const payload = {
        ...values,
        __leadId: lead.id,
        __formName: selectedSource.name,
      };

      await api.post<CaptureSubmitResponse>(
        CAPTURE_SOURCE_PATHS.publicSubmit(selectedSource.token || ''),
        payload,
      );

      onSuccess();
      onClose();
    } catch (err) {
      if (err instanceof ApiFailure) {
        if (err.fields && Object.keys(err.fields).length > 0) {
          setFieldErrors(err.fields);
        } else {
          setGeneralError(err.message);
        }
      } else {
        setGeneralError('Failed to submit survey. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  const fields: FormConfigField[] = sourceConfig?.fields || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-lg border border-slate-200 bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 pb-3">
          <div className="flex flex-col">
            <h3 className="text-base font-bold text-slate-900">Fill Survey for Lead</h3>
            <span className="text-xs text-slate-500">
              Pre-filled with profile details for <strong className="text-slate-800">{lead.name}</strong>
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-slate-400 hover:text-slate-600"
          >
            ✕
          </button>
        </div>

        {generalError && <FormError>{generalError}</FormError>}

        {activeSources.length === 0 ? (
          <div className="py-6 text-center text-xs text-slate-500">
            No fillable web form found. A webhook source (like a Google Form) is filled by the
            tool that posts to it — use <strong className="text-slate-700">Add Manual Response</strong> to
            record an answer by hand, or create a web form first.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Select
              id="survey-source-select"
              label="Select Form / Survey *"
              value={selectedSourceId}
              onChange={setSelectedSourceId}
              options={activeSources.map((s) => ({
                value: s.id,
                label: `${s.name} (${s.kind === 'form' ? 'Web Form' : 'Webhook'})`,
              }))}
            />

            {isLoadingConfig ? (
              <div className="py-6 text-center text-xs text-slate-500">Loading form fields…</div>
            ) : (
              <div className="flex flex-col gap-3 rounded-md border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-bold text-slate-700">Form Questions & Answers</div>
                {fields.length === 0 && (
                  <p className="text-xs text-slate-500">No fields configured for this form.</p>
                )}
                {fields.map((field) => {
                  const isRequired = field.required;
                  const label = `${field.label}${isRequired ? ' *' : ''}`;
                  const val = values[field.key] || '';
                  const err = fieldErrors[field.key];
                  const fieldType =
                    field.type ||
                    (field.key === 'email' ? 'email' : field.key === 'phone' ? 'tel' : 'text');

                  if (fieldType === 'select' && field.options && field.options.length > 0) {
                    return (
                      <Select
                        key={field.key}
                        id={`fill-${field.key}`}
                        label={label}
                        value={val}
                        onChange={(v) => setValues((prev) => ({ ...prev, [field.key]: v }))}
                        placeholder={`-- Select ${field.label} --`}
                        options={field.options.map((opt) => ({ value: opt, label: opt }))}
                      />
                    );
                  }

                  return (
                    <Field
                      key={field.key}
                      id={`fill-${field.key}`}
                      label={label}
                      type={fieldType === 'email' ? 'email' : fieldType === 'date' ? 'date' : 'text'}
                      value={val}
                      error={err}
                      onChange={(v) => setValues((prev) => ({ ...prev, [field.key]: v }))}
                    />
                  );
                })}
              </div>
            )}

            <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || isLoadingConfig}
                className="rounded bg-teal-700 px-4 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
              >
                {isSubmitting ? 'Submitting…' : 'Submit Survey'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
