import {
  AUTH_PATHS,
  PARTY_ERROR_CODES,
  PARTY_PATHS,
  listPath,
  type AuthenticatedSession,
  type PartyListResponse,
  type PartyResponse,
  type PartyRolesResponse,
  type PartySummary,
  type SignUpRequest,
} from '@erp/shared';
import { PartyDirectory } from '../src/modules/parties';
import { createTestApp, resetDatabase, type TestApp } from './harness/test-app';

/**
 * The address book, over HTTP, against a real database.
 *
 * Nothing is mocked and nothing reaches below the endpoint, except the one block that asks
 * the module's public surface directly — because a contract other modules will consume is
 * not reachable over HTTP, and "another module can read a party without touching its tables"
 * is precisely the claim worth testing.
 *
 * Two companies are signed up in the isolation test rather than one, because "a party
 * belongs to a company" is a claim you cannot make with only one company in the database:
 * every query would pass whether or not scoping worked at all.
 */
describe('parties', () => {
  let app: TestApp;

  const PASSWORD = 'correct-horse-battery';

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
        password: PASSWORD,
        ...overrides,
      })
      .expect(201);

    const session = response.body as AuthenticatedSession;
    return {
      session,
      as: (request) => request.set('Authorization', `Bearer ${session.token}`),
    };
  }

  async function addParty(
    tenant: Tenant,
    body: Record<string, unknown>,
  ): Promise<PartyResponse> {
    const response = await tenant
      .as(app.http.post(PARTY_PATHS.parties))
      .send({ kind: 'person', name: 'Somebody', ...body })
      .expect(201);

    return response.body as PartyResponse;
  }

  async function list(tenant: Tenant, query = {}): Promise<PartyListResponse> {
    const response = await tenant
      .as(app.http.get(listPath(PARTY_PATHS.parties, query)))
      .expect(200);

    return response.body as PartyListResponse;
  }

  describe('creating', () => {
    it('records a person and an organisation, and tells them apart', async () => {
      const tenant = await signUp();

      const person = await addParty(tenant, { name: 'Ada Okafor', email: 'ada@example.test' });
      const organisation = await addParty(tenant, {
        kind: 'organisation',
        name: 'Northwind Ltd',
        phone: '0161 496 0000',
      });

      expect(person).toMatchObject({
        kind: 'person',
        name: 'Ada Okafor',
        email: 'ada@example.test',
        status: 'active',
        roles: [],
        addresses: [],
        members: [],
      });
      expect(organisation).toMatchObject({ kind: 'organisation', phone: '0161 496 0000' });
    });

    it('holds several roles at once, given at creation', async () => {
      const tenant = await signUp();

      // The whole reason there is one address book rather than four: the same record is a
      // customer to Sales and a supplier to Purchase, and neither has to know about the other.
      const party = await addParty(tenant, {
        name: 'Ada Okafor',
        roles: ['supplier', 'customer', 'customer'],
      });

      expect(party.roles).toEqual(['customer', 'supplier']);
    });

    it('puts people in an organisation, and refuses to put an organisation in one', async () => {
      const tenant = await signUp();
      const northwind = await addParty(tenant, { kind: 'organisation', name: 'Northwind Ltd' });

      const ada = await addParty(tenant, {
        name: 'Ada Okafor',
        organisationId: northwind.id,
      });

      expect(ada.organisationId).toBe(northwind.id);
      expect(ada.organisationName).toBe('Northwind Ltd');

      const detail = await tenant.as(app.http.get(PARTY_PATHS.party(northwind.id))).expect(200);
      expect((detail.body as PartyResponse).members.map((m) => m.name)).toEqual(['Ada Okafor']);

      const refused = await tenant
        .as(app.http.post(PARTY_PATHS.parties))
        .send({ kind: 'organisation', name: 'Acme', organisationId: northwind.id })
        .expect(422);

      expect(refused.body.fields).toHaveProperty('organisationId');
    });

    it('refuses an organisation that is really a person, naming the input', async () => {
      const tenant = await signUp();
      const ada = await addParty(tenant, { name: 'Ada Okafor' });

      const refused = await tenant
        .as(app.http.post(PARTY_PATHS.parties))
        .send({ kind: 'person', name: 'Bo Lindqvist', organisationId: ada.id })
        .expect(422);

      expect(refused.body.code).toBe(PARTY_ERROR_CODES.notAnOrganisation);
      expect(refused.body.fields.organisationId).toMatch(/organisation/i);
    });

    it('says what is wrong with every field at once', async () => {
      const tenant = await signUp();

      const refused = await tenant
        .as(app.http.post(PARTY_PATHS.parties))
        .send({ kind: 'robot', name: '', email: 'not-an-address' })
        .expect(422);

      expect(Object.keys(refused.body.fields).sort()).toEqual(['email', 'kind', 'name']);
      expect(refused.body.fields.kind).toContain('person, organisation');
    });
  });

  describe('roles', () => {
    it('adds and removes roles without recreating the party', async () => {
      const tenant = await signUp();
      const ada = await addParty(tenant, { name: 'Ada Okafor', roles: ['customer'] });

      const added = await tenant
        .as(app.http.post(PARTY_PATHS.partyRoles(ada.id)))
        .send({ role: 'supplier' })
        .expect(200);

      expect((added.body as PartyResponse).roles).toEqual(['customer', 'supplier']);

      const removed = await tenant
        .as(app.http.delete(PARTY_PATHS.partyRole(ada.id, 'customer')))
        .expect(200);

      // Same id throughout: a role is something a party holds, not something it is.
      expect((removed.body as PartyResponse).id).toBe(ada.id);
      expect((removed.body as PartyResponse).roles).toEqual(['supplier']);
    });

    it('takes a role nothing in this system has ever heard of', async () => {
      const tenant = await signUp();
      const ada = await addParty(tenant, { name: 'Ada Okafor' });

      // The criterion is that adding a role does not require changing the Parties module.
      // Nothing anywhere lists the permitted roles, so this is a new one by construction.
      const added = await tenant
        .as(app.http.post(PARTY_PATHS.partyRoles(ada.id)))
        .send({ role: 'freight-forwarder' })
        .expect(200);

      expect((added.body as PartyResponse).roles).toEqual(['freight-forwarder']);

      const roles = await tenant.as(app.http.get(PARTY_PATHS.roles)).expect(200);
      expect((roles.body as PartyRolesResponse).roles).toEqual(['freight-forwarder']);
    });

    it('refuses a role that could not be filtered on or put in a URL', async () => {
      const tenant = await signUp();
      const ada = await addParty(tenant, { name: 'Ada Okafor' });

      const refused = await tenant
        .as(app.http.post(PARTY_PATHS.partyRoles(ada.id)))
        .send({ role: 'Key Account!' })
        .expect(422);

      expect(refused.body.fields.role).toMatch(/lowercase/i);
    });

    it('is unbothered by a role a party already holds', async () => {
      const tenant = await signUp();
      const ada = await addParty(tenant, { name: 'Ada Okafor', roles: ['customer'] });

      const again = await tenant
        .as(app.http.post(PARTY_PATHS.partyRoles(ada.id)))
        .send({ role: 'customer' })
        .expect(200);

      expect((again.body as PartyResponse).roles).toEqual(['customer']);
    });
  });

  describe('addresses', () => {
    it('holds several, and keeps one of them the main one', async () => {
      const tenant = await signUp();
      const northwind = await addParty(tenant, { kind: 'organisation', name: 'Northwind Ltd' });

      const office = {
        label: 'Registered office',
        line1: '1 Bridgewater Place',
        city: 'Manchester',
        postcode: 'M1 5AA',
        country: 'United Kingdom',
        primary: true,
      };

      await tenant.as(app.http.post(PARTY_PATHS.addresses(northwind.id))).send(office).expect(201);

      const both = await tenant
        .as(app.http.post(PARTY_PATHS.addresses(northwind.id)))
        .send({ ...office, label: 'Warehouse', line1: 'Unit 4', primary: true })
        .expect(201);

      const addresses = (both.body as PartyResponse).addresses;
      expect(addresses.map((a) => a.label)).toEqual(['Warehouse', 'Registered office']);
      // The newest claim wins rather than being refused: setting a main address is an
      // instruction, not a collision the caller has to resolve.
      expect(addresses.filter((a) => a.primary).map((a) => a.label)).toEqual(['Warehouse']);

      const removed = await tenant
        .as(app.http.delete(PARTY_PATHS.address(northwind.id, addresses[1]!.id)))
        .expect(200);

      expect((removed.body as PartyResponse).addresses.map((a) => a.label)).toEqual(['Warehouse']);
    });
  });

  describe('searching and filtering', () => {
    async function bookOfThree(tenant: Tenant) {
      const northwind = await addParty(tenant, {
        kind: 'organisation',
        name: 'Northwind Ltd',
        roles: ['supplier'],
      });
      const ada = await addParty(tenant, {
        name: 'Ada Okafor',
        email: 'ada@northwind.test',
        roles: ['customer', 'employee-contact'],
        organisationId: northwind.id,
      });
      const bo = await addParty(tenant, { name: 'Bo Lindqvist', roles: ['customer'] });

      return { northwind, ada, bo };
    }

    it('searches names and email addresses together', async () => {
      const tenant = await signUp();
      await bookOfThree(tenant);

      // Half a name or half an address, whichever the person at the screen remembers.
      expect((await list(tenant, { search: 'okafor' })).items.map((p) => p.name)).toEqual([
        'Ada Okafor',
      ]);
      expect((await list(tenant, { search: 'northwind' })).items.map((p) => p.name)).toEqual([
        'Ada Okafor',
        'Northwind Ltd',
      ]);
    });

    it('filters by role, which is not a column on the party at all', async () => {
      const tenant = await signUp();
      await bookOfThree(tenant);

      // The `via` declaration in the module's list spec is the whole of what makes this work.
      // Nothing in the module writes a join, and the screen asks for it exactly as it would
      // ask for a column.
      expect((await list(tenant, { filters: { role: 'customer' } })).items.map((p) => p.name)).toEqual([
        'Ada Okafor',
        'Bo Lindqvist',
      ]);
      expect((await list(tenant, { filters: { role: 'supplier' } })).items.map((p) => p.name)).toEqual([
        'Northwind Ltd',
      ]);
      expect((await list(tenant, { filters: { role: 'nobody-holds-this' } })).items).toEqual([]);
    });

    it('narrows by role and search together, not alongside each other', async () => {
      const tenant = await signUp();
      await bookOfThree(tenant);

      const found = await list(tenant, { search: 'ada', filters: { role: 'customer' } });
      expect(found.items.map((p) => p.name)).toEqual(['Ada Okafor']);
    });

    it('filters by status and by kind', async () => {
      const tenant = await signUp();
      const { bo } = await bookOfThree(tenant);

      await tenant.as(app.http.patch(PARTY_PATHS.party(bo.id))).send({ status: 'inactive' }).expect(200);

      expect((await list(tenant, { filters: { status: 'active' } })).items.map((p) => p.name)).toEqual([
        'Ada Okafor',
        'Northwind Ltd',
      ]);
      expect((await list(tenant, { filters: { kind: 'organisation' } })).items.map((p) => p.name)).toEqual([
        'Northwind Ltd',
      ]);
    });

    it('refuses a sort by role, because a party has several and the list has one order', async () => {
      const tenant = await signUp();
      await bookOfThree(tenant);

      const refused = await tenant
        .as(app.http.get(listPath(PARTY_PATHS.parties, { sort: 'role' })))
        .expect(422);

      expect(refused.body.fields.sort).toMatch(/cannot sort by 'role'/i);
      // And says what it can sort by, which is the half of a refusal that helps.
      expect(refused.body.fields.sort).toContain('name');
    });

    it('returns the one envelope every list endpoint returns', async () => {
      const tenant = await signUp();
      await bookOfThree(tenant);

      const page = await list(tenant, { pageSize: 2 });
      expect(page.page).toEqual({ number: 1, size: 2, total: 3, pages: 2 });
      expect(page.items).toHaveLength(2);
    });
  });

  describe('deactivating', () => {
    it('keeps the record and stops it being active, rather than deleting it', async () => {
      const tenant = await signUp();
      const ada = await addParty(tenant, { name: 'Ada Okafor', roles: ['customer'] });

      const deactivated = await tenant
        .as(app.http.patch(PARTY_PATHS.party(ada.id)))
        .send({ status: 'inactive' })
        .expect(200);

      expect((deactivated.body as PartyResponse).status).toBe('inactive');
      // Still there, still holding its roles, still findable by its id — which is what makes
      // a three-year-old order naming it intelligible.
      expect((deactivated.body as PartyResponse).roles).toEqual(['customer']);
      await tenant.as(app.http.get(PARTY_PATHS.party(ada.id))).expect(200);

      const reactivated = await tenant
        .as(app.http.patch(PARTY_PATHS.party(ada.id)))
        .send({ status: 'active' })
        .expect(200);
      expect((reactivated.body as PartyResponse).status).toBe('active');
    });

    it('offers no way to delete a party at all', async () => {
      const tenant = await signUp();
      const ada = await addParty(tenant, { name: 'Ada Okafor' });

      // Not having the route is the point. History that points at a party has to keep
      // resolving, and a delete would leave it pointing at nothing.
      await tenant.as(app.http.delete(PARTY_PATHS.party(ada.id))).expect(404);
    });

    it('refuses a status that is reached by merging rather than by asking', async () => {
      const tenant = await signUp();
      const ada = await addParty(tenant, { name: 'Ada Okafor' });

      const refused = await tenant
        .as(app.http.patch(PARTY_PATHS.party(ada.id)))
        .send({ status: 'merged' })
        .expect(422);

      expect(refused.body.fields.status).toContain('active, inactive');
    });
  });

  describe('merging', () => {
    it('moves everything across and keeps the duplicate as a pointer', async () => {
      const tenant = await signUp();

      const survivor = await addParty(tenant, { name: 'Ada Okafor', roles: ['customer'] });
      const duplicate = await addParty(tenant, {
        name: 'A. Okafor',
        phone: '0161 496 0000',
        roles: ['customer', 'supplier'],
      });

      await tenant
        .as(app.http.post(PARTY_PATHS.addresses(duplicate.id)))
        .send({
          label: 'Home',
          line1: '1 Bridgewater Place',
          city: 'Manchester',
          postcode: 'M1 5AA',
          country: 'United Kingdom',
        })
        .expect(201);

      const merged = await tenant
        .as(app.http.post(PARTY_PATHS.merge(survivor.id)))
        .send({ duplicateId: duplicate.id })
        .expect(200);

      const kept = merged.body as PartyResponse;
      expect(kept.id).toBe(survivor.id);
      expect(kept.roles).toEqual(['customer', 'supplier']);
      expect(kept.addresses.map((a) => a.label)).toEqual(['Home']);
      // Only what the survivor was missing is taken across; merging never overwrites the
      // record somebody chose to keep.
      expect(kept.name).toBe('Ada Okafor');
      expect(kept.phone).toBe('0161 496 0000');

      const gone = await tenant.as(app.http.get(PARTY_PATHS.party(duplicate.id))).expect(200);
      expect(gone.body).toMatchObject({
        status: 'merged',
        mergedIntoId: survivor.id,
        roles: [],
      });
    });

    it('moves an organisation’s people to the survivor', async () => {
      const tenant = await signUp();

      const survivor = await addParty(tenant, { kind: 'organisation', name: 'Northwind Ltd' });
      const duplicate = await addParty(tenant, { kind: 'organisation', name: 'Northwind' });
      await addParty(tenant, { name: 'Ada Okafor', organisationId: duplicate.id });

      const merged = await tenant
        .as(app.http.post(PARTY_PATHS.merge(survivor.id)))
        .send({ duplicateId: duplicate.id })
        .expect(200);

      expect((merged.body as PartyResponse).members.map((m) => m.name)).toEqual(['Ada Okafor']);
    });

    it('refuses to merge a person and an organisation, or a party into itself', async () => {
      const tenant = await signUp();
      const ada = await addParty(tenant, { name: 'Ada Okafor' });
      const northwind = await addParty(tenant, { kind: 'organisation', name: 'Northwind Ltd' });

      const itself = await tenant
        .as(app.http.post(PARTY_PATHS.merge(ada.id)))
        .send({ duplicateId: ada.id })
        .expect(409);
      expect(itself.body.code).toBe(PARTY_ERROR_CODES.cannotMerge);

      // An employee and their employer are two entities; `organisationId` is what says so.
      const across = await tenant
        .as(app.http.post(PARTY_PATHS.merge(ada.id)))
        .send({ duplicateId: northwind.id })
        .expect(409);
      expect(across.body.message).toMatch(/organisation/i);
    });

    it('leaves the survivor with one main address, not two', async () => {
      const tenant = await signUp();
      const survivor = await addParty(tenant, { kind: 'organisation', name: 'Northwind Ltd' });
      const duplicate = await addParty(tenant, { kind: 'organisation', name: 'Northwind' });

      const address = {
        line1: '1 Bridgewater Place',
        city: 'Manchester',
        postcode: 'M1 5AA',
        country: 'United Kingdom',
        primary: true,
      };

      for (const [party, label] of [
        [survivor, 'Registered office'],
        [duplicate, 'Old office'],
      ] as const) {
        await tenant
          .as(app.http.post(PARTY_PATHS.addresses(party.id)))
          .send({ ...address, label })
          .expect(201);
      }

      const merged = await tenant
        .as(app.http.post(PARTY_PATHS.merge(survivor.id)))
        .send({ duplicateId: duplicate.id })
        .expect(200);

      // Both were the main address of their own party. Repointing them unchanged would leave
      // two rows claiming to be the one used when nothing says otherwise, and the survivor's
      // own choice is the one that should stand.
      const addresses = (merged.body as PartyResponse).addresses;
      expect(addresses).toHaveLength(2);
      expect(addresses.filter((a) => a.primary).map((a) => a.label)).toEqual([
        'Registered office',
      ]);
    });

    it('refuses to edit a party that has been merged away', async () => {
      const tenant = await signUp();
      const survivor = await addParty(tenant, { name: 'Ada Okafor' });
      const duplicate = await addParty(tenant, { name: 'A. Okafor' });

      await tenant
        .as(app.http.post(PARTY_PATHS.merge(survivor.id)))
        .send({ duplicateId: duplicate.id })
        .expect(200);

      const refused = await tenant
        .as(app.http.patch(PARTY_PATHS.party(duplicate.id)))
        .send({ name: 'Someone Else' })
        .expect(409);

      expect(refused.body.code).toBe(PARTY_ERROR_CODES.partyMerged);
      expect(refused.body.message).toContain(survivor.id);
    });
  });

  describe('one company cannot see another’s address book', () => {
    it('is not a filter any of this code writes, and holds anyway', async () => {
      const northwind = await signUp();
      const acme = await signUp({
        companyName: 'Acme',
        name: 'Bo Lindqvist',
        email: 'bo@acme.test',
      });

      const theirs = await addParty(northwind, { name: 'Ada Okafor', roles: ['customer'] });
      await addParty(acme, { name: 'Kit Bramley' });

      expect((await list(acme)).items.map((p) => p.name)).toEqual(['Kit Bramley']);

      // By its own identifier, which is the case a list filter would not cover: the id is
      // real, and the answer is the one a made-up id gets.
      await acme.as(app.http.get(PARTY_PATHS.party(theirs.id))).expect(404);
      await acme.as(app.http.patch(PARTY_PATHS.party(theirs.id))).send({ name: 'Mine' }).expect(404);

      // And the roles endpoint, which reads a different table with the same scoping.
      const roles = await acme.as(app.http.get(PARTY_PATHS.roles)).expect(200);
      expect((roles.body as PartyRolesResponse).roles).toEqual([]);
    });
  });

  /**
   * The module's public surface, asked directly.
   *
   * Not reachable over HTTP — it is what *other modules* use, and none exists yet — so this is
   * the one place in the suite that resolves a provider from the container. What is being
   * asserted is the criterion: another module can read a party without touching its tables.
   * `PartyDirectory` is imported from `src/modules/parties`, which is the same public surface
   * a real consumer would import, and `PartiesService` is deliberately not reachable from
   * there at all.
   */
  describe('what other modules may ask', () => {
    async function inCompany<T>(tenant: Tenant, work: () => Promise<T>): Promise<T> {
      return app.tenancy.runInCompany(
        { companyId: tenant.session.company.id, grants: 'all' },
        work,
      );
    }

    it('reads a party by id, in the company doing the asking', async () => {
      const tenant = await signUp();
      const ada = await addParty(tenant, {
        name: 'Ada Okafor',
        email: 'ada@example.test',
        roles: ['customer'],
      });

      const directory = app.nest.get(PartyDirectory);
      const found = await inCompany(tenant, () => directory.party(ada.id));

      expect(found).toMatchObject({
        id: ada.id,
        name: 'Ada Okafor',
        email: 'ada@example.test',
        roles: ['customer'],
      });
    });

    it('answers with the survivor when asked about a party that was merged away', async () => {
      const tenant = await signUp();
      const survivor = await addParty(tenant, { name: 'Ada Okafor' });
      const duplicate = await addParty(tenant, { name: 'A. Okafor' });

      await tenant
        .as(app.http.post(PARTY_PATHS.merge(survivor.id)))
        .send({ duplicateId: duplicate.id })
        .expect(200);

      const directory = app.nest.get(PartyDirectory);
      const found = await inCompany(tenant, () => directory.party(duplicate.id));

      // The whole reason the merged row is kept: an order placed against the duplicate three
      // years ago still resolves to the customer who really placed it, and the module holding
      // that order never learns a merge happened.
      expect(found?.id).toBe(survivor.id);
      expect(found?.name).toBe('Ada Okafor');

      // And in a batch, which is the same question asked twice over. One contract answering
      // a merged id one way singly and another way in a list would be a contract with a
      // coin-flip in it, found on the day somebody merges a customer.
      const batch = await inCompany(tenant, () => directory.parties([duplicate.id, survivor.id]));
      expect(batch.map((p: PartySummary) => p.id)).toEqual([survivor.id, survivor.id]);
    });

    it('reads several in the order asked for, and everybody holding a role', async () => {
      const tenant = await signUp();
      const ada = await addParty(tenant, { name: 'Ada Okafor', roles: ['customer'] });
      const bo = await addParty(tenant, { name: 'Bo Lindqvist', roles: ['customer'] });
      const kit = await addParty(tenant, { name: 'Kit Bramley', roles: ['supplier'] });

      await tenant.as(app.http.patch(PARTY_PATHS.party(bo.id))).send({ status: 'inactive' }).expect(200);

      const directory = app.nest.get(PartyDirectory);

      const some = await inCompany(tenant, () =>
        directory.parties([kit.id, ada.id, 'ffffffff-ffff-4fff-8fff-ffffffffffff']),
      );
      expect(some.map((p: PartySummary) => p.name)).toEqual(['Kit Bramley', 'Ada Okafor']);

      // Deactivated, but still readable by id: `withRole` is a list of who to act on, and
      // this is a lookup of who somebody is. Only the first has an opinion about status.
      expect((await inCompany(tenant, () => directory.party(bo.id)))?.status).toBe('inactive');

      // Active only: a list of who to invoice should not include somebody deliberately
      // deactivated last year.
      const customers = await inCompany(tenant, () => directory.withRole('customer'));
      expect(customers.map((p: PartySummary) => p.name)).toEqual(['Ada Okafor']);
    });

    it('sees nothing of another company’s address book', async () => {
      const northwind = await signUp();
      const acme = await signUp({
        companyName: 'Acme',
        name: 'Bo Lindqvist',
        email: 'bo@acme.test',
      });
      const theirs = await addParty(northwind, { name: 'Ada Okafor', roles: ['customer'] });

      const directory = app.nest.get(PartyDirectory);

      expect(await inCompany(acme, () => directory.party(theirs.id))).toBeUndefined();
      expect(await inCompany(acme, () => directory.withRole('customer'))).toEqual([]);
    });
  });
});
