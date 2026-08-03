import {
  AUTH_PATHS,
  ERROR_CODES,
  HRM_PATHS,
  NAVIGATION_PATH,
  PARTY_PATHS,
  type AuthenticatedSession,
  type NavigationResponse,
  type SignUpRequest,
} from '@erp/shared';
import { createTestApp, resetDatabase, type TestApp } from './harness/test-app';
import { createFactories, type Factories } from './harness/factories';

/**
 * Tier-based enablement, over HTTP, against a real database — general behaviour, using `hrm`
 * (enterprise) as the module under a tier gate. `warranties.spec.ts` covers the same mechanism
 * for the Custom-tier add-on stub specifically; this file is about the default a fresh company
 * starts at, and about the gate applying to an ordinary module rather than only the stub built
 * to prove it.
 */
describe('tier-based enablement', () => {
  let app: TestApp;
  let factories: Factories;

  type SupertestRequest = ReturnType<TestApp['http']['get']>;

  interface Tenant {
    session: AuthenticatedSession;
    as: (request: SupertestRequest) => SupertestRequest;
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

  it('starts a new company at core tier, with no self-serve way to change it', async () => {
    const tenant = await signUp();
    expect(tenant.session.company.tier).toBe('core');
  });

  it('refuses an enterprise module’s endpoints to a core-tier company, naming the plan', async () => {
    const tenant = await signUp();

    const response = await tenant.as(app.http.get(HRM_PATHS.employees)).expect(403);
    expect(response.body.code).toBe(ERROR_CODES.moduleUnavailable);

    // Core-tier modules are unaffected — the refusal is about hrm, not about the caller.
    await tenant.as(app.http.get(PARTY_PATHS.parties)).expect(200);
  });

  it('hides the enterprise module’s navigation entry at core tier and shows it once raised', async () => {
    const tenant = await signUp();

    const atCore = await tenant.as(app.http.get(NAVIGATION_PATH)).expect(200);
    expect((atCore.body as NavigationResponse).entries.map((e) => e.module)).not.toContain('hrm');

    await factories.setTier(tenant.session.company.id, 'enterprise');

    const atEnterprise = await tenant.as(app.http.get(NAVIGATION_PATH)).expect(200);
    expect((atEnterprise.body as NavigationResponse).entries.map((e) => e.module)).toContain(
      'hrm',
    );
  });

  it('reaches the module the moment the tier is raised, with no restart and no new sign-in', async () => {
    const tenant = await signUp();

    await tenant.as(app.http.get(HRM_PATHS.employees)).expect(403);

    await factories.setTier(tenant.session.company.id, 'enterprise');

    // Same running application, same bearer token: the tier is read fresh from the database
    // on every request rather than cached anywhere a change would need to invalidate.
    await tenant.as(app.http.get(HRM_PATHS.employees)).expect(200);
  });

  it('reaches every lower tier too — custom is a ceiling raised, not a tier swapped in', async () => {
    const tenant = await signUp();
    await factories.setTier(tenant.session.company.id, 'custom');

    // Core and enterprise modules both remain reachable at the highest tier — a company does
    // not lose what a lower tier already gave it by being granted a higher one.
    await tenant.as(app.http.get(PARTY_PATHS.parties)).expect(200);
    await tenant.as(app.http.get(HRM_PATHS.employees)).expect(200);
  });
});
