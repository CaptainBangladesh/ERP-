import {
  AUTH_PATHS,
  PARTY_PATHS,
  PRODUCT_ERROR_CODES,
  PRODUCT_PATHS,
  Quantity,
  UNIT_PATHS,
  listPath,
  type AuthenticatedSession,
  type PartyResponse,
  type ProductListResponse,
  type ProductResponse,
  type ProductSummary,
  type SignUpRequest,
  type UnitGroupsResponse,
  type UnitListResponse,
  type UnitSummary,
} from '@erp/shared';
import { ProductCatalogue } from '../src/modules/products';
import { createTestApp, resetDatabase, type TestApp } from './harness/test-app';

/**
 * The product master, over HTTP, against a real database.
 *
 * Nothing is mocked and nothing reaches below the endpoint, except the one block that asks the
 * module's public surface directly — because a contract inventory is about to consume is not
 * reachable over HTTP, and "another module can read a product without touching its tables" is
 * precisely the claim worth testing.
 *
 * Every test starts by creating a unit, and that is not ceremony: nothing in this system is
 * seeded, so a company that has not said what it measures things in cannot yet have a product.
 * The first assertion in the file is that the unit list of a brand new company is empty.
 */
describe('products', () => {
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

  async function addUnit(tenant: Tenant, body: Record<string, unknown>): Promise<UnitSummary> {
    const response = await tenant
      .as(app.http.post(UNIT_PATHS.units))
      .send({ code: 'each', name: 'Each', ...body })
      .expect(201);

    return response.body as UnitSummary;
  }

  async function addGroup(tenant: Tenant, name: string): Promise<string> {
    const response = await tenant
      .as(app.http.post(UNIT_PATHS.groups))
      .send({ name })
      .expect(201);

    const created = (response.body as UnitGroupsResponse).groups.find(
      (group) => group.name === name,
    );
    return created!.id;
  }

  async function addProduct(
    tenant: Tenant,
    body: Record<string, unknown> = {},
  ): Promise<ProductResponse> {
    const unitId = body.unitId ?? (await addUnit(tenant, {})).id;

    const response = await tenant
      .as(app.http.post(PRODUCT_PATHS.products))
      .send({ code: 'WIDGET-1', name: 'Widget', unitId, ...body })
      .expect(201);

    return response.body as ProductResponse;
  }

  async function listProducts(tenant: Tenant, query = {}): Promise<ProductListResponse> {
    const response = await tenant
      .as(app.http.get(listPath(PRODUCT_PATHS.products, query)))
      .expect(200);

    return response.body as ProductListResponse;
  }

  describe('units of measure', () => {
    it('starts with none, and takes the ones this business actually uses', async () => {
      const tenant = await signUp();

      // Nothing is seeded, here least of all. A business dealing in metres and one dealing in
      // pallets should not both begin with a list somebody else guessed at.
      const empty = await tenant.as(app.http.get(UNIT_PATHS.units)).expect(200);
      expect((empty.body as UnitListResponse).items).toEqual([]);

      const kilogram = await addUnit(tenant, { code: 'kg', name: 'Kilogram' });
      expect(kilogram).toMatchObject({ code: 'kg', name: 'Kilogram', status: 'active', ratio: '1' });

      const listed = await tenant.as(app.http.get(UNIT_PATHS.units)).expect(200);
      expect((listed.body as UnitListResponse).items.map((unit) => unit.code)).toEqual(['kg']);
    });

    it('keeps the case somebody typed, because kWh is not KWH', async () => {
      const tenant = await signUp();

      const unit = await addUnit(tenant, { code: 'kWh', name: 'Kilowatt hour' });
      expect(unit.code).toBe('kWh');
    });

    it('refuses a second unit with the same code, naming the input', async () => {
      const tenant = await signUp();
      await addUnit(tenant, { code: 'kg', name: 'Kilogram' });

      const refused = await tenant
        .as(app.http.post(UNIT_PATHS.units))
        .send({ code: 'kg', name: 'Kilogrammes' })
        .expect(409);

      expect(refused.body.code).toBe(PRODUCT_ERROR_CODES.duplicateUnitCode);
      expect(refused.body.fields.code).toMatch(/already/i);
    });

    it('refuses a code that could not be a symbol', async () => {
      const tenant = await signUp();

      const refused = await tenant
        .as(app.http.post(UNIT_PATHS.units))
        .send({ code: '', name: 'Nameless' })
        .expect(422);

      expect(refused.body.fields).toHaveProperty('code');
    });

    describe('groups, so related units convert', () => {
      async function weights(tenant: Tenant) {
        const groupId = await addGroup(tenant, 'Weight');
        const gram = await addUnit(tenant, { code: 'g', name: 'Gram', groupId, ratio: '1' });
        const kilogram = await addUnit(tenant, {
          code: 'kg',
          name: 'Kilogram',
          groupId,
          ratio: '1000',
        });

        return { groupId, gram, kilogram };
      }

      it('reports a group with its units, smallest first', async () => {
        const tenant = await signUp();
        await weights(tenant);

        const response = await tenant.as(app.http.get(UNIT_PATHS.groups)).expect(200);
        const [group] = (response.body as UnitGroupsResponse).groups;

        expect(group?.name).toBe('Weight');
        // Ascending by ratio, so the group reads from its smallest unit to its largest —
        // which is also the order somebody checking the numbers would write them in.
        expect(group?.units.map((unit) => `${unit.code}=${unit.ratio}`)).toEqual([
          'g=1',
          'kg=1000',
        ]);
      });

      it('refuses a ratio on a unit that belongs to no group', async () => {
        const tenant = await signUp();

        const refused = await tenant
          .as(app.http.post(UNIT_PATHS.units))
          .send({ code: 'each', name: 'Each', ratio: '12' })
          .expect(422);

        // A ratio says how many of the *group's* base unit one of these is. A unit in no group
        // has nothing to be a ratio of, so a number here is somebody misunderstanding rather
        // than something to store.
        expect(refused.body.fields.ratio).toMatch(/no group/i);
      });

      it('refuses a ratio of zero, which every conversion would divide by', async () => {
        const tenant = await signUp();
        const groupId = await addGroup(tenant, 'Weight');

        const refused = await tenant
          .as(app.http.post(UNIT_PATHS.units))
          .send({ code: 'g', name: 'Gram', groupId, ratio: '0' })
          .expect(422);

        expect(refused.body.fields.ratio).toMatch(/more than zero/i);
      });

      it('refuses to deactivate a unit that products are measured in', async () => {
        const tenant = await signUp();
        const { kilogram } = await weights(tenant);
        const flour = await addProduct(tenant, { unitId: kilogram.id });

        const refused = await tenant
          .as(app.http.patch(UNIT_PATHS.unit(kilogram.id)))
          .send({ status: 'inactive' })
          .expect(409);

        // The alternative — letting it go inactive and leaving the product pointing at it —
        // produces a catalogue measured in something the unit screen says is not in use.
        expect(refused.body.code).toBe(PRODUCT_ERROR_CODES.unitInUse);
        expect(refused.body.message).toMatch(/1 active product is measured/i);

        // And the way out that the message names actually works. Counting active products only
        // is what makes the advice followable: deactivating everything measured in a unit is
        // exactly how somebody stops measuring things that way, and a refusal that still
        // refused afterwards would be a dead end.
        await tenant
          .as(app.http.patch(PRODUCT_PATHS.product(flour.id)))
          .send({ status: 'inactive' })
          .expect(200);

        const allowed = await tenant
          .as(app.http.patch(UNIT_PATHS.unit(kilogram.id)))
          .send({ status: 'inactive' })
          .expect(200);
        expect((allowed.body as UnitSummary).status).toBe('inactive');
      });

      it('refuses a ratio on a unit taken out of its group, as creation does', async () => {
        const tenant = await signUp();
        const each = await addUnit(tenant, { code: 'each', name: 'Each' });

        // Without this the PATCH would be a way round the rule creation enforces, and the
        // unit would end up with a ratio of nothing in particular.
        const refused = await tenant
          .as(app.http.patch(UNIT_PATHS.unit(each.id)))
          .send({ ratio: '12' })
          .expect(422);

        expect(refused.body.fields.ratio).toMatch(/no group/i);
      });

      it('changes a ratio within a group', async () => {
        const tenant = await signUp();
        const { kilogram } = await weights(tenant);

        const changed = await tenant
          .as(app.http.patch(UNIT_PATHS.unit(kilogram.id)))
          .send({ ratio: '1000.5' })
          .expect(200);

        expect((changed.body as UnitSummary).ratio).toBe('1000.5');
      });

      it('deactivates a unit nothing is measured in, rather than deleting it', async () => {
        const tenant = await signUp();
        const { gram } = await weights(tenant);

        const changed = await tenant
          .as(app.http.patch(UNIT_PATHS.unit(gram.id)))
          .send({ status: 'inactive' })
          .expect(200);

        expect((changed.body as UnitSummary).status).toBe('inactive');
        // Still there: every quantity ever recorded in grams still has to mean something.
        await tenant.as(app.http.get(UNIT_PATHS.unit(gram.id))).expect(200);
      });

      it('refuses to measure a new product in a unit nobody uses any more', async () => {
        const tenant = await signUp();
        const { gram } = await weights(tenant);

        await tenant
          .as(app.http.patch(UNIT_PATHS.unit(gram.id)))
          .send({ status: 'inactive' })
          .expect(200);

        const refused = await tenant
          .as(app.http.post(PRODUCT_PATHS.products))
          .send({ code: 'FLOUR', name: 'Flour', unitId: gram.id })
          .expect(422);

        expect(refused.body.fields.unitId).toMatch(/still in use/i);
      });
    });
  });

  describe('creating a product', () => {
    it('records a code, a name and a unit', async () => {
      const tenant = await signUp();
      const unit = await addUnit(tenant, { code: 'kg', name: 'Kilogram' });

      const product = await addProduct(tenant, { unitId: unit.id, name: 'Flour', code: 'FLOUR' });

      expect(product).toMatchObject({
        code: 'FLOUR',
        name: 'Flour',
        status: 'active',
        stockable: true,
        unitId: unit.id,
        unitCode: 'kg',
        unitName: 'Kilogram',
        cost: null,
        suppliers: [],
      });
    });

    it('stores a code upper case, so one SKU cannot be two products', async () => {
      const tenant = await signUp();

      const product = await addProduct(tenant, { code: 'widget-1' });
      expect(product.code).toBe('WIDGET-1');

      const refused = await tenant
        .as(app.http.post(PRODUCT_PATHS.products))
        .send({ code: 'WIDGET-1', name: 'Widget again', unitId: product.unitId })
        .expect(409);

      expect(refused.body.code).toBe(PRODUCT_ERROR_CODES.duplicateProductCode);
      expect(refused.body.fields.code).toMatch(/already/i);
    });

    it('says what is wrong with every field at once', async () => {
      const tenant = await signUp();

      const refused = await tenant
        .as(app.http.post(PRODUCT_PATHS.products))
        .send({ code: 'a widget', name: '', unitId: 'not-an-identifier' })
        .expect(422);

      expect(Object.keys(refused.body.fields).sort()).toEqual(['code', 'name', 'unitId']);
    });

    it('refuses a unit that is not this company’s', async () => {
      const tenant = await signUp();
      const acme = await signUp({
        companyName: 'Acme',
        name: 'Bo Lindqvist',
        email: 'bo@acme.test',
      });
      const theirs = await addUnit(acme, { code: 'kg', name: 'Kilogram' });

      // The same 404 a made-up identifier gets. Telling a caller that a unit is real but not
      // theirs would turn the endpoint into a way of counting somebody else's.
      await tenant
        .as(app.http.post(PRODUCT_PATHS.products))
        .send({ code: 'FLOUR', name: 'Flour', unitId: theirs.id })
        .expect(404);
    });

    it('holds a product that is not stocked at all', async () => {
      const tenant = await signUp();
      const hour = await addUnit(tenant, { code: 'hour', name: 'Hour' });

      // A delivery charge and an hour of consultancy are products with prices and no shelf. A
      // catalogue that could not hold them would push every module that needs one into
      // inventing its own.
      const consultancy = await addProduct(tenant, {
        code: 'CONSULT',
        name: 'Consultancy',
        unitId: hour.id,
        stockable: false,
      });

      expect(consultancy.stockable).toBe(false);
    });
  });

  describe('cost', () => {
    it('records an exact amount, in the shared money primitive', async () => {
      const tenant = await signUp();

      const product = await addProduct(tenant, { cost: '12.50' });

      // A money value and not a number: the currency travels with the amount, and the amount
      // is text because a JSON number is a double and loses pennies.
      expect(product.cost).toEqual({ amount: '12.50', currency: 'GBP' });
    });

    it('takes the wire shape as well as bare decimal text', async () => {
      const tenant = await signUp();

      const product = await addProduct(tenant, { cost: { amount: '9.99', currency: 'GBP' } });
      expect(product.cost).toEqual({ amount: '9.99', currency: 'GBP' });
    });

    it('refuses a JSON number, a negative amount, and a third penny', async () => {
      const tenant = await signUp();
      const unit = await addUnit(tenant, {});

      async function refuse(cost: unknown): Promise<string> {
        const response = await tenant
          .as(app.http.post(PRODUCT_PATHS.products))
          .send({ code: 'WIDGET-1', name: 'Widget', unitId: unit.id, cost })
          .expect(422);

        return response.body.fields.cost;
      }

      // A double cannot hold every value the column can, so accepting one would lose precision
      // before validation had a chance to look at it.
      expect(await refuse(12.5)).toMatch(/amount/i);
      expect(await refuse('-1.00')).toMatch(/negative/i);
      expect(await refuse('12.505')).toMatch(/decimal place/i);
    });

    it('changes a cost, and leaves it alone when the field is not sent', async () => {
      const tenant = await signUp();
      const product = await addProduct(tenant, { cost: '12.50' });

      const renamed = await tenant
        .as(app.http.patch(PRODUCT_PATHS.product(product.id)))
        .send({ name: 'Widget, large' })
        .expect(200);

      // Absent means "do not touch it". A PATCH that quietly cleared every field it did not
      // mention would make correcting a name an act with consequences nobody asked for.
      expect((renamed.body as ProductResponse).cost).toEqual({ amount: '12.50', currency: 'GBP' });

      const repriced = await tenant
        .as(app.http.patch(PRODUCT_PATHS.product(product.id)))
        .send({ cost: '13.00' })
        .expect(200);

      expect((repriced.body as ProductResponse).cost).toEqual({ amount: '13.00', currency: 'GBP' });
    });
  });

  describe('editing and deactivating', () => {
    it('corrects the details somebody typed wrong', async () => {
      const tenant = await signUp();
      const product = await addProduct(tenant, { code: 'WIDJET', name: 'Widgit' });
      const box = await addUnit(tenant, { code: 'box', name: 'Box' });

      const corrected = await tenant
        .as(app.http.patch(PRODUCT_PATHS.product(product.id)))
        .send({ code: 'WIDGET', name: 'Widget', unitId: box.id })
        .expect(200);

      expect(corrected.body).toMatchObject({ code: 'WIDGET', name: 'Widget', unitCode: 'box' });
    });

    it('keeps the record and stops it being active, rather than deleting it', async () => {
      const tenant = await signUp();
      const product = await addProduct(tenant);

      const deactivated = await tenant
        .as(app.http.patch(PRODUCT_PATHS.product(product.id)))
        .send({ status: 'inactive' })
        .expect(200);
      expect((deactivated.body as ProductResponse).status).toBe('inactive');

      // Still there, still findable by its identifier — which is what makes three years of
      // movements naming it intelligible.
      await tenant.as(app.http.get(PRODUCT_PATHS.product(product.id))).expect(200);

      const reactivated = await tenant
        .as(app.http.patch(PRODUCT_PATHS.product(product.id)))
        .send({ status: 'active' })
        .expect(200);
      expect((reactivated.body as ProductResponse).status).toBe('active');
    });

    it('offers no way to delete a product at all', async () => {
      const tenant = await signUp();
      const product = await addProduct(tenant);

      // Not having the route is the point.
      await tenant.as(app.http.delete(PRODUCT_PATHS.product(product.id))).expect(404);
    });

    it('refuses a change that changes nothing', async () => {
      const tenant = await signUp();
      const product = await addProduct(tenant);

      await tenant.as(app.http.patch(PRODUCT_PATHS.product(product.id))).send({}).expect(422);
    });
  });

  describe('searching and filtering the catalogue', () => {
    async function catalogueOfThree(tenant: Tenant) {
      const unit = await addUnit(tenant, { code: 'kg', name: 'Kilogram' });
      const hour = await addUnit(tenant, { code: 'hour', name: 'Hour' });

      await addProduct(tenant, { code: 'FLOUR', name: 'Flour, plain', unitId: unit.id });
      await addProduct(tenant, { code: 'SUGAR', name: 'Sugar, caster', unitId: unit.id });
      await addProduct(tenant, {
        code: 'CONSULT',
        name: 'Consultancy',
        unitId: hour.id,
        stockable: false,
      });

      return { unit, hour };
    }

    it('searches codes and names together', async () => {
      const tenant = await signUp();
      await catalogueOfThree(tenant);

      // Half a SKU or half a name, whichever the person at the screen remembers.
      expect((await listProducts(tenant, { search: 'flour' })).items.map((p) => p.code)).toEqual([
        'FLOUR',
      ]);
      expect((await listProducts(tenant, { search: 'consult' })).items.map((p) => p.code)).toEqual([
        'CONSULT',
      ]);
    });

    it('filters by status, by unit and by whether stock of it is counted', async () => {
      const tenant = await signUp();
      const { unit } = await catalogueOfThree(tenant);

      expect(
        (await listProducts(tenant, { filters: { unitId: unit.id } })).items.map((p) => p.code),
      ).toEqual(['FLOUR', 'SUGAR']);
      expect(
        (await listProducts(tenant, { filters: { stockable: 'false' } })).items.map((p) => p.code),
      ).toEqual(['CONSULT']);
      expect(
        (await listProducts(tenant, { filters: { status: 'active' } })).items,
      ).toHaveLength(3);
    });

    it('returns the one envelope every list endpoint returns, ordered by code', async () => {
      const tenant = await signUp();
      await catalogueOfThree(tenant);

      const page = await listProducts(tenant, { pageSize: 2 });
      expect(page.page).toEqual({ number: 1, size: 2, total: 3, pages: 2 });
      expect(page.items.map((p) => p.code)).toEqual(['CONSULT', 'FLOUR']);
    });
  });

  describe('who supplies it', () => {
    async function supplier(tenant: Tenant, name: string): Promise<PartyResponse> {
      const response = await tenant
        .as(app.http.post(PARTY_PATHS.parties))
        .send({ kind: 'organisation', name, roles: ['supplier'] })
        .expect(201);

      return response.body as PartyResponse;
    }

    it('links a party from the one address book, and reports their details from it', async () => {
      const tenant = await signUp();
      const product = await addProduct(tenant);
      const bakers = await supplier(tenant, 'Bakers Ltd');

      const linked = await tenant
        .as(app.http.post(PRODUCT_PATHS.suppliers(product.id)))
        .send({ partyId: bakers.id })
        .expect(200);

      // The name comes from Parties rather than from a copy taken when the link was made, so
      // correcting it there corrects it here by the same act.
      expect((linked.body as ProductResponse).suppliers).toEqual([
        { partyId: bakers.id, name: 'Bakers Ltd', email: null },
      ]);

      const again = await tenant
        .as(app.http.post(PRODUCT_PATHS.suppliers(product.id)))
        .send({ partyId: bakers.id })
        .expect(200);
      // Supplying something twice is not a different fact from supplying it once.
      expect((again.body as ProductResponse).suppliers).toHaveLength(1);
    });

    it('follows a merge, so linking a duplicate links the record that survived', async () => {
      const tenant = await signUp();
      const product = await addProduct(tenant);
      const bakers = await supplier(tenant, 'Bakers Ltd');
      const duplicate = await supplier(tenant, 'Bakers Limited');

      await tenant
        .as(app.http.post(PARTY_PATHS.merge(bakers.id)))
        .send({ duplicateId: duplicate.id })
        .expect(200);

      const linked = await tenant
        .as(app.http.post(PRODUCT_PATHS.suppliers(product.id)))
        .send({ partyId: duplicate.id })
        .expect(200);

      // `PartyDirectory` resolves the merge, so the catalogue never accumulates references the
      // address book has already superseded — and products never learns a merge happened.
      expect((linked.body as ProductResponse).suppliers.map((s) => s.partyId)).toEqual([bakers.id]);
    });

    it('refuses somebody who is not in the address book', async () => {
      const tenant = await signUp();
      const product = await addProduct(tenant);

      const refused = await tenant
        .as(app.http.post(PRODUCT_PATHS.suppliers(product.id)))
        .send({ partyId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' })
        .expect(422);

      expect(refused.body.code).toBe(PRODUCT_ERROR_CODES.notAParty);
    });

    it('unlinks one, and says so when there was nothing to unlink', async () => {
      const tenant = await signUp();
      const product = await addProduct(tenant);
      const bakers = await supplier(tenant, 'Bakers Ltd');

      await tenant
        .as(app.http.post(PRODUCT_PATHS.suppliers(product.id)))
        .send({ partyId: bakers.id })
        .expect(200);

      const unlinked = await tenant
        .as(app.http.delete(PRODUCT_PATHS.supplier(product.id, bakers.id)))
        .expect(200);
      expect((unlinked.body as ProductResponse).suppliers).toEqual([]);

      await tenant
        .as(app.http.delete(PRODUCT_PATHS.supplier(product.id, bakers.id)))
        .expect(404);
    });
  });

  describe('one company cannot see another’s catalogue', () => {
    it('is not a filter any of this code writes, and holds anyway', async () => {
      const northwind = await signUp();
      const acme = await signUp({
        companyName: 'Acme',
        name: 'Bo Lindqvist',
        email: 'bo@acme.test',
      });

      const theirs = await addProduct(northwind, { code: 'WIDGET-1' });

      // The same code, in another company, which is not a collision: a global constraint would
      // make one business rename its catalogue because of somebody they have never met.
      const ours = await addProduct(acme, { code: 'WIDGET-1' });
      expect(ours.code).toBe('WIDGET-1');

      expect((await listProducts(acme)).items.map((p) => p.id)).toEqual([ours.id]);

      // By its own identifier, which is the case a list filter would not cover.
      await acme.as(app.http.get(PRODUCT_PATHS.product(theirs.id))).expect(404);
      await acme
        .as(app.http.patch(PRODUCT_PATHS.product(theirs.id)))
        .send({ name: 'Mine' })
        .expect(404);

      // And the units, which are a different table with the same scoping.
      const units = await acme.as(app.http.get(UNIT_PATHS.units)).expect(200);
      expect((units.body as UnitListResponse).items).toHaveLength(1);
    });
  });

  /**
   * The module's public surface, asked directly.
   *
   * Not reachable over HTTP — it is what *other modules* use, and inventory does not exist yet
   * — so this is the one place in the file that resolves a provider from the container. What
   * is being asserted is the criterion: another module can read a product without touching its
   * tables. `ProductCatalogue` is imported from `src/modules/products`, which is the same
   * public surface a real consumer would import, and `ProductsService` is deliberately not
   * reachable from there at all.
   */
  describe('what other modules may ask', () => {
    async function inCompany<T>(tenant: Tenant, work: () => Promise<T>): Promise<T> {
      return app.tenancy.runInCompany(
        { companyId: tenant.session.company.id, grants: 'all' },
        work,
      );
    }

    it('reads a product by identifier and by code, with its unit and cost', async () => {
      const tenant = await signUp();
      const kilogram = await addUnit(tenant, { code: 'kg', name: 'Kilogram' });
      const flour = await addProduct(tenant, {
        code: 'FLOUR',
        name: 'Flour',
        unitId: kilogram.id,
        cost: '1.25',
      });

      const catalogue = app.nest.get(ProductCatalogue);

      expect(await inCompany(tenant, () => catalogue.product(flour.id))).toMatchObject({
        code: 'FLOUR',
        unitCode: 'kg',
        cost: { amount: '1.25', currency: 'GBP' },
      });

      // Lower case, because a consumer should not have to know that the code is stored
      // normalised — which is the sort of thing a public surface exists to absorb.
      expect((await inCompany(tenant, () => catalogue.byCode('flour')))?.id).toBe(flour.id);
      expect(await inCompany(tenant, () => catalogue.byCode('NOTHING'))).toBeUndefined();
    });

    it('reads several in the order asked for, leaving out what it does not know', async () => {
      const tenant = await signUp();
      const unit = await addUnit(tenant, {});
      const flour = await addProduct(tenant, { code: 'FLOUR', name: 'Flour', unitId: unit.id });
      const sugar = await addProduct(tenant, { code: 'SUGAR', name: 'Sugar', unitId: unit.id });

      const catalogue = app.nest.get(ProductCatalogue);
      const found = await inCompany(tenant, () =>
        catalogue.products([sugar.id, 'ffffffff-ffff-4fff-8fff-ffffffffffff', flour.id]),
      );

      // The caller's order, which is nearly always the order of the rows they are about to
      // render, and never the order the database found them in.
      expect(found.map((product: ProductSummary) => product.code)).toEqual(['SUGAR', 'FLOUR']);
    });

    it('converts between units that measure the same thing, and refuses ones that do not', async () => {
      const tenant = await signUp();
      const groupId = await addGroup(tenant, 'Weight');
      const gram = await addUnit(tenant, { code: 'g', name: 'Gram', groupId, ratio: '1' });
      const kilogram = await addUnit(tenant, {
        code: 'kg',
        name: 'Kilogram',
        groupId,
        ratio: '1000',
      });
      const hour = await addUnit(tenant, { code: 'hour', name: 'Hour' });

      const catalogue = app.nest.get(ProductCatalogue);

      const grams = await inCompany(tenant, () =>
        catalogue.convert(Quantity.parse('2.5'), kilogram.id, gram.id),
      );
      expect(grams.toValue()).toBe('2500');

      const kilograms = await inCompany(tenant, () =>
        catalogue.convert(Quantity.parse('250'), gram.id, kilogram.id),
      );
      expect(kilograms.toValue()).toBe('0.25');

      // Refused rather than answered. Converting kilograms to hours has no answer, and one
      // invented here would surface three modules away as a stock figure nobody can explain.
      await expect(
        inCompany(tenant, () => catalogue.convert(Quantity.parse('1'), kilogram.id, hour.id)),
      ).rejects.toThrow(/do not measure the same thing/i);
    });

    it('sees nothing of another company’s catalogue', async () => {
      const northwind = await signUp();
      const acme = await signUp({
        companyName: 'Acme',
        name: 'Bo Lindqvist',
        email: 'bo@acme.test',
      });
      const theirs = await addProduct(northwind, { code: 'WIDGET-1' });

      const catalogue = app.nest.get(ProductCatalogue);

      expect(await inCompany(acme, () => catalogue.product(theirs.id))).toBeUndefined();
      expect(await inCompany(acme, () => catalogue.byCode('WIDGET-1'))).toBeUndefined();
    });
  });
});
