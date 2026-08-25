import { useCallback, useEffect, useState } from 'react';
import type { LeadFieldSummary } from '@erp/shared';

/**
 * Which columns the Leads board shows, and what each one is for.
 *
 * A board that shows every column a CRM could have is unreadable, and one that shows a fixed
 * seven is somebody else's CRM. So the columns are a choice, made from a catalogue that says
 * in plain words what turning each one on gets you — "Assign a person to every lead" rather
 * than "assignedToUserId".
 *
 * The choice is per person and per browser rather than per company: it is a view preference,
 * like a window size, and one colleague hiding Phone should not hide it for everybody. That
 * is the whole reason it lives in `localStorage` and not on the server.
 */

/** A column backed by a field the Lead record already has. */
export type CoreColumnKey =
  | 'status'
  | 'owner'
  | 'convert'
  | 'company'
  | 'email'
  | 'phone'
  | 'source';

export interface ColumnOption {
  key: string;
  label: string;
  description: string;
  icon: string;
  /** The colour of the tile beside it, so the list is scannable by shape as well as by word. */
  tone: string;
}

export const CORE_COLUMNS: (ColumnOption & { key: CoreColumnKey })[] = [
  {
    key: 'status',
    label: 'Status',
    description: 'Add new lead, contacted, etc.',
    icon: '▦',
    tone: 'bg-emerald-500',
  },
  {
    key: 'owner',
    label: 'Owner',
    description: 'Assign a person to every lead',
    icon: '👥',
    tone: 'bg-sky-500',
  },
  {
    key: 'convert',
    label: 'Create a contact',
    description: 'Turn lead into contact in one click',
    icon: '➜',
    tone: 'bg-indigo-600',
  },
  {
    key: 'company',
    label: 'Company',
    description: 'Add lead company name',
    icon: 'T',
    tone: 'bg-blue-500',
  },
  {
    key: 'email',
    label: 'Email',
    description: 'Add lead email address',
    icon: '✉',
    tone: 'bg-amber-400',
  },
  {
    key: 'phone',
    label: 'Phone',
    description: 'Add lead phone number',
    icon: '📱',
    tone: 'bg-violet-600',
  },
  {
    key: 'source',
    label: 'Source',
    description: 'Where this lead came from',
    icon: '⇢',
    tone: 'bg-teal-600',
  },
];

/**
 * Columns the catalogue offers that the Lead record has no room for, so switching one on
 * defines a custom field to hold it.
 *
 * They read as built-in because that is how they are used — every CRM has a location box —
 * but there is no `location` column on `Lead`, and inventing one for each would mean a
 * migration per idea. The custom-field mechanism already stores, validates and renders values
 * a company invented, so these are simply the two it is worth offering by name.
 *
 * `key` is what the server derives from the label, which is how a column switched on today
 * finds the field switched on last month instead of defining a second one.
 */
export const PROVISIONED_COLUMNS: (ColumnOption & { fieldLabel: string })[] = [
  {
    key: 'location',
    fieldLabel: 'Location',
    label: 'Location',
    description: 'Add lead location',
    icon: '📍',
    tone: 'bg-rose-500',
  },
  {
    key: 'comments',
    fieldLabel: 'Comments',
    label: 'Comments',
    description: 'Add any additional comments',
    icon: '💬',
    tone: 'bg-indigo-500',
  },
];

/** A custom field's column key. Namespaced so no field can ever collide with a core column. */
export function fieldColumnKey(field: Pick<LeadFieldSummary, 'key'>): string {
  return `field:${field.key}`;
}

const STORAGE_KEY = 'erp.crm.leads.columns';

/**
 * What a board shows before anybody has chosen: the columns that answer "who is this and how
 * do I reach them", and nothing that needs setting up first. Owner is off because a company
 * with one user has nobody to assign to, and every custom field is off because a column per
 * field a company has ever defined is exactly the unreadable board this catalogue exists to
 * prevent — they are switched on one at a time, under More columns.
 */
const DEFAULT_VISIBLE: string[] = ['status', 'convert', 'company', 'email', 'phone'];

export function useVisibleColumns(): {
  visible: (key: string) => boolean;
  toggle: (key: string, on: boolean) => void;
  keys: string[];
} {
  const [keys, setKeys] = useState<string[]>(DEFAULT_VISIBLE);

  // Read after mount rather than as the initial state: `localStorage` throws in a few real
  // contexts (private windows, blocked site data) and a board that fails to render at all is
  // a worse answer to that than a board showing the defaults.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) setKeys(JSON.parse(stored) as string[]);
    } catch {
      // Keep the defaults.
    }
  }, []);

  const toggle = useCallback((key: string, on: boolean) => {
    setKeys((previous) => {
      const next = on ? [...new Set([...previous, key])] : previous.filter((k) => k !== key);
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // The choice still applies to this session; it simply will not outlive it.
      }
      return next;
    });
  }, []);

  const visible = useCallback((key: string) => keys.includes(key), [keys]);

  return { visible, toggle, keys };
}
