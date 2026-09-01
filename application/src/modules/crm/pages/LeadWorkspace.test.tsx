import { describe, expect, it, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import {
  ACTIVITY_PATHS,
  IDENTITY_PATHS,
  LEAD_FIELD_PATHS,
  LEAD_PATHS,
  LEAD_SOURCE_PATHS,
  LEAD_STATUS_LABEL_PATHS,
  LEAD_SUBMISSION_PATHS,
  type ActivitySummary,
  type LeadAttachmentResponse,
  type LeadListResponse,
  type LeadSubmissionSummary,
  type LeadSummary,
} from '@erp/shared';
import { server } from '../../../test/server';
import { renderPage, signedInWith } from '../../../test/render';
import { LeadWorkspace } from './LeadWorkspace';

describe('LeadWorkspace', () => {
  const WORKSPACE_PATH = '/crm/leads/id-priya-kapoor';

  /** A board that renamed one built-in status and added a settable stage of its own. */
  const STATUS_LABELS = [
    { status: 'new', label: 'New', color: '#579bfc', isCustom: false, order: 0, isSettable: true },
    { status: 'contacted', label: 'Contacted', color: '#9d5bf0', isCustom: false, order: 1, isSettable: true },
    { status: 'qualified', label: 'Qualified', color: '#00c875', isCustom: false, order: 2, isSettable: false },
    { status: 'disqualified', label: 'Disqualified', color: '#e2445c', isCustom: false, order: 3, isSettable: false },
    { status: 'in-negotiation', label: 'In negotiation', color: '#fdab3d', isCustom: true, order: 4, isSettable: true },
  ];

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
      partyId: null,
      groupId: 'group-1',
      sourceId: null,
      customValues: {},
      sourceName: null,
      groupName: 'New Leads',
      ...overrides,
    };
  }

  /** The list envelope a lead's own artifacts come back in — unpaged, all at once. */
  function listed<T>(items: T[]) {
    return { items, page: { number: 1, size: items.length, total: items.length, pages: items.length ? 1 : 0 } };
  }

  function page(items: LeadSummary[]): LeadListResponse {
    return { items, page: { number: 1, size: 100, total: items.length, pages: 1 } };
  }

  function activity(overrides: Partial<ActivitySummary> = {}): ActivitySummary {
    return {
      id: `act-${Math.random().toString(36).slice(2)}`,
      type: 'note',
      notes: 'A note',
      occurredAt: '2026-08-30T09:00:00.000Z',
      dueAt: null,
      completedAt: null,
      createdByUserId: 'u1',
      createdByName: 'Ada Okafor',
      leadId: 'id-priya-kapoor',
      dealId: null,
      partyId: null,
      createdAt: '2026-08-30T09:00:00.000Z',
      ...overrides,
    };
  }

  const priya = () =>
    lead('Priya Kapoor', {
      organisationName: 'Kapoor Trading',
      email: 'priya@kapoor.example',
      phone: '01711000000',
      sourceName: 'Referral',
      assignedToUserId: 'u1',
      customValues: { priority: 'hot', budget: '50k' },
    });

  beforeEach(() => {
    window.localStorage.clear();
    signedInWith();
    server.use(
      http.get(LEAD_PATHS.lead('id-priya-kapoor'), () => HttpResponse.json(priya())),
      http.get(LEAD_PATHS.leads, () => HttpResponse.json(page([priya()]))),
      http.get(LEAD_STATUS_LABEL_PATHS.labels, () => HttpResponse.json({ items: STATUS_LABELS })),
      http.get(LEAD_SOURCE_PATHS.leadSources, () => HttpResponse.json({ items: [] })),
      http.get(LEAD_FIELD_PATHS.leadFields, () =>
        HttpResponse.json({
          items: [
            { id: 'f-budget', key: 'budget', label: 'Budget', type: 'text', required: false, order: 1, options: [], archivedAt: null },
          ],
        }),
      ),
      http.get(IDENTITY_PATHS.users, () =>
        HttpResponse.json({
          items: [{ id: 'u1', name: 'Ada Okafor', email: 'ada@northwind.test', roles: [] }],
          page: { number: 1, size: 200, total: 1, pages: 1 },
        }),
      ),
      http.get(ACTIVITY_PATHS.leadActivities('id-priya-kapoor'), () => HttpResponse.json({ items: [] })),
      http.get(LEAD_PATHS.files('id-priya-kapoor'), () => HttpResponse.json(listed([]))),
      http.get(LEAD_SUBMISSION_PATHS.byLead('id-priya-kapoor'), () => HttpResponse.json(listed([]))),
    );
  });

  it('shows the lead on its own full page, with a Hot priority badge in the header', async () => {
    renderPage(<LeadWorkspace />, { token: 'a-token', path: WORKSPACE_PATH });

    const workspace = await screen.findByRole('region', { name: 'Priya Kapoor' });
    expect(within(workspace).getByRole('heading', { name: 'Priya Kapoor' })).toBeInTheDocument();
    // Priority is a display-only custom field (ADR 0010) — 'hot' maps to a Hot badge.
    expect(within(workspace).getAllByText('Hot').length).toBeGreaterThan(0);
  });

  it('gathers every lead detail in one place on the Details tab', async () => {
    const { user } = renderPage(<LeadWorkspace />, { token: 'a-token', path: WORKSPACE_PATH });

    await user.click(await screen.findByRole('button', { name: 'Details' }));

    const details = within(await screen.findByRole('region', { name: 'Lead details' }));
    expect(details.getByText('priya@kapoor.example')).toBeInTheDocument();
    expect(details.getByText('01711000000')).toBeInTheDocument();
    expect(details.getByText('Referral')).toBeInTheDocument();
    expect(details.getByText('Ada Okafor')).toBeInTheDocument();
    // The custom field and its value both appear.
    expect(details.getByText('Budget')).toBeInTheDocument();
    expect(details.getByText('50k')).toBeInTheDocument();
  });

  describe('the worklist', () => {
    it('lists leads with name, organisation, status and priority, and filters by name', async () => {
      server.use(
        http.get(LEAD_PATHS.leads, () =>
          HttpResponse.json(
            page([
              priya(),
              lead('Imran Ali', { status: 'contacted', customValues: { priority: 'cold' } }),
            ]),
          ),
        ),
      );

      const { user } = renderPage(<LeadWorkspace />, { token: 'a-token', path: WORKSPACE_PATH });

      const worklist = await screen.findByRole('complementary', { name: 'Worklist' });
      expect(within(worklist).getByText('Priya Kapoor')).toBeInTheDocument();
      expect(within(worklist).getByText('Kapoor Trading')).toBeInTheDocument();
      expect(within(worklist).getByText('Imran Ali')).toBeInTheDocument();
      expect(within(worklist).getByText('Cold')).toBeInTheDocument();

      await user.type(within(worklist).getByRole('searchbox', { name: 'Search the worklist' }), 'Imran');

      await waitFor(() => expect(within(worklist).queryByText('Priya Kapoor')).not.toBeInTheDocument());
      expect(within(worklist).getByText('Imran Ali')).toBeInTheDocument();
    });

    it('collapses so the centre can fill the space', async () => {
      const { user } = renderPage(<LeadWorkspace />, { token: 'a-token', path: WORKSPACE_PATH });

      await user.click(await screen.findByRole('button', { name: 'Collapse worklist' }));

      expect(screen.queryByRole('complementary', { name: 'Worklist' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Expand worklist' })).toBeInTheDocument();
    });

    it('moves to another lead by clicking its worklist card', async () => {
      server.use(
        http.get(LEAD_PATHS.leads, () =>
          HttpResponse.json(page([priya(), lead('Imran Ali')])),
        ),
      );

      const { user } = renderPage(<LeadWorkspace />, { token: 'a-token', path: WORKSPACE_PATH });

      const worklist = await screen.findByRole('complementary', { name: 'Worklist' });
      await user.click(within(worklist).getByText('Imran Ali'));

      expect(window.location.pathname).toBe('/crm/leads/id-imran-ali');
    });
  });

  describe('the status stepper', () => {
    it('renders the company’s settable statuses in order, including a custom one', async () => {
      renderPage(<LeadWorkspace />, { token: 'a-token', path: WORKSPACE_PATH });

      await screen.findByRole('region', { name: 'Priya Kapoor' });

      const stepper = within(screen.getByRole('group', { name: 'Status pipeline' }));
      expect(stepper.getByRole('button', { name: 'New' })).toHaveAttribute('aria-current', 'step');
      expect(stepper.getByRole('button', { name: 'Contacted' })).toBeInTheDocument();
      expect(stepper.getByRole('button', { name: 'In negotiation' })).toBeInTheDocument();
      // Qualify and Disqualify are the terminal actions, set apart from the ordinary steps.
      expect(stepper.getByRole('button', { name: 'Qualify' })).toBeInTheDocument();
      expect(stepper.getByRole('button', { name: 'Disqualify' })).toBeInTheDocument();
    });

    it('advances the status by clicking the next step', async () => {
      let sent: unknown;
      server.use(
        http.patch(LEAD_PATHS.lead('id-priya-kapoor'), async ({ request }) => {
          sent = await request.json();
          return HttpResponse.json({ ...priya(), status: 'contacted' });
        }),
      );

      const { user } = renderPage(<LeadWorkspace />, { token: 'a-token', path: WORKSPACE_PATH });

      await user.click(await screen.findByRole('button', { name: 'Contacted' }));

      await waitFor(() => expect(sent).toEqual({ status: 'contacted' }));
    });

    it('disqualifies through the terminal action', async () => {
      let called = false;
      server.use(
        http.post(LEAD_PATHS.disqualify('id-priya-kapoor'), () => {
          called = true;
          return HttpResponse.json({ ...priya(), status: 'disqualified' });
        }),
      );

      const { user } = renderPage(<LeadWorkspace />, { token: 'a-token', path: WORKSPACE_PATH });

      await user.click(await screen.findByRole('button', { name: 'Disqualify' }));

      await waitFor(() => expect(called).toBe(true));
    });
  });

  describe('the Activity feed', () => {
    function withActivities(items: ActivitySummary[]) {
      server.use(http.get(ACTIVITY_PATHS.leadActivities('id-priya-kapoor'), () => HttpResponse.json({ items })));
    }

    it('interleaves person activities and system audit events, and filters between them', async () => {
      withActivities([
        activity({ id: 'a1', type: 'call', notes: 'Called and left a voicemail' }),
        activity({ id: 'a2', type: 'note', notes: '📝 Survey response received: Site Survey Form' }),
        activity({ id: 'a3', type: 'email', notes: 'Sent the intro email' }),
      ]);

      const { user } = renderPage(<LeadWorkspace />, { token: 'a-token', path: WORKSPACE_PATH });

      expect(await screen.findByText('Called and left a voicemail')).toBeInTheDocument();
      // The audit event is rendered as what it means, not as the emoji-tagged wire format.
      expect(screen.getByText('Answered Site Survey Form')).toBeInTheDocument();
      expect(screen.getByText('Sent the intro email')).toBeInTheDocument();

      await user.click(screen.getByRole('tab', { name: 'System' }));
      expect(screen.getByText('Answered Site Survey Form')).toBeInTheDocument();
      expect(screen.queryByText('Called and left a voicemail')).not.toBeInTheDocument();

      await user.click(screen.getByRole('tab', { name: 'Notes' }));
      expect(screen.getByText('Called and left a voicemail')).toBeInTheDocument();
      expect(screen.queryByText('Answered Site Survey Form')).not.toBeInTheDocument();
      expect(screen.queryByText('Sent the intro email')).not.toBeInTheDocument();
    });

    it('logs a note from the pinned composer', async () => {
      let sent: unknown;
      server.use(
        http.post(ACTIVITY_PATHS.activities, async ({ request }) => {
          sent = await request.json();
          return HttpResponse.json(activity({ notes: 'Left a message with reception' }));
        }),
      );

      const { user } = renderPage(<LeadWorkspace />, { token: 'a-token', path: WORKSPACE_PATH });

      await user.type(
        await screen.findByRole('textbox', { name: 'Activity notes' }),
        'Left a message with reception',
      );
      await user.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() =>
        expect(sent).toEqual({ type: 'note', notes: 'Left a message with reception', leadId: 'id-priya-kapoor' }),
      );
    });
  });

  describe('the Next-step rail', () => {
    it('surfaces a pending task with one-tap complete', async () => {
      server.use(
        http.get(ACTIVITY_PATHS.leadActivities('id-priya-kapoor'), () =>
          HttpResponse.json({ items: [activity({ id: 't1', type: 'task', notes: 'Follow up on Tuesday' })] }),
        ),
      );
      let completed = false;
      server.use(
        http.post(ACTIVITY_PATHS.completeTask('t1'), () => {
          completed = true;
          return HttpResponse.json(activity({ id: 't1', type: 'task', notes: 'Follow up on Tuesday', completedAt: '2026-08-31T00:00:00.000Z' }));
        }),
      );

      const { user } = renderPage(<LeadWorkspace />, { token: 'a-token', path: WORKSPACE_PATH });

      const rail = await screen.findByRole('complementary', { name: 'Next step' });
      expect(await within(rail).findByText('Follow up on Tuesday')).toBeInTheDocument();

      await user.click(within(rail).getByRole('button', { name: 'Mark done' }));
      await waitFor(() => expect(completed).toBe(true));
    });

    it('offers Qualify as the next step when nothing is pending, and shows what we know', async () => {
      const { user } = renderPage(<LeadWorkspace />, { token: 'a-token', path: WORKSPACE_PATH });

      const rail = await screen.findByRole('complementary', { name: 'Next step' });
      expect(within(rail).getByRole('button', { name: 'Qualify' })).toBeInTheDocument();
      // "What we know": the source and priority, without opening a tab.
      expect(within(rail).getByText('Referral')).toBeInTheDocument();
      expect(within(rail).getByText('Hot')).toBeInTheDocument();

      // The rail's Qualify opens the convert flow rather than writing a status directly.
      await user.click(within(rail).getByRole('button', { name: 'Qualify' }));
      expect(await screen.findByRole('heading', { name: /move .* to contacts/i })).toBeInTheDocument();
    });
  });

  describe('the Files tab', () => {
    function attachment(overrides: Partial<LeadAttachmentResponse> = {}): LeadAttachmentResponse {
      return {
        id: 'file-1',
        leadId: 'id-priya-kapoor',
        filename: 'quote.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 245_760,
        uploadedBy: 'Ada Okafor',
        createdAt: '2026-08-30T09:00:00.000Z',
        ...overrides,
      };
    }

    it('lists each attachment with its type, size and date', async () => {
      server.use(
        http.get(LEAD_PATHS.files('id-priya-kapoor'), () =>
          HttpResponse.json(listed([attachment()])),
        ),
      );

      const { user } = renderPage(<LeadWorkspace />, { token: 'a-token', path: WORKSPACE_PATH });

      await user.click(await screen.findByRole('button', { name: 'Files' }));

      const files = within(await screen.findByRole('region', { name: 'Files' }));
      expect(await files.findByText('quote.pdf')).toBeInTheDocument();
      expect(files.getByText('PDF')).toBeInTheDocument();
      expect(files.getByText('240 KB')).toBeInTheDocument();
    });

    /**
     * The upload carries the file itself rather than a description of it.
     *
     * The assertion is on the body being a `FormData` and not JSON, which is precisely the bug
     * this replaced: the first cut posted `{ filename, sizeBytes }` and stored no bytes at all.
     * It stops short of reading the parts back because jsdom's `FormData` and Node's `fetch`
     * are different realms — undici does not recognise the former and stringifies it, so
     * `request.formData()` here would be asserting on a quirk of the test environment. That the
     * server receives real multipart is proven where it can be: `crm-lead-workspace.spec.ts`.
     */
    it('uploads the chosen file itself, not a description of it', async () => {
      let body: string | undefined;
      let contentType: string | null = null;
      server.use(
        http.post(LEAD_PATHS.files('id-priya-kapoor'), async ({ request }) => {
          contentType = request.headers.get('content-type');
          body = await request.text();
          return HttpResponse.json(attachment(), { status: 201 });
        }),
      );

      const { user } = renderPage(<LeadWorkspace />, { token: 'a-token', path: WORKSPACE_PATH });
      await user.click(await screen.findByRole('button', { name: 'Files' }));

      const picker = await screen.findByLabelText('Choose a file to attach');
      await user.upload(picker, new File(['a quote'], 'quote.pdf', { type: 'application/pdf' }));

      await waitFor(() => expect(body).toBeDefined());
      expect(body).not.toContain('"filename"');
      expect(contentType).not.toContain('application/json');
    });

    it('downloads a stored file through the authenticated endpoint', async () => {
      let downloaded = false;
      server.use(
        http.get(LEAD_PATHS.files('id-priya-kapoor'), () =>
          HttpResponse.json(listed([attachment()])),
        ),
        http.get(LEAD_PATHS.fileDownload('id-priya-kapoor', 'file-1'), () => {
          downloaded = true;
          return HttpResponse.text('the quote', { headers: { 'Content-Type': 'application/pdf' } });
        }),
      );

      const { user } = renderPage(<LeadWorkspace />, { token: 'a-token', path: WORKSPACE_PATH });
      await user.click(await screen.findByRole('button', { name: 'Files' }));

      await user.click(await screen.findByRole('button', { name: 'Download quote.pdf' }));

      await waitFor(() => expect(downloaded).toBe(true));
    });

    it('thumbnails an image attachment rather than showing it an icon', async () => {
      server.use(
        http.get(LEAD_PATHS.files('id-priya-kapoor'), () =>
          HttpResponse.json(
            listed([attachment({ id: 'file-2', filename: 'site.png', mimeType: 'image/png' })]),
          ),
        ),
        http.get(LEAD_PATHS.fileDownload('id-priya-kapoor', 'file-2'), () =>
          HttpResponse.text('pretend png', { headers: { 'Content-Type': 'image/png' } }),
        ),
      );

      const { user } = renderPage(<LeadWorkspace />, { token: 'a-token', path: WORKSPACE_PATH });
      await user.click(await screen.findByRole('button', { name: 'Files' }));

      const thumbnail = await screen.findByRole('img', { name: 'site.png' });
      expect(thumbnail).toHaveAttribute('src', expect.stringContaining('blob:'));
    });
  });

  describe('the Survey tab', () => {
    function submission(overrides: Partial<LeadSubmissionSummary> = {}): LeadSubmissionSummary {
      return {
        id: 'sub-1',
        leadId: 'id-priya-kapoor',
        captureSourceId: 'cs-1',
        formName: 'Site Survey Form',
        rawPayload: { entry_104: '50k', entry_999: 'About 12 years' },
        mappedFields: { entry_104: 'budget' },
        submittedAt: '2026-08-30T09:00:00.000Z',
        ...overrides,
      };
    }

    it('lists each response, expanding to the full question and answer', async () => {
      server.use(
        http.get(LEAD_SUBMISSION_PATHS.byLead('id-priya-kapoor'), () =>
          HttpResponse.json(listed([submission()])),
        ),
      );

      const { user } = renderPage(<LeadWorkspace />, { token: 'a-token', path: WORKSPACE_PATH });
      await user.click(await screen.findByRole('button', { name: 'Survey' }));

      const survey = within(await screen.findByRole('region', { name: 'Survey' }));
      expect(await survey.findByText('Site Survey Form')).toBeInTheDocument();
      // Collapsed until asked for: the tab is for finding a response, not reading them all.
      expect(survey.queryByText('About 12 years')).not.toBeInTheDocument();

      await user.click(survey.getByRole('button', { expanded: false }));

      expect(survey.getByText('About 12 years')).toBeInTheDocument();
      expect(survey.getByText('50k')).toBeInTheDocument();
      // A mapped answer is labelled by the field it fed, not by the form's own key for it.
      expect(survey.getByText('Budget')).toBeInTheDocument();
    });

    it('tells a mapped answer from one no field maps', async () => {
      server.use(
        http.get(LEAD_SUBMISSION_PATHS.byLead('id-priya-kapoor'), () =>
          HttpResponse.json(listed([submission()])),
        ),
      );

      const { user } = renderPage(<LeadWorkspace />, { token: 'a-token', path: WORKSPACE_PATH });
      await user.click(await screen.findByRole('button', { name: 'Survey' }));
      await user.click(await screen.findByRole('button', { expanded: false }));

      const survey = within(screen.getByRole('region', { name: 'Survey' }));
      expect(survey.getByText('Mapped to a field')).toBeInTheDocument();
      expect(survey.getByText('Not mapped')).toBeInTheDocument();
    });

    it('promotes an unmapped answer into a custom field, then onto the lead', async () => {
      let definedField: unknown;
      let patched: unknown;
      server.use(
        http.get(LEAD_SUBMISSION_PATHS.byLead('id-priya-kapoor'), () =>
          HttpResponse.json(listed([submission()])),
        ),
        http.post(LEAD_FIELD_PATHS.leadFields, async ({ request }) => {
          definedField = await request.json();
          return HttpResponse.json(
            { id: 'f-roof', key: 'roof_age', label: 'Roof Age', type: 'text', required: false, order: 2, options: [], archivedAt: null },
            { status: 201 },
          );
        }),
        http.patch(LEAD_PATHS.lead('id-priya-kapoor'), async ({ request }) => {
          patched = await request.json();
          return HttpResponse.json(priya());
        }),
      );

      const { user } = renderPage(<LeadWorkspace />, { token: 'a-token', path: WORKSPACE_PATH });
      await user.click(await screen.findByRole('button', { name: 'Survey' }));
      await user.click(await screen.findByRole('button', { expanded: false }));
      await user.click(screen.getByRole('button', { name: 'Save as a field' }));

      // The existing two writes, in order — there is no "promote" endpoint and none is wanted.
      // The field is keyed readably: `entry_999` is the right thing to map *from* and a poor
      // thing to name a field after.
      await waitFor(() =>
        expect(definedField).toEqual({ key: 'entry_999', label: 'Entry 999', type: 'text' }),
      );
      await waitFor(() =>
        expect(patched).toEqual({
          customValues: { priority: 'hot', budget: '50k', entry_999: 'About 12 years' },
        }),
      );
    });
  });

  it('shows an email open as a likelihood, naming the lead and counting the opens', async () => {
    server.use(
      http.get(ACTIVITY_PATHS.leadActivities('id-priya-kapoor'), () =>
        HttpResponse.json({
          items: [
            activity({
              id: 'a-open',
              type: 'email',
              notes: '📬 Email opened 3 times (probably seen): Your roof quote',
            }),
          ],
        }),
      ),
    );

    renderPage(<LeadWorkspace />, { token: 'a-token', path: WORKSPACE_PATH });

    // The wire format is taken apart and rendered as what it means — who, which email, how many
    // times — rather than printed with its emoji still on the front.
    expect(
      await screen.findByText('Priya Kapoor likely opened “Your roof quote”'),
    ).toBeInTheDocument();
    expect(screen.getByText('3×')).toBeInTheDocument();
    // Never "read" or "confirmed": the pixel is defeated by image-blocking and inflated by
    // Apple Mail Privacy Protection's pre-fetch.
    expect(screen.getByText('Probably seen')).toBeInTheDocument();
    expect(screen.getByText(/soft signal, not proof/)).toBeInTheDocument();
  });

  it('renders a sent email as its subject and a preview of what was said', async () => {
    server.use(
      http.get(ACTIVITY_PATHS.leadActivities('id-priya-kapoor'), () =>
        HttpResponse.json({
          items: [
            activity({
              id: 'a-sent',
              type: 'email',
              notes: 'Email sent: Your detailing quote\n\nHi Priya, great speaking with you.',
            }),
          ],
        }),
      ),
    );

    renderPage(<LeadWorkspace />, { token: 'a-token', path: WORKSPACE_PATH });

    expect(await screen.findByText('Sent “Your detailing quote”')).toBeInTheDocument();
    expect(screen.getByText('Hi Priya, great speaking with you.')).toBeInTheDocument();
  });

  describe('the redesigned shell', () => {
    it('counts what each find-it tab holds, so the number is not a trip', async () => {
      server.use(
        http.get(ACTIVITY_PATHS.leadActivities('id-priya-kapoor'), () =>
          HttpResponse.json({ items: [activity({ id: 'a1' }), activity({ id: 'a2' })] }),
        ),
        http.get(LEAD_PATHS.files('id-priya-kapoor'), () =>
          HttpResponse.json(
            listed([
              {
                id: 'file-1',
                leadId: 'id-priya-kapoor',
                filename: 'quote.pdf',
                mimeType: 'application/pdf',
                sizeBytes: 1024,
                uploadedBy: 'Ada Okafor',
                createdAt: '2026-08-30T09:00:00.000Z',
              },
            ]),
          ),
        ),
      );

      renderPage(<LeadWorkspace />, { token: 'a-token', path: WORKSPACE_PATH });

      const tabs = within(await screen.findByRole('navigation', { name: 'Lead sections' }));
      // The count sits beside the label without becoming part of the tab's name, which would
      // otherwise rename the tab every time a file is added.
      await waitFor(() =>
        expect(tabs.getByRole('button', { name: 'Activity' })).toHaveTextContent('2'),
      );
      expect(tabs.getByRole('button', { name: 'Files' })).toHaveTextContent('1');
    });

    it('shows the lead’s own contact details as things you can act on', async () => {
      renderPage(<LeadWorkspace />, { token: 'a-token', path: WORKSPACE_PATH });

      const workspace = within(await screen.findByRole('region', { name: 'Priya Kapoor' }));
      expect(workspace.getByRole('link', { name: /priya@kapoor.example/ })).toHaveAttribute(
        'href',
        'mailto:priya@kapoor.example',
      );
      expect(workspace.getByRole('link', { name: /01711000000/ })).toHaveAttribute(
        'href',
        'tel:01711000000',
      );
    });

    it('groups the worklist by the source that brought each lead in', async () => {
      server.use(
        http.get(LEAD_PATHS.leads, () =>
          HttpResponse.json(
            page([
              priya(),
              lead('Imran Ali', { sourceName: 'Referral' }),
              lead('Shaan Auto', { sourceName: 'Referral' }),
            ]),
          ),
        ),
      );

      renderPage(<LeadWorkspace />, { token: 'a-token', path: WORKSPACE_PATH });

      const worklist = within(await screen.findByRole('complementary', { name: 'Worklist' }));
      // Each source names itself and says how many it brought — four Facebook Ads leads are
      // one batch to work, which a flat list of every lead in the company hides.
      expect(worklist.getByText('Referral · 3')).toBeInTheDocument();
    });

    it('narrows the worklist to one tile when it is clicked, and back again', async () => {
      server.use(
        http.get(LEAD_PATHS.leads, () =>
          HttpResponse.json(
            page([priya(), lead('Imran Ali', { customValues: { priority: 'cold' } })]),
          ),
        ),
      );

      const { user } = renderPage(<LeadWorkspace />, { token: 'a-token', path: WORKSPACE_PATH });

      const worklist = within(await screen.findByRole('complementary', { name: 'Worklist' }));
      const hot = worklist.getByRole('button', { name: 'Show hot' });

      await user.click(hot);
      expect(worklist.queryByText('Imran Ali')).not.toBeInTheDocument();
      expect(worklist.getByText('Priya Kapoor')).toBeInTheDocument();

      await user.click(hot);
      expect(worklist.getByText('Imran Ali')).toBeInTheDocument();
    });

    it('puts the lead’s survey answers in the rail, beside the next action', async () => {
      server.use(
        http.get(LEAD_SUBMISSION_PATHS.byLead('id-priya-kapoor'), () =>
          HttpResponse.json(
            listed([
              {
                id: 'sub-1',
                leadId: 'id-priya-kapoor',
                captureSourceId: 'cs-1',
                formName: 'Site Survey Form',
                rawPayload: { entry_104: '৳50,000', entry_105: '12 vehicles', entry_101: 'Priya Kapoor' },
                mappedFields: { entry_104: 'budget', entry_101: 'name' },
                submittedAt: '2026-08-30T09:00:00.000Z',
              },
            ]),
          ),
        ),
      );

      renderPage(<LeadWorkspace />, { token: 'a-token', path: WORKSPACE_PATH });

      const rail = within(await screen.findByRole('complementary', { name: 'Next step' }));
      // The answers that say what this lead actually wants — not the name and email already
      // in the header two inches away.
      expect(await rail.findByText('৳50,000')).toBeInTheDocument();
      expect(rail.getByText('12 vehicles')).toBeInTheDocument();
      expect(rail.queryByText('Priya Kapoor')).not.toBeInTheDocument();
    });

    it('offers Snooze beside Mark done, so a task need not be finished to be cleared', async () => {
      let snoozed: unknown;
      server.use(
        http.get(ACTIVITY_PATHS.leadActivities('id-priya-kapoor'), () =>
          HttpResponse.json({
            items: [activity({ id: 't1', type: 'task', notes: 'Follow up on the quote' })],
          }),
        ),
        http.post(ACTIVITY_PATHS.snoozeTask('t1'), async ({ request }) => {
          snoozed = await request.json();
          return HttpResponse.json(activity({ id: 't1', type: 'task', notes: 'Follow up on the quote' }));
        }),
      );

      const { user } = renderPage(<LeadWorkspace />, { token: 'a-token', path: WORKSPACE_PATH });

      const rail = within(await screen.findByRole('complementary', { name: 'Next step' }));
      await user.click(await rail.findByRole('button', { name: 'Snooze' }));

      await waitFor(() => expect(snoozed).toEqual({ days: 1 }));
    });
  });

  it('returns the same not-found for a lead in another company as for one that does not exist', async () => {
    server.use(
      http.get(LEAD_PATHS.lead('id-priya-kapoor'), () =>
        HttpResponse.json({ code: 'lead_not_found', message: 'That lead could not be found.' }, { status: 404 }),
      ),
    );

    renderPage(<LeadWorkspace />, { token: 'a-token', path: WORKSPACE_PATH });

    expect(await screen.findByText(/could not be found/i)).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Worklist' })).not.toBeInTheDocument();
  });
});
