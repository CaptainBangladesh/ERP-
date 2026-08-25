import {
  AUTH_PATHS,
  EMAIL_TEMPLATE_ERROR_CODES,
  EMAIL_TEMPLATE_PATHS,
  LEAD_EMAIL_PATHS,
  LEAD_FIELD_PATHS,
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
import { createTestApp, resetDatabase, type TestApp } from './harness/test-app';

describe('CRM Outreach: Mailboxes, Templates & 1-on-1 Send', () => {
  let app: TestApp;

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

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(app);
  });

  it('connects a Gmail/Outlook mailbox via OAuth state token', async () => {
    const tenantA = await signUp('OutreachA');

    const connectRes = await tenantA
      .as(app.http.post(MAILBOX_PATHS.connectUrl))
      .send({ provider: 'gmail' })
      .expect(200);

    const { stateToken, url } = connectRes.body;
    expect(stateToken).toMatch(/^mbs_/);
    expect(url).toContain(stateToken);

    // OAuth callback
    const callbackRes = await app.http
      .get(MAILBOX_PATHS.callback)
      .query({ state: stateToken, code: 'code_abc' })
      .expect(200);

    expect(callbackRes.body).toEqual({
      success: true,
      mailboxId: expect.any(String),
    });

    // List connected mailboxes
    const listRes = await tenantA
      .as(app.http.get(MAILBOX_PATHS.mailboxes))
      .expect(200);

    const mailboxes = listRes.body.items as MailboxConnectionSummary[];
    expect(mailboxes).toHaveLength(1);
    expect(mailboxes[0]?.provider).toBe('gmail');
    expect(mailboxes[0]?.status).toBe('connected');
    expect(mailboxes[0]?.emailAddress).toContain('gmail_user@example.com');
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
    const connectRes = await tenantA
      .as(app.http.post(MAILBOX_PATHS.connectUrl))
      .send({ provider: 'outlook' })
      .expect(200);

    const callbackRes = await app.http
      .get(MAILBOX_PATHS.callback)
      .query({ state: connectRes.body.stateToken, code: 'code_outlook' })
      .expect(200);

    const mailboxId = callbackRes.body.mailboxId;

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
    expect(previewRes.body.htmlBody).toContain('OUTLOOK Sales User');
    expect(previewRes.body.textBody).toContain('Hi Samantha Jones');
  });

  it('sends 1-on-1 personalized email, delivers through Mailer, and logs timeline activity', async () => {
    const tenantA = await signUp('OutreachA');

    // 1. Connect mailbox
    const connectRes = await tenantA
      .as(app.http.post(MAILBOX_PATHS.connectUrl))
      .send({ provider: 'gmail' })
      .expect(200);

    const callbackRes = await app.http
      .get(MAILBOX_PATHS.callback)
      .query({ state: connectRes.body.stateToken, code: 'code_123' })
      .expect(200);

    const mailboxId = callbackRes.body.mailboxId;

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
    const connectRes = await tenantA
      .as(app.http.post(MAILBOX_PATHS.connectUrl))
      .send({ provider: 'gmail' })
      .expect(200);

    const callbackRes = await app.http
      .get(MAILBOX_PATHS.callback)
      .query({ state: connectRes.body.stateToken, code: 'code_revoked' })
      .expect(200);

    const mailboxId = callbackRes.body.mailboxId;

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
