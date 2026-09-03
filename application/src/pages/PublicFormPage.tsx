import { useEffect, useState } from 'react';
import {
  CAPTURE_SOURCE_PATHS,
  type CaptureSubmitResponse,
  type FormConfigField,
  type PublicFormConfigResponse,
} from '@erp/shared';
import { Field, FormError, Select } from '@erp/shared/ui';
import { ApiFailure, api } from '../api/client';

import { currentSearchParams, useLocationPath } from '../app/location';

export function PublicFormRoute() {
  const path = useLocationPath();
  const tokenFromPath = path.replace('/public/crm/form/', '');
  const token = tokenFromPath && tokenFromPath !== '/public/crm/form' ? tokenFromPath : currentSearchParams().get('token') || '';

  return <PublicFormPage token={token} />;
}

export function PublicFormPage({ token }: { token: string }) {
  const [config, setConfig] = useState<PublicFormConfigResponse | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [submittedResponse, setSubmittedResponse] = useState<CaptureSubmitResponse | null>(null);

  useEffect(() => {
    async function loadFormConfig() {
      setIsLoading(true);
      setGeneralError(null);
      try {
        const data = await api.get<PublicFormConfigResponse>(
          CAPTURE_SOURCE_PATHS.publicForm(token),
        );
        setConfig(data);

        // Pre-populate input values from URL query parameters (e.g. ?name=...&email=...&phone=...)
        const initialVals: Record<string, string> = {};
        const params = currentSearchParams();
        params.forEach((val, key) => {
          if (key !== 'token') {
            initialVals[key] = val;
          }
        });
        if (Object.keys(initialVals).length > 0) {
          setValues((prev) => ({ ...initialVals, ...prev }));
        }
      } catch (err) {
        if (err instanceof ApiFailure) {
          setGeneralError(err.message);
        } else {
          setGeneralError('This web form is currently unavailable.');
        }
      } finally {
        setIsLoading(false);
      }
    }
    void loadFormConfig();
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    setGeneralError(null);
    setFieldErrors({});

    try {
      const res = await api.post<CaptureSubmitResponse>(
        CAPTURE_SOURCE_PATHS.publicSubmit(token),
        values,
      );

      if (res.submitBehavior?.kind === 'redirect' && res.submitBehavior.url) {
        window.location.href = res.submitBehavior.url;
        return;
      }

      setSubmittedResponse(res);
    } catch (err) {
      if (err instanceof ApiFailure) {
        if (err.fields && Object.keys(err.fields).length > 0) {
          setFieldErrors(err.fields);
        } else {
          setGeneralError(err.message);
        }
      } else {
        setGeneralError('Could not submit form. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="text-sm text-slate-500">Loading form…</div>
      </div>
    );
  }

  if (generalError && !config) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div className="text-3xl mb-2">🔒</div>
          <h2 className="text-lg font-bold text-slate-800">Form Unavailable</h2>
          <p className="mt-2 text-xs text-slate-600">{generalError}</p>
        </div>
      </div>
    );
  }

  if (submittedResponse) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div className="text-4xl mb-3">🎉</div>
          <h2 className="text-xl font-bold text-emerald-800">Submission Received</h2>
          <p className="mt-2 text-sm text-slate-600">
            {submittedResponse.submitBehavior?.kind === 'message'
              ? submittedResponse.submitBehavior.text
              : 'Thank you for your submission!'}
          </p>
        </div>
      </div>
    );
  }

  const fields: FormConfigField[] = config?.fields || [];

  function renderFormField(field: FormConfigField) {
    const isRequired = field.required;
    const label = `${field.label}${isRequired ? ' *' : ''}`;
    const value = values[field.key] || '';
    const error = fieldErrors[field.key];
    const fieldType = field.type || (field.key === 'email' ? 'email' : field.key === 'phone' ? 'tel' : 'text');

    if (fieldType === 'select' && field.options && field.options.length > 0) {
      return (
        <Select
          key={field.key}
          id={`field-${field.key}`}
          label={label}
          value={value}
          onChange={(val: string) => setValues((prev) => ({ ...prev, [field.key]: val }))}
          placeholder={`-- Select ${field.label} --`}
          options={field.options.map((opt: string) => ({ value: opt, label: opt }))}
        />
      );
    }

    if (fieldType === 'textarea') {
      return (
        <div key={field.key} className="flex flex-col gap-1.5">
          <label htmlFor={`field-${field.key}`} className="text-xs font-semibold text-slate-700">
            {label}
          </label>
          <textarea
            id={`field-${field.key}`}
            rows={3}
            value={value}
            placeholder={field.placeholder || `Enter ${field.label}`}
            onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
            className="w-full rounded-md border border-slate-300 p-2.5 text-xs text-slate-900 focus:border-teal-600 focus:outline-hidden"
          />
          {error && <span className="text-xs text-red-600">{error}</span>}
        </div>
      );
    }

    if (fieldType === 'email' || field.key === 'email') {
      return (
        <Field
          key={field.key}
          id={`field-${field.key}`}
          label={label}
          type="email"
          value={value}
          error={error}
          onChange={(val: string) => setValues((prev) => ({ ...prev, [field.key]: val }))}
        />
      );
    }

    if (fieldType === 'date') {
      return (
        <Field
          key={field.key}
          id={`field-${field.key}`}
          label={label}
          type="date"
          value={value}
          error={error}
          onChange={(val: string) => setValues((prev) => ({ ...prev, [field.key]: val }))}
        />
      );
    }

    return (
      <div key={field.key} className="flex flex-col gap-1.5">
        <label htmlFor={`field-${field.key}`} className="text-xs font-semibold text-slate-700">
          {label}
        </label>
        <input
          id={`field-${field.key}`}
          type={fieldType === 'tel' || field.key === 'phone' ? 'tel' : fieldType === 'url' ? 'url' : 'text'}
          value={value}
          placeholder={field.placeholder || `Enter ${field.label}`}
          onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-teal-600 focus:outline-hidden"
        />
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <header className="border-b border-slate-200 pb-4 mb-6">
          <h1 className="text-xl font-bold text-slate-900">{config?.name || 'Contact Us'}</h1>
        </header>

        {generalError && <FormError>{generalError}</FormError>}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {fields.map(renderFormField)}

          <div className="pt-3">
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-md bg-teal-700 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:opacity-50"
            >
              {isSubmitting ? 'Submitting…' : 'Submit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
