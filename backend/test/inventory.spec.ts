import {
  AUTH_PATHS,
  LOCATION_ERROR_CODES,
  LOCATION_PATHS,
  listPath,
  type AuthenticatedSession,
  type CreateLocationRequest,
  type LocationListResponse,
  type LocationResponse,
  type SignUpRequest,
  type UpdateLocationRequest,
} from '@erp/shared';
import { createTestApp, resetDatabase, type TestApp } from './harness/test-app';

/**
 * Locations, over HTTP, against a real database. Nothing is mocked and nothing reaches below
 * the endpoint.
 *
 * The first assertion in the file is that a brand new company has no locations, and it is not
 * a formality: nothing in this system is seeded, so an empty list is what every real user sees
 * first — and the movement screen ticket 09 will send somebody back here from depends on that
 * being the ordinary state rather than a broken one.
 *
 * Two companies are signed up in the isolation block rather than one, because "a location
 * belongs to a company" is a claim you cannot make with only one company in the database:
 * every query would pass whether or not scoping worked at all.
 */
describe('inventory', () => {
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

  async function addLocation(
    tenant: Tenant,
    body: Partial<CreateLocationRequest> = {},
  ): Promise<LocationResponse> {
    const response = await tenant
      .as(app.http.post(LOCATION_PATHS.locations))
      .send({ code: 'WH-1', name: 'Main warehouse', ...body })
      .expect(201);

    return response.body as LocationResponse;
  }

  async function change(
    tenant: Tenant,
    id: string,
    body: UpdateLocationRequest,
    status = 200,
  ): Promise<LocationResponse> {
    const response = await tenant
      .as(app.http.patch(LOCATION_PATHS.location(id)))
      .send(body)
      .expect(status);

    return response.body as LocationResponse;
  }

  async function listLocations(tenant: Tenant, query = {}): Promise<LocationListResponse> {
    const response = await tenant
      .as(app.http.get(listPath(LOCATION_PATHS.locations, query)))
      .expect(200);

    return response.body as LocationListResponse;
  }

  describe('creating one', () => {
    it('has none until somebody says so', async () => {
      const tenant = await signUp();

      const listed = await listLocations(tenant);
      expect(listed.items).toEqual([]);
      expect(listed.page.total).toBe(0);
    });

    it('records a location, and lists it in the envelope every list endpoint returns', async () => {
      const tenant = await signUp();
      const created = await addLocation(tenant);

      expect(created).toMatchObject({ code: 'WH-1', name: 'Main warehouse', status: 'active' });

      const listed = await listLocations(tenant, { pageSize: 10 });
      expect(listed.items.map((item) => item.code)).toEqual(['WH-1']);
      expect(listed.page).toEqual({ number: 1, size: 10, total: 1, pages: 1 });
    });

    it('stores the code upper case, however it was typed', async () => {
      const tenant = await signUp();
      const created = await addLocation(tenant, { code: ' wh-1 ' });

      expect(created.code).toBe('WH-1');
    });

    it('says what is wrong with the input rather than failing obscurely', async () => {
      const tenant = await signUp();

      const refused = await tenant
        .as(app.http.post(LOCATION_PATHS.locations))
        .send({ code: 'WH 1!', name: '' })
        .expect(422);

      expect(refused.body.fields).toHaveProperty('code');
      expect(refused.body.fields).toHaveProperty('name');
    });
  });

  describe('one code, one place', () => {
    it('refuses a second location with the same code, and says which box is at fault', async () => {
      const tenant = await signUp();
      await addLocation(tenant);

      const refused = await tenant
        .as(app.http.post(LOCATION_PATHS.locations))
        .send({ code: 'WH-1', name: 'Somewhere else' })
        .expect(409);

      expect(refused.body.code).toBe(LOCATION_ERROR_CODES.duplicateLocationCode);
      expect(refused.body.fields.code).toContain('WH-1');
    });

    /** The normalisation earning its keep: `wh-1` and `WH-1` are one code, not two. */
    it('refuses one that differs only in case', async () => {
      const tenant = await signUp();
      await addLocation(tenant);

      await tenant
        .as(app.http.post(LOCATION_PATHS.locations))
        .send({ code: 'wh-1', name: 'Somewhere else' })
        .expect(409);
    });

    it('refuses an edit that would collide with another location', async () => {
      const tenant = await signUp();
      await addLocation(tenant);
      const van = await addLocation(tenant, { code: 'VAN-1', name: 'Delivery van' });

      const refused = await change(tenant, van.id, { code: 'WH-1' }, 409);
      expect(refused.code).toBe(LOCATION_ERROR_CODES.duplicateLocationCode);
    });

    /**
     * Unique *within* a company, which is the whole claim. Two businesses both calling
     * somewhere `WH-1` is not a collision, and a global constraint would make one of them
     * rename their warehouse because of somebody they have never met.
     */
    it('lets another company use the same code', async () => {
      const northwind = await signUp();
      const acme = await signUp({
        companyName: 'Acme',
        name: 'Bo Lindqvist',
        email: 'bo@acme.test',
      });

      await addLocation(northwind);
      await addLocation(acme);

      expect((await listLocations(acme)).items.map((item) => item.code)).toEqual(['WH-1']);
    });
  });

  describe('editing and deactivating', () => {
    it('corrects a code and a name', async () => {
      const tenant = await signUp();
      const created = await addLocation(tenant);

      const changed = await change(tenant, created.id, { code: 'WH-2', name: 'North warehouse' });

      expect(changed).toMatchObject({ code: 'WH-2', name: 'North warehouse' });
      expect((await listLocations(tenant)).items).toEqual([changed]);
    });

    it('refuses a change that changes nothing rather than pretending to have made one', async () => {
      const tenant = await signUp();
      const created = await addLocation(tenant);

      await change(tenant, created.id, {}, 422);
    });

    it('deactivates rather than deleting, and keeps the record', async () => {
      const tenant = await signUp();
      const created = await addLocation(tenant);

      const closed = await change(tenant, created.id, { status: 'inactive' });
      expect(closed.status).toBe('inactive');

      // Still there, still findable by its identifier — which is what makes every movement
      // that will name it intelligible.
      await tenant.as(app.http.get(LOCATION_PATHS.location(created.id))).expect(200);
      await tenant.as(app.http.delete(LOCATION_PATHS.location(created.id))).expect(404);

      // And still in the list, because a deactivated location is a fact about the company
      // rather than a row to hide. The screen filters by status; the endpoint does not decide
      // that on its behalf.
      expect((await listLocations(tenant)).items.map((item) => item.status)).toEqual(['inactive']);
    });

    it('brings one back, because closing somewhere is not a decision that has to be final', async () => {
      const tenant = await signUp();
      const created = await addLocation(tenant);

      await change(tenant, created.id, { status: 'inactive' });
      const reopened = await change(tenant, created.id, { status: 'active' });

      expect(reopened.status).toBe('active');
    });

    it('filters the list by status, which is how a screen shows only what is in use', async () => {
      const tenant = await signUp();
      const warehouse = await addLocation(tenant);
      await addLocation(tenant, { code: 'VAN-1', name: 'Delivery van' });
      await change(tenant, warehouse.id, { status: 'inactive' });

      const active = await listLocations(tenant, { filters: { status: 'active' } });
      expect(active.items.map((item) => item.code)).toEqual(['VAN-1']);
    });
  });

  describe('one company cannot see another', () => {
    it('is not a filter any of this code writes', async () => {
      const northwind = await signUp();
      const acme = await signUp({
        companyName: 'Acme',
        name: 'Bo Lindqvist',
        email: 'bo@acme.test',
      });

      const theirs = await addLocation(northwind, { code: 'WH-9', name: 'Theirs' });
      await addLocation(acme, { code: 'WH-1', name: 'Ours' });

      expect((await listLocations(acme)).items.map((item) => item.name)).toEqual(['Ours']);

      // By its own identifier, which is the case a list filter would not cover: the id is
      // real, and the answer is the one a made-up id gets.
      await acme.as(app.http.get(LOCATION_PATHS.location(theirs.id))).expect(404);
      await acme
        .as(app.http.patch(LOCATION_PATHS.location(theirs.id)))
        .send({ name: 'Mine now' })
        .expect(404);

      // Untouched, which is the assertion the 404 above cannot make on its own: a write that
      // happened and was then refused would look identical from the far side.
      const untouched = await northwind
        .as(app.http.get(LOCATION_PATHS.location(theirs.id)))
        .expect(200);
      expect((untouched.body as LocationResponse).name).toBe('Theirs');
    });
  });
});
