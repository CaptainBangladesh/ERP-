import {
  AUTH_PATHS,
  MARKETING_PATHS,
  listPath,
  type AuthenticatedSession,
  type MarketingListResponse,
  type MarketingResponse,
  type SignUpRequest,
} from '@erp/shared';
import { createTestApp, resetDatabase, type TestApp } from './harness/test-app';

/**
 * Marketing, over HTTP, against a real database. Nothing is mocked and
 * nothing reaches below the endpoint.
 *
 * Two companies are signed up in the isolation test rather than one, because "a row belongs
 * to a company" is a claim you cannot make with only one company in the database: every query
 * would pass whether or not scoping worked at all.
 */
describe('marketing', () => {
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

  async function add(tenant: Tenant, name: string): Promise<MarketingResponse> {
    const response = await tenant
      .as(app.http.post(MARKETING_PATHS.marketings))
      .send({ name })
      .expect(201);

    return response.body as MarketingResponse;
  }

  it('records one, and lists it in the envelope every list endpoint returns', async () => {
    const tenant = await signUp();
    await add(tenant, 'First');

    const response = await tenant
      .as(app.http.get(listPath(MARKETING_PATHS.marketings, { pageSize: 10 })))
      .expect(200);

    const listed = response.body as MarketingListResponse;
    expect(listed.items.map((item) => item.name)).toEqual(['First']);
    expect(listed.page).toEqual({ number: 1, size: 10, total: 1, pages: 1 });
  });

  it('says what is wrong with the input rather than failing obscurely', async () => {
    const tenant = await signUp();

    const refused = await tenant
      .as(app.http.post(MARKETING_PATHS.marketings))
      .send({ name: '' })
      .expect(422);

    expect(refused.body.fields).toHaveProperty('name');
  });

  it('deactivates rather than deleting, and keeps the record', async () => {
    const tenant = await signUp();
    const created = await add(tenant, 'First');

    const changed = await tenant
      .as(app.http.patch(MARKETING_PATHS.marketing(created.id)))
      .send({ status: 'inactive' })
      .expect(200);

    expect((changed.body as MarketingResponse).status).toBe('inactive');
    // Still there, still findable by its identifier — which is what makes anything naming it
    // later intelligible.
    await tenant.as(app.http.get(MARKETING_PATHS.marketing(created.id))).expect(200);
    await tenant.as(app.http.delete(MARKETING_PATHS.marketing(created.id))).expect(404);
  });

  it('is not a filter any of this code writes, and one company cannot see another', async () => {
    const northwind = await signUp();
    const acme = await signUp({ companyName: 'Acme', name: 'Bo Lindqvist', email: 'bo@acme.test' });

    const theirs = await add(northwind, 'Theirs');
    await add(acme, 'Ours');

    const listed = await acme.as(app.http.get(MARKETING_PATHS.marketings)).expect(200);
    expect((listed.body as MarketingListResponse).items.map((item) => item.name)).toEqual(['Ours']);

    // By its own identifier, which is the case a list filter would not cover: the id is real,
    // and the answer is the one a made-up id gets.
    await acme.as(app.http.get(MARKETING_PATHS.marketing(theirs.id))).expect(404);
  });
});
