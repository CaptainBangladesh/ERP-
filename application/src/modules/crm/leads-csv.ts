import type { LeadSummary } from '@erp/shared';
import type { BoardColumn } from './columns';

/**
 * How the export turns the ids on a lead row into the words a person expects to read.
 *
 * A bag of lookups rather than the tables themselves, because the board has already resolved
 * every one of them to render the row — the colleague list, the group list, the status
 * vocabulary — and handing those over again would be asking this module to redo a join it has
 * no business knowing about. It also keeps the one join `crm` is *not* allowed to make on the
 * caller's side: owner names live in `identity`, and the board holds them only because it
 * fetched them for the Owner column.
 */
export interface LeadCellNames {
  owner: (userId: string | null) => string;
  group: (groupId: string | null) => string;
  status: (status: LeadSummary['status']) => string;
  source: (lead: LeadSummary) => string;
  custom: (lead: LeadSummary, columnKey: string) => string;
}

/**
 * The board's selection, as a CSV file.
 *
 * Built here rather than on the server, and that is a decision rather than a shortcut. Two
 * reasons, and the second is the binding one:
 *
 *  - **The file should be the board.** What a person exports is what they are looking at — the
 *    columns they switched on, in the order they sit in, with the company's own fields among
 *    them. All of that is a view decision that lives in this workspace; a server route would
 *    have to re-derive it from a request describing the view, which is the same code twice.
 *  - **Owner names are not the CRM's to read.** A lead stores `assignedToUserId` and nothing
 *    more; the names live in `identity`, whose public surface is deliberately empty, and the
 *    conformance pack refuses a `crm` service that reaches into its tables. The board already
 *    holds the colleague list it renders, so the join it is allowed to make is the one it has
 *    already made.
 *
 * The cost is honest and worth naming: this exports the rows the board is holding. That is
 * exactly the set that can be ticked, so today it is no limit at all — but a board that grows
 * a "select every match, including the pages you have not loaded" would outgrow this, and that
 * is the day it earns a server route.
 */
export function leadsToCsv(
  leads: LeadSummary[],
  columns: BoardColumn[],
  names: LeadCellNames,
): string {
  // `select` and `actions` are furniture — a checkbox and a row's own buttons. `convert` is a
  // button too; there is no value under it to write down.
  const exported = columns.filter((column) => !FURNITURE.has(column.key));

  const rows = [
    exported.map((column) => csvCell(column.label)),
    ...leads.map((lead) => exported.map((column) => csvCell(cellText(lead, column, names)))),
  ];

  // CRLF, per RFC 4180 — what Excel expects, and the line ending every other reader takes.
  return `${rows.map((row) => row.join(',')).join('\r\n')}\r\n`;
}

const FURNITURE = new Set(['select', 'actions', 'convert']);

/**
 * What the board draws in this column, as text.
 *
 * Every core column gets a case of its own, including the four the board keeps in `customValues`
 * under bare keys — Title, Type, Priority — and the one it derives rather than stores, Deals.
 * Leaving those to the `default` branch is how an export writes a heading over a column of empty
 * cells: the reader has no way to tell "this lead has no title" from "the export forgot about
 * titles", and the file quietly stops being the board it promises to be.
 */
function cellText(lead: LeadSummary, column: BoardColumn, names: LeadCellNames): string {
  switch (column.key) {
    case 'lead':
      return lead.name;
    case 'company':
      return lead.organisationName ?? '';
    case 'email':
      return lead.email ?? '';
    case 'phone':
      return lead.phone ?? '';
    case 'status':
      return names.status(lead.status);
    case 'owner':
      return names.owner(lead.assignedToUserId);
    case 'group':
      return names.group(lead.groupId ?? null);
    case 'source':
      return names.source(lead);
    case 'title':
    case 'type':
      return String(lead.customValues?.[column.key] ?? '');
    // The board's Priority select falls back to `medium` when nothing is stored, so the export
    // writes what the person is looking at rather than a blank they never chose.
    case 'priority':
      return String(lead.customValues?.priority ?? 'medium');
    case 'deals':
      return lead.partyId ? 'Contact created' : 'No deals';
    default:
      return names.custom(lead, column.key);
  }
}

/**
 * One CSV cell.
 *
 * Quoted whenever the value carries a comma, a quote or a newline, with inner quotes doubled —
 * RFC 4180, and the difference between a lead called "Rahman, Sadia" occupying one column and
 * silently shifting every column after it by one.
 *
 * The leading apostrophe on a value starting with `=`, `+`, `-` or `@` is not cosmetic: without
 * it, Excel reads the cell as a formula, and a lead name a stranger typed into a public capture
 * form becomes something the spreadsheet *executes* when a colleague opens the export.
 */
export function csvCell(value: string): string {
  const injectionRisk = /^[=+\-@\t\r]/.test(value);
  const text = injectionRisk ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
