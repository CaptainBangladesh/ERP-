import {
  AUTH_PATHS,
  EMAIL_TEMPLATE_ERROR_CODES,
  EMAIL_TEMPLATE_PATHS,
  LEAD_EMAIL_PATHS,
  LEAD_FIELD_PATHS,
  CAMPAIGN_PATHS,
  LEAD_PATHS,
  MAILBOX_ERROR_CODES,
  MAILBOX_PATHS,
  type AuthenticatedSession,
  type CreateEmailTemplateRequest,
  type CreateLeadFieldRequest,
  type CreateLeadRequest,
  type EmailTemplateSummary,
  type LeadResponse,
  type MailboxConnectionSummary,
  type SendLeadEmailRequest,
  type SignUpRequest,
} from '@erp/shared';
import { DevMailer } from '../src/platform/mail/dev-mailer';
import { StubMailboxOAuth } from '../src/modules/crm/mailbox-oauth';
import { RecordingMailboxSender } from '../src/modules/crm/mailbox-sender';
import { createTestApp, resetDatabase, type TestApp } from './harness/test-app';
import { createFactories, type Factories } from './harness/factories';

describe('CRM Outreach: Mailboxes, Templates & 1-on-1 Send', () => {
  let app: TestApp;
  let factories: Factories;

  type SupertestRequest = ReturnType<TestApp['http']['get']>;

  interface Tenant {
    session: AuthenticatedSession;
    tokenHeader: string;
    as: (req: SupertestRequest) => SupertestRequest;
  }

  async function signUp(name: string): Promise<Tenant> {
    const email = `${name.toLowerCase().replace(/\s+/g, '')}_${Math.random().toString(36).substring(2)}@example.com`;
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
    return {
      session,
      tokenHeader: `Bearer ${session.token}`,
      as: (req: SupertestRequest) => req.set('Authorization', `Bearer ${session.token}`),
    };
  }

  /**
   * Connects a mailbox the way the application does: ask for the consent URL, then hand the
   * callback the code the provider would have returned with.
   *
   * The id comes from the mailbox list rather than the callback, because the callback answers
   * a popup with a page rather than a caller with JSON — see `MailboxesController`.
   */
  async function connectMailbox(tenant: Tenant, code: string): Promise<string> {
    const connectRes = await tenant
      .as(app.http.post(MAILBOX_PATHS.connectUrl))
      .send({ provider: 'gmail' })
      .expect(200);

    await app.http
      .get(MAILBOX_PATHS.callback)
      .query({ state: connectRes.body.stateToken, code })
      .expect(200);

    const listRes = await tenant.as(app.http.get(MAILBOX_PATHS.mailboxes)).expect(200);
    const mailboxes = listRes.body.items as MailboxConnectionSummary[];

    return mailboxes[0]!.id;
  }

  beforeAll(async () => {
    app = await createTestApp();
    factories = createFactories(app.prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(app);
  });

  /**
   * Connecting a mailbox, and the two ways it can fail to happen.
   *
   * The rule these hold in place: a connection row exists only when the provider named the
   * account. The exchange used to fall back to `gmail_user@example.com` whenever Google could
   * not be reached, so a failed connect was indistinguishable on screen from a real one.
   */
  it('records the account the provider named, and sends the user to the provider to consent', async () => {
    const tenantA = await signUp('OutreachA');

    const connectRes = await tenantA
      .as(app.http.post(MAILBOX_PATHS.connectUrl))
      .send({ provider: 'gmail' })
      .expect(200);

    const { stateToken, url } = connectRes.body;
    expect(stateToken).toMatch(/^mbs_/);
    // The provider's own consent screen, carrying the state that ties the return to this
    // request — never an internal URL that would connect something without one.
    expect(url).toContain('https://accounts.google.com/');
    expect(url).toContain(encodeURIComponent(stateToken));

    // Permission to send as this account, which `LiveMailboxSender` genuinely uses, plus a
    // refresh token so the mailbox still works an hour later.
    const params = new URL(url).searchParams;
    expect(params.get('scope')).toContain('https://www.googleapis.com/auth/gmail.send');
    expect(params.get('access_type')).toBe('offline');

    const callbackRes = await app.http
      .get(MAILBOX_PATHS.callback)
      .query({ state: stateToken, code: 'code_abc' })
      .expect(200);

    // A page for the popup that is looking at it, which reports what happened.
    expect(callbackRes.text).toMatch(/Connected/);

    const listRes = await tenantA.as(app.http.get(MAILBOX_PATHS.mailboxes)).expect(200);
    const mailboxes = listRes.body.items as MailboxConnectionSummary[];

    expect(mailboxes).toHaveLength(1);
    expect(mailboxes[0]?.provider).toBe('gmail');
    expect(mailboxes[0]?.status).toBe('connected');
    // The address the provider reported, not one this system chose on its behalf.
    expect(mailboxes[0]?.emailAddress).toBe('gmail.user@example.test');

    // The code and the redirect URI reached the exchange rather than being assumed.
    const exchange = app.nest.get(StubMailboxOAuth);
    expect(exchange.exchanged.at(-1)).toMatchObject({ provider: 'gmail', code: 'code_abc' });
  });

  it('connects nothing when the provider refuses to name the account', async () => {
    const tenantA = await signUp('OutreachA');

    const connectRes = await tenantA
      .as(app.http.post(MAILBOX_PATHS.connectUrl))
      .send({ provider: 'gmail' })
      .expect(200);

    const callbackRes = await app.http
      .get(MAILBOX_PATHS.callback)
      .query({ state: connectRes.body.stateToken, code: StubMailboxOAuth.REFUSED_CODE })
      .expect(200);

    // The popup is told, in the page and in the message it posts to its opener.
    expect(callbackRes.text).toMatch(/Not connected/);
    expect(callbackRes.text).toContain('connected: false');

    // The point of the test: no half-made mailbox is left behind for the screen to show.
    const listRes = await tenantA.as(app.http.get(MAILBOX_PATHS.mailboxes)).expect(200);
    expect(listRes.body.items).toEqual([]);
  });

  it('refuses a provider it cannot actually talk to, rather than pretending', async () => {
    const tenantA = await signUp('OutreachA');

    const response = await tenantA
      .as(app.http.post(MAILBOX_PATHS.connectUrl))
      .send({ provider: 'outlook' })
      .expect(503);

    expect(response.body.code).toBe(MAILBOX_ERROR_CODES.providerUnavailable);

    const listRes = await tenantA.as(app.http.get(MAILBOX_PATHS.mailboxes)).expect(200);
    expect(listRes.body.items).toEqual([]);
  });

  it('refuses a callback whose state token is unknown or spent', async () => {
    const tenantA = await signUp('OutreachA');

    const spent = await app.http
      .get(MAILBOX_PATHS.callback)
      .query({ state: 'mbs_never_issued', code: 'code_abc' })
      .expect(200);

    expect(spent.text).toMatch(/Not connected/);

    const listRes = await tenantA.as(app.http.get(MAILBOX_PATHS.mailboxes)).expect(200);
    expect(listRes.body.items).toEqual([]);
  });

  /**
   * The two ways a mailbox leaves the screen, which are not the same thing.
   *
   * Disconnecting keeps the row so it can be reconnected; removing deletes it. They used to
   * be one endpoint behind two labels, so "Remove" on an already-revoked mailbox re-revoked
   * it and the row never went away.
   */
  describe('disconnecting and removing', () => {
    it('keeps a disconnected mailbox on the list, and removes a removed one', async () => {
      const tenantA = await signUp('OutreachA');
      const mailboxId = await connectMailbox(tenantA, 'code_abc');

      await tenantA.as(app.http.post(MAILBOX_PATHS.disconnect(mailboxId))).expect(200);

      const afterDisconnect = await tenantA
        .as(app.http.get(MAILBOX_PATHS.mailboxes))
        .expect(200);
      const disconnected = afterDisconnect.body.items as MailboxConnectionSummary[];
      expect(disconnected).toHaveLength(1);
      expect(disconnected[0]?.status).toBe('revoked');

      await tenantA.as(app.http.delete(MAILBOX_PATHS.remove(mailboxId))).expect(204);

      const afterRemove = await tenantA.as(app.http.get(MAILBOX_PATHS.mailboxes)).expect(200);
      expect(afterRemove.body.items).toEqual([]);
    });

    it('removes a mailbox that was already revoked', async () => {
      // The case from the screen: a connection somebody wants gone, already revoked, whose
      // Remove button previously did nothing at all.
      const tenantA = await signUp('OutreachA');
      const mailboxId = await connectMailbox(tenantA, 'code_abc');

      await tenantA.as(app.http.post(MAILBOX_PATHS.disconnect(mailboxId))).expect(200);
      await tenantA.as(app.http.delete(MAILBOX_PATHS.remove(mailboxId))).expect(204);

      const listRes = await tenantA.as(app.http.get(MAILBOX_PATHS.mailboxes)).expect(200);
      expect(listRes.body.items).toEqual([]);
    });

    it('refuses to remove a mailbox a campaign still sends from', async () => {
      const tenantA = await signUp('OutreachA');
      const mailboxId = await connectMailbox(tenantA, 'code_abc');

      const templateRes = await tenantA
        .as(app.http.post(EMAIL_TEMPLATE_PATHS.templates))
        .send({
          name: 'Campaign Template',
          subject: 'Hello {{lead.name}}',
          body: '<p>Hi {{lead.name}}</p>',
        } satisfies CreateEmailTemplateRequest)
        .expect(201);

      await tenantA
        .as(app.http.post(CAMPAIGN_PATHS.campaigns))
        .send({
          name: 'Spring push',
          mailboxConnectionId: mailboxId,
          templateId: (templateRes.body as EmailTemplateSummary).id,
        })
        .expect(201);

      const response = await tenantA
        .as(app.http.delete(MAILBOX_PATHS.remove(mailboxId)))
        .expect(409);

      expect(response.body.code).toBe(MAILBOX_ERROR_CODES.mailboxInUse);

      // Still there, because deleting it would leave the campaign pointing at nothing.
      const listRes = await tenantA.as(app.http.get(MAILBOX_PATHS.mailboxes)).expect(200);
      expect(listRes.body.items).toHaveLength(1);
    });

    it('refuses to remove a mailbox that does not exist', async () => {
      const tenantA = await signUp('OutreachA');

      const response = await tenantA
        .as(app.http.delete(MAILBOX_PATHS.remove('00000000-0000-0000-0000-000000000000')))
        .expect(404);

      expect(response.body.code).toBe(MAILBOX_ERROR_CODES.mailboxNotFound);
    });
  });

  /**
   * The company mailbox: SMTP, added by typing its settings rather than by consenting at a
   * provider.
   *
   * This is the shape company mail hosting actually takes — Namecheap Private Email,
   * Fastmail, an Exchange server — none of which Google can speak for. Without it the only
   * way to get a mailbox was an OAuth provider, so anyone whose company mail was not Gmail
   * could not send from their own address at all.
   */
  describe('company mailboxes over SMTP', () => {
    const settings = {
      host: 'mail.privateemail.com',
      port: 465,
      secure: true,
      emailAddress: 'sales@northwind.test',
      displayName: 'Northwind Sales',
      username: 'sales@northwind.test',
      password: 'a-real-mailbox-password',
    };

    it('adds a mailbox after the host accepts the settings', async () => {
      const tenantA = await signUp('OutreachA');

      const response = await tenantA
        .as(app.http.post(MAILBOX_PATHS.connectSmtp))
        .send(settings)
        .expect(201);

      const mailbox = response.body as MailboxConnectionSummary;
      expect(mailbox.provider).toBe('smtp');
      expect(mailbox.status).toBe('connected');
      expect(mailbox.emailAddress).toBe('sales@northwind.test');
      // Where it sends through, so the screen can show more than a name.
      expect(mailbox.smtp).toEqual({
        host: 'mail.privateemail.com',
        port: 465,
        secure: true,
        username: 'sales@northwind.test',
      });
    });

    it('never hands the password back, and never stores it as typed', async () => {
      const tenantA = await signUp('OutreachA');

      const response = await tenantA
        .as(app.http.post(MAILBOX_PATHS.connectSmtp))
        .send(settings)
        .expect(201);

      // Not in the response, and not in the list either.
      expect(JSON.stringify(response.body)).not.toContain(settings.password);

      const listRes = await tenantA.as(app.http.get(MAILBOX_PATHS.mailboxes)).expect(200);
      expect(JSON.stringify(listRes.body)).not.toContain(settings.password);

      // And not in the database. Encrypted at rest, so a leaked dump is not a mailbox.
      const stored = await app.prisma.mailboxConnection.findFirstOrThrow({
        where: { provider: 'smtp' },
      });
      expect(stored.smtpPassword).not.toContain(settings.password);
      expect(stored.smtpPassword).toBeTruthy();
    });

    it('refuses settings the host rejects, and stores nothing', async () => {
      const tenantA = await signUp('OutreachA');

      const response = await tenantA
        .as(app.http.post(MAILBOX_PATHS.connectSmtp))
        .send({ ...settings, password: RecordingMailboxSender.REJECTED_PASSWORD })
        .expect(400);

      expect(response.body.code).toBe(MAILBOX_ERROR_CODES.smtpSettingsRejected);

      // Proved before it is stored: a wrong password is a message under the form, not a
      // mailbox that looks connected and fails at the first campaign.
      const listRes = await tenantA.as(app.http.get(MAILBOX_PATHS.mailboxes)).expect(200);
      expect(listRes.body.items).toEqual([]);
    });

    it('validates the settings it is given', async () => {
      const tenantA = await signUp('OutreachA');

      const response = await tenantA
        .as(app.http.post(MAILBOX_PATHS.connectSmtp))
        .send({ ...settings, host: '', port: 70000, emailAddress: 'not-an-address' })
        .expect(422);

      expect(Object.keys(response.body.fields).sort()).toEqual([
        'emailAddress',
        'host',
        'port',
      ]);
    });

    it('lets one person hold a personal Gmail and a company mailbox at once', async () => {
      const tenantA = await signUp('OutreachA');

      await connectMailbox(tenantA, 'code_abc');
      await tenantA.as(app.http.post(MAILBOX_PATHS.connectSmtp)).send(settings).expect(201);

      const listRes = await tenantA.as(app.http.get(MAILBOX_PATHS.mailboxes)).expect(200);
      const mailboxes = listRes.body.items as MailboxConnectionSummary[];

      // Both, so the send screen has two to choose between — which is the whole point.
      expect(mailboxes.map((m) => m.provider).sort()).toEqual(['gmail', 'smtp']);
    });

    it('sends through whichever mailbox was chosen', async () => {
      const tenantA = await signUp('OutreachA');

      await connectMailbox(tenantA, 'code_abc');
      const smtpRes = await tenantA
        .as(app.http.post(MAILBOX_PATHS.connectSmtp))
        .send(settings)
        .expect(201);
      const companyMailboxId = (smtpRes.body as MailboxConnectionSummary).id;

      const leadRes = await tenantA
        .as(app.http.post(LEAD_PATHS.leads))
        .send({ name: 'Samantha Jones', email: 'samantha@example.com' } satisfies CreateLeadRequest)
        .expect(201);

      const sender = app.nest.get(RecordingMailboxSender);
      const before = sender.sentFrom.length;

      await tenantA
        .as(app.http.post(LEAD_EMAIL_PATHS.send((leadRes.body as LeadResponse).id)))
        .send({
          mailboxConnectionId: companyMailboxId,
          subject: 'Hello {{lead.name}}',
          htmlBody: '<p>From {{sender.emailAddress}}</p>',
        } satisfies SendLeadEmailRequest)
        .expect(200);

      // The mailbox the user picked carried it — not the deployment's own mailer, and not
      // the other mailbox this person also holds.
      const carried = sender.sentFrom[sender.sentFrom.length - 1];
      expect(sender.sentFrom.length).toBe(before + 1);
      expect(carried).toEqual({
        mailboxId: companyMailboxId,
        provider: 'smtp',
        emailAddress: 'sales@northwind.test',
      });
    });

    it('shares the owner-configured company SMTP mailbox with teammates and allows sending without re-entering credentials', async () => {
      const owner = await signUp('OutreachCompany');
      const smtpRes = await owner
        .as(app.http.post(MAILBOX_PATHS.connectSmtp))
        .send(settings)
        .expect(201);
      const companyMailboxId = (smtpRes.body as MailboxConnectionSummary).id;

      // Add a teammate / colleague to the company
      await factories.addColleague({
        ownerUserId: owner.session.user.id,
        name: 'Alex Teammate',
        email: 'alex@northwind.test',
        permissions: ['crm:leads:read', 'crm:leads:write'],
      });

      const colleagueSession = await app.http
        .post(AUTH_PATHS.signIn)
        .send({ email: 'alex@northwind.test', password: 'Password123!' })
        .expect(200);

      const colleagueTenant: Tenant = {
        session: colleagueSession.body as AuthenticatedSession,
        tokenHeader: `Bearer ${(colleagueSession.body as AuthenticatedSession).token}`,
        as: (req: SupertestRequest) =>
          req.set('Authorization', `Bearer ${(colleagueSession.body as AuthenticatedSession).token}`),
      };

      // Teammate lists mailboxes: sees the company's shared SMTP mailbox without entering any settings!
      const listRes = await colleagueTenant.as(app.http.get(MAILBOX_PATHS.mailboxes)).expect(200);
      const mailboxes = listRes.body.items as MailboxConnectionSummary[];
      expect(mailboxes).toHaveLength(1);
      expect(mailboxes[0]!.id).toBe(companyMailboxId);
      expect(mailboxes[0]!.provider).toBe('smtp');
      expect(mailboxes[0]!.isShared).toBe(true);
      expect(mailboxes[0]!.canManage).toBe(false);

      // Teammate cannot disconnect or remove the company mailbox
      await colleagueTenant
        .as(app.http.delete(MAILBOX_PATHS.remove(companyMailboxId)))
        .expect(403);

      // Create a lead and send an email as teammate using the company mailbox
      const leadRes = await colleagueTenant
        .as(app.http.post(LEAD_PATHS.leads))
        .send({ name: 'Lead Prospect', email: 'prospect@example.com' } satisfies CreateLeadRequest)
        .expect(201);

      const sender = app.nest.get(RecordingMailboxSender);
      const before = sender.sentFrom.length;

      await colleagueTenant
        .as(app.http.post(LEAD_EMAIL_PATHS.send((leadRes.body as LeadResponse).id)))
        .send({
          mailboxConnectionId: companyMailboxId,
          subject: 'Welcome {{lead.name}}',
          htmlBody: '<p>Sent by teammate from company mailbox</p>',
        } satisfies SendLeadEmailRequest)
        .expect(200);

      expect(sender.sentFrom.length).toBe(before + 1);
      const carried = sender.sentFrom[sender.sentFrom.length - 1];
      expect(carried).toEqual({
        mailboxId: companyMailboxId,
        provider: 'smtp',
        emailAddress: 'sales@northwind.test',
      });
    });
  });

  it('creates, lists, and validates email templates with dynamic tags', async () => {
    const tenantA = await signUp('OutreachA');

    // Create a custom field first
    await tenantA
      .as(app.http.post(LEAD_FIELD_PATHS.leadFields))
      .send({
        label: 'Industry',
        type: 'text',
      } satisfies CreateLeadFieldRequest)
      .expect(201);

    // Valid template
    const templateRes = await tenantA
      .as(app.http.post(EMAIL_TEMPLATE_PATHS.templates))
      .send({
        name: 'Welcome Intro',
        subject: 'Hello {{lead.name|there}} from {{sender.displayName}}',
        body: '<p>Hi {{lead.name|there}},</p><p>We noticed you work in {{custom.industry|business}}.</p>',
      } satisfies CreateEmailTemplateRequest)
      .expect(201);

    const template = templateRes.body as EmailTemplateSummary;
    expect(template.id).toBeDefined();
    expect(template.name).toBe('Welcome Intro');

    // Invalid tag namespace refusal
    const invalidNamespaceRes = await tenantA
      .as(app.http.post(EMAIL_TEMPLATE_PATHS.templates))
      .send({
        name: 'Bad Tag Template',
        subject: 'Hi',
        body: 'Hello {{user.unknownTag}}',
      })
      .expect(400);

    expect(invalidNamespaceRes.body.code).toBe(EMAIL_TEMPLATE_ERROR_CODES.invalidTemplateTags);

    // Invalid custom field key refusal
    const invalidCustomKeyRes = await tenantA
      .as(app.http.post(EMAIL_TEMPLATE_PATHS.templates))
      .send({
        name: 'Bad Custom Key Template',
        subject: 'Hi',
        body: 'Hello {{custom.nonExistentField}}',
      })
      .expect(400);

    expect(invalidCustomKeyRes.body.code).toBe(EMAIL_TEMPLATE_ERROR_CODES.invalidTemplateTags);
  });

  it('previews populated email template against target lead', async () => {
    const tenantA = await signUp('OutreachA');

    // 1. Connect mailbox
    const mailboxId = await connectMailbox(tenantA, 'code_outlook');

    // 2. Create lead
    const leadRes = await tenantA
      .as(app.http.post(LEAD_PATHS.leads))
      .send({
        name: 'Samantha Jones',
        email: 'samantha@example.com',
        organisationName: 'Jones Enterprises',
      } satisfies CreateLeadRequest)
      .expect(201);

    const leadId = (leadRes.body as LeadResponse).id;

    // 3. Create template
    const templateRes = await tenantA
      .as(app.http.post(EMAIL_TEMPLATE_PATHS.templates))
      .send({
        name: 'Outreach Intro',
        subject: 'Partnership with {{lead.organisationName}}',
        body: 'Hi {{lead.name}},<br>I am {{sender.displayName}} from {{sender.emailAddress}}.',
      })
      .expect(201);

    const templateId = templateRes.body.id;

    // 4. Preview
    const previewRes = await tenantA
      .as(app.http.post(EMAIL_TEMPLATE_PATHS.preview(templateId)))
      .send({ leadId, mailboxConnectionId: mailboxId })
      .expect(200);

    expect(previewRes.body.subject).toBe('Partnership with Jones Enterprises');
    expect(previewRes.body.htmlBody).toContain('Hi Samantha Jones,');
    // The sender's name as the provider reported it, resolved into the template.
    expect(previewRes.body.htmlBody).toContain('gmail user');
    expect(previewRes.body.textBody).toContain('Hi Samantha Jones');
  });

  it('sends 1-on-1 personalized email, delivers through Mailer, and logs timeline activity', async () => {
    const tenantA = await signUp('OutreachA');

    // 1. Connect mailbox
    const mailboxId = await connectMailbox(tenantA, 'code_123');

    // 2. Create lead
    const leadRes = await tenantA
      .as(app.http.post(LEAD_PATHS.leads))
      .send({
        name: 'Bob Marley',
        email: 'bob@reggae.test',
        organisationName: 'Tuff Gong',
      } satisfies CreateLeadRequest)
      .expect(201);

    const leadId = (leadRes.body as LeadResponse).id;

    // 3. Create template
    const templateRes = await tenantA
      .as(app.http.post(EMAIL_TEMPLATE_PATHS.templates))
      .send({
        name: 'Intro Template',
        subject: 'Hello {{lead.name}}',
        body: '<h1>Welcome {{lead.name}}</h1><p>Great to connect with {{lead.organisationName}}!</p>',
      })
      .expect(201);

    const templateId = templateRes.body.id;

    // 4. Clear dev mailer
    const devMailer = app.nest.get(DevMailer);
    const initialSentCount = devMailer.sent.length;

    // 5. Send email
    const sendRes = await tenantA
      .as(app.http.post(LEAD_EMAIL_PATHS.sendEmail(leadId)))
      .send({
        mailboxConnectionId: mailboxId,
        templateId,
      } satisfies SendLeadEmailRequest)
      .expect(200);

    expect(sendRes.body.success).toBe(true);
    expect(sendRes.body.activityId).toBeDefined();

    // Verify DevMailer received message with html and plain text
    expect(devMailer.sent.length).toBe(initialSentCount + 1);
    const sentMessage = devMailer.sent[devMailer.sent.length - 1];
    expect(sentMessage?.to).toBe('bob@reggae.test');
    expect(sentMessage?.subject).toBe('Hello Bob Marley');
    expect(sentMessage?.html).toContain('Welcome Bob Marley');
    expect(sentMessage?.body).toContain('Welcome Bob Marley');

    // Verify activity on lead timeline
    const activitiesRes = await tenantA
      .as(app.http.get(`/api/crm/leads/${leadId}/activities`))
      .expect(200);

    expect(activitiesRes.body.items).toHaveLength(1);
    expect(activitiesRes.body.items[0].type).toBe('email');
    expect(activitiesRes.body.items[0].notes).toContain('Email sent: Hello Bob Marley');
  });

  it('refuses email sending when mailbox connection is revoked', async () => {
    const tenantA = await signUp('OutreachA');

    // Connect mailbox
    const mailboxId = await connectMailbox(tenantA, 'code_revoked');

    // Disconnect mailbox
    await tenantA
      .as(app.http.post(MAILBOX_PATHS.disconnect(mailboxId)))
      .expect(200);

    // Create lead
    const leadRes = await tenantA
      .as(app.http.post(LEAD_PATHS.leads))
      .send({ name: 'Charlie', email: 'charlie@example.com' })
      .expect(201);

    // Attempt to send email
    const res = await tenantA
      .as(app.http.post(LEAD_EMAIL_PATHS.sendEmail(leadRes.body.id)))
      .send({
        mailboxConnectionId: mailboxId,
        subject: 'Test',
        htmlBody: 'Hello',
      })
      .expect(400);

    expect(res.body.code).toBe(MAILBOX_ERROR_CODES.mailboxNotConnected);
  });

  it('enforces tenant isolation for email templates and mailbox connections', async () => {
    const tenantA = await signUp('OutreachA');
    const tenantB = await signUp('OutreachB');

    // Tenant A creates template
    const templateA = await tenantA
      .as(app.http.post(EMAIL_TEMPLATE_PATHS.templates))
      .send({
        name: 'Private Template A',
        subject: 'Subject A',
        body: 'Body A',
      })
      .expect(201);

    // Tenant B cannot read Tenant A template
    await tenantB
      .as(app.http.get(EMAIL_TEMPLATE_PATHS.template(templateA.body.id)))
      .expect(404);

    // Tenant B list does not contain Tenant A template
    const listB = await tenantB
      .as(app.http.get(EMAIL_TEMPLATE_PATHS.templates))
      .expect(200);

    expect(listB.body.items.some((t: EmailTemplateSummary) => t.id === templateA.body.id)).toBe(false);
  });
});
