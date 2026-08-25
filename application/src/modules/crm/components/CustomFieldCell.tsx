import type { LeadCustomValues, LeadFieldSummary, LeadFieldValue } from '@erp/shared';
import { EditableSelect, EditableText } from './EditableCell';

/**
 * One custom field, in its own column, edited like any other cell.
 *
 * A company's own fields are not second-class here: a Location column behaves exactly as the
 * Phone column does, because to the person using the board there is no difference between a
 * box the platform shipped and a box they added. What varies is the editor, and that follows
 * the definition's type rather than a guess about the value.
 */
export function CustomFieldCell({
  field,
  values,
  leadName,
  canWrite,
  onSave,
}: {
  field: LeadFieldSummary;
  values: LeadCustomValues;
  leadName: string;
  canWrite: boolean;
  onSave: (next: LeadCustomValues) => void;
}) {
  const raw = values?.[field.key];
  const label = `${field.label} of ${leadName}`;

  function save(value: LeadFieldValue) {
    onSave({ [field.key]: value });
  }

  if (field.type === 'checkbox') {
    return (
      <input
        type="checkbox"
        aria-label={label}
        checked={raw === true}
        disabled={!canWrite}
        onChange={(event) => save(event.target.checked)}
        className="size-4 rounded border-slate-300 text-teal-700 focus:ring-teal-500"
      />
    );
  }

  if (field.type === 'select') {
    return (
      <EditableSelect
        value={typeof raw === 'string' ? raw : null}
        label={label}
        canWrite={canWrite}
        options={(field.options || []).map((option) => ({ value: option, label: option }))}
        onSave={(next) => save(next === '' ? null : next)}
      />
    );
  }

  if (field.type === 'multiselect') {
    const chosen = Array.isArray(raw) ? raw : [];
    return (
      <span className="flex flex-wrap gap-1" title={chosen.join(', ')}>
        {chosen.length === 0 ? (
          <span className="text-slate-400">—</span>
        ) : (
          chosen.map((option) => (
            <span
              key={option}
              className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-700"
            >
              {option}
            </span>
          ))
        )}
      </span>
    );
  }

  // text, number and date all read and write as text. A number is sent as typed, because the
  // server reads decimal text and parsing here would fight somebody halfway through "1.".
  const isLink = looksLikeLink(field);

  return (
    <EditableText
      value={raw === null || raw === undefined ? null : String(raw)}
      label={label}
      canWrite={canWrite}
      href={isLink ? toHref : undefined}
      icon={iconFor(field)}
      // A profile URL is worth one click, not one column's width of reading. Shortened to the
      // part that identifies it, capped so a long address cannot stretch the table, and the
      // whole thing is still in the tooltip and in the editor.
      display={isLink ? shortenLink : undefined}
      className={isLink ? 'max-w-[150px] text-teal-700' : 'max-w-[220px]'}
      onSave={(next) => save(next === '' ? null : next)}
    />
  );
}

/** `https://www.facebook.com/priya.kapoor` → `facebook.com/priya.kapoor`. */
function shortenLink(value: string): string {
  return value.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');
}

/** A field whose values are addresses worth one click rather than text worth reading. */
function looksLikeLink(field: LeadFieldSummary): boolean {
  return /link|url|website|profile|linkedin|facebook|instagram|twitter/i.test(
    `${field.label} ${field.key}`,
  );
}

/**
 * A glyph read off what the field was named. A company that called a field "LinkedIn" gets the
 * LinkedIn mark without having been asked to pick one, and a field named something this list
 * has never heard of gets a neutral mark rather than nothing — a column of values with no
 * glyph beside a column that has one looks broken.
 */
function iconFor(field: LeadFieldSummary): string {
  const named = `${field.label} ${field.key}`.toLowerCase();

  if (/linkedin/.test(named)) return '💼';
  if (/twitter|\bx\b/.test(named)) return '🐦';
  if (/facebook|\bfb\b/.test(named)) return '🌐';
  if (/instagram|\binsta\b/.test(named)) return '📸';
  if (/whatsapp/.test(named)) return '💬';
  if (/location|address|city|country/.test(named)) return '📍';
  if (/comment|note/.test(named)) return '💬';
  if (looksLikeLink(field)) return '🔗';
  if (field.type === 'date') return '📅';
  if (field.type === 'number') return '#';
  return '⊞';
}

function toHref(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}
