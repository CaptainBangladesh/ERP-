import {
  type LeadCustomValues,
  type LeadFieldSummary,
  type LeadFieldValue,
} from '@erp/shared';
import { Field, Select } from '@erp/shared/ui';

/**
 * One input per custom field a company has defined, driven entirely by the definitions.
 *
 * Shared by the create form and the lead detail rather than written twice, because "a field
 * defined once is available everywhere a lead is touched" is the story, and two copies of this
 * switch would be two places for a newly supported type to be forgotten.
 *
 * Values are reported as they will be sent: a number field yields a number, a checkbox a
 * boolean, a multiselect an array. The server validates all of it again — this is convenience,
 * never the check.
 */
export function CustomFieldInputs({
  definitions,
  values,
  errors,
  onChange,
  idPrefix,
}: {
  definitions: LeadFieldSummary[];
  values: LeadCustomValues;
  errors: Record<string, string>;
  onChange: (key: string, value: LeadFieldValue) => void;
  /** Keeps input ids unique when the create form and the detail panel are both mounted. */
  idPrefix: string;
}) {
  if (definitions.length === 0) return null;

  return (
    <>
      {definitions.map((definition) => {
        const id = `${idPrefix}-${definition.key}`;
        const error = errors[definition.key];
        const label = definition.required ? `${definition.label} *` : definition.label;
        const value = values[definition.key];

        switch (definition.type) {
          case 'checkbox':
            return (
              <div key={definition.key} className="flex flex-col gap-1.5">
                <label htmlFor={id} className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    id={id}
                    type="checkbox"
                    checked={value === true}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? `${id}-error` : undefined}
                    onChange={(event) => onChange(definition.key, event.target.checked)}
                    className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                  />
                  <span>{label}</span>
                </label>
                {error && (
                  <p id={`${id}-error`} className="text-xs text-red-600">
                    {error}
                  </p>
                )}
              </div>
            );

          case 'select':
            return (
              <Select
                key={definition.key}
                id={id}
                label={label}
                value={typeof value === 'string' ? value : ''}
                placeholder={definition.required ? undefined : '—'}
                error={error}
                options={(definition.options || []).map((option) => ({ value: option, label: option }))}
                onChange={(chosen) => onChange(definition.key, chosen === '' ? null : chosen)}
              />
            );

          case 'multiselect':
            return (
              <MultiSelectField
                key={definition.key}
                id={id}
                label={label}
                error={error}
                options={definition.options || []}
                chosen={Array.isArray(value) ? value : []}
                onChange={(next) => onChange(definition.key, next)}
              />
            );

          case 'number':
            return (
              <Field
                key={definition.key}
                id={id}
                label={label}
                inputMode="decimal"
                error={error}
                value={value === null || value === undefined ? '' : String(value)}
                // Kept as typed text and sent as text: parsing here would turn a half-typed
                // "1." into 1 and fight the person entering it. The server reads decimal text.
                onChange={(typed) => onChange(definition.key, typed === '' ? null : typed)}
              />
            );

          case 'date':
            return (
              <Field
                key={definition.key}
                id={id}
                label={label}
                type="date"
                error={error}
                value={typeof value === 'string' ? value : ''}
                onChange={(typed) => onChange(definition.key, typed === '' ? null : typed)}
              />
            );

          case 'text':
          default:
            return (
              <Field
                key={definition.key}
                id={id}
                label={label}
                error={error}
                value={typeof value === 'string' ? value : ''}
                onChange={(typed) => onChange(definition.key, typed === '' ? null : typed)}
              />
            );
        }
      })}
    </>
  );
}

/**
 * A checkbox per option. Not a `<select multiple>`: that control is close to unusable with a
 * keyboard and invisible to most people who meet it, and there is no shared component for it.
 */
function MultiSelectField({
  id,
  label,
  error,
  options,
  chosen,
  onChange,
}: {
  id: string;
  label: string;
  error?: string;
  options: string[];
  chosen: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <fieldset
      className="flex flex-col gap-1.5"
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${id}-error` : undefined}
    >
      <legend className="text-xs font-medium text-slate-700">{label}</legend>
      <div className="flex flex-wrap gap-3">
        {options.map((option) => (
          <label key={option} className="flex items-center gap-1.5 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={chosen.includes(option)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...chosen, option]
                    : chosen.filter((entry) => entry !== option),
                )
              }
              className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
            />
            <span>{option}</span>
          </label>
        ))}
      </div>
      {error && (
        <p id={`${id}-error`} className="text-xs text-red-600">
          {error}
        </p>
      )}
    </fieldset>
  );
}
