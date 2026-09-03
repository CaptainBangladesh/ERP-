import { describe, expect, it, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import {
  IDENTITY_PATHS,
  LEAD_FIELD_PATHS,
  LEAD_GROUP_PATHS,
  LEAD_PATHS,
  LEAD_SOURCE_PATHS,
  LEAD_STATUS_LABEL_PATHS,
  ACTIVITY_PATHS,
  type LeadListResponse,
  type LeadSummary,
  type UserListResponse,
} from '@erp/shared';
import { server } from '../../../test/server';
import { renderPage, signedInWith } from '../../../test/render';
import { LeadsPage } from './LeadsPage';

describe('LeadsPage', () => {
  const PAGE_SIZE = 25;

  const defaultGroup = { id: 'group-1', name: 'New Leads', color: '#0284c7', order: 1, leadCount: 1 };

  beforeEach(() => {
    window.localStorage.clear();
    server.use(
      http.get(LEAD_GROUP_PATHS.leadGroups, () =>
        HttpResponse.json({ items: [defaultGroup] }),
      ),
      http.get(LEAD_FIELD_PATHS.leadFields, () =>
        HttpResponse.json({ items: [] }),
      ),
      http.get(LEAD_SOURCE_PATHS.leadSources, () =>
        HttpResponse.json({ items: [] }),
      ),
      http.get(LEAD_STATUS_LABEL_PATHS.labels, () =>
        HttpResponse.json({ items: [] }),
      ),
      // The colleague list and a lead's history are fetched by the board and the detail
      // panel whatever a given test is about. Without a baseline here the tests that do not
      // care about them assert against a failed request instead of an empty one, and the
      // rejection lands after the test that caused it — an unhandled error, which fails the
      // whole run. Tests that do care override these, `server.use` taking the later handler.
      http.get(IDENTITY_PATHS.users, () =>
        HttpResponse.json({
          items: [],
          page: { number: 1, size: 200, total: 0, pages: 0 },
        } satisfies UserListResponse),
      ),
      http.get(ACTIVITY_PATHS.leadActivities(':id'), () => HttpResponse.json({ items: [] })),
    );
  });

  function lead(name: string, overrides: Partial<LeadSummary> = {}): LeadSummary {
    return {
      id: `id-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      name,
      organisationName: null,
      email: null,
      phone: null,
      status: 'new',
      source: 'inbound',
      assignedToUserId: null,
      assigneeUserIds: [],
      partyId: null,
      groupId: 'group-1',
      sourceId: null,
      customValues: {},
      sourceName: null,
      groupName: 'New Leads',
      ...overrides,
    };
  }

  function page(items: LeadSummary[], total = items.length): LeadListResponse {
    return { items, page: { number: 1, size: PAGE_SIZE, total, pages: Math.ceil(total / PAGE_SIZE) } };
  }

  function listing(items: LeadSummary[]): void {
    server.use(http.get(LEAD_PATHS.leads, () => HttpResponse.json(page(items))));
  }

  describe('the list', () => {
    it('guides the first action rather than showing an empty box', async () => {
      server.use(
        http.get(LEAD_GROUP_PATHS.leadGroups, () => HttpResponse.json({ items: [] })),
        http.get(LEAD_PATHS.leads, () => HttpResponse.json(page([]))),
      );

      renderPage(<LeadsPage />, { path: '/crm/leads' });

      expect(await screen.findByText(/your board is empty/i)).toBeInTheDocument();
    });

    it('shows what is there', async () => {
      server.use(
        http.get(LEAD_SOURCE_PATHS.leadSources, () =>
          HttpResponse.json({ items: [{ id: 'source-1', name: 'Referral', order: 1, leadCount: 1 }] }),
        ),
      );
      listing([
        lead('Priya Kapoor', {
          organisationName: 'Kapoor Trading',
          sourceId: 'source-1',
          sourceName: 'Referral',
        }),
      ]);

      renderPage(<LeadsPage />, { path: '/crm/leads' });

      await screen.findByText('Priya Kapoor');
      // Re-queried rather than held: the board re-renders as its other queries settle, and a
      // node captured before that is detached by the time the drag is fired at it.
      const row = await waitFor(() => {
        const found = screen.getByText('Priya Kapoor').closest('tr');
        if (!found) throw new Error('row not settled');
        return found;
      });
      expect(within(row).getByText('Kapoor Trading')).toBeInTheDocument();
    });

    it('asks the server to sort when a column heading is clicked', async () => {
      const asked: string[] = [];
      server.use(
        http.get(LEAD_PATHS.leads, ({ request }) => {
          asked.push(new URL(request.url).search);
          return HttpResponse.json(page([lead('Priya Kapoor')]));
        }),
      );

      renderPage(<LeadsPage />, { path: '/crm/leads' });
      expect(await screen.findByText('Priya Kapoor')).toBeInTheDocument();
    });
  });

  describe('typing a lead into the table', () => {
    it('puts the cursor in the first group\'s row when New Lead is pressed', async () => {
      signedInWith();
      server.use(
        http.get(LEAD_PATHS.leads, () => HttpResponse.json(page([]))),
        http.get(IDENTITY_PATHS.users, () =>
          HttpResponse.json({ items: [], page: { number: 1, size: 200, total: 0, pages: 0 } } satisfies UserListResponse),
        ),
      );

      const { user } = renderPage(<LeadsPage />, { token: 'a-token', path: '/crm/leads' });
      await screen.findByRole('heading', { name: 'New Leads' });

      await user.click(screen.getByRole('button', { name: 'New Lead' }));

      await waitFor(() => expect(screen.getByLabelText('Lead name')).toHaveFocus());
    });

    it('takes name, email and phone from the row and commits on Enter', async () => {
      signedInWith();
      let sent: unknown;

      server.use(
        http.get(LEAD_PATHS.leads, () => HttpResponse.json(page([]))),
        http.post(LEAD_PATHS.leads, async ({ request }) => {
          sent = await request.json();
          return HttpResponse.json(lead('Priya Kapoor'), { status: 201 });
        }),
        http.get(IDENTITY_PATHS.users, () =>
          HttpResponse.json({ items: [], page: { number: 1, size: 200, total: 0, pages: 0 } } satisfies UserListResponse),
        ),
      );

      const { user } = renderPage(<LeadsPage />, { token: 'a-token', path: '/crm/leads' });
      await screen.findByRole('heading', { name: 'New Leads' });

      await user.type(screen.getByLabelText('Lead name'), 'Priya Kapoor');
      await user.type(screen.getByLabelText('Email'), 'priya@kapoor.example');
      await user.type(screen.getByLabelText('Phone'), '8801711000000{Enter}');

      await waitFor(() =>
        expect(sent).toEqual({
          name: 'Priya Kapoor',
          email: 'priya@kapoor.example',
          phone: '8801711000000',
          groupId: 'group-1',
        }),
      );
    });

    it('clears the row so the next one can be typed straight in', async () => {
      signedInWith();
      server.use(
        http.get(LEAD_PATHS.leads, () => HttpResponse.json(page([]))),
        http.post(LEAD_PATHS.leads, () => HttpResponse.json(lead('Priya Kapoor'), { status: 201 })),
        http.get(IDENTITY_PATHS.users, () =>
          HttpResponse.json({ items: [], page: { number: 1, size: 200, total: 0, pages: 0 } } satisfies UserListResponse),
        ),
      );

      const { user } = renderPage(<LeadsPage />, { token: 'a-token', path: '/crm/leads' });
      await screen.findByRole('heading', { name: 'New Leads' });

      await user.type(screen.getByLabelText('Lead name'), 'Priya Kapoor{Enter}');

      await waitFor(() => expect(screen.getByLabelText('Lead name')).toHaveValue(''));
    });

    it('says why the server refused, without losing what was typed', async () => {
      signedInWith();
      server.use(
        http.get(LEAD_PATHS.leads, () => HttpResponse.json(page([]))),
        http.post(LEAD_PATHS.leads, () =>
          HttpResponse.json(
            {
              code: 'validation_failed',
              message: 'Some of the details you entered need attention.',
              fields: { email: 'Enter a valid email address.' },
            },
            { status: 422 },
          ),
        ),
        http.get(IDENTITY_PATHS.users, () =>
          HttpResponse.json({ items: [], page: { number: 1, size: 200, total: 0, pages: 0 } } satisfies UserListResponse),
        ),
      );

      const { user } = renderPage(<LeadsPage />, { token: 'a-token', path: '/crm/leads' });
      await screen.findByRole('heading', { name: 'New Leads' });

      await user.type(screen.getByLabelText('Lead name'), 'Priya Kapoor{Enter}');

      expect(await screen.findByText(/enter a valid email address/i)).toBeInTheDocument();
      expect(screen.getByLabelText('Lead name')).toHaveValue('Priya Kapoor');
    });
  });

  describe('editing a lead in the table', () => {
    function editable(items: LeadSummary[]): { patched: () => unknown[] } {
      const sent: unknown[] = [];
      server.use(
        http.get(LEAD_PATHS.leads, () => HttpResponse.json(page(items))),
        http.patch(LEAD_PATHS.lead(items[0]!.id), async ({ request }) => {
          sent.push(await request.json());
          return HttpResponse.json(items[0]!);
        }),
        http.get(IDENTITY_PATHS.users, () =>
          HttpResponse.json({ items: [], page: { number: 1, size: 200, total: 0, pages: 0 } } satisfies UserListResponse),
        ),
      );
      return { patched: () => sent };
    }

    it('saves a retyped phone number', async () => {
      signedInWith();
      const { patched } = editable([lead('Priya Kapoor', { phone: '01711 000000' })]);

      const { user } = renderPage(<LeadsPage />, { token: 'a-token', path: '/crm/leads' });

      await user.click(await screen.findByRole('button', { name: 'Edit Phone of Priya Kapoor' }));
      await user.clear(screen.getByLabelText('Phone of Priya Kapoor'));
      await user.type(screen.getByLabelText('Phone of Priya Kapoor'), '01711 999999{Enter}');

      await waitFor(() => expect(patched()).toEqual([{ phone: '01711 999999' }]));
    });

    it('clears a field when the cell is emptied', async () => {
      signedInWith();
      const { patched } = editable([lead('Priya Kapoor', { email: 'wrong@example.test' })]);

      const { user } = renderPage(<LeadsPage />, { token: 'a-token', path: '/crm/leads' });

      await user.click(await screen.findByRole('button', { name: 'Edit Email of Priya Kapoor' }));
      await user.clear(screen.getByLabelText('Email of Priya Kapoor'));
      await user.keyboard('{Enter}');

      await waitFor(() => expect(patched()).toEqual([{ email: '' }]));
    });

    it('writes nothing when a cell is opened and left alone', async () => {
      signedInWith();
      const { patched } = editable([lead('Priya Kapoor', { phone: '01711 000000' })]);

      const { user } = renderPage(<LeadsPage />, { token: 'a-token', path: '/crm/leads' });

      await user.click(await screen.findByRole('button', { name: 'Edit Phone of Priya Kapoor' }));
      await user.keyboard('{Enter}');

      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Edit Phone of Priya Kapoor' })).toBeInTheDocument(),
      );
      expect(patched()).toEqual([]);
    });

    it('abandons an edit on Escape', async () => {
      signedInWith();
      const { patched } = editable([lead('Priya Kapoor', { phone: '01711 000000' })]);

      const { user } = renderPage(<LeadsPage />, { token: 'a-token', path: '/crm/leads' });

      await user.click(await screen.findByRole('button', { name: 'Edit Phone of Priya Kapoor' }));
      await user.clear(screen.getByLabelText('Phone of Priya Kapoor'));
      await user.type(screen.getByLabelText('Phone of Priya Kapoor'), 'nonsense{Escape}');

      await waitFor(() => expect(screen.getByText('01711 000000')).toBeInTheDocument());
      expect(patched()).toEqual([]);
    });

    it('puts the old value back and says so when the server refuses', async () => {
      signedInWith();
      server.use(
        http.get(LEAD_PATHS.leads, () =>
          HttpResponse.json(page([lead('Priya Kapoor', { email: 'priya@kapoor.example' })])),
        ),
        http.patch(LEAD_PATHS.lead('id-priya-kapoor'), () =>
          HttpResponse.json(
            {
              code: 'validation_failed',
              message: 'Some of the details you entered need attention.',
              fields: { email: 'Enter a valid email address.' },
            },
            { status: 422 },
          ),
        ),
        http.get(IDENTITY_PATHS.users, () =>
          HttpResponse.json({ items: [], page: { number: 1, size: 200, total: 0, pages: 0 } } satisfies UserListResponse),
        ),
      );

      const { user } = renderPage(<LeadsPage />, { token: 'a-token', path: '/crm/leads' });

      await user.click(await screen.findByRole('button', { name: 'Edit Email of Priya Kapoor' }));
      await user.clear(screen.getByLabelText('Email of Priya Kapoor'));
      await user.type(screen.getByLabelText('Email of Priya Kapoor'), 'not-an-email{Enter}');

      expect(await screen.findByText(/enter a valid email address/i)).toBeInTheDocument();
      await waitFor(() => expect(screen.getByText('priya@kapoor.example')).toBeInTheDocument());
    });
  });

  describe('one click uses a cell, two change it', () => {
    it('leaves the email a link, and only opens the editor on a double click', async () => {
      signedInWith();
      server.use(
        http.get(LEAD_PATHS.leads, () =>
          HttpResponse.json(page([lead('Priya Kapoor', { email: 'priya@kapoor.example' })])),
        ),
        http.get(IDENTITY_PATHS.users, () =>
          HttpResponse.json({ items: [], page: { number: 1, size: 200, total: 0, pages: 0 } } satisfies UserListResponse),
        ),
      );

      const { user } = renderPage(<LeadsPage />, { token: 'a-token', path: '/crm/leads' });

      await screen.findByText('Priya Kapoor');
      const emailLink = () => screen.getByRole('link', { name: 'priya@kapoor.example' });

      await waitFor(() => expect(emailLink()).toHaveAttribute('href', 'mailto:priya@kapoor.example'));

      await user.click(emailLink());
      expect(screen.queryByLabelText('Email of Priya Kapoor')).not.toBeInTheDocument();

      fireEvent.doubleClick(emailLink());
      expect(await screen.findByLabelText('Email of Priya Kapoor')).toHaveValue(
        'priya@kapoor.example',
      );
    });
  });

  it('keeps the glyph beside each cell, filled in or not', async () => {
    signedInWith();
    server.use(
      http.get(LEAD_PATHS.leads, () =>
        HttpResponse.json(
          page([
            lead('Priya Kapoor', {
              email: 'priya@kapoor.example',
              organisationName: 'Kapoor Trading',
            }),
          ]),
        ),
      ),
      http.get(IDENTITY_PATHS.users, () =>
        HttpResponse.json({ items: [], page: { number: 1, size: 200, total: 0, pages: 0 } } satisfies UserListResponse),
      ),
    );

    renderPage(<LeadsPage />, { token: 'a-token', path: '/crm/leads' });
    await screen.findByText('Priya Kapoor');

    const row = await waitFor(() => {
      const found = screen.getByText('Priya Kapoor').closest('tr');
      if (!found) throw new Error('row not settled');
      return found;
    });

    expect(within(row).getByText('🏢')).toBeInTheDocument();
    expect(within(row).getByText('✉️')).toBeInTheDocument();
    // Phone is empty on this lead — the glyph still marks the column.
    expect(within(row).getByText('📞')).toBeInTheDocument();
  });

  it('shortens a link field rather than showing the whole address', async () => {
    signedInWith();
    const fbField = {
      id: 'field-9',
      key: 'fb_link',
      label: 'FB link',
      type: 'text' as const,
      options: [],
      required: false,
      order: 1,
      archivedAt: null,
    };
    const url = 'https://www.facebook.com/priya.kapoor.trading.official';

    window.localStorage.setItem('erp.crm.leads.columns', JSON.stringify(['field:fb_link']));
    server.use(
      http.get(LEAD_FIELD_PATHS.leadFields, () => HttpResponse.json({ items: [fbField] })),
      http.get(LEAD_PATHS.leads, () =>
        HttpResponse.json(page([lead('Priya Kapoor', { customValues: { fb_link: url } })])),
      ),
      http.get(IDENTITY_PATHS.users, () =>
        HttpResponse.json({ items: [], page: { number: 1, size: 200, total: 0, pages: 0 } } satisfies UserListResponse),
      ),
    );

    const { user } = renderPage(<LeadsPage />, { token: 'a-token', path: '/crm/leads' });
    await screen.findByText('Priya Kapoor');

    const link = await screen.findByRole('link', { name: 'facebook.com/priya.kapoor.trading.official' });
    // Shortened for reading, but still the real address to click and still capped in width.
    expect(link).toHaveAttribute('href', url);
    expect(link).toHaveAttribute('title', url);
    expect(link.className).toContain('truncate');
    expect(link.className).toContain('max-w-[150px]');

    // Editing shows what is stored, never the shortened form.
    fireEvent.doubleClick(link);
    expect(await screen.findByLabelText('FB link of Priya Kapoor')).toHaveValue(url);
    await user.keyboard('{Escape}');
  });

  describe('the status picker', () => {
    /** A board that has renamed one built-in status and added a stage of its own. */
    function vocabulary() {
      server.use(
        http.get(LEAD_STATUS_LABEL_PATHS.labels, () =>
          HttpResponse.json({
            items: [
              { status: 'new', label: 'Fresh', color: '#579bfc', isCustom: false, order: 0, isSettable: true },
              { status: 'contacted', label: 'Contacted', color: '#9d5bf0', isCustom: false, order: 1, isSettable: true },
              { status: 'qualified', label: 'Qualified', color: '#00c875', isCustom: false, order: 2, isSettable: false },
              { status: 'disqualified', label: 'Disqualified', color: '#e2445c', isCustom: false, order: 3, isSettable: false },
              { status: 'in-negotiation', label: 'In negotiation', color: '#fdab3d', isCustom: true, order: 4, isSettable: true },
            ],
          }),
        ),
      );
    }

    function board() {
      server.use(
        http.get(LEAD_PATHS.leads, () => HttpResponse.json(page([lead('Priya Kapoor')]))),
      );
    }

    it('moves a lead into a status the company added itself', async () => {
      signedInWith();
      vocabulary();
      board();

      let sent: unknown;
      server.use(
        http.patch(LEAD_PATHS.lead('id-priya-kapoor'), async ({ request }) => {
          sent = await request.json();
          return HttpResponse.json({ ...lead('Priya Kapoor'), status: 'in-negotiation' });
        }),
      );

      const { user } = renderPage(<LeadsPage />, { token: 'a-token', path: '/crm/leads' });
      await screen.findByText('Priya Kapoor');

      await user.click(await screen.findByRole('button', { name: 'Status of Priya Kapoor' }));
      await user.click(await screen.findByRole('menuitem', { name: /In negotiation/ }));

      await waitFor(() => expect(sent).toEqual({ status: 'in-negotiation' }));
    });

    /**
     * The bug the picker replaced: the old select offered all four statuses, and the two the
     * lifecycle owns were refused by the API after the fact.
     */
    it('will not set a status that is reached by an action instead', async () => {
      signedInWith();
      vocabulary();
      board();

      let patched = false;
      server.use(
        http.patch(LEAD_PATHS.lead('id-priya-kapoor'), () => {
          patched = true;
          return HttpResponse.json(lead('Priya Kapoor'));
        }),
      );

      const { user } = renderPage(<LeadsPage />, { token: 'a-token', path: '/crm/leads' });
      await screen.findByText('Priya Kapoor');

      await user.click(await screen.findByRole('button', { name: 'Status of Priya Kapoor' }));

      const qualified = await screen.findByRole('menuitem', { name: /Qualified/ });
      expect(qualified).toBeDisabled();

      await user.click(qualified);
      expect(patched).toBe(false);
    });

    it('renames a status from the picker, without leaving the board', async () => {
      signedInWith();
      vocabulary();
      board();

      let sent: unknown;
      server.use(
        http.patch(LEAD_STATUS_LABEL_PATHS.label('new'), async ({ request }) => {
          sent = await request.json();
          return HttpResponse.json({
            status: 'new',
            label: 'Brand new',
            color: '#579bfc',
            isCustom: false,
            order: 0,
            isSettable: true,
          });
        }),
      );

      const { user } = renderPage(<LeadsPage />, { token: 'a-token', path: '/crm/leads' });
      await screen.findByText('Priya Kapoor');

      await user.click(await screen.findByRole('button', { name: 'Status of Priya Kapoor' }));
      await user.click(await screen.findByRole('button', { name: 'Edit Fresh' }));

      const name = screen.getByLabelText('Name for Fresh');
      await user.clear(name);
      await user.type(name, 'Brand new{Enter}');

      await waitFor(() => expect(sent).toEqual({ label: 'Brand new', color: '#579bfc' }));
    });

    it('adds a status of the company\'s own from the picker', async () => {
      signedInWith();
      vocabulary();
      board();

      let sent: unknown;
      server.use(
        http.post(LEAD_STATUS_LABEL_PATHS.labels, async ({ request }) => {
          sent = await request.json();
          return HttpResponse.json({
            status: 'on-hold',
            label: 'On hold',
            color: '#fdab3d',
            isCustom: true,
            order: 5,
            isSettable: true,
          });
        }),
      );

      const { user } = renderPage(<LeadsPage />, { token: 'a-token', path: '/crm/leads' });
      await screen.findByText('Priya Kapoor');

      await user.click(await screen.findByRole('button', { name: 'Status of Priya Kapoor' }));
      await user.click(screen.getByRole('button', { name: /Add status/ }));

      await user.type(screen.getByLabelText('New status name'), 'On hold');
      await user.click(screen.getByRole('button', { name: 'Use #00c875' }));
      await user.click(screen.getByRole('button', { name: 'Add' }));

      await waitFor(() => expect(sent).toEqual({ label: 'On hold', color: '#00c875' }));
    });

    it('says how many leads are in the way when a status cannot be removed', async () => {
      signedInWith();
      vocabulary();
      board();

      server.use(
        http.delete(LEAD_STATUS_LABEL_PATHS.label('in-negotiation'), () =>
          HttpResponse.json(
            {
              code: 'lead_status_has_leads',
              message: '3 leads are still in "In negotiation". Move them to another status first, then remove this one.',
            },
            { status: 409 },
          ),
        ),
      );

      const { user } = renderPage(<LeadsPage />, { token: 'a-token', path: '/crm/leads' });
      await screen.findByText('Priya Kapoor');

      await user.click(await screen.findByRole('button', { name: 'Status of Priya Kapoor' }));
      await user.click(await screen.findByRole('button', { name: 'Edit In negotiation' }));
      await user.click(screen.getByRole('button', { name: 'Remove' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(/3 leads are still in/);
    });
  });

  describe('choosing columns', () => {
    function board(): void {
      server.use(
        http.get(LEAD_PATHS.leads, () =>
          HttpResponse.json(page([lead('Priya Kapoor', { sourceId: 'source-1', sourceName: 'Referral' })])),
        ),
        http.get(LEAD_SOURCE_PATHS.leadSources, () =>
          HttpResponse.json({ items: [{ id: 'source-1', name: 'Referral', order: 1, leadCount: 1 }] }),
        ),
        http.get(IDENTITY_PATHS.users, () =>
          HttpResponse.json({ items: [], page: { number: 1, size: 200, total: 0, pages: 0 } } satisfies UserListResponse),
        ),
      );
    }

    it('adds and removes a core column, and remembers the choice', async () => {
      signedInWith();
      board();

      const { user } = renderPage(<LeadsPage />, { token: 'a-token', path: '/crm/leads' });
      await screen.findByText('Priya Kapoor');

      expect(screen.queryByRole('columnheader', { name: 'Source' })).not.toBeInTheDocument();

      await user.click(screen.getAllByRole('button', { name: 'Choose columns' })[0]!);
      await user.click(screen.getByRole('checkbox', { name: /Source/ }));

      expect(await screen.findByRole('columnheader', { name: 'Source' })).toBeInTheDocument();
      expect(JSON.parse(window.localStorage.getItem('erp.crm.leads.columns')!)).toContain('source');

      await user.click(screen.getByRole('checkbox', { name: /Source/ }));
      expect(screen.queryByRole('columnheader', { name: 'Source' })).not.toBeInTheDocument();
    });

    it('defines the field behind Location the first time that column is switched on', async () => {
      signedInWith();
      board();
      let defined: unknown;
      server.use(
        http.post(LEAD_FIELD_PATHS.leadFields, async ({ request }) => {
          defined = await request.json();
          return HttpResponse.json(
            {
              id: 'field-1',
              key: 'location',
              label: 'Location',
              type: 'text',
              options: [],
              required: false,
              order: 1,
              archivedAt: null,
            },
            { status: 201 },
          );
        }),
      );

      const { user } = renderPage(<LeadsPage />, { token: 'a-token', path: '/crm/leads' });
      await screen.findByText('Priya Kapoor');

      await user.click(screen.getAllByRole('button', { name: 'Choose columns' })[0]!);
      await user.click(screen.getByRole('checkbox', { name: /Location/ }));

      await waitFor(() => expect(defined).toEqual({ label: 'Location', type: 'text' }));
    });

    it('defines a new field from the popup and gives it a column at once', async () => {
      signedInWith();
      board();

      let defined: unknown;
      let fields: unknown[] = [];
      server.use(
        http.get(LEAD_FIELD_PATHS.leadFields, () => HttpResponse.json({ items: fields })),
        http.post(LEAD_FIELD_PATHS.leadFields, async ({ request }) => {
          defined = await request.json();
          const created = {
            id: 'field-2',
            key: 'deal_size',
            label: 'Deal size',
            type: 'number',
            options: [],
            required: false,
            order: 1,
            archivedAt: null,
          };
          fields = [created];
          return HttpResponse.json(created, { status: 201 });
        }),
      );

      const { user } = renderPage(<LeadsPage />, { token: 'a-token', path: '/crm/leads' });
      await screen.findByText('Priya Kapoor');

      await user.click(screen.getAllByRole('button', { name: 'Choose columns' })[0]!);
      await user.click(screen.getByRole('tab', { name: 'More columns' }));
      await user.click(screen.getByRole('button', { name: /add a custom field/i }));

      await user.type(screen.getByLabelText('Field name'), 'Deal size');
      await user.selectOptions(screen.getByLabelText('Holds'), 'number');
      await user.click(screen.getByRole('button', { name: 'Add field' }));

      await waitFor(() => expect(defined).toEqual({ label: 'Deal size', type: 'number' }));
      expect(await screen.findByRole('columnheader', { name: 'Deal size' })).toBeInTheDocument();
    });

    it('asks for the choices a select field offers before it will define one', async () => {
      signedInWith();
      board();

      let defined: unknown;
      server.use(
        http.post(LEAD_FIELD_PATHS.leadFields, async ({ request }) => {
          defined = await request.json();
          return HttpResponse.json(
            {
              id: 'field-3',
              key: 'tier',
              label: 'Tier',
              type: 'select',
              options: ['Gold', 'Silver'],
              required: false,
              order: 1,
              archivedAt: null,
            },
            { status: 201 },
          );
        }),
      );

      const { user } = renderPage(<LeadsPage />, { token: 'a-token', path: '/crm/leads' });
      await screen.findByText('Priya Kapoor');

      await user.click(screen.getAllByRole('button', { name: 'Choose columns' })[0]!);
      await user.click(screen.getByRole('tab', { name: 'More columns' }));
      await user.click(screen.getByRole('button', { name: /add a custom field/i }));

      await user.type(screen.getByLabelText('Field name'), 'Tier');
      await user.selectOptions(screen.getByLabelText('Holds'), 'select');

      // No choices typed yet — there is nothing to define, so the button will not send.
      expect(screen.getByRole('button', { name: 'Add field' })).toBeDisabled();

      await user.type(screen.getByLabelText(/choices/i), 'Gold, Silver');
      await user.click(screen.getByRole('button', { name: 'Add field' }));

      await waitFor(() =>
        expect(defined).toEqual({ label: 'Tier', type: 'select', options: ['Gold', 'Silver'] }),
      );
    });

    /** What the retired Lead Fields screen used to do, now done from More columns. */
    describe('managing the fields themselves', () => {
      const fbField = {
        id: 'field-9',
        key: 'fb_link',
        label: 'FB link',
        type: 'text' as const,
        options: [],
        required: false,
        order: 1,
        archivedAt: null as string | null,
      };

      async function openMoreColumns(field = fbField) {
        signedInWith();
        board();
        server.use(
          http.get(LEAD_FIELD_PATHS.leadFields, () => HttpResponse.json({ items: [field] })),
        );

        const { user } = renderPage(<LeadsPage />, { token: 'a-token', path: '/crm/leads' });
        await screen.findByText('Priya Kapoor');
        await user.click(screen.getAllByRole('button', { name: 'Choose columns' })[0]!);
        await user.click(screen.getByRole('tab', { name: 'More columns' }));
        return user;
      }

      it('renames a field without disturbing the key its values are filed under', async () => {
        let sent: unknown;
        server.use(
          http.patch(LEAD_FIELD_PATHS.leadField('field-9'), async ({ request }) => {
            sent = await request.json();
            return HttpResponse.json({ ...fbField, label: 'Facebook' });
          }),
        );

        const user = await openMoreColumns();
        const name = await screen.findByLabelText('Name of FB link');
        await user.clear(name);
        await user.type(name, 'Facebook');
        await user.tab();

        await waitFor(() => expect(sent).toEqual({ label: 'Facebook' }));
      });

      it('makes a field required', async () => {
        let sent: unknown;
        server.use(
          http.patch(LEAD_FIELD_PATHS.leadField('field-9'), async ({ request }) => {
            sent = await request.json();
            return HttpResponse.json({ ...fbField, required: true });
          }),
        );

        const user = await openMoreColumns();
        await user.click(await screen.findByRole('checkbox', { name: 'FB link is required' }));

        await waitFor(() => expect(sent).toEqual({ required: true }));
      });

      it('retires a field, and takes its column away with it', async () => {
        let retired = false;
        window.localStorage.setItem('erp.crm.leads.columns', JSON.stringify(['field:fb_link']));
        server.use(
          http.post(LEAD_FIELD_PATHS.archive('field-9'), () => {
            retired = true;
            return HttpResponse.json({ ...fbField, archivedAt: '2026-08-24T00:00:00.000Z' });
          }),
        );

        const user = await openMoreColumns();
        await user.click(await screen.findByRole('button', { name: 'Retire' }));

        await waitFor(() => expect(retired).toBe(true));
        await waitFor(() =>
          expect(JSON.parse(window.localStorage.getItem('erp.crm.leads.columns')!)).not.toContain(
            'field:fb_link',
          ),
        );
      });

      it('brings a retired field back', async () => {
        let restored = false;
        server.use(
          http.post(LEAD_FIELD_PATHS.restore('field-9'), () => {
            restored = true;
            return HttpResponse.json({ ...fbField, archivedAt: null });
          }),
        );

        const user = await openMoreColumns({ ...fbField, archivedAt: '2026-08-24T00:00:00.000Z' });
        await user.click(await screen.findByRole('button', { name: 'Bring back' }));

        await waitFor(() => expect(restored).toBe(true));
      });
    });

    it('offers a company\'s own fields under More columns', async () => {
      signedInWith();
      board();
      server.use(
        http.get(LEAD_FIELD_PATHS.leadFields, () =>
          HttpResponse.json({
            items: [
              {
                id: 'field-9',
                key: 'fb_link',
                label: 'FB link',
                type: 'text',
                options: [],
                required: false,
                order: 1,
                archivedAt: null,
              },
            ],
          }),
        ),
      );

      const { user } = renderPage(<LeadsPage />, { token: 'a-token', path: '/crm/leads' });
      await screen.findByText('Priya Kapoor');

      await user.click(screen.getAllByRole('button', { name: 'Choose columns' })[0]!);
      await user.click(screen.getByRole('tab', { name: 'More columns' }));
      await user.click(await screen.findByRole('checkbox', { name: 'Show FB link as a column' }));

      expect(await screen.findByRole('columnheader', { name: 'FB link' })).toBeInTheDocument();
    });
  });

  describe('dragging a lead between groups', () => {
    const otherGroup = { id: 'group-2', name: 'Working', color: '#16a34a', order: 2, leadCount: 0 };

    function dragging(leadId: string) {
      const data = new Map<string, string>();
      return {
        dataTransfer: {
          effectAllowed: '',
          dropEffect: '',
          setData: (format: string, value: string) => data.set(format, value),
          getData: (format: string) => data.get(format) ?? '',
          types: [...data.keys()],
          setDragImage: () => {},
        },
        leadId,
      };
    }

    it('moves it into the group it was dropped on', async () => {
      signedInWith();
      let sent: unknown;
      server.use(
        http.get(LEAD_GROUP_PATHS.leadGroups, () =>
          HttpResponse.json({ items: [defaultGroup, otherGroup] }),
        ),
        http.get(LEAD_PATHS.leads, () => HttpResponse.json(page([lead('Priya Kapoor')]))),
        http.patch(LEAD_PATHS.lead('id-priya-kapoor'), async ({ request }) => {
          sent = await request.json();
          return HttpResponse.json(lead('Priya Kapoor', { groupId: 'group-2' }));
        }),
        http.get(IDENTITY_PATHS.users, () =>
          HttpResponse.json({ items: [], page: { number: 1, size: 200, total: 0, pages: 0 } } satisfies UserListResponse),
        ),
      );

      renderPage(<LeadsPage />, { token: 'a-token', path: '/crm/leads' });

      await screen.findByText('Priya Kapoor');
      // Re-queried rather than held: the board re-renders as its other queries settle, and a
      // node captured before that is detached by the time the drag is fired at it.
      const row = await waitFor(() => {
        const found = screen.getByText('Priya Kapoor').closest('tr');
        if (!found) throw new Error('row not settled');
        return found;
      });
      const target = screen.getByRole('heading', { name: 'Working' }).closest('section')!;

      const { dataTransfer } = dragging('id-priya-kapoor');
      fireEvent.dragStart(row, { dataTransfer });
      fireEvent.dragOver(target, { dataTransfer });
      fireEvent.drop(target, { dataTransfer });

      await waitFor(() => expect(sent).toEqual({ groupId: 'group-2' }));
    });

    it('leaves it alone when dropped back on the group it came from', async () => {
      signedInWith();
      let patched = false;
      server.use(
        http.get(LEAD_GROUP_PATHS.leadGroups, () =>
          HttpResponse.json({ items: [defaultGroup, otherGroup] }),
        ),
        http.get(LEAD_PATHS.leads, () => HttpResponse.json(page([lead('Priya Kapoor')]))),
        http.patch(LEAD_PATHS.lead('id-priya-kapoor'), () => {
          patched = true;
          return HttpResponse.json(lead('Priya Kapoor'));
        }),
        http.get(IDENTITY_PATHS.users, () =>
          HttpResponse.json({ items: [], page: { number: 1, size: 200, total: 0, pages: 0 } } satisfies UserListResponse),
        ),
      );

      renderPage(<LeadsPage />, { token: 'a-token', path: '/crm/leads' });

      await screen.findByText('Priya Kapoor');
      // Re-queried rather than held: the board re-renders as its other queries settle, and a
      // node captured before that is detached by the time the drag is fired at it.
      const row = await waitFor(() => {
        const found = screen.getByText('Priya Kapoor').closest('tr');
        if (!found) throw new Error('row not settled');
        return found;
      });
      const origin = screen.getByRole('heading', { name: 'New Leads' }).closest('section')!;

      const { dataTransfer } = dragging('id-priya-kapoor');
      fireEvent.dragStart(row, { dataTransfer });
      fireEvent.drop(origin, { dataTransfer });

      await waitFor(() => expect(screen.getByText('Priya Kapoor')).toBeInTheDocument());
      expect(patched).toBe(false);
    });
  });

  describe('adding a lead', () => {
    it('hides the form from a colleague without crm:leads:write', async () => {
      signedInWith([]);
      listing([lead('Priya Kapoor')]);

      renderPage(<LeadsPage />, { token: 'a-token', path: '/crm/leads' });
      await screen.findByText('Priya Kapoor');

      expect(screen.queryByRole('button', { name: 'New Lead' })).not.toBeInTheDocument();
    });
  });

  describe('opening a lead', () => {
    it('navigates to the lead workspace at its own route', async () => {
      signedInWith();
      listing([lead('Priya Kapoor')]);

      const { user } = renderPage(<LeadsPage />, { token: 'a-token', path: '/crm/leads' });
      await user.click(await screen.findByRole('button', { name: 'Open Priya Kapoor' }));

      expect(window.location.pathname).toBe('/crm/leads/id-priya-kapoor');
    });
  });

  describe('owning and acting on many leads at once', () => {
    const team = [
      { id: 'user-1', name: 'Rose Foster', email: 'rose@thenearbuy.example', roles: [] },
      { id: 'user-2', name: 'Imran Hossain', email: 'imran@thenearbuy.example', roles: [] },
    ];

    function boardWith(items: LeadSummary[]): { patched: () => { id: string; body: unknown }[]; deleted: () => string[] } {
      const patched: { id: string; body: unknown }[] = [];
      const deleted: string[] = [];

      server.use(
        http.get(LEAD_PATHS.leads, () => HttpResponse.json(page(items))),
        http.get(IDENTITY_PATHS.users, () =>
          HttpResponse.json({
            items: team,
            page: { number: 1, size: 200, total: team.length, pages: 1 },
          } as unknown as UserListResponse),
        ),
        http.patch('/api/crm/leads/:id', async ({ params, request }) => {
          patched.push({ id: String(params.id), body: await request.json() });
          return HttpResponse.json(items[0]!);
        }),
        http.delete('/api/crm/leads/:id', ({ params }) => {
          deleted.push(String(params.id));
          return new HttpResponse(null, { status: 204 });
        }),
      );

      return { patched: () => patched, deleted: () => deleted };
    }

    /**
     * What a save actually looks like from outside: jsdom has no downloads, so the anchor's
     * `click` is the only observable moment. Held per test and restored after, so nothing else
     * in the file inherits a stubbed anchor.
     */
    let downloads: string[] = [];
    function saved(): string[] {
      return downloads;
    }

    beforeEach(() => {
      downloads = [];
      const realClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function stubbed(this: HTMLAnchorElement) {
        if (this.download) downloads.push(this.download);
        else realClick.call(this);
      };
      return () => {
        HTMLAnchorElement.prototype.click = realClick;
      };
    });

    it('gives the Owner column somewhere to write to, once it is switched on', async () => {
      signedInWith();
      const { patched } = boardWith([lead('Priya Kapoor')]);

      const { user } = renderPage(<LeadsPage />, { token: 'a-token', path: '/crm/leads' });
      await screen.findByText('Priya Kapoor');

      await user.click(screen.getAllByRole('button', { name: 'Choose columns' })[0]!);
      await user.click(screen.getByRole('checkbox', { name: /Owner/ }));
      await user.keyboard('{Escape}');

      expect(await screen.findByRole('columnheader', { name: 'Owner' })).toBeInTheDocument();

      await user.selectOptions(
        await screen.findByRole('combobox', { name: 'Owner of Priya Kapoor' }),
        'user-2',
      );

      await waitFor(() =>
        expect(patched()).toEqual([
          { id: 'id-priya-kapoor', body: { assigneeUserIds: ['user-2'] } },
        ]),
      );
    });

    it('shares a lead across several people with Ctrl-click, without closing the menu', async () => {
      signedInWith();
      const { patched } = boardWith([
        lead('Priya Kapoor', { assignedToUserId: 'user-1', assigneeUserIds: ['user-1'] }),
      ]);

      const { user } = renderPage(<LeadsPage />, { token: 'a-token', path: '/crm/leads' });
      await screen.findByText('Priya Kapoor');

      await user.click(screen.getAllByRole('button', { name: 'Choose columns' })[0]!);
      await user.click(screen.getByRole('checkbox', { name: /Owner/ }));
      await user.keyboard('{Escape}');
      expect(await screen.findByRole('columnheader', { name: 'Owner' })).toBeInTheDocument();

      // The trigger already reads as the primary owner; open the menu from it.
      await user.click(screen.getByRole('button', { name: /Rose Foster/ }));

      // Ctrl-click adds the second person to the set rather than replacing the first.
      await user.keyboard('{Control>}');
      await user.click(screen.getByRole('button', { name: /Imran Hossain/ }));
      await user.keyboard('{/Control}');

      await waitFor(() =>
        expect(patched()).toEqual([
          { id: 'id-priya-kapoor', body: { assigneeUserIds: ['user-1', 'user-2'] } },
        ]),
      );

      // The menu stays open through a multiple selection, so more people can be added.
      expect(screen.getByPlaceholderText('Search names, roles or teams')).toBeInTheDocument();
    });

    it('assigns every ticked lead in one act', async () => {
      signedInWith();
      const { patched } = boardWith([lead('Priya Kapoor'), lead('Imran Ali'), lead('Sadia Rahman')]);

      const { user } = renderPage(<LeadsPage />, { token: 'a-token', path: '/crm/leads' });
      await screen.findByText('Priya Kapoor');

      await user.click(screen.getByRole('checkbox', { name: 'Select Priya Kapoor' }));
      await user.click(screen.getByRole('checkbox', { name: 'Select Sadia Rahman' }));

      const toolbar = await screen.findByRole('toolbar', { name: 'Actions for the selected leads' });
      expect(within(toolbar).getByText('2')).toBeInTheDocument();
      expect(within(toolbar).getByText(/leads selected/)).toBeInTheDocument();

      await user.selectOptions(
        screen.getByRole('combobox', { name: 'Assign selected leads to' }),
        'user-1',
      );

      await waitFor(() =>
        expect(patched().map((call) => call.id).sort()).toEqual(['id-priya-kapoor', 'id-sadia-rahman']),
      );
      expect(patched().every((call) => JSON.stringify(call.body) === '{"assigneeUserIds":["user-1"]}')).toBe(true);
    });

    it('assigns a whole selection to several people at once', async () => {
      signedInWith();
      const { patched } = boardWith([lead('Priya Kapoor'), lead('Imran Ali'), lead('Sadia Rahman')]);

      const { user } = renderPage(<LeadsPage />, { token: 'a-token', path: '/crm/leads' });
      await screen.findByText('Priya Kapoor');

      await user.click(screen.getByRole('checkbox', { name: 'Select Priya Kapoor' }));
      await user.click(screen.getByRole('checkbox', { name: 'Select Sadia Rahman' }));

      const toolbar = await screen.findByRole('toolbar', { name: 'Actions for the selected leads' });
      // Open the Assign-owner menu, tick two people, then apply the set.
      await user.click(within(toolbar).getByRole('button', { name: /Assign owner/ }));
      await user.click(await screen.findByRole('button', { name: /Rose Foster/ }));
      await user.click(screen.getByRole('button', { name: /Imran Hossain/ }));
      await user.click(screen.getByRole('button', { name: /Assign to 2 people/ }));

      await waitFor(() =>
        expect(patched().map((call) => call.id).sort()).toEqual(['id-priya-kapoor', 'id-sadia-rahman']),
      );
      expect(
        patched().every((call) => JSON.stringify(call.body) === '{"assigneeUserIds":["user-1","user-2"]}'),
      ).toBe(true);
    });

    /**
     * The failure that reads as "bulk assign does not work": one lead the server refuses used to
     * reject the whole `Promise.all`, leaving a bare error banner over a board where the other
     * assignments had in fact landed. The count in the message is what tells those two apart.
     */
    it('says how many an assignment reached when the server refuses one of them', async () => {
      signedInWith();
      boardWith([lead('Priya Kapoor'), lead('Imran Ali')]);
      server.use(
        http.patch('/api/crm/leads/:id', ({ params }) =>
          String(params.id) === 'id-imran-ali'
            ? HttpResponse.json(
                { code: 'validation_failed', message: 'That is not a user.' },
                { status: 422 },
              )
            : HttpResponse.json(lead('Priya Kapoor')),
        ),
      );

      const { user } = renderPage(<LeadsPage />, { token: 'a-token', path: '/crm/leads' });
      await screen.findByText('Priya Kapoor');

      await user.click(screen.getByRole('checkbox', { name: 'Select Priya Kapoor' }));
      await user.click(screen.getByRole('checkbox', { name: 'Select Imran Ali' }));
      await user.selectOptions(
        screen.getByRole('combobox', { name: 'Assign selected leads to' }),
        'user-1',
      );

      expect(await screen.findByText(/assigned 1 of 2.*that is not a user/i)).toBeInTheDocument();
    });

    it('will not delete a selection until it is asked twice', async () => {
      signedInWith();
      const { deleted } = boardWith([lead('Priya Kapoor'), lead('Imran Ali')]);

      const { user } = renderPage(<LeadsPage />, { token: 'a-token', path: '/crm/leads' });
      await screen.findByText('Priya Kapoor');

      await user.click(screen.getByRole('checkbox', { name: 'Select Imran Ali' }));
      await user.click(await screen.findByRole('button', { name: 'Delete' }));

      expect(deleted()).toEqual([]);
      expect(screen.getByText(/delete 1 for good\?/i)).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Delete' }));

      await waitFor(() => expect(deleted()).toEqual(['id-imran-ali']));
    });

    it('archives a selection by disqualifying each lead, and says what it did', async () => {
      signedInWith();
      const disqualified: string[] = [];
      boardWith([lead('Priya Kapoor'), lead('Imran Ali')]);
      server.use(
        http.post('/api/crm/leads/:id/disqualify', ({ params }) => {
          disqualified.push(String(params.id));
          return HttpResponse.json(lead('Priya Kapoor'));
        }),
      );

      const { user } = renderPage(<LeadsPage />, { token: 'a-token', path: '/crm/leads' });
      await screen.findByText('Priya Kapoor');

      await user.click(screen.getByRole('checkbox', { name: 'Select Priya Kapoor' }));
      await user.click(screen.getByRole('checkbox', { name: 'Select Imran Ali' }));
      await user.click(await screen.findByRole('button', { name: 'Archive' }));

      await waitFor(() => expect(disqualified.sort()).toEqual(['id-imran-ali', 'id-priya-kapoor']));

      // Archiving clears the selection, which takes the toolbar away with it — so the notice
      // has to outlive the toolbar rather than live inside it, or the two acts most worth
      // reporting are the two that report nothing.
      expect(await screen.findByText(/archived 2 leads/i)).toBeInTheDocument();
      expect(
        screen.queryByRole('toolbar', { name: 'Actions for the selected leads' }),
      ).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Dismiss' }));
      expect(screen.queryByText(/archived 2 leads/i)).not.toBeInTheDocument();
    });

    /**
     * The half of a bulk act that is easy to get wrong: `Promise.all` would reject on the first
     * refusal and lose the successes, and a bar that then said nothing would leave somebody
     * guessing which rows took. The count in the message is the whole assertion.
     */
    it('reports a partial archive rather than swallowing the leads it could not archive', async () => {
      signedInWith();
      boardWith([lead('Priya Kapoor'), lead('Imran Ali')]);
      server.use(
        http.post('/api/crm/leads/:id/disqualify', ({ params }) =>
          String(params.id) === 'id-imran-ali'
            ? HttpResponse.json(
                { code: 'lead_already_disqualified', message: 'Already archived.' },
                { status: 409 },
              )
            : HttpResponse.json(lead('Priya Kapoor')),
        ),
      );

      const { user } = renderPage(<LeadsPage />, { token: 'a-token', path: '/crm/leads' });
      await screen.findByText('Priya Kapoor');

      await user.click(screen.getByRole('checkbox', { name: 'Select Priya Kapoor' }));
      await user.click(screen.getByRole('checkbox', { name: 'Select Imran Ali' }));
      await user.click(await screen.findByRole('button', { name: 'Archive' }));

      expect(await screen.findByText(/archived 1 of 2/i)).toBeInTheDocument();
    });

    it('exports only the ticked leads, and saves the file without leaving the board', async () => {
      signedInWith();
      boardWith([lead('Priya Kapoor'), lead('Imran Ali')]);

      const { user } = renderPage(<LeadsPage />, { token: 'a-token', path: '/crm/leads' });
      await screen.findByText('Priya Kapoor');

      await user.click(screen.getByRole('checkbox', { name: 'Select Priya Kapoor' }));
      await user.click(await screen.findByRole('button', { name: 'Export' }));

      expect(await screen.findByText(/exported 1 lead/i)).toBeInTheDocument();
      // `leads-csv.test.ts` owns what is inside the file; this owns that the button saves one.
      expect(saved()).toHaveLength(1);
      expect(saved()[0]).toMatch(/^leads-\d{4}-\d{2}-\d{2}\.csv$/);
    });

    /**
     * A sequence is several emails on a schedule, and there is no such thing in this CRM yet.
     * The button is on the bar because the shape of the toolbar is the deliverable; what it must
     * not do is look like it worked.
     */
    it('says plainly that sequences do not exist yet rather than pretending to enrol anybody', async () => {
      signedInWith();
      boardWith([lead('Priya Kapoor')]);

      const { user } = renderPage(<LeadsPage />, { token: 'a-token', path: '/crm/leads' });
      await screen.findByText('Priya Kapoor');

      await user.click(screen.getByRole('checkbox', { name: 'Select Priya Kapoor' }));
      await user.click(await screen.findByRole('button', { name: 'Add to sequence' }));

      expect(await screen.findByText(/sequences are not built yet/i)).toBeInTheDocument();
    });

    it('opens mass email on the selection, and sends through the campaign it builds', async () => {
      signedInWith();
      boardWith([lead('Priya Kapoor'), lead('Imran Ali')]);

      let createdWith: any;
      let materialized = false;
      server.use(
        http.get('/api/crm/mailboxes', () =>
          HttpResponse.json({
            items: [{ id: 'mailbox-1', emailAddress: 'sales@nearbuy.example', status: 'connected' }],
          }),
        ),
        http.get('/api/crm/email-templates', () =>
          HttpResponse.json({ items: [{ id: 'template-1', name: 'First touch' }] }),
        ),
        http.post('/api/crm/campaigns', async ({ request }) => {
          createdWith = await request.json();
          return HttpResponse.json({ id: 'campaign-1', name: 'x', status: 'draft' });
        }),
        http.post('/api/crm/campaigns/:id/materialize', () => {
          materialized = true;
          return HttpResponse.json({ id: 'campaign-1', name: 'x', status: 'draft' });
        }),
        http.get('/api/crm/campaigns/:id/recipients', () =>
          HttpResponse.json({
            items: [
              {
                id: 'r1',
                leadId: 'id-priya-kapoor',
                leadName: 'Priya Kapoor',
                emailAddress: 'priya@kapoor.test',
                status: 'pending',
                excludeReason: null,
                sentAt: null,
                openedAt: null,
              },
              {
                id: 'r2',
                leadId: 'id-imran-ali',
                leadName: 'Imran Ali',
                emailAddress: '',
                status: 'excluded',
                excludeReason: 'no_email',
                sentAt: null,
                openedAt: null,
              },
            ],
          }),
        ),
        http.post('/api/crm/campaigns/:id/send-batch', () =>
          HttpResponse.json({ batchSent: 1, remainingPending: 0, status: 'completed' }),
        ),
      );

      const { user } = renderPage(<LeadsPage />, { token: 'a-token', path: '/crm/leads' });
      await screen.findByText('Priya Kapoor');

      await user.click(screen.getByRole('checkbox', { name: 'Select Priya Kapoor' }));
      await user.click(screen.getByRole('checkbox', { name: 'Select Imran Ali' }));
      await user.click(await screen.findByRole('button', { name: 'Mass email' }));

      await user.click(await screen.findByRole('button', { name: 'Continue' }));

      // The pause is the point: who is actually going to be written to, and who was set aside.
      expect(await screen.findByText(/1 of 2 will be written to/i)).toBeInTheDocument();
      expect(screen.getByText(/no email address/i)).toBeInTheDocument();
      expect(createdWith.segmentConfig).toEqual({ leadIds: ['id-priya-kapoor', 'id-imran-ali'] });
      expect(materialized).toBe(true);

      await user.click(screen.getByRole('button', { name: 'Send to 1' }));

      expect(await screen.findByText(/sent to 1 lead/i)).toBeInTheDocument();
    });

    /**
     * Working out who a mass email would actually reach means building a real campaign, so
     * backing out has to take that campaign with it — otherwise every change of mind leaves a
     * draft on the Campaigns page.
     */
    it('throws away the draft campaign it built when the send is cancelled', async () => {
      signedInWith();
      boardWith([lead('Priya Kapoor')]);

      const discarded: string[] = [];
      server.use(
        http.get('/api/crm/mailboxes', () =>
          HttpResponse.json({
            items: [{ id: 'mailbox-1', emailAddress: 'sales@nearbuy.example', status: 'connected' }],
          }),
        ),
        http.get('/api/crm/email-templates', () =>
          HttpResponse.json({ items: [{ id: 'template-1', name: 'First touch' }] }),
        ),
        http.post('/api/crm/campaigns', () =>
          HttpResponse.json({ id: 'campaign-1', name: 'x', status: 'draft' }),
        ),
        http.post('/api/crm/campaigns/:id/materialize', () =>
          HttpResponse.json({ id: 'campaign-1', name: 'x', status: 'draft' }),
        ),
        http.get('/api/crm/campaigns/:id/recipients', () =>
          HttpResponse.json({
            items: [
              {
                id: 'r1',
                leadId: 'id-priya-kapoor',
                leadName: 'Priya Kapoor',
                emailAddress: 'priya@kapoor.test',
                status: 'pending',
                excludeReason: null,
                sentAt: null,
                openedAt: null,
              },
            ],
          }),
        ),
        http.delete('/api/crm/campaigns/:id', ({ params }) => {
          discarded.push(String(params.id));
          return new HttpResponse(null, { status: 204 });
        }),
      );

      const { user } = renderPage(<LeadsPage />, { token: 'a-token', path: '/crm/leads' });
      await screen.findByText('Priya Kapoor');

      await user.click(screen.getByRole('checkbox', { name: 'Select Priya Kapoor' }));
      await user.click(await screen.findByRole('button', { name: 'Mass email' }));
      await user.click(await screen.findByRole('button', { name: 'Continue' }));
      await screen.findByText(/1 of 1 will be written to/i);

      // Scoped to the dialog: the board's own inline add-lead row has a Cancel too.
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));

      await waitFor(() => expect(discarded).toEqual(['campaign-1']));
    });

    it('opens the new lead row above the group, not below it', async () => {
      signedInWith();
      boardWith([lead('Priya Kapoor')]);

      const { user } = renderPage(<LeadsPage />, { token: 'a-token', path: '/crm/leads' });
      await screen.findByText('Priya Kapoor');

      await user.click(screen.getByRole('button', { name: 'New Lead' }));

      const rows = screen.getAllByRole('row');
      const typing = rows.findIndex((row) => within(row).queryByLabelText('Lead name'));
      const existing = rows.findIndex((row) => within(row).queryByText('Priya Kapoor'));

      expect(typing).toBeGreaterThan(-1);
      expect(typing).toBeLessThan(existing);
    });

    it('offers New group and New source from the caret beside New Lead', async () => {
      signedInWith();
      boardWith([lead('Priya Kapoor')]);

      const { user } = renderPage(<LeadsPage />, { token: 'a-token', path: '/crm/leads' });
      await screen.findByText('Priya Kapoor');

      await user.click(screen.getByRole('button', { name: 'More to add' }));
      await user.click(screen.getByRole('menuitem', { name: 'New source' }));

      const dialog = await screen.findByRole('tab', { name: 'Sources' });
      expect(dialog).toHaveAttribute('aria-selected', 'true');
    });
  });
});
