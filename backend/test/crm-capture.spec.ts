import {
  AUTH_PATHS,
  CAPTURE_SOURCE_ERROR_CODES,
  CAPTURE_SOURCE_PATHS,
  LEAD_FIELD_ERROR_CODES,
  LEAD_FIELD_PATHS,
  LEAD_PATHS,
  type AuthenticatedSession,
  type CaptureSourceResponse,
  type CreateLeadFieldRequest,
  type LeadFieldResponse,
  type LeadListResponse,
  type PublicFormConfigResponse,
  type SignUpRequest,
} from '@erp/shared';
import { createTestApp, resetDatabase, type TestApp } from './harness/test-app';

describe('CRM Capture Sources & Public Intakes', () => {
  let app: TestApp;

  type SupertestRequest = ReturnType<TestApp['http']['get']>;

  interface Tenant {
    session: AuthenticatedSession;
    as: (req: SupertestRequest) => SupertestRequest;
  }

  let tenantCounter = 0;

  async function defineField(tenant: Tenant, body: CreateLeadFieldRequest): Promise<LeadFieldResponse> {
    const response = await tenant
      .as(app.http.post(LEAD_FIELD_PATHS.leadFields))
      .send(body)
      .expect(201);

    return response.body as LeadFieldResponse;
  }

  async function signUp(name: string): Promise<Tenant> {
    tenantCounter += 1;
    const email = `${name.toLowerCase().replace(/\s+/g, '')}${tenantCounter}_${Date.now()}@example.com`;
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
      as: (req) => req.set('Authorization', `Bearer ${session.token}`),
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

  it('creates form and webhook capture sources with unguessable tokens', async () => {
    const tenantA = await signUp('TenantA');

    // Form capture source
    const formRes = await tenantA
      .as(app.http.post(CAPTURE_SOURCE_PATHS.sources))
      .send({
        kind: 'form',
        name: 'Website Contact Form',
        config: {
          fields: [
            { key: 'name', label: 'Full Name', required: true, order: 1 },
            { key: 'email', label: 'Email Address', required: false, order: 2 },
            { key: 'phone', label: 'Phone', required: false, order: 3 },
          ],
          submitBehavior: { kind: 'message', text: 'Thank you for reaching out!' },
        },
      })
      .expect(201);

    const formSource = formRes.body as CaptureSourceResponse;
    expect(formSource.id).toBeDefined();
    expect(formSource.kind).toBe('form');
    expect(formSource.name).toBe('Website Contact Form');
    expect(formSource.token).toMatch(/^cs_[a-f0-9]{32}$/);
    expect(formSource.enabled).toBe(true);

    // Webhook capture source
    const webhookRes = await tenantA
      .as(app.http.post(CAPTURE_SOURCE_PATHS.sources))
      .send({
        kind: 'webhook',
        name: 'Zapier Webhook Intake',
        config: {
          fieldMapping: {
            full_name: 'name',
            contact_email: 'email',
            company_name: 'organisationName',
          },
        },
      })
      .expect(201);

    const webhookSource = webhookRes.body as CaptureSourceResponse;
    expect(webhookSource.token).toMatch(/^cs_[a-f0-9]{32}$/);
  });

  it('provides public form config endpoint without revealing company identity', async () => {
    const tenantA = await signUp('TenantA');

    const createRes = await tenantA
      .as(app.http.post(CAPTURE_SOURCE_PATHS.sources))
      .send({
        kind: 'form',
        name: 'Public Inquiries Form',
        config: {
          fields: [
            { key: 'name', label: 'Your Name', required: true, order: 1 },
            { key: 'email', label: 'Your Email', required: true, order: 2 },
          ],
          submitBehavior: { kind: 'message', text: 'We will be in touch!' },
        },
      })
      .expect(201);

    const token = createRes.body.token;

    const publicRes = await app.http
      .get(CAPTURE_SOURCE_PATHS.publicForm(token))
      .expect(200);

    const publicConfig = publicRes.body as PublicFormConfigResponse;
    expect(publicConfig.name).toBe('Public Inquiries Form');
    expect(publicConfig.fields).toHaveLength(2);
    expect(publicConfig.submitBehavior).toEqual({ kind: 'message', text: 'We will be in touch!' });
    expect((publicConfig as any).companyId).toBeUndefined();
  });

  it('accepts public web-form submissions, creates lead, and advances counts', async () => {
    const tenantA = await signUp('TenantA');

    const sourceRes = await tenantA
      .as(app.http.post(CAPTURE_SOURCE_PATHS.sources))
      .send({
        kind: 'form',
        name: 'Lead Intake Form',
        config: {
          fields: [
            { key: 'name', label: 'Name', required: true, order: 1 },
            { key: 'email', label: 'Email', required: false, order: 2 },
          ],
          submitBehavior: { kind: 'message', text: 'Success!' },
        },
      })
      .expect(201);

    const source = sourceRes.body as CaptureSourceResponse;

    const submitRes = await app.http
      .post(CAPTURE_SOURCE_PATHS.publicSubmit(source.token!))
      .send({
        name: 'Alice Springs',
        email: 'alice@example.com',
      })
      .expect(200);

    expect(submitRes.body).toEqual({
      success: true,
      submitBehavior: { kind: 'message', text: 'Success!' },
    });

    // Check created lead in company A
    const leadsRes = await tenantA
      .as(app.http.get(LEAD_PATHS.leads))
      .expect(200);

    const leads = (leadsRes.body as LeadListResponse).items;
    const createdLead = leads.find((l) => l.name === 'Alice Springs');
    expect(createdLead).toBeDefined();
    expect(createdLead?.email).toBe('alice@example.com');

    // Check source counts advanced
    const updatedSource = await tenantA
      .as(app.http.get(CAPTURE_SOURCE_PATHS.source(source.id)))
      .expect(200);

    expect(updatedSource.body.submissionCount).toBe(1);
    expect(updatedSource.body.lastSubmissionAt).not.toBeNull();
  });

  it('maps inbound keys for webhook capture sources', async () => {
    const tenantA = await signUp('TenantA');

    const sourceRes = await tenantA
      .as(app.http.post(CAPTURE_SOURCE_PATHS.sources))
      .send({
        kind: 'webhook',
        name: 'Typeform Webhook',
        config: {
          fieldMapping: {
            applicant_name: 'name',
            applicant_email: 'email',
            company: 'organisationName',
          },
        },
      })
      .expect(201);

    const token = sourceRes.body.token;

    await app.http
      .post(CAPTURE_SOURCE_PATHS.publicSubmit(token))
      .send({
        applicant_name: 'Bob Builder',
        applicant_email: 'bob@build.com',
        company: 'Bob Construction',
      })
      .expect(200);

    const leadsRes = await tenantA
      .as(app.http.get(LEAD_PATHS.leads))
      .expect(200);

    const createdLead = (leadsRes.body as LeadListResponse).items.find(
      (l) => l.name === 'Bob Builder',
    );
    expect(createdLead).toBeDefined();
    expect(createdLead?.email).toBe('bob@build.com');
    expect(createdLead?.organisationName).toBe('Bob Construction');
  });

  it('refuses form submissions with unconfigured fields', async () => {
    const tenantA = await signUp('TenantA');

    const sourceRes = await tenantA
      .as(app.http.post(CAPTURE_SOURCE_PATHS.sources))
      .send({
        kind: 'form',
        name: 'Strict Form',
        config: {
          fields: [{ key: 'name', label: 'Name', required: true, order: 1 }],
          submitBehavior: { kind: 'message', text: 'OK' },
        },
      })
      .expect(201);

    const token = sourceRes.body.token;

    const res = await app.http
      .post(CAPTURE_SOURCE_PATHS.publicSubmit(token))
      .send({
        name: 'Charlie Brown',
        unauthorized_key: 'hacker_data',
      })
      .expect(400);

    expect(res.body.code).toBe(CAPTURE_SOURCE_ERROR_CODES.unconfiguredField);
  });

  it('runs a form submission\'s custom values through the same type check every other write path uses', async () => {
    const tenantA = await signUp('TenantA');

    const field = await defineField(tenantA, { label: 'Team Size', type: 'number' });

    const sourceRes = await tenantA
      .as(app.http.post(CAPTURE_SOURCE_PATHS.sources))
      .send({
        kind: 'form',
        name: 'Sizing Form',
        config: {
          fields: [
            { key: 'name', label: 'Name', required: true, order: 1 },
            { key: field.key, label: field.label, required: false, order: 2 },
          ],
          submitBehavior: { kind: 'message', text: 'OK' },
        },
      })
      .expect(201);

    const token = sourceRes.body.token;

    // A well-formed submission is stored under the custom field's key.
    await app.http
      .post(CAPTURE_SOURCE_PATHS.publicSubmit(token))
      .send({ name: 'Grace Hopper', [field.key]: 12 })
      .expect(200);

    // A value that fails the field's own type check is refused, not written verbatim — the
    // public door must not be more lenient than the authenticated one beside it.
    const refused = await app.http
      .post(CAPTURE_SOURCE_PATHS.publicSubmit(token))
      .send({ name: 'Ada Lovelace', [field.key]: 'a lot' })
      .expect(422);

    expect(refused.body.code).toBe(LEAD_FIELD_ERROR_CODES.invalidLeadFieldValue);
  });

  it('refuses a webhook submission mapped onto a custom field this company never defined', async () => {
    const tenantA = await signUp('TenantA');

    const sourceRes = await tenantA
      .as(app.http.post(CAPTURE_SOURCE_PATHS.sources))
      .send({
        kind: 'webhook',
        name: 'Untrusted Webhook',
        config: {
          fieldMapping: {
            lead_name: 'name',
            // No `LeadFieldDefinition` named 'made_up_field' exists for this company — this
            // is what public capture must still refuse rather than write straight into
            // `Lead.customValues`, whatever the sender chooses to name the mapped key.
            note: 'made_up_field',
          },
        },
      })
      .expect(201);

    const token = sourceRes.body.token;

    const res = await app.http
      .post(CAPTURE_SOURCE_PATHS.publicSubmit(token))
      .send({ lead_name: 'Frank Herbert', note: 'anything at all' })
      .expect(422);

    expect(res.body.code).toBe(LEAD_FIELD_ERROR_CODES.invalidLeadFieldValue);

    // Confirm the lead was never created — the refusal must roll back the whole submission,
    // not create a lead first and reject the extra field after.
    const leadsRes = await tenantA.as(app.http.get(LEAD_PATHS.leads)).expect(200);
    expect(
      (leadsRes.body as LeadListResponse).items.some((l) => l.name === 'Frank Herbert'),
    ).toBe(false);
  });

  it('refuses disabled sources, unknown tokens, and rotated tokens with anti-enumeration 404', async () => {
    const tenantA = await signUp('TenantA');

    // 1. Unknown token
    const unknownRes = await app.http
      .get(CAPTURE_SOURCE_PATHS.publicForm('cs_00000000000000000000000000000000'))
      .expect(404);

    expect(unknownRes.body.code).toBe(CAPTURE_SOURCE_ERROR_CODES.invalidCaptureToken);
    expect(unknownRes.body.message).toBe('Invalid or inactive capture link.');

    // 2. Disabled source
    const sourceRes = await tenantA
      .as(app.http.post(CAPTURE_SOURCE_PATHS.sources))
      .send({
        kind: 'form',
        name: 'Paused Form',
        config: { fields: [], submitBehavior: { kind: 'message', text: 'OK' } },
      })
      .expect(201);

    const sourceId = sourceRes.body.id;
    const oldToken = sourceRes.body.token;

    // Pause the source
    await tenantA
      .as(app.http.patch(CAPTURE_SOURCE_PATHS.source(sourceId)))
      .send({ enabled: false })
      .expect(200);

    const disabledRes = await app.http
      .post(CAPTURE_SOURCE_PATHS.publicSubmit(oldToken))
      .send({ name: 'Test' })
      .expect(404);

    expect(disabledRes.body.code).toBe(CAPTURE_SOURCE_ERROR_CODES.invalidCaptureToken);

    // Re-enable and rotate token
    await tenantA
      .as(app.http.patch(CAPTURE_SOURCE_PATHS.source(sourceId)))
      .send({ enabled: true })
      .expect(200);

    const rotateRes = await tenantA
      .as(app.http.post(CAPTURE_SOURCE_PATHS.rotateToken(sourceId)))
      .expect(200);

    const newToken = rotateRes.body.token;
    expect(newToken).not.toBe(oldToken);

    // Old token should now answer 404
    const oldTokenRes = await app.http
      .get(CAPTURE_SOURCE_PATHS.publicForm(oldToken))
      .expect(404);

    expect(oldTokenRes.body.code).toBe(CAPTURE_SOURCE_ERROR_CODES.invalidCaptureToken);

    // New token works
    await app.http
      .get(CAPTURE_SOURCE_PATHS.publicForm(newToken))
      .expect(200);
  });

  it('enforces tenant isolation — submissions never leak between companies', async () => {
    const tenantA = await signUp('TenantA');
    const tenantB = await signUp('TenantB');

    const sourceA = await tenantA
      .as(app.http.post(CAPTURE_SOURCE_PATHS.sources))
      .send({
        kind: 'form',
        name: 'Company A Intake',
        config: {
          fields: [{ key: 'name', label: 'Name', required: true, order: 1 }],
          submitBehavior: { kind: 'message', text: 'OK' },
        },
      })
      .expect(201);

    await app.http
      .post(CAPTURE_SOURCE_PATHS.publicSubmit(sourceA.body.token))
      .send({ name: 'Tenant A Submission' })
      .expect(200);

    // Verify Company A has lead
    const leadsA = await tenantA
      .as(app.http.get(LEAD_PATHS.leads))
      .expect(200);

    expect(
      (leadsA.body as LeadListResponse).items.some((l) => l.name === 'Tenant A Submission'),
    ).toBe(true);

    // Verify Company B has NO such lead
    const leadsB = await tenantB
      .as(app.http.get(LEAD_PATHS.leads))
      .expect(200);

    expect(
      (leadsB.body as LeadListResponse).items.some((l) => l.name === 'Tenant A Submission'),
    ).toBe(false);
  });
});
