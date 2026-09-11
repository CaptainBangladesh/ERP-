import {
  AUTH_PATHS,
  LEAD_EMAIL_PATHS,
  LEAD_PATHS,
  MAILBOX_ERROR_CODES,
  MAILBOX_PATHS,
  type AuthenticatedSession,
  type CreateLeadRequest,
  type LeadResponse,
  type MailPollResponse,
  type MailboxConnectionSummary,
  type SendLeadEmailRequest,
  type SignUpRequest,
} from '@erp/shared';
import { encryptSmtpPassword } from '../src/platform/secrets';
import { DevMailer } from '../src/platform/mail/dev-mailer';
import {
  RecordingInboundMailReader,
  type InboundMessage,
} from '../src/modules/crm/inbound-mail-reader';
import { createTestApp, resetDatabase, type TestApp } from './harness/test-app';

/**
 * Inbound reply capture: the poll reads a company mailbox over IMAP (a recording reader stands
 * in for the server here) and records each reply on the lead it answers.
 *
 * Everything below the HTTP seam is the real application. The one thing faked is the mailbox
 * itself — there is no IMAP server in a suite — so a test queues the messages a case is about
 * and asserts on what the poll did with them.
 */
describe('CRM Inbound Replies: poll, match, record', () => {
  let app: TestApp;
  let reader: RecordingInboundMailReader;

  const POLL_SECRET = 'test-poll-secret-0123456789';
  const MAILBOX = { host: 'mail.privateemail.com', username: 'info@thenearbuy.com' };

  type SupertestRequest = ReturnType<TestApp['http']['get']>;

  interface Tenant {
    ownerUserId: string;
    companyId: string;
    as: (req: SupertestRequest) => SupertestRequest;
  }

  async function signUp(name: string): Promise<Tenant> {
    const email = `${name.toLowerCase()}_${Math.random().toString(36).slice(2)}@example.com`;
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
    const owner = await app.prisma.user.findFirstOrThrow({
      where: { email },
      select: { id: true, companyId: true },
    });

    return {
      ownerUserId: owner.id,
      companyId: owner.companyId,
      as: (req: SupertestRequest) => req.set('Authorization', `Bearer ${session.token}`),
    };
  }

  /** Configure a company's own mailbox — the state "Settings → Company mail" reaches. */
  async function configureCompanyMailbox(companyId: string): Promise<void> {
    await app.prisma.company.update({
      where: { id: companyId },
      data: {
        mailFromAddress: MAILBOX.username,
        mailFromName: 'Thenearbuy',
        mailSmtpHost: MAILBOX.host,
        mailSmtpPort: 465,
        mailSmtpSecure: true,
        mailSmtpUsername: MAILBOX.username,
        mailSmtpPassword: encryptSmtpPassword('the-mailbox-password'),
      },
    });
  }

  async function createLead(
    tenant: Tenant,
    input: { email: string; assignToOwner?: boolean },
  ): Promise<string> {
    const res = await tenant
      .as(app.http.post(LEAD_PATHS.leads))
      .send({
        name: `Lead ${input.email}`,
        email: input.email,
        ...(input.assignToOwner ? { assignedToUserId: tenant.ownerUserId } : {}),
      } satisfies CreateLeadRequest)
      .expect(201);
    return (res.body as LeadResponse).id;
  }

  function reply(overrides: Partial<InboundMessage> = {}): InboundMessage {
    return {
      uid: 10,
      messageId: `<${Math.random().toString(36).slice(2)}@example.com>`,
      fromAddress: 'buyer@example.com',
      subject: 'Re: welcome to Thenearbuy',
      text: 'okey I will think about it. it is a good idea.',
      receivedAt: new Date('2026-09-10T11:31:00Z'),
      ...overrides,
    };
  }

  function poll(secret: string | null = POLL_SECRET): SupertestRequest {
    const req = app.http.post(MAILBOX_PATHS.poll);
    return secret === null ? req : req.set('x-poll-secret', secret);
  }

  beforeAll(async () => {
    app = await createTestApp();
    reader = app.nest.get(RecordingInboundMailReader);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(app);
    reader.reset();
    process.env.INBOUND_POLL_SECRET = POLL_SECRET;
  });

  describe('the gate on a public route', () => {
    it('refuses every request when no secret is configured, rather than running open', async () => {
      delete process.env.INBOUND_POLL_SECRET;

      const res = await poll('anything');

      expect(res.status).toBe(503);
      expect(res.body.code).toBe(MAILBOX_ERROR_CODES.pollUnauthorized);
    });

    it('refuses a missing or incorrect secret', async () => {
      const missing = await poll(null);
      expect(missing.status).toBe(401);
      expect(missing.body.code).toBe(MAILBOX_ERROR_CODES.pollUnauthorized);

      const wrong = await poll('not-the-secret');
      expect(wrong.status).toBe(401);
      expect(wrong.body.code).toBe(MAILBOX_ERROR_CODES.pollUnauthorized);
    });
  });

  it('records a matched reply on the lead timeline, once, and notifies the owner', async () => {
    const acme = await signUp('Acme');
    await configureCompanyMailbox(acme.companyId);
    const leadId = await createLead(acme, { email: 'buyer@example.com', assignToOwner: true });

    reader.queue(MAILBOX, [reply({ uid: 10, fromAddress: 'buyer@example.com' })]);

    const res = await poll();
    expect(res.status).toBe(200);
    const summary = res.body as MailPollResponse;
    expect(summary.companiesPolled).toBe(1);
    expect(summary.messagesSeen).toBe(1);
    expect(summary.repliesRecorded).toBe(1);
    expect(summary.errors).toEqual([]);

    const activities = await app.prisma.activity.findMany({ where: { leadId } });
    expect(activities).toHaveLength(1);
    expect(activities[0]!.type).toBe('email');
    expect(activities[0]!.notes).toContain('Reply received: Re: welcome to Thenearbuy');
    expect(activities[0]!.notes).toContain('okey I will think about it');

    const receipts = await app.prisma.leadEmailReceipt.findMany({ where: { leadId } });
    expect(receipts).toHaveLength(1);

    const notifications = await app.prisma.notification.findMany({
      where: { companyId: acme.companyId, userId: acme.ownerUserId },
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.title).toContain('replied');
  });

  it('skips a reply whose sender matches no lead, and records nothing', async () => {
    const acme = await signUp('Acme');
    await configureCompanyMailbox(acme.companyId);
    await createLead(acme, { email: 'buyer@example.com' });

    reader.queue(MAILBOX, [reply({ uid: 10, fromAddress: 'stranger@example.com' })]);

    const summary = (await poll()).body as MailPollResponse;
    expect(summary.messagesSeen).toBe(1);
    expect(summary.repliesRecorded).toBe(0);

    expect(await app.prisma.leadEmailReceipt.count()).toBe(0);
    expect(await app.prisma.activity.count()).toBe(0);
  });

  it('records a Message-ID once, even when a later poll sees it again', async () => {
    const acme = await signUp('Acme');
    await configureCompanyMailbox(acme.companyId);
    const leadId = await createLead(acme, { email: 'buyer@example.com' });

    reader.queue(MAILBOX, [reply({ uid: 10, messageId: '<dup@example.com>' })]);
    const first = (await poll()).body as MailPollResponse;
    expect(first.repliesRecorded).toBe(1);

    // A new UID (so the cursor lets it through) carrying the same Message-ID — the second line
    // of defence after the cursor, and the one that holds if the mailbox is re-read from zero.
    reader.queue(MAILBOX, [reply({ uid: 11, messageId: '<dup@example.com>' })]);
    const second = (await poll()).body as MailPollResponse;
    expect(second.repliesRecorded).toBe(0);

    expect(await app.prisma.leadEmailReceipt.count({ where: { leadId } })).toBe(1);
    expect(await app.prisma.activity.count({ where: { leadId } })).toBe(1);
  });

  it('advances its cursor so a second poll does not re-read the same messages', async () => {
    const acme = await signUp('Acme');
    await configureCompanyMailbox(acme.companyId);
    await createLead(acme, { email: 'buyer@example.com' });

    reader.queue(MAILBOX, [reply({ uid: 42 })]);
    await poll();

    // The same message is still in the mailbox, but the cursor has moved past it.
    const second = (await poll()).body as MailPollResponse;
    expect(second.messagesSeen).toBe(0);

    const lastFetch = reader.fetches.at(-1);
    expect(lastFetch?.sinceUid).toBe(42);
  });

  it('never records one company’s reply against another company’s lead', async () => {
    const acme = await signUp('Acme');
    const globex = await signUp('Globex');
    // Only Acme has a mailbox. Both have a lead with the *same* address, so the only thing that
    // can keep the reply off Globex's lead is the company scope the poll runs each read under.
    await configureCompanyMailbox(acme.companyId);
    const acmeLeadId = await createLead(acme, { email: 'buyer@example.com' });
    const globexLeadId = await createLead(globex, { email: 'buyer@example.com' });

    reader.queue(MAILBOX, [reply({ uid: 10, fromAddress: 'buyer@example.com' })]);
    await poll();

    expect(await app.prisma.leadEmailReceipt.count({ where: { leadId: acmeLeadId } })).toBe(1);
    expect(await app.prisma.leadEmailReceipt.count({ where: { leadId: globexLeadId } })).toBe(0);
  });

  /** The shared company mailbox, as the workspace's Send email box resolves it from the list. */
  async function companyMailboxId(tenant: Tenant): Promise<string> {
    const listRes = await tenant.as(app.http.get(MAILBOX_PATHS.mailboxes)).expect(200);
    const items = listRes.body.items as MailboxConnectionSummary[];
    return items[0]!.id;
  }

  it('threads a reply sent from the app under the message it answers', async () => {
    const acme = await signUp('Acme');
    await configureCompanyMailbox(acme.companyId);
    const leadId = await createLead(acme, { email: 'buyer@example.com', assignToOwner: true });

    // The lead replies; the poll records it, leaving an inbound Activity keyed to a receipt that
    // holds the received Message-ID.
    reader.queue(MAILBOX, [
      reply({ uid: 10, fromAddress: 'buyer@example.com', messageId: '<lead-reply-1@example.com>' }),
    ]);
    await poll();
    const inbound = await app.prisma.activity.findFirstOrThrow({ where: { leadId, type: 'email' } });

    const devMailer = app.nest.get(DevMailer);
    const before = devMailer.sent.length;

    // Answer that reply from the app, naming the inbound Activity it replies to.
    await acme
      .as(app.http.post(LEAD_EMAIL_PATHS.sendEmail(leadId)))
      .send({
        mailboxConnectionId: await companyMailboxId(acme),
        subject: 'Re: welcome to Thenearbuy',
        htmlBody: '<p>Glad to hear it — shall we set up a call?</p>',
        inReplyToActivityId: inbound.id,
      } satisfies SendLeadEmailRequest)
      .expect(200);

    expect(devMailer.sent.length).toBe(before + 1);
    const sent = devMailer.sent[devMailer.sent.length - 1]!;
    expect(sent.to).toBe('buyer@example.com');
    // The received Message-ID becomes In-Reply-To and References, so the recipient's client
    // threads this under the reply it answers rather than starting a new conversation.
    expect(sent.inReplyTo).toBe('<lead-reply-1@example.com>');
    expect(sent.references).toBe('<lead-reply-1@example.com>');
  });

  it('sends a fresh email with no threading headers when it is not a reply', async () => {
    const acme = await signUp('Acme');
    await configureCompanyMailbox(acme.companyId);
    const leadId = await createLead(acme, { email: 'buyer@example.com' });

    const devMailer = app.nest.get(DevMailer);
    const before = devMailer.sent.length;

    await acme
      .as(app.http.post(LEAD_EMAIL_PATHS.sendEmail(leadId)))
      .send({
        mailboxConnectionId: await companyMailboxId(acme),
        subject: 'Quick intro',
        htmlBody: '<p>Hello there</p>',
      } satisfies SendLeadEmailRequest)
      .expect(200);

    expect(devMailer.sent.length).toBe(before + 1);
    const sent = devMailer.sent[devMailer.sent.length - 1]!;
    expect(sent.inReplyTo).toBeUndefined();
    expect(sent.references).toBeUndefined();
  });
});
