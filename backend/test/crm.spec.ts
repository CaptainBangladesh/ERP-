import {
  AUTH_PATHS,
  LEAD_ERROR_CODES,
  LEAD_PATHS,
  PARTY_PATHS,
  listPath,
  type AuthenticatedSession,
  type CreateLeadRequest,
  type CreatePartyRequest,
  type LeadListResponse,
  type LeadResponse,
  type PartyResponse,
  type QualifyLeadRequest,
  type SignUpRequest,
  type UpdateLeadRequest,
} from '@erp/shared';
import { createTestApp, resetDatabase, type TestApp } from './harness/test-app';

/**
 * Leads, over HTTP, against a real database. Nothing is mocked and nothing reaches below the
 * endpoint — `PartyDirectory` is exercised for real, exactly as `ProductCatalogue` is in
 * `inventory.spec.ts`.
 *
 * Two companies are signed up in the isolation block rather than one, because "a lead belongs
 * to a company" is a claim you cannot make with only one company in the database: every query
 * would pass whether or not scoping worked at all.
 */
describe('crm', () => {
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

  async function addLead(
    tenant: Tenant,
    body: Partial<CreateLeadRequest> = {},
  ): Promise<LeadResponse> {
    const response = await tenant
      .as(app.http.post(LEAD_PATHS.leads))
      .send({ name: 'Priya Kapoor', source: 'inbound', ...body } satisfies CreateLeadRequest)
      .expect(201);

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

  async function listLeads(tenant: Tenant, query = {}): Promise<LeadListResponse> {
    const response = await tenant
      .as(app.http.get(listPath(LEAD_PATHS.leads, query)))
      .expect(200);

    return response.body as LeadListResponse;
  }

  /** A Party the frontend would have created or found before calling `qualify`. */
  async function addParty(
    tenant: Tenant,
    body: Partial<CreatePartyRequest> = {},
  ): Promise<PartyResponse> {
    const response = await tenant
      .as(app.http.post(PARTY_PATHS.parties))
      .send({ kind: 'organisation', name: 'Kapoor Trading', ...body } satisfies CreatePartyRequest)
      .expect(201);

    return response.body as PartyResponse;
  }

  describe('creating one', () => {
    it('has none until somebody says so', async () => {
      const tenant = await signUp();

      const listed = await listLeads(tenant);
      expect(listed.items).toEqual([]);
      expect(listed.page.total).toBe(0);
    });

    it('records a lead, and lists it in the envelope every list endpoint returns', async () => {
      const tenant = await signUp();
      const created = await addLead(tenant, {
        name: 'Priya Kapoor',
        organisationName: 'Kapoor Trading',
        email: 'priya@kapoor.test',
        phone: '+44 20 7946 0958',
        source: 'referral',
      });

      expect(created).toMatchObject({
        name: 'Priya Kapoor',
        organisationName: 'Kapoor Trading',
        email: 'priya@kapoor.test',
        phone: '+44 20 7946 0958',
        source: 'referral',
        status: 'new',
        partyId: null,
        assignedToUserId: null,
      });

      const listed = await listLeads(tenant, { pageSize: 10 });
      expect(listed.items.map((item) => item.name)).toEqual(['Priya Kapoor']);
      expect(listed.page).toEqual({ number: 1, size: 10, total: 1, pages: 1 });
    });

    it('says what is wrong with the input rather than failing obscurely', async () => {
      const tenant = await signUp();

      const refused = await tenant
        .as(app.http.post(LEAD_PATHS.leads))
        .send({ name: '', source: 'inbound' })
        .expect(422);

      expect(refused.body.fields).toHaveProperty('name');
    });

    it('refuses a source outside the wire vocabulary', async () => {
      const tenant = await signUp();

      const refused = await tenant
        .as(app.http.post(LEAD_PATHS.leads))
        .send({ name: 'Priya Kapoor', source: 'telepathy' })
        .expect(422);

      expect(refused.body.fields).toHaveProperty('source');
    });
  });

  describe('editing one', () => {
    it('changes the ordinary fields, and can move between new and contacted', async () => {
      const tenant = await signUp();
      const created = await addLead(tenant);

      const changed = await change(tenant, created.id, {
        name: 'Priya N. Kapoor',
        status: 'contacted',
      });

      expect(changed.name).toBe('Priya N. Kapoor');
      expect(changed.status).toBe('contacted');
    });

    it('refuses to set qualified or disqualified through the general update', async () => {
      const tenant = await signUp();
      const created = await addLead(tenant);

      const refused = await tenant
        .as(app.http.patch(LEAD_PATHS.lead(created.id)))
        .send({ status: 'qualified' })
        .expect(422);

      expect(refused.body.fields).toHaveProperty('status');
    });

    it('is the same 404 a made-up id gets, for an id nobody in this company has', async () => {
      const tenant = await signUp();

      await tenant
        .as(app.http.patch(LEAD_PATHS.lead('00000000-0000-0000-0000-000000000000')))
        .send({ name: 'Anybody' })
        .expect(404);
    });
  });

  describe('qualifying', () => {
    it('creates a new Party first, then links it — status becomes qualified in one request', async () => {
      const tenant = await signUp();
      const lead = await addLead(tenant, { name: 'Priya Kapoor' });
      const party = await addParty(tenant, { name: 'Kapoor Trading' });

      const qualified = await tenant
        .as(app.http.post(LEAD_PATHS.qualify(lead.id)))
        .send({ action: 'create', partyId: party.id } satisfies QualifyLeadRequest)
        .expect(200);

      const body = qualified.body as LeadResponse;
      expect(body.status).toBe('qualified');
      expect(body.partyId).toBe(party.id);
    });

    it('links to an existing Party found beforehand, the same way', async () => {
      const tenant = await signUp();
      const existing = await addParty(tenant, { name: 'Existing Trading Co' });
      const lead = await addLead(tenant, { name: 'Someone at Existing' });

      const qualified = await tenant
        .as(app.http.post(LEAD_PATHS.qualify(lead.id)))
        .send({ action: 'link', partyId: existing.id } satisfies QualifyLeadRequest)
        .expect(200);

      const body = qualified.body as LeadResponse;
      expect(body.status).toBe('qualified');
      expect(body.partyId).toBe(existing.id);
    });

    it('never writes a PartyRole — there is no such write path to call', async () => {
      const tenant = await signUp();
      const party = await addParty(tenant, { name: 'Kapoor Trading' });
      const lead = await addLead(tenant);

      await tenant
        .as(app.http.post(LEAD_PATHS.qualify(lead.id)))
        .send({ action: 'create', partyId: party.id } satisfies QualifyLeadRequest)
        .expect(200);

      // The qualified Party holds no roles: crm's backend has no endpoint that could have
      // given it one, so the only way `prospect` ever lands here is the frontend's own,
      // separate call to Parties' `POST /parties/:id/roles`.
      const detail = await tenant.as(app.http.get(PARTY_PATHS.party(party.id))).expect(200);
      expect((detail.body as PartyResponse).roles).toEqual([]);
    });

    it('refuses a partyId that does not resolve through PartyDirectory', async () => {
      const tenant = await signUp();
      const lead = await addLead(tenant);

      await tenant
        .as(app.http.post(LEAD_PATHS.qualify(lead.id)))
        .send({ action: 'link', partyId: '00000000-0000-0000-0000-000000000000' } satisfies QualifyLeadRequest)
        .expect(404);
    });

    it('refuses a partyId belonging to another company', async () => {
      const northwind = await signUp();
      const acme = await signUp({ companyName: 'Acme', name: 'Bo Lindqvist', email: 'bo@acme.test' });

      const acmeParty = await addParty(acme, { name: "Acme's own party" });
      const lead = await addLead(northwind);

      await northwind
        .as(app.http.post(LEAD_PATHS.qualify(lead.id)))
        .send({ action: 'link', partyId: acmeParty.id } satisfies QualifyLeadRequest)
        .expect(404);
    });

    it('refuses to qualify a lead that already holds a Party', async () => {
      const tenant = await signUp();
      const lead = await addLead(tenant);
      const first = await addParty(tenant, { name: 'First Party' });
      const second = await addParty(tenant, { name: 'Second Party' });

      await tenant
        .as(app.http.post(LEAD_PATHS.qualify(lead.id)))
        .send({ action: 'create', partyId: first.id } satisfies QualifyLeadRequest)
        .expect(200);

      await tenant
        .as(app.http.post(LEAD_PATHS.qualify(lead.id)))
        .send({ action: 'create', partyId: second.id } satisfies QualifyLeadRequest)
        .expect(409);
    });

    it('refuses to qualify a disqualified lead — reopen it first', async () => {
      const tenant = await signUp();
      const lead = await addLead(tenant);
      const party = await addParty(tenant);

      await tenant.as(app.http.post(LEAD_PATHS.disqualify(lead.id))).expect(200);

      const refused = await tenant
        .as(app.http.post(LEAD_PATHS.qualify(lead.id)))
        .send({ action: 'create', partyId: party.id } satisfies QualifyLeadRequest)
        .expect(409);

      expect(refused.body.code).toBe(LEAD_ERROR_CODES.leadNotQualifiable);
    });
  });

  describe('disqualifying and reopening', () => {
    it('round-trips through the status held before disqualifying, not a guess', async () => {
      const tenant = await signUp();
      const lead = await addLead(tenant);
      await change(tenant, lead.id, { status: 'contacted' });

      const disqualified = await tenant
        .as(app.http.post(LEAD_PATHS.disqualify(lead.id)))
        .expect(200);
      expect((disqualified.body as LeadResponse).status).toBe('disqualified');

      const reopened = await tenant.as(app.http.post(LEAD_PATHS.reopen(lead.id))).expect(200);
      // Restored to 'contacted', the status disqualifying interrupted — not reset to 'new'.
      expect((reopened.body as LeadResponse).status).toBe('contacted');
    });

    it('restores new when that is what was held', async () => {
      const tenant = await signUp();
      const lead = await addLead(tenant);

      await tenant.as(app.http.post(LEAD_PATHS.disqualify(lead.id))).expect(200);
      const reopened = await tenant.as(app.http.post(LEAD_PATHS.reopen(lead.id))).expect(200);

      expect((reopened.body as LeadResponse).status).toBe('new');
    });

    it('refuses to disqualify one already disqualified', async () => {
      const tenant = await signUp();
      const lead = await addLead(tenant);

      await tenant.as(app.http.post(LEAD_PATHS.disqualify(lead.id))).expect(200);

      const refused = await tenant.as(app.http.post(LEAD_PATHS.disqualify(lead.id))).expect(409);
      expect(refused.body.code).toBe(LEAD_ERROR_CODES.leadAlreadyDisqualified);
    });

    it('refuses to reopen one that was never disqualified', async () => {
      const tenant = await signUp();
      const lead = await addLead(tenant);

      const refused = await tenant.as(app.http.post(LEAD_PATHS.reopen(lead.id))).expect(409);
      expect(refused.body.code).toBe(LEAD_ERROR_CODES.leadNotDisqualified);
    });
  });

  describe('tenant isolation', () => {
    it('is not a filter any of this code writes, and one company cannot see another', async () => {
      const northwind = await signUp();
      const acme = await signUp({ companyName: 'Acme', name: 'Bo Lindqvist', email: 'bo@acme.test' });

      const theirs = await addLead(northwind, { name: 'Theirs' });
      await addLead(acme, { name: 'Ours' });

      const listed = await listLeads(acme);
      expect(listed.items.map((item) => item.name)).toEqual(['Ours']);

      // By its own identifier, which is the case a list filter would not cover: the id is
      // real, and the answer is the one a made-up id gets.
      await acme.as(app.http.get(LEAD_PATHS.lead(theirs.id))).expect(404);
    });

    it('refuses every lifecycle action on a lead belonging to another company', async () => {
      const northwind = await signUp();
      const acme = await signUp({ companyName: 'Acme', name: 'Bo Lindqvist', email: 'bo@acme.test' });

      const theirs = await addLead(northwind, { name: 'Theirs' });

      await acme.as(app.http.patch(LEAD_PATHS.lead(theirs.id))).send({ name: 'Ours now' }).expect(404);
      await acme.as(app.http.post(LEAD_PATHS.disqualify(theirs.id))).expect(404);
      await acme.as(app.http.post(LEAD_PATHS.reopen(theirs.id))).expect(404);
      await acme
        .as(app.http.post(LEAD_PATHS.qualify(theirs.id)))
        .send({ action: 'link', partyId: theirs.id } satisfies QualifyLeadRequest)
        .expect(404);
    });
  });
});
