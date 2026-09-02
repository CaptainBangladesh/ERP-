import {
  AUTH_PATHS,
  CAMPAIGN_ERROR_CODES,
  CAMPAIGN_PATHS,
  EMAIL_TEMPLATE_PATHS,
  LEAD_GROUP_PATHS,
  LEAD_PATHS,
  MAILBOX_PATHS,
  type AuthenticatedSession,
  type CampaignRecipientSummary,
  type CampaignResponse,
  type CreateCampaignRequest,
  type CreateEmailTemplateRequest,
  type CreateLeadRequest,
  type LeadResponse,
  type SendCampaignBatchResponse,
  type SignUpRequest,
} from '@erp/shared';
import { DevMailer } from '../src/platform/mail/dev-mailer';
import { createTestApp, resetDatabase, type TestApp } from './harness/test-app';

describe('CRM Email Campaigns', () => {
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

  async function setupOutreach(tenant: Tenant) {
    // 1. Connect mailbox
    const connectRes = await tenant
      .as(app.http.post(MAILBOX_PATHS.connectUrl))
      .send({ provider: 'gmail' })
      .expect(200);

    await app.http
      .get(MAILBOX_PATHS.callback)
      .query({ state: connectRes.body.stateToken, code: 'code_campaign' })
      .expect(200);

    // From the list rather than the callback: the callback answers a popup with a page, not
    // a caller with JSON.
    const listRes = await tenant.as(app.http.get(MAILBOX_PATHS.mailboxes)).expect(200);
    const mailboxId = listRes.body.items[0].id as string;

    // 2. Create template
    const templateRes = await tenant
      .as(app.http.post(EMAIL_TEMPLATE_PATHS.templates))
      .send({
        name: 'Campaign Template',
        subject: 'Special offer for {{lead.name}}',
        body: '<p>Hi {{lead.name}},</p><p>Check out our products for {{lead.organisationName|your company}}.</p>',
      } satisfies CreateEmailTemplateRequest)
      .expect(201);

    const templateId = templateRes.body.id;

    return { mailboxId, templateId };
  }

  it('builds, materializes, batch-sends a campaign, and tracks opens and unsubscribes', async () => {
    const tenant = await signUp('CampaignCorp');
    const { mailboxId, templateId } = await setupOutreach(tenant);

    // Create 3 leads: 2 valid emails, 1 with no email
    const lead1 = await tenant
      .as(app.http.post(LEAD_PATHS.leads))
      .send({ name: 'Alice Smith', email: 'alice@example.com', organisationName: 'Acme' } satisfies CreateLeadRequest)
      .expect(201);

    const lead2 = await tenant
      .as(app.http.post(LEAD_PATHS.leads))
      .send({ name: 'Bob Jones', email: 'bob@example.com', organisationName: 'Acme Dup' } satisfies CreateLeadRequest)
      .expect(201);

    const lead3 = await tenant
      .as(app.http.post(LEAD_PATHS.leads))
      .send({ name: 'Charlie NoEmail' } satisfies CreateLeadRequest)
      .expect(201);

    // Create draft campaign
    const campaignRes = await tenant
      .as(app.http.post(CAMPAIGN_PATHS.campaigns))
      .send({
        name: 'Summer Outreach',
        mailboxConnectionId: mailboxId,
        templateId,
      } satisfies CreateCampaignRequest)
      .expect(201);

    const campaignId = (campaignRes.body as CampaignResponse).id;
    expect(campaignRes.body.status).toBe('draft');

    // Materialize campaign recipients
    const matRes = await tenant
      .as(app.http.post(CAMPAIGN_PATHS.materialize(campaignId)))
      .expect(200);

    expect(matRes.body.totalLeadsCount).toBe(3);
    expect(matRes.body.excludedCount).toBe(1); // 1 no email

    // Inspect recipients list
    const recipientsRes = await tenant
      .as(app.http.get(CAMPAIGN_PATHS.recipients(campaignId)))
      .expect(200);

    const recipients = recipientsRes.body.items as CampaignRecipientSummary[];
    expect(recipients).toHaveLength(3);

    const pendingRecipients = recipients.filter((r) => r.status === 'pending');
    expect(pendingRecipients).toHaveLength(2);

    const noEmailRecipient = recipients.find((r) => r.excludeReason === 'no_email')!;
    expect(noEmailRecipient).toBeDefined();

    // Batch send (batch size = 10)
    const devMailer = app.nest.get(DevMailer);
    const initialSent = devMailer.sent.length;

    const batchRes = await tenant
      .as(app.http.post(CAMPAIGN_PATHS.sendBatch(campaignId)))
      .send({ batchSize: 10 })
      .expect(200);

    const batchData = batchRes.body as SendCampaignBatchResponse;
    expect(batchData.batchSent).toBe(2);
    expect(batchData.remainingPending).toBe(0);
    expect(batchData.status).toBe('completed');

    expect(devMailer.sent.length).toBe(initialSent + 2);
    const sentMail = devMailer.sent.slice(initialSent).find((m) => m.to === 'alice@example.com')!;
    expect(sentMail).toBeDefined();
    expect(sentMail.subject).toBe('Special offer for Alice Smith');
    expect(sentMail.html).toContain('/api/crm/e/');
    expect(sentMail.html).toContain('/api/crm/unsubscribe/');

    // Check sent activity logged on lead timeline
    const activitiesRes = await tenant
      .as(app.http.get(`/api/crm/leads/${lead1.body.id}/activities`))
      .expect(200);

    expect(activitiesRes.body.items).toHaveLength(1);
    expect(activitiesRes.body.items[0].notes).toContain("Email sent via campaign 'Summer Outreach'");

    // Simulate recipient clicking tracking pixel (open GIF)
    const pendingRecipient = pendingRecipients[0]!;
    const openToken = pendingRecipient.openToken!;
    await app.http
      .get(CAMPAIGN_PATHS.publicOpenPixel(openToken))
      .expect(200)
      .expect('Content-Type', /image\/gif/);

    // Check campaign open rate updated
    const updatedCampaign = await tenant
      .as(app.http.get(CAMPAIGN_PATHS.campaign(campaignId)))
      .expect(200);

    expect(updatedCampaign.body.sentCount).toBe(2);
    expect(updatedCampaign.body.openedCount).toBe(1);
    expect(updatedCampaign.body.openRate).toBe(0.5);

    // Second open increments openCount but does not duplicate openedCount metric
    await app.http
      .get(CAMPAIGN_PATHS.publicOpenPixel(openToken))
      .expect(200);

    const recheckCampaign = await tenant
      .as(app.http.get(CAMPAIGN_PATHS.campaign(campaignId)))
      .expect(200);

    expect(recheckCampaign.body.openedCount).toBe(1);

    // Public Unsubscribe
    const unsubRes = await app.http
      .get(CAMPAIGN_PATHS.publicUnsubscribe(openToken))
      .expect(200);

    expect(unsubRes.body.success).toBe(true);

    // Create new campaign: unsubscribed recipient must be excluded from materialization
    const campaign2 = await tenant
      .as(app.http.post(CAMPAIGN_PATHS.campaigns))
      .send({
        name: 'Autumn Campaign',
        mailboxConnectionId: mailboxId,
        templateId,
      })
      .expect(201);

    const mat2 = await tenant
      .as(app.http.post(CAMPAIGN_PATHS.materialize(campaign2.body.id)))
      .expect(200);

    const recs2 = await tenant
      .as(app.http.get(CAMPAIGN_PATHS.recipients(campaign2.body.id)))
      .expect(200);

    const unsubscribedRecipient = (recs2.body.items as CampaignRecipientSummary[]).find(
      (r) => r.leadId === lead1.body.id,
    )!;
    expect(unsubscribedRecipient.status).toBe('excluded');
    expect(unsubscribedRecipient.excludeReason).toBe('unsubscribed');
  });

  it('refuses updating non-draft campaigns or sending non-materialized campaigns', async () => {
    const tenant = await signUp('RefusalCorp');
    const { mailboxId, templateId } = await setupOutreach(tenant);

    const campaign = await tenant
      .as(app.http.post(CAMPAIGN_PATHS.campaigns))
      .send({ name: 'Draft 1', mailboxConnectionId: mailboxId, templateId })
      .expect(201);

    // Attempt send without materialization -> 400 campaignNotMaterialized
    await tenant
      .as(app.http.post(CAMPAIGN_PATHS.sendBatch(campaign.body.id)))
      .send({ batchSize: 5 })
      .expect(400);

    // Add lead & materialize
    await tenant
      .as(app.http.post(LEAD_PATHS.leads))
      .send({ name: 'David', email: 'david@example.com' })
      .expect(201);

    await tenant
      .as(app.http.post(CAMPAIGN_PATHS.materialize(campaign.body.id)))
      .expect(200);

    // Send batch -> transitions status to completed
    await tenant
      .as(app.http.post(CAMPAIGN_PATHS.sendBatch(campaign.body.id)))
      .expect(200);

    // Refuses editing sent campaign
    await tenant
      .as(app.http.patch(CAMPAIGN_PATHS.campaign(campaign.body.id)))
      .send({ name: 'Renamed Campaign' })
      .expect(400);
  });

  /**
   * A draft is somebody changing their mind, and changing your mind should not leave litter.
   * The Leads board builds a campaign in order to *show* who a mass email would reach — leads
   * with no address, unsubscribed ones, duplicates — which cannot be known until the recipients
   * are materialized. Cancel at that point and the draft has to go somewhere, and until this
   * endpoint existed there was nowhere for it to go.
   */
  describe('discarding a draft', () => {
    it('removes a draft campaign and the recipients it materialized', async () => {
      const tenant = await signUp('DiscardCorp');
      const { mailboxId, templateId } = await setupOutreach(tenant);

      await tenant
        .as(app.http.post(LEAD_PATHS.leads))
        .send({ name: 'Erin', email: 'erin@example.com' })
        .expect(201);

      const campaign = await tenant
        .as(app.http.post(CAMPAIGN_PATHS.campaigns))
        .send({ name: 'Abandoned', mailboxConnectionId: mailboxId, templateId })
        .expect(201);

      await tenant.as(app.http.post(CAMPAIGN_PATHS.materialize(campaign.body.id))).expect(200);
      expect(
        (await tenant.as(app.http.get(CAMPAIGN_PATHS.recipients(campaign.body.id))).expect(200)).body
          .items,
      ).toHaveLength(1);

      await tenant.as(app.http.delete(CAMPAIGN_PATHS.campaign(campaign.body.id))).expect(204);

      await tenant.as(app.http.get(CAMPAIGN_PATHS.campaign(campaign.body.id))).expect(404);
      const listed = await tenant.as(app.http.get(CAMPAIGN_PATHS.campaigns)).expect(200);
      expect(listed.body.items.some((c: CampaignResponse) => c.id === campaign.body.id)).toBe(false);
    });

    /**
     * The one that matters. A campaign that has sent is a record of email that reached real
     * people — deleting it would delete the evidence, and the open tracking still arriving
     * against it. Discarding is for drafts; a sent campaign stays.
     */
    it('refuses to discard a campaign that has already sent', async () => {
      const tenant = await signUp('SentCorp');
      const { mailboxId, templateId } = await setupOutreach(tenant);

      await tenant
        .as(app.http.post(LEAD_PATHS.leads))
        .send({ name: 'Frank', email: 'frank@example.com' })
        .expect(201);

      const campaign = await tenant
        .as(app.http.post(CAMPAIGN_PATHS.campaigns))
        .send({ name: 'Already Out', mailboxConnectionId: mailboxId, templateId })
        .expect(201);

      await tenant.as(app.http.post(CAMPAIGN_PATHS.materialize(campaign.body.id))).expect(200);
      await tenant.as(app.http.post(CAMPAIGN_PATHS.sendBatch(campaign.body.id))).expect(200);

      const refused = await tenant
        .as(app.http.delete(CAMPAIGN_PATHS.campaign(campaign.body.id)))
        .expect(400);
      expect(refused.body.code).toBe(CAMPAIGN_ERROR_CODES.campaignNotDraft);

      await tenant.as(app.http.get(CAMPAIGN_PATHS.campaign(campaign.body.id))).expect(200);
    });

    it('will not let one company discard another’s draft', async () => {
      const mine = await signUp('MineCorp');
      const theirs = await signUp('TheirsCorp');
      const outreach = await setupOutreach(theirs);

      const campaign = await theirs
        .as(app.http.post(CAMPAIGN_PATHS.campaigns))
        .send({ name: 'Not Yours', mailboxConnectionId: outreach.mailboxId, templateId: outreach.templateId })
        .expect(201);

      await mine.as(app.http.delete(CAMPAIGN_PATHS.campaign(campaign.body.id))).expect(404);
      await theirs.as(app.http.get(CAMPAIGN_PATHS.campaign(campaign.body.id))).expect(200);
    });
  });

  it('enforces tenant isolation for campaigns and recipients', async () => {
    const tenantA = await signUp('TenantA');
    const tenantB = await signUp('TenantB');
    const outreachA = await setupOutreach(tenantA);

    const campaignA = await tenantA
      .as(app.http.post(CAMPAIGN_PATHS.campaigns))
      .send({ name: 'Campaign A', mailboxConnectionId: outreachA.mailboxId, templateId: outreachA.templateId })
      .expect(201);

    // Tenant B cannot read Tenant A campaign
    await tenantB
      .as(app.http.get(CAMPAIGN_PATHS.campaign(campaignA.body.id)))
      .expect(404);

    // Tenant B list does not contain Tenant A campaign
    const listB = await tenantB
      .as(app.http.get(CAMPAIGN_PATHS.campaigns))
      .expect(200);

    expect(listB.body.items.some((c: CampaignResponse) => c.id === campaignA.body.id)).toBe(false);
  });
});
