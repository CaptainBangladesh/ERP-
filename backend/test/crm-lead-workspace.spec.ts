import {
  ACTIVITY_PATHS,
  AUTH_PATHS,
  CAPTURE_SOURCE_PATHS,
  LEAD_EMAIL_PATHS,
  LEAD_ERROR_CODES,
  LEAD_FIELD_PATHS,
  LEAD_PATHS,
  LEAD_SUBMISSION_PATHS,
  MAILBOX_PATHS,
  type ActivityListResponse,
  type AuthenticatedSession,
  type CaptureSourceResponse,
  type CreateLeadRequest,
  type LeadAttachmentListResponse,
  type LeadAttachmentResponse,
  type LeadListResponse,
  type LeadResponse,
  type LeadSubmissionListResponse,
  type MailboxConnectionSummary,
  type SendLeadEmailRequest,
  type SignUpRequest,
} from '@erp/shared';
import { createTestApp, resetDatabase, type TestApp } from './harness/test-app';

/**
 * The three capabilities the Lead Workspace is only truthful if it has: a file that can be
 * opened, a survey response that is kept, and an email whose open is known about.
 *
 * Everything is asserted through the HTTP surface — a stored file is proved by downloading it
 * back, an appended submission by reading the lead and its submissions, an open by the
 * notification and the Timeline entry it produced. Nothing below reaches for a service, and
 * `StorageProvider` is never touched directly: a store the endpoints cannot round-trip through
 * is a store that does not work, whatever its own unit test would say.
 */
describe('CRM Lead Workspace: files, survey submissions and email opens', () => {
  let app: TestApp;

  type SupertestRequest = ReturnType<TestApp['http']['get']>;

  interface Tenant {
    session: AuthenticatedSession;
    as: (req: SupertestRequest) => SupertestRequest;
  }

  let tenantCounter = 0;

  async function signUp(name: string): Promise<Tenant> {
    tenantCounter += 1;
    const email = `${name.toLowerCase()}${tenantCounter}_${Date.now()}@example.com`;
    const res = await app.http
      .post(AUTH_PATHS.signUp)
      .send({
        companyName: `${name} Corp`,
        name: `${name} Owner`,
        email,
        password: 'Password123!',
      } satisfies SignUpRequest)
      .expect(201);

    const session = res.body as AuthenticatedSession;
    return { session, as: (req) => req.set('Authorization', `Bearer ${session.token}`) };
  }

  async function createLead(tenant: Tenant, body: CreateLeadRequest): Promise<LeadResponse> {
    const res = await tenant.as(app.http.post(LEAD_PATHS.leads)).send(body).expect(201);
    return res.body as LeadResponse;
  }

  async function timeline(tenant: Tenant, leadId: string): Promise<ActivityListResponse> {
    const res = await tenant.as(app.http.get(ACTIVITY_PATHS.leadActivities(leadId))).expect(200);
    return res.body as ActivityListResponse;
  }

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(app);
  });

  // ─── real file storage ──────────────────────────────────────────────────────────────

  describe('attachments', () => {
    const PDF_BYTES = Buffer.from('%PDF-1.4\nA quote for the Kapoor job.\n%%EOF');

    it('stores the bytes, hands them back on download, and logs the attach to the Timeline', async () => {
      const tenant = await signUp('FilesA');
      const lead = await createLead(tenant, { name: 'Priya Kapoor' });

      const uploaded = await tenant
        .as(app.http.post(LEAD_PATHS.files(lead.id)))
        .attach('file', PDF_BYTES, 'quote.pdf')
        .expect(201);

      const attachment = uploaded.body as LeadAttachmentResponse;
      expect(attachment.filename).toBe('quote.pdf');
      expect(attachment.mimeType).toBe('application/pdf');
      expect(attachment.sizeBytes).toBe(PDF_BYTES.length);

      const listed = await tenant.as(app.http.get(LEAD_PATHS.files(lead.id))).expect(200);
      expect((listed.body as LeadAttachmentListResponse).items).toHaveLength(1);

      // The claim the first cut of this could not make: the file is the file.
      const downloaded = await tenant
        .as(app.http.get(LEAD_PATHS.fileDownload(lead.id, attachment.id)))
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
        })
        .expect(200);

      expect(downloaded.headers['content-type']).toContain('application/pdf');
      expect(Buffer.from(downloaded.body as Buffer).equals(PDF_BYTES)).toBe(true);

      const feed = await timeline(tenant, lead.id);
      expect(feed.items.some((entry) => entry.notes === '📎 Attached file: quote.pdf')).toBe(true);
    });

    it('refuses a file type that is not a document, spreadsheet, presentation or image', async () => {
      const tenant = await signUp('FilesB');
      const lead = await createLead(tenant, { name: 'Priya Kapoor' });

      const refused = await tenant
        .as(app.http.post(LEAD_PATHS.files(lead.id)))
        .attach('file', Buffer.from('MZ\x90\x00'), 'installer.exe')
        .expect(400);

      expect(refused.body.code).toBe('invalid_file_type');
      const listed = await tenant.as(app.http.get(LEAD_PATHS.files(lead.id))).expect(200);
      expect((listed.body as LeadAttachmentListResponse).items).toHaveLength(0);
    });

    it('forgets the bytes when the attachment is deleted', async () => {
      const tenant = await signUp('FilesC');
      const lead = await createLead(tenant, { name: 'Priya Kapoor' });

      const uploaded = await tenant
        .as(app.http.post(LEAD_PATHS.files(lead.id)))
        .attach('file', PDF_BYTES, 'quote.pdf')
        .expect(201);
      const attachment = uploaded.body as LeadAttachmentResponse;

      await tenant.as(app.http.delete(LEAD_PATHS.file(lead.id, attachment.id))).expect(204);

      await tenant.as(app.http.get(LEAD_PATHS.fileDownload(lead.id, attachment.id))).expect(404);
      const listed = await tenant.as(app.http.get(LEAD_PATHS.files(lead.id))).expect(200);
      expect((listed.body as LeadAttachmentListResponse).items).toHaveLength(0);
    });

    it('gives another company the same not-found as a lead that never existed', async () => {
      const tenantA = await signUp('FilesD');
      const tenantB = await signUp('FilesE');
      const lead = await createLead(tenantA, { name: 'Priya Kapoor' });

      const uploaded = await tenantA
        .as(app.http.post(LEAD_PATHS.files(lead.id)))
        .attach('file', PDF_BYTES, 'quote.pdf')
        .expect(201);
      const attachment = (uploaded.body as LeadAttachmentResponse).id;

      const listed = await tenantB.as(app.http.get(LEAD_PATHS.files(lead.id))).expect(404);
      expect(listed.body.code).toBe(LEAD_ERROR_CODES.leadNotFound);

      await tenantB
        .as(app.http.post(LEAD_PATHS.files(lead.id)))
        .attach('file', PDF_BYTES, 'theirs.pdf')
        .expect(404);

      const download = await tenantB
        .as(app.http.get(LEAD_PATHS.fileDownload(lead.id, attachment)))
        .expect(404);
      expect(download.body.code).toBe(LEAD_ERROR_CODES.leadNotFound);
    });
  });

  // ─── stored survey submissions ──────────────────────────────────────────────────────

  describe('capture submissions', () => {
    /**
     * A webhook source is what a Google Form posts to through an Apps Script trigger, and its
     * mapping is by stable item id rather than question title — titles change and duplicate.
     */
    async function webhookSource(tenant: Tenant): Promise<string> {
      const res = await tenant
        .as(app.http.post(CAPTURE_SOURCE_PATHS.sources))
        .send({
          kind: 'webhook',
          name: 'Site Survey Form',
          config: {
            fieldMapping: {
              entry_101: 'name',
              entry_102: 'email',
              entry_103: 'phone',
              entry_104: 'budget',
            },
          },
        })
        .expect(201);
      return (res.body as CaptureSourceResponse).token!;
    }

    async function defineBudgetField(tenant: Tenant): Promise<void> {
      await tenant
        .as(app.http.post(LEAD_FIELD_PATHS.leadFields))
        .send({ key: 'budget', label: 'Budget', type: 'text' })
        .expect(201);
    }

    it('attaches a repeat response to the lead it matches, filling only the gaps', async () => {
      const tenant = await signUp('SurveyA');
      await defineBudgetField(tenant);
      const source = await webhookSource(tenant);

      // A lead who already has a phone number, and no budget on file yet.
      const existing = await createLead(tenant, {
        name: 'Priya Kapoor',
        email: 'priya@kapoor.example',
        phone: '01711000000',
      });

      await app.http
        .post(CAPTURE_SOURCE_PATHS.publicSubmit(source))
        .send({
          entry_101: 'Priya Kapoor',
          entry_102: 'priya@kapoor.example',
          entry_103: '01999999999',
          entry_104: '50k',
          entry_999: 'We are re-roofing the west wing',
        })
        .expect(200);

      // No duplicate: the response found her.
      const leads = await tenant.as(app.http.get(LEAD_PATHS.leads)).expect(200);
      expect((leads.body as LeadListResponse).items).toHaveLength(1);

      const detail = await tenant.as(app.http.get(LEAD_PATHS.lead(existing.id))).expect(200);
      const lead = detail.body as LeadResponse;
      // The empty field was filled; the one she already had was not touched. This endpoint is
      // public, so a submission naming a known lead must never be able to overwrite what we know.
      expect(lead.customValues?.budget).toBe('50k');
      expect(lead.phone).toBe('01711000000');

      const submissions = await tenant
        .as(app.http.get(LEAD_SUBMISSION_PATHS.byLead(existing.id)))
        .expect(200);
      const items = (submissions.body as LeadSubmissionListResponse).items;
      expect(items).toHaveLength(1);
      expect(items[0]!.formName).toBe('Site Survey Form');
      // Keyed by the answer's own key, not the field's: a Google Form asks `entry_104` and the
      // source maps it onto `budget`, so this is the only shape that can say which answer was
      // mapped — and an answer nothing maps is simply absent from it.
      expect(items[0]!.mappedFields).toEqual({
        entry_101: 'name',
        entry_102: 'email',
        entry_103: 'phone',
        entry_104: 'budget',
      });
      expect(items[0]!.mappedFields.entry_999).toBeUndefined();
      // The answer no field maps survives in full — that is the point of keeping the raw payload.
      expect(items[0]!.rawPayload.entry_999).toBe('We are re-roofing the west wing');

      const feed = await timeline(tenant, existing.id);
      expect(
        feed.items.some((entry) => entry.notes === '📝 Survey response received: Site Survey Form'),
      ).toBe(true);
    });

    it('creates the lead when nothing matches, and attaches the submission to it', async () => {
      const tenant = await signUp('SurveyB');
      const source = await webhookSource(tenant);

      await app.http
        .post(CAPTURE_SOURCE_PATHS.publicSubmit(source))
        .send({
          entry_101: 'Rashid Ahmed',
          entry_102: 'rashid@example.test',
          entry_999: 'Heard about you from a neighbour',
        })
        .expect(200);

      const leads = await tenant.as(app.http.get(LEAD_PATHS.leads)).expect(200);
      const items = (leads.body as LeadListResponse).items;
      expect(items).toHaveLength(1);
      expect(items[0]!.name).toBe('Rashid Ahmed');

      const submissions = await tenant
        .as(app.http.get(LEAD_SUBMISSION_PATHS.byLead(items[0]!.id)))
        .expect(200);
      const stored = (submissions.body as LeadSubmissionListResponse).items;
      expect(stored).toHaveLength(1);
      expect(stored[0]!.rawPayload.entry_999).toBe('Heard about you from a neighbour');
    });

    it('accumulates a second response rather than replacing the first', async () => {
      const tenant = await signUp('SurveyC');
      const source = await webhookSource(tenant);

      for (const answer of ['First visit', 'Second visit']) {
        await app.http
          .post(CAPTURE_SOURCE_PATHS.publicSubmit(source))
          .send({ entry_101: 'Rashid Ahmed', entry_999: answer })
          .expect(200);
      }

      const leads = await tenant.as(app.http.get(LEAD_PATHS.leads)).expect(200);
      expect((leads.body as LeadListResponse).items).toHaveLength(1);

      const leadId = (leads.body as LeadListResponse).items[0]!.id;
      const submissions = await tenant
        .as(app.http.get(LEAD_SUBMISSION_PATHS.byLead(leadId)))
        .expect(200);
      const stored = (submissions.body as LeadSubmissionListResponse).items;
      expect(stored).toHaveLength(2);
      expect(stored.map((entry) => entry.rawPayload.entry_999).sort()).toEqual([
        'First visit',
        'Second visit',
      ]);
    });

    it('gives another company the same not-found when reading a lead’s submissions', async () => {
      const tenantA = await signUp('SurveyD');
      const tenantB = await signUp('SurveyE');
      const lead = await createLead(tenantA, { name: 'Priya Kapoor' });

      const refused = await tenantB
        .as(app.http.get(LEAD_SUBMISSION_PATHS.byLead(lead.id)))
        .expect(404);
      expect(refused.body.code).toBe(LEAD_ERROR_CODES.leadNotFound);
    });
  });

  // ─── 1:1 email opens ────────────────────────────────────────────────────────────────

  describe('email opens', () => {
    async function connectMailbox(tenant: Tenant): Promise<string> {
      const connect = await tenant
        .as(app.http.post(MAILBOX_PATHS.connectUrl))
        .send({ provider: 'gmail' })
        .expect(200);

      await app.http
        .get(MAILBOX_PATHS.callback)
        .query({ state: connect.body.stateToken, code: 'code_open_tracking' })
        .expect(200);

      const list = await tenant.as(app.http.get(MAILBOX_PATHS.mailboxes)).expect(200);
      return (list.body.items as MailboxConnectionSummary[])[0]!.id;
    }

    /**
     * The pixel URL the mail actually carried. Read out of the sent message rather than
     * constructed here, because the claim is that the recipient can reach the token — a test
     * that built its own URL would pass even if the mail carried no pixel at all.
     */
    function sentPixelToken(html: string): string {
      const match = /\/api\/public\/lead-emails\/open\/([^"']+)/.exec(html);
      expect(match).not.toBeNull();
      return match![1]!;
    }

    async function sendEmail(tenant: Tenant, leadId: string, mailboxId: string): Promise<string> {
      const { DevMailer } = await import('../src/platform/mail/dev-mailer');
      const mailer = app.nest.get(DevMailer);

      await tenant
        .as(app.http.post(LEAD_EMAIL_PATHS.send(leadId)))
        .send({
          mailboxConnectionId: mailboxId,
          subject: 'Your roof quote',
          htmlBody: '<p>Here is the quote we discussed.</p>',
        } satisfies SendLeadEmailRequest)
        .expect(200);

      return sentPixelToken(mailer.sent[mailer.sent.length - 1]!.html ?? '');
    }

    it('notifies the sender once, however many times the pixel is fetched', async () => {
      const tenant = await signUp('OpensA');
      const mailboxId = await connectMailbox(tenant);
      const lead = await createLead(tenant, { name: 'Priya Kapoor', email: 'priya@kapoor.example' });

      const token = await sendEmail(tenant, lead.id, mailboxId);

      const pixel = await app.http.get(LEAD_EMAIL_PATHS.publicOpenPixel(token)).expect(200);
      expect(pixel.headers['content-type']).toContain('image/gif');

      const afterFirst = await app.prisma.leadEmailSend.findUnique({ where: { openToken: token } });
      expect(afterFirst?.openCount).toBe(1);
      expect(afterFirst?.openedAt).not.toBeNull();

      const notifications = await app.prisma.notification.findMany({
        where: { userId: tenant.session.user.id },
      });
      expect(notifications).toHaveLength(1);
      expect(notifications[0]!.title).toBe('Your email was probably opened');

      const feed = await timeline(tenant, lead.id);
      const opens = feed.items.filter((entry) => entry.notes.startsWith('📬'));
      expect(opens).toHaveLength(1);
      // Never stated as certainty: the pixel is defeated by image-blocking and inflated by
      // Apple Mail Privacy Protection's pre-fetch.
      expect(opens[0]!.notes).toContain('probably seen');

      // Apple Mail pre-fetches; a second fetch is a count, not news.
      await app.http.get(LEAD_EMAIL_PATHS.publicOpenPixel(token)).expect(200);

      const afterSecond = await app.prisma.leadEmailSend.findUnique({ where: { openToken: token } });
      expect(afterSecond?.openCount).toBe(2);
      expect(afterSecond?.openedAt).toEqual(afterFirst?.openedAt);

      expect(
        await app.prisma.notification.count({ where: { userId: tenant.session.user.id } }),
      ).toBe(1);

      // Still one entry — but its count has climbed, which is what a salesperson weighs.
      const feedAfter = await timeline(tenant, lead.id);
      const opensAfter = feedAfter.items.filter((entry) => entry.notes.startsWith('📬'));
      expect(opensAfter).toHaveLength(1);
      expect(opensAfter[0]!.notes).toContain('2 times');
      expect(opensAfter[0]!.notes).toContain('probably seen');
    });

    it('answers a token it has never seen with the same pixel, telling the fetcher nothing', async () => {
      const response = await app.http
        .get(LEAD_EMAIL_PATHS.publicOpenPixel('not-a-real-token'))
        .expect(200);

      expect(response.headers['content-type']).toContain('image/gif');
    });
  });
});
