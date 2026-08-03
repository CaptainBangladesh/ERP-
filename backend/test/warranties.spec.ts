import {
  AUTH_PATHS,
  ERROR_CODES,
  NAVIGATION_PATH,
  PRODUCT_PATHS,
  UNIT_PATHS,
  WARRANTY_ERROR_CODES,
  WARRANTY_PATHS,
  listPath,
  type AuthenticatedSession,
  type NavigationResponse,
  type ProductResponse,
  type SignUpRequest,
  type WarrantyListResponse,
  type WarrantyResponse,
} from '@erp/shared';
import { createTestApp, resetDatabase, type TestApp } from './harness/test-app';
import { createFactories, type Factories } from './harness/factories';

/**
 * Warranties — the add-on shape stub — over HTTP, against a real database.
 *
 * Two claims this file exists to prove, on top of the ordinary CRUD-and-isolation shape every
 * generated module already gets: it genuinely reads through `products`' public contract rather
 * than a private shortcut, and it is genuinely unavailable below the Custom tier it was
 * generated at. Neither is something a hand-rolled test could fake past — the product's name
 * only appears at all if `ProductCatalogue` was actually asked, and the tier refusal only
 * happens if `AccessGuard` really is comparing the company's tier against this module's.
 */
describe('warranties', () => {
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

  /** Custom is the tier the module was generated at; most of this file needs to reach it. */
  async function custom(tenant: Tenant): Promise<Tenant> {
    await factories.setTier(tenant.session.company.id, 'custom');
    return tenant;
  }

  async function addProduct(tenant: Tenant, code = 'WIDGET-1'): Promise<ProductResponse> {
    const unit = await tenant
      .as(app.http.post(UNIT_PATHS.units))
      .send({ code: 'each', name: 'Each' })
      .expect(201);

    const product = await tenant
      .as(app.http.post(PRODUCT_PATHS.products))
      .send({ code, name: 'Widget', unitId: (unit.body as { id: string }).id })
      .expect(201);

    return product.body as ProductResponse;
  }

  async function addWarranty(
    tenant: Tenant,
    body: Record<string, unknown>,
  ): Promise<WarrantyResponse> {
    const response = await tenant
      .as(app.http.post(WARRANTY_PATHS.warranties))
      .send(body)
      .expect(201);

    return response.body as WarrantyResponse;
  }

  describe('extending products through its public contract', () => {
    it('resolves the product name through ProductCatalogue rather than storing it', async () => {
      const tenant = await custom(await signUp());
      const product = await addProduct(tenant);

      const warranty = await addWarranty(tenant, { productId: product.id, months: 24 });
      expect(warranty.productId).toBe(product.id);
      expect(warranty.productName).toBe('Widget');

      const listed = await tenant.as(app.http.get(WARRANTY_PATHS.warranties)).expect(200);
      expect((listed.body as WarrantyListResponse).items[0]?.productName).toBe('Widget');
    });

    it('refuses a product id that does not resolve for this company', async () => {
      const tenant = await custom(await signUp());

      const response = await tenant
        .as(app.http.post(WARRANTY_PATHS.warranties))
        .send({ productId: '0b6d2b3e-0000-4000-8000-000000000000', months: 12 })
        .expect(404);

      expect(response.body.code).toBe(WARRANTY_ERROR_CODES.warrantyProductNotFound);
    });

    it('does not resolve a product belonging to a different company', async () => {
      const northwind = await custom(await signUp());
      const acme = await custom(
        await signUp({ companyName: 'Acme', name: 'Bo Lindqvist', email: 'bo@acme.test' }),
      );
      const acmesProduct = await addProduct(acme);

      const response = await northwind
        .as(app.http.post(WARRANTY_PATHS.warranties))
        .send({ productId: acmesProduct.id, months: 12 })
        .expect(404);

      expect(response.body.code).toBe(WARRANTY_ERROR_CODES.warrantyProductNotFound);
    });
  });

  describe('the shape every generated module gets', () => {
    it('records one, and lists it in the envelope every list endpoint returns', async () => {
      const tenant = await custom(await signUp());
      const product = await addProduct(tenant);
      await addWarranty(tenant, { productId: product.id, months: 24 });

      const response = await tenant
        .as(app.http.get(listPath(WARRANTY_PATHS.warranties, { pageSize: 10 })))
        .expect(200);

      const listed = response.body as WarrantyListResponse;
      expect(listed.items.map((item) => item.months)).toEqual([24]);
      expect(listed.page).toEqual({ number: 1, size: 10, total: 1, pages: 1 });
    });

    it('says what is wrong with the input rather than failing obscurely', async () => {
      const tenant = await custom(await signUp());
      const product = await addProduct(tenant);

      const refused = await tenant
        .as(app.http.post(WARRANTY_PATHS.warranties))
        .send({ productId: product.id, months: 0 })
        .expect(422);

      expect(refused.body.fields).toHaveProperty('months');
    });

    it('deactivates rather than deleting, and keeps the record', async () => {
      const tenant = await custom(await signUp());
      const product = await addProduct(tenant);
      const created = await addWarranty(tenant, { productId: product.id, months: 12 });

      const changed = await tenant
        .as(app.http.patch(WARRANTY_PATHS.warranty(created.id)))
        .send({ status: 'inactive' })
        .expect(200);

      expect((changed.body as WarrantyResponse).status).toBe('inactive');
      // Still there, still findable by its identifier — which is what makes anything naming
      // it later intelligible.
      await tenant.as(app.http.get(WARRANTY_PATHS.warranty(created.id))).expect(200);
      await tenant.as(app.http.delete(WARRANTY_PATHS.warranty(created.id))).expect(404);
    });

    it('is not a filter any of this code writes, and one company cannot see another', async () => {
      const northwind = await custom(await signUp());
      const acme = await custom(
        await signUp({ companyName: 'Acme', name: 'Bo Lindqvist', email: 'bo@acme.test' }),
      );

      const northwindsProduct = await addProduct(northwind);
      const acmesProduct = await addProduct(acme);

      const theirs = await addWarranty(northwind, { productId: northwindsProduct.id, months: 6 });
      await addWarranty(acme, { productId: acmesProduct.id, months: 12 });

      const listed = await acme.as(app.http.get(WARRANTY_PATHS.warranties)).expect(200);
      expect((listed.body as WarrantyListResponse).items.map((item) => item.months)).toEqual([12]);

      // By its own identifier, which is the case a list filter would not cover: the id is real,
      // and the answer is the one a made-up id gets.
      await acme.as(app.http.get(WARRANTY_PATHS.warranty(theirs.id))).expect(404);
    });
  });

  describe('unavailable below the tier it was generated at', () => {
    it('refuses every one of its endpoints at core tier, with a reason naming the plan', async () => {
      const tenant = await signUp(); // core, the default — never bumped in this test

      const response = await tenant.as(app.http.get(WARRANTY_PATHS.warranties)).expect(403);
      expect(response.body.code).toBe(ERROR_CODES.moduleUnavailable);

      await tenant
        .as(app.http.post(WARRANTY_PATHS.warranties))
        .send({ productId: '0b6d2b3e-0000-4000-8000-000000000000', months: 12 })
        .expect(403);
    });

    it('is absent from navigation at core tier and present at custom tier', async () => {
      const tenant = await signUp();

      const atCore = await tenant.as(app.http.get(NAVIGATION_PATH)).expect(200);
      expect(
        (atCore.body as NavigationResponse).entries.map((entry) => entry.module),
      ).not.toContain('warranties');

      await factories.setTier(tenant.session.company.id, 'custom');

      const atCustom = await tenant.as(app.http.get(NAVIGATION_PATH)).expect(200);
      expect(
        (atCustom.body as NavigationResponse).entries.map((entry) => entry.module),
      ).toContain('warranties');
    });

    it('becomes reachable the moment the company is raised to custom tier, on the same running application', async () => {
      const tenant = await signUp();
      const product = await addProduct(tenant);

      await tenant
        .as(app.http.post(WARRANTY_PATHS.warranties))
        .send({ productId: product.id, months: 12 })
        .expect(403);

      // No restart: the same app instance, the same session token, one row changed underneath
      // it. `AccessGuard` reads the company's tier fresh from the database on every request.
      await factories.setTier(tenant.session.company.id, 'custom');

      await tenant
        .as(app.http.post(WARRANTY_PATHS.warranties))
        .send({ productId: product.id, months: 12 })
        .expect(201);
    });

    it('remains available to products even when warranties itself is not', async () => {
      // The converse of dependency-driven unavailability: warranties (custom) depends on
      // products (core), and a core-tier company reaches products fine while warranties alone
      // is refused. Tiers are totally ordered and `assembleModules` already refuses a module
      // depending on a higher tier than its own, so a module's dependency is never itself
      // unavailable to a company that can reach the module — there is no lower state for
      // 'products' to be missing from once 'warranties' is reachable at custom tier.
      const tenant = await signUp(); // core

      await tenant.as(app.http.get(PRODUCT_PATHS.products)).expect(200);
      await tenant.as(app.http.get(WARRANTY_PATHS.warranties)).expect(403);
    });
  });
});
