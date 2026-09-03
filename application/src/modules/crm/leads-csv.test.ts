import { describe, expect, it } from 'vitest';
import type { LeadSummary } from '@erp/shared';
import { csvCell, leadsToCsv } from './leads-csv';
import { GROUP_COLUMN, type BoardColumn } from './columns';

describe('leadsToCsv', () => {
  function lead(overrides: Partial<LeadSummary> = {}): LeadSummary {
    return {
      id: 'id-1',
      name: 'Priya Kapoor',
      organisationName: 'Kapoor Trading',
      email: 'priya@kapoor.test',
      phone: '01712039220',
      source: 'inbound',
      sourceId: null,
      sourceName: null,
      status: 'new',
      assignedToUserId: null,
      assigneeUserIds: [],
      partyId: null,
      groupId: 'group-1',
      groupName: 'Fashion & Clothing',
      customValues: {},
      ...overrides,
    };
  }

  const names = {
    owner: (id: string | null) => (id === 'user-1' ? 'Rose Foster' : ''),
    group: (id: string | null) => (id === 'group-1' ? 'Fashion & Clothing' : ''),
    status: (status: string) => (status === 'new' ? 'New' : status),
    source: () => 'Facebook',
    custom: () => '',
  };

  const columns: BoardColumn[] = [
    { key: 'select', label: '' },
    { key: 'lead', label: 'Lead' },
    { key: 'status', label: 'Status' },
    { key: 'owner', label: 'Owner' },
    { key: 'convert', label: 'Move to Contacts' },
    { key: 'email', label: 'Email' },
    GROUP_COLUMN,
    { key: 'actions', label: '' },
  ];

  it('writes the columns the board is showing, and none of its furniture', () => {
    const csv = leadsToCsv([lead({ assignedToUserId: 'user-1' })], columns, names);

    const [header, row] = csv.trim().split('\r\n');
    expect(header).toBe('Lead,Status,Owner,Email,Group');
    expect(row).toBe('Priya Kapoor,New,Rose Foster,priya@kapoor.test,Fashion & Clothing');
  });

  it('names the owner, group and status rather than writing their ids', () => {
    const csv = leadsToCsv([lead({ assignedToUserId: 'user-1' })], columns, names);

    expect(csv).not.toContain('user-1');
    expect(csv).not.toContain('group-1');
    expect(csv).toContain('New');
  });

  it('leaves an unassigned lead’s owner cell empty rather than writing null', () => {
    const csv = leadsToCsv([lead()], columns, names);

    expect(csv).toContain('Priya Kapoor,New,,priya@kapoor.test');
  });

  /**
   * The four the board draws from somewhere other than a plain Lead field: Title, Type and
   * Priority live in `customValues` under bare keys, and Deals is derived from `partyId`. Left
   * to the custom-field branch they all come out blank, and the file writes a heading over a
   * column of nothing — which reads as "no lead has a title", not "the export forgot".
   */
  it('writes the columns the board derives rather than stores', () => {
    const derived: BoardColumn[] = [
      { key: 'lead', label: 'Lead' },
      { key: 'title', label: 'Title' },
      { key: 'type', label: 'Type' },
      { key: 'priority', label: 'Priority' },
      { key: 'deals', label: 'Deals' },
    ];

    const csv = leadsToCsv(
      [
        lead({
          customValues: { title: 'Head of Ops', type: 'Partner', priority: 'high' },
          partyId: 'party-1',
        }),
      ],
      derived,
      names,
    );

    const [header, row] = csv.trim().split('\r\n');
    expect(header).toBe('Lead,Title,Type,Priority,Deals');
    expect(row).toBe('Priya Kapoor,Head of Ops,Partner,high,Contact created');
  });

  it('matches the board’s own defaults for a lead that has none of them set', () => {
    const derived: BoardColumn[] = [
      { key: 'priority', label: 'Priority' },
      { key: 'deals', label: 'Deals' },
    ];

    // The board's Priority select shows `medium` when nothing is stored; the file agrees.
    expect(leadsToCsv([lead()], derived, names).trim().split('\r\n')[1]).toBe('medium,No deals');
  });

  it('ends every line with CRLF, which is what a spreadsheet expects', () => {
    const csv = leadsToCsv([lead()], columns, names);

    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv.split('\r\n')).toHaveLength(3);
  });
});

describe('csvCell', () => {
  it('quotes a value carrying a comma, so it stays in one column', () => {
    expect(csvCell('Rahman, Sadia')).toBe('"Rahman, Sadia"');
  });

  it('doubles an inner quote rather than ending the cell early', () => {
    expect(csvCell('Sadia "Sadi" Rahman')).toBe('"Sadia ""Sadi"" Rahman"');
  });

  it('quotes a value carrying a newline', () => {
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
  });

  /**
   * A lead name is whatever a stranger typed into a public capture form. Excel runs a cell
   * beginning `=`, `+`, `-` or `@` as a formula, so an export is a way for that stranger's text
   * to execute on a colleague's machine. The apostrophe is what makes it text again.
   */
  it.each(['=1+1', '+1', '-1', '@SUM(A1)'])('defuses %s so a spreadsheet cannot run it', (value) => {
    expect(csvCell(value)).toBe(`'${value}`);
  });

  it('leaves an ordinary value exactly as it is', () => {
    expect(csvCell('Priya Kapoor')).toBe('Priya Kapoor');
  });
});
