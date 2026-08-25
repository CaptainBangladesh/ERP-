import {
  AUTH_PATHS,
  LEAD_FIELD_ERROR_CODES,
  LEAD_FIELD_PATHS,
  LEAD_PATHS,
  type AuthenticatedSession,
  type CreateLeadFieldRequest,
  type CreateLeadRequest,
  type LeadFieldListResponse,
  type LeadFieldResponse,
  type LeadResponse,
  type SignUpRequest,
  type UpdateLeadFieldRequest,
  type UpdateLeadRequest,
} from '@erp/shared';
import { createTestApp, resetDatabase, type TestApp } from './harness/test-app';

/**
 * Custom fields a company defines on its Leads, over HTTP against a real database.
 *
 * Split out from `crm.spec.ts` the way `crm-deals` and `crm-dashboard-events` already were —
 * this is its own pillar of the Leads spec, and growing one file to hold all of them would make
 * none of them findable.
 *
 * What is worth asserting here, and why: the type checks are the whole product ("a date field
 * never contains 'next Tuesday-ish'"), and `key` outliving a rename is the invariant that keeps
 * a relabelled field from orphaning every value already captured under it.
 */
describe('crm lead fields', () => {
  let app: TestApp;

  type SupertestRequest = ReturnType<TestApp['http']['get']>;

  interface Tenant {
    session: AuthenticatedSession;
    as: (request: SupertestRequest) => SupertestRequest;
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

  async function signUp(overrides: Partial<SignUpRequest> = {}): Promise<Tenant> {
    const response = await app.http
      .post(AUTH_PATHS.signUp)
      .send({
        companyName: 'Northwind Trading',
        name: 'Ada Okafor',
        email: 'ada@northwind.test',
        password: 'correct-horse-battery',
        ...overrides,
      })
      .expect(201);

    const session = response.body as AuthenticatedSession;
    return { session, as: (request) => request.set('Authorization', `Bearer ${session.token}`) };
  }

  async function defineField(
    tenant: Tenant,
    body: CreateLeadFieldRequest,
  ): Promise<LeadFieldResponse> {
    const response = await tenant
      .as(app.http.post(LEAD_FIELD_PATHS.leadFields))
      .send(body)
      .expect(201);

    return response.body as LeadFieldResponse;
  }

  async function listFields(tenant: Tenant): Promise<LeadFieldListResponse> {
    const response = await tenant.as(app.http.get(LEAD_FIELD_PATHS.leadFields)).expect(200);
    return response.body as LeadFieldListResponse;
  }

  let leadFieldSeq = 0;
  async function addLead(
    tenant: Tenant,
    body: Partial<CreateLeadRequest> = {},
    status = 201,
  ): Promise<LeadResponse> {
    leadFieldSeq++;
    const response = await tenant
      .as(app.http.post(LEAD_PATHS.leads))
      .send({ name: `Priya Kapoor ${leadFieldSeq}`, ...body } satisfies CreateLeadRequest)
      .expect(status);

    return response.body as LeadResponse;
  }

  async function change(
    tenant: Tenant,
    id: string,
    body: UpdateLeadRequest,
    status = 200,
  ): Promise<LeadResponse> {
    const response = await tenant
      .as(app.http.patch(LEAD_PATHS.lead(id)))
      .send(body)
      .expect(status);

    return response.body as LeadResponse;
  }

  describe('defining fields', () => {
    it('starts empty and defines a field of each type', async () => {
      const tenant = await signUp();
      expect((await listFields(tenant)).items).toEqual([]);

      const industry = await defineField(tenant, { label: 'Industry', type: 'text' });
      expect(industry).toMatchObject({
        key: 'industry',
        label: 'Industry',
        type: 'text',
        options: [],
        required: false,
        order: 1,
        archivedAt: null,
      });

      const budget = await defineField(tenant, { label: 'Budget', type: 'number' });
      const renews = await defineField(tenant, { label: 'Renews on', type: 'date' });
      const tier = await defineField(tenant, {
        label: 'Tier',
        type: 'select',
        options: ['Bronze', 'Silver', 'Gold'],
      });
      const wants = await defineField(tenant, {
        label: 'Interested in',
        type: 'multiselect',
        options: ['Hardware', 'Support'],
      });
      const nda = await defineField(tenant, { label: 'NDA signed', type: 'checkbox' });

      expect([budget, renews, tier, wants, nda].map((field) => field.key)).toEqual([
        'budget',
        'renews_on',
        'tier',
        'interested_in',
        'nda_signed',
      ]);
      expect(tier.options).toEqual(['Bronze', 'Silver', 'Gold']);
    });

    it('refuses a select with no options, and a checkbox that carries some', async () => {
      const tenant = await signUp();

      const noOptions = await tenant
        .as(app.http.post(LEAD_FIELD_PATHS.leadFields))
        .send({ label: 'Tier', type: 'select' })
        .expect(422);
      expect(noOptions.body.fields).toHaveProperty('options');

      const strayOptions = await tenant
        .as(app.http.post(LEAD_FIELD_PATHS.leadFields))
        .send({ label: 'NDA', type: 'checkbox', options: ['yes'] })
        .expect(422);
      expect(strayOptions.body.fields).toHaveProperty('options');
    });

    it('gives two fields with the same label distinct keys', async () => {
      const tenant = await signUp();

      const first = await defineField(tenant, { label: 'Region', type: 'text' });
      const second = await defineField(tenant, { label: 'Region', type: 'text' });

      expect(first.key).toBe('region');
      expect(second.key).toBe('region_2');
    });

    /**
     * The invariant the whole `key` design exists for. A rename is a caption change; the values
     * already captured stay filed under the key they were written with.
     */
    it("keeps a field's key, and its stored values, across a rename", async () => {
      const tenant = await signUp();
      const field = await defineField(tenant, { label: 'Industry', type: 'text' });
      const lead = await addLead(tenant, { customValues: { industry: 'Logistics' } });

      await tenant
        .as(app.http.patch(LEAD_FIELD_PATHS.leadField(field.id)))
        .send({ label: 'Sector' } satisfies UpdateLeadFieldRequest)
        .expect(200);

      const [renamed] = (await listFields(tenant)).items;
      expect(renamed).toMatchObject({ key: 'industry', label: 'Sector' });

      const reread = await tenant.as(app.http.get(LEAD_PATHS.lead(lead.id))).expect(200);
      expect((reread.body as LeadResponse).customValues).toEqual({ industry: 'Logistics' });
    });

    it('moves a field to a position and renumbers the rest around it', async () => {
      const tenant = await signUp();
      await defineField(tenant, { label: 'First', type: 'text' });
      await defineField(tenant, { label: 'Second', type: 'text' });
      const third = await defineField(tenant, { label: 'Third', type: 'text' });

      await tenant
        .as(app.http.patch(LEAD_FIELD_PATHS.leadField(third.id)))
        .send({ order: 1 } satisfies UpdateLeadFieldRequest)
        .expect(200);

      const moved = (await listFields(tenant)).items;
      expect(moved.map((field) => field.label)).toEqual(['Third', 'First', 'Second']);
      expect(moved.map((field) => field.order)).toEqual([1, 2, 3]);
    });
  });

  describe('validating values', () => {
    it('accepts a well-formed value of every type', async () => {
      const tenant = await signUp();
      await defineField(tenant, { label: 'Industry', type: 'text' });
      await defineField(tenant, { label: 'Budget', type: 'number' });
      await defineField(tenant, { label: 'Renews on', type: 'date' });
      await defineField(tenant, { label: 'Tier', type: 'select', options: ['Bronze', 'Gold'] });
      await defineField(tenant, {
        label: 'Interested in',
        type: 'multiselect',
        options: ['Hardware', 'Support'],
      });
      await defineField(tenant, { label: 'NDA signed', type: 'checkbox' });

      const lead = await addLead(tenant, {
        customValues: {
          industry: 'Logistics',
          budget: 25000,
          renews_on: '2026-11-30',
          tier: 'Gold',
          interested_in: ['Support'],
          nda_signed: true,
        },
      });

      expect(lead.customValues).toEqual({
        industry: 'Logistics',
        budget: 25000,
        renews_on: '2026-11-30',
        tier: 'Gold',
        interested_in: ['Support'],
        nda_signed: true,
      });
    });

    it('refuses a value that does not match its type', async () => {
      const tenant = await signUp();
      await defineField(tenant, { label: 'Renews on', type: 'date' });

      const refused = await tenant
        .as(app.http.post(LEAD_PATHS.leads))
        .send({ name: 'Priya Kapoor', customValues: { renews_on: 'next Tuesday-ish' } })
        .expect(422);

      expect(refused.body.code).toBe(LEAD_FIELD_ERROR_CODES.invalidLeadFieldValue);
      expect(refused.body.fields).toHaveProperty('renews_on');
    });

    /** `2026-02-31` matches the pattern and is not a day. */
    it('refuses a date that is not on the calendar', async () => {
      const tenant = await signUp();
      await defineField(tenant, { label: 'Renews on', type: 'date' });

      await tenant
        .as(app.http.post(LEAD_PATHS.leads))
        .send({ name: 'Priya Kapoor', customValues: { renews_on: '2026-02-31' } })
        .expect(422);
    });

    it('refuses a select value outside its configured options', async () => {
      const tenant = await signUp();
      await defineField(tenant, { label: 'Tier', type: 'select', options: ['Bronze', 'Gold'] });

      const refused = await tenant
        .as(app.http.post(LEAD_PATHS.leads))
        .send({ name: 'Priya Kapoor', customValues: { tier: 'Platinum' } })
        .expect(422);

      expect(refused.body.fields.tier).toContain('Platinum');
    });

    it('refuses a multiselect entry outside its configured options', async () => {
      const tenant = await signUp();
      await defineField(tenant, {
        label: 'Interested in',
        type: 'multiselect',
        options: ['Hardware', 'Support'],
      });

      await tenant
        .as(app.http.post(LEAD_PATHS.leads))
        .send({ name: 'Priya Kapoor', customValues: { interested_in: ['Hardware', 'Catering'] } })
        .expect(422);
    });

    it('refuses a key naming no field at all', async () => {
      const tenant = await signUp();

      const refused = await tenant
        .as(app.http.post(LEAD_PATHS.leads))
        .send({ name: 'Priya Kapoor', customValues: { invented: 'anything' } })
        .expect(422);

      expect(refused.body.fields).toHaveProperty('invented');
    });

    it('refuses a required field left absent, and accepts it once given', async () => {
      const tenant = await signUp();
      await defineField(tenant, { label: 'Industry', type: 'text', required: true });

      const refused = await tenant
        .as(app.http.post(LEAD_PATHS.leads))
        .send({ name: 'Priya Kapoor' })
        .expect(422);
      expect(refused.body.fields).toHaveProperty('industry');

      const created = await addLead(tenant, { customValues: { industry: 'Logistics' } });
      expect(created.customValues?.industry).toBe('Logistics');
    });

    it('reports every bad value at once rather than one per attempt', async () => {
      const tenant = await signUp();
      await defineField(tenant, { label: 'Budget', type: 'number' });
      await defineField(tenant, { label: 'Renews on', type: 'date' });

      const refused = await tenant
        .as(app.http.post(LEAD_PATHS.leads))
        .send({
          name: 'Priya Kapoor',
          customValues: { budget: 'lots', renews_on: 'soon' },
        })
        .expect(422);

      expect(Object.keys(refused.body.fields).sort()).toEqual(['budget', 'renews_on']);
    });

    /**
     * An edit screen showing three of ten fields must not erase the other seven, so an update
     * merges rather than replaces — and a required field already filled in stays filled in.
     */
    it('merges an update over what is stored rather than replacing it', async () => {
      const tenant = await signUp();
      await defineField(tenant, { label: 'Industry', type: 'text', required: true });
      await defineField(tenant, { label: 'Budget', type: 'number' });

      const lead = await addLead(tenant, {
        customValues: { industry: 'Logistics', budget: 1000 },
      });

      const updated = await change(tenant, lead.id, { customValues: { budget: 2000 } });
      expect(updated.customValues).toEqual({ industry: 'Logistics', budget: 2000 });

      // An update that never mentions custom values leaves them entirely alone, and is not
      // refused by a required field it was never asked about.
      const renamed = await change(tenant, lead.id, { name: 'Priya N. Kapoor' });
      expect(renamed.customValues).toEqual({ industry: 'Logistics', budget: 2000 });
    });

    it('clears a value with null, and refuses to clear a required one', async () => {
      const tenant = await signUp();
      await defineField(tenant, { label: 'Budget', type: 'number' });
      await defineField(tenant, { label: 'Industry', type: 'text', required: true });

      const lead = await addLead(tenant, {
        customValues: { budget: 1000, industry: 'Logistics' },
      });

      const cleared = await change(tenant, lead.id, { customValues: { budget: null } });
      expect(cleared.customValues).toEqual({ industry: 'Logistics' });

      await change(tenant, lead.id, { customValues: { industry: null } }, 422);
    });
  });

  describe('archiving', () => {
    /**
     * The point of archive-not-delete: a company changing its mind must not destroy what it
     * already captured.
     */
    it('keeps values captured under an archived field readable', async () => {
      const tenant = await signUp();
      const field = await defineField(tenant, { label: 'Industry', type: 'text' });
      const lead = await addLead(tenant, { customValues: { industry: 'Logistics' } });

      const archived = await tenant
        .as(app.http.post(LEAD_FIELD_PATHS.archive(field.id)))
        .expect(201);
      expect((archived.body as LeadFieldResponse).archivedAt).not.toBeNull();

      const reread = await tenant.as(app.http.get(LEAD_PATHS.lead(lead.id))).expect(200);
      expect((reread.body as LeadResponse).customValues).toEqual({ industry: 'Logistics' });
    });

    it('stops requiring an archived field, and stops accepting writes to it', async () => {
      const tenant = await signUp();
      const field = await defineField(tenant, { label: 'Industry', type: 'text', required: true });

      await tenant.as(app.http.post(LEAD_FIELD_PATHS.archive(field.id))).expect(201);

      // No longer required — a lead saves without it.
      await addLead(tenant, { name: 'After archiving' });

      // And no longer writable: "archived" must not quietly mean "hidden but still settable".
      await tenant
        .as(app.http.post(LEAD_PATHS.leads))
        .send({ name: 'Second', customValues: { industry: 'Logistics' } })
        .expect(422);
    });

    it('restores an archived field', async () => {
      const tenant = await signUp();
      const field = await defineField(tenant, { label: 'Industry', type: 'text' });

      await tenant.as(app.http.post(LEAD_FIELD_PATHS.archive(field.id))).expect(201);
      const restored = await tenant
        .as(app.http.post(LEAD_FIELD_PATHS.restore(field.id)))
        .expect(201);

      expect((restored.body as LeadFieldResponse).archivedAt).toBeNull();
      await addLead(tenant, { customValues: { industry: 'Logistics' } });
    });
  });

  describe('tenant isolation', () => {
    it("never shows or accepts another company's field definitions", async () => {
      const northwind = await signUp();
      const acme = await signUp({
        companyName: 'Acme',
        name: 'Bo Lindqvist',
        email: 'bo@acme.test',
      });

      await defineField(northwind, { label: 'Industry', type: 'text' });

      expect((await listFields(acme)).items).toEqual([]);

      // The key is real in Northwind and means nothing in Acme, so the write is refused rather
      // than quietly stored against a definition Acme cannot see.
      await tenantRefusedCustomValue(acme);

      async function tenantRefusedCustomValue(tenant: Tenant): Promise<void> {
        await tenant
          .as(app.http.post(LEAD_PATHS.leads))
          .send({ name: 'Bo', customValues: { industry: 'Logistics' } })
          .expect(422);
      }
    });

    it("refuses to archive another company's field", async () => {
      const northwind = await signUp();
      const acme = await signUp({
        companyName: 'Acme',
        name: 'Bo Lindqvist',
        email: 'bo@acme.test',
      });

      const field = await defineField(northwind, { label: 'Industry', type: 'text' });

      await acme.as(app.http.post(LEAD_FIELD_PATHS.archive(field.id))).expect(404);
      await acme
        .as(app.http.patch(LEAD_FIELD_PATHS.leadField(field.id)))
        .send({ label: 'Stolen' })
        .expect(404);
    });
  });
});
