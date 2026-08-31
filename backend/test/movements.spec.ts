import {
  AUTH_PATHS,
  INVENTORY_EVENTS,
  LOCATION_ERROR_CODES,
  LOCATION_PATHS,
  MOVEMENT_ERROR_CODES,
  MOVEMENT_PATHS,
  PRODUCT_PATHS,
  Quantity,
  STOCK_PATHS,
  UNIT_PATHS,
  listPath,
  type AuthenticatedSession,
  type LocationResponse,
  type MovementListResponse,
  type MovementResponse,
  type ProductResponse,
  type SignUpRequest,
  type StockListResponse,
  type StockMovementRecorded,
} from '@erp/shared';
import { DomainEvents, type DomainEvent } from '../src/platform/events';
import { createTestApp, resetDatabase, type TestApp } from './harness/test-app';

/**
 * Stock movements, over HTTP, against a real database. Nothing is mocked and nothing reaches
 * below the endpoint except where the deliverable is genuinely not observable there.
 *
 * The claims worth reading this file for are the ones that are cheap to assert weakly and
 * expensive to get wrong:
 *
 * - **The level reconciles with the ledger.** Asserted after a long mixed sequence rather than
 *   after one movement, because a projection that is wrong by a fixed amount passes every
 *   single-movement test ever written.
 * - **Nothing can edit history.** Asserted against the platform's own refusal as well as
 *   against the absence of a route, because "there is no endpoint" is a fact about today's
 *   controller and "the table refuses updates" is a fact about the system.
 * - **The accounting seam actually fires.** Asserted by subscribing to `DomainEvents` the way
 *   an Accounting module would, which is the one thing no HTTP request can show — there is no
 *   endpoint that would reveal it, and a seam nobody has ever listened to is a seam nobody
 *   knows works.
 */
describe('stock movements', () => {
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

  /**
   * One unit of measure per company, made on first use.
   *
   * Every product in this file is measured in "each", because none of these tests is about
   * units — and a fresh unit per product would be both unrealistic and a duplicate-code
   * refusal waiting to happen. Cleared with the database, since the rows go with it.
   */
  const unitByCompany = new Map<string, string>();

  beforeEach(async () => {
    await resetDatabase(app);
    unitByCompany.clear();
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

  async function unitOf(tenant: Tenant): Promise<string> {
    const cached = unitByCompany.get(tenant.session.company.id);
    if (cached) return cached;

    const response = await tenant
      .as(app.http.post(UNIT_PATHS.units))
      .send({ code: 'each', name: 'Each' })
      .expect(201);

    const unitId = (response.body as { id: string }).id;
    unitByCompany.set(tenant.session.company.id, unitId);
    return unitId;
  }

  async function addProduct(
    tenant: Tenant,
    body: Partial<{ code: string; name: string; cost: string; stockable: boolean }> = {},
  ): Promise<ProductResponse> {
    const response = await tenant
      .as(app.http.post(PRODUCT_PATHS.products))
      .send({ code: 'WIDGET-1', name: 'Widget', unitId: await unitOf(tenant), ...body })
      .expect(201);

    return response.body as ProductResponse;
  }

  async function addLocation(tenant: Tenant, code = 'WH-1'): Promise<LocationResponse> {
    const response = await tenant
      .as(app.http.post(LOCATION_PATHS.locations))
      .send({ code, name: `${code} store` })
      .expect(201);

    return response.body as LocationResponse;
  }

  /** A company with somewhere to put things and something to put there. */
  async function ready(): Promise<{
    tenant: Tenant;
    product: ProductResponse;
    location: LocationResponse;
  }> {
    const tenant = await signUp();
    return {
      tenant,
      product: await addProduct(tenant, { cost: '12.50' }),
      location: await addLocation(tenant),
    };
  }

  async function receive(
    tenant: Tenant,
    body: { productId: string; locationId: string; quantity: string },
    status = 201,
  ): Promise<MovementResponse> {
    const response = await tenant
      .as(app.http.post(MOVEMENT_PATHS.receipts))
      .send(body)
      .expect(status);

    return response.body as MovementResponse;
  }

  async function issue(
    tenant: Tenant,
    body: { productId: string; locationId: string; quantity: string },
    status = 201,
  ): Promise<MovementResponse> {
    const response = await tenant.as(app.http.post(MOVEMENT_PATHS.issues)).send(body).expect(status);

    return response.body as MovementResponse;
  }

  async function adjust(
    tenant: Tenant,
    body: { productId: string; locationId: string; quantity: string; reason: string },
    status = 201,
  ): Promise<MovementResponse> {
    const response = await tenant
      .as(app.http.post(MOVEMENT_PATHS.adjustments))
      .send(body)
      .expect(status);

    return response.body as MovementResponse;
  }

  async function transfer(
    tenant: Tenant,
    body: { productId: string; fromLocationId: string; toLocationId: string; quantity: string },
    status = 201,
  ): Promise<{ from: MovementResponse; to: MovementResponse }> {
    const response = await tenant
      .as(app.http.post(MOVEMENT_PATHS.transfers))
      .send(body)
      .expect(status);

    return response.body as { from: MovementResponse; to: MovementResponse };
  }

  async function stock(tenant: Tenant, query = {}): Promise<StockListResponse> {
    const response = await tenant.as(app.http.get(listPath(STOCK_PATHS.stock, query))).expect(200);
    return response.body as StockListResponse;
  }

  async function history(tenant: Tenant, query = {}): Promise<MovementListResponse> {
    const response = await tenant
      .as(app.http.get(listPath(MOVEMENT_PATHS.movements, query)))
      .expect(200);

    return response.body as MovementListResponse;
  }

  describe('recording what arrived and what left', () => {
    it('has no stock and no history until somebody records something', async () => {
      const { tenant } = await ready();

      expect((await stock(tenant)).items).toEqual([]);
      expect((await history(tenant)).items).toEqual([]);
    });

    it('records a receipt, which increases stock', async () => {
      const { tenant, product, location } = await ready();

      const movement = await receive(tenant, {
        productId: product.id,
        locationId: location.id,
        quantity: '10',
      });

      expect(movement).toMatchObject({
        kind: 'receipt',
        classification: 'stock-in',
        productId: product.id,
        productCode: 'WIDGET-1',
        productName: 'Widget',
        locationId: location.id,
        locationCode: 'WH-1',
        // Positive, and unpadded: the column is `numeric(24, 6)` and `10.000000` is six digits
        // of precision nobody has, on a number somebody is about to read.
        quantity: '10',
      });

      const levels = (await stock(tenant)).items;
      expect(levels).toHaveLength(1);
      expect(levels[0]).toMatchObject({ productId: product.id, quantity: '10' });
    });

    it('records an issue, which decreases stock', async () => {
      const { tenant, product, location } = await ready();
      await receive(tenant, { productId: product.id, locationId: location.id, quantity: '10' });

      const movement = await issue(tenant, {
        productId: product.id,
        locationId: location.id,
        quantity: '4',
      });

      // The caller sent an unsigned 4 and chose the endpoint. The sign is the server's, which
      // is what stops a stock figure depending on forty callers getting a minus right.
      expect(movement).toMatchObject({ kind: 'issue', classification: 'stock-out', quantity: '-4' });
      expect((await stock(tenant)).items[0]?.quantity).toBe('6');
    });

    it('records who did it and when, from the session rather than from the body', async () => {
      const { tenant, product, location } = await ready();

      const movement = await receive(tenant, {
        productId: product.id,
        locationId: location.id,
        // A body that tries to claim somebody else did it. Unknown keys are ignored by the
        // platform's validator, so this is not refused — it is simply not believed.
        quantity: '3',
        recordedById: '00000000-0000-4000-8000-000000000000',
        recordedByName: 'Somebody Else',
      } as never);

      expect(movement.recordedById).toBe(tenant.session.user.id);
      expect(movement.recordedByName).toBe('Ada Okafor');
      expect(Date.parse(movement.recordedAt)).not.toBeNaN();
    });

    it('keeps fractional quantities exactly, because a unit is not always countable', async () => {
      const { tenant, product, location } = await ready();

      await receive(tenant, { productId: product.id, locationId: location.id, quantity: '2.5' });
      await receive(tenant, { productId: product.id, locationId: location.id, quantity: '0.25' });

      expect((await stock(tenant)).items[0]?.quantity).toBe('2.75');
    });
  });

  describe('what the input has to be', () => {
    it('refuses a quantity of zero — a movement of nothing is a line an auditor asks about', async () => {
      const { tenant, product, location } = await ready();

      const refused = await tenant
        .as(app.http.post(MOVEMENT_PATHS.receipts))
        .send({ productId: product.id, locationId: location.id, quantity: '0' })
        .expect(422);

      expect(refused.body.fields.quantity).toMatch(/greater than zero/i);
    });

    it('refuses a negative quantity rather than treating it as the opposite movement', async () => {
      const { tenant, product, location } = await ready();

      await tenant
        .as(app.http.post(MOVEMENT_PATHS.receipts))
        .send({ productId: product.id, locationId: location.id, quantity: '-5' })
        .expect(422);
    });

    it('refuses a quantity that is not a number, and says so beside the box', async () => {
      const { tenant, product, location } = await ready();

      const refused = await tenant
        .as(app.http.post(MOVEMENT_PATHS.receipts))
        .send({ productId: product.id, locationId: location.id, quantity: 'ten' })
        .expect(422);

      expect(refused.body.fields).toHaveProperty('quantity');
    });

    /** A JSON number is a double and cannot hold every value the column can. */
    it('refuses a JSON number, at the one layer that can still stop it', async () => {
      const { tenant, product, location } = await ready();

      await tenant
        .as(app.http.post(MOVEMENT_PATHS.receipts))
        .send({ productId: product.id, locationId: location.id, quantity: 10 })
        .expect(422);
    });

    it('names every field at fault at once rather than one per attempt', async () => {
      const { tenant } = await ready();

      const refused = await tenant
        .as(app.http.post(MOVEMENT_PATHS.receipts))
        .send({ productId: 'not-an-id', locationId: '', quantity: '' })
        .expect(422);

      expect(Object.keys(refused.body.fields).sort()).toEqual([
        'locationId',
        'productId',
        'quantity',
      ]);
    });
  });

  describe('what a movement is allowed to name', () => {
    it('refuses a product this company does not have', async () => {
      const { tenant, location } = await ready();

      const refused = await tenant
        .as(app.http.post(MOVEMENT_PATHS.receipts))
        .send({
          productId: '00000000-0000-4000-8000-000000000000',
          locationId: location.id,
          quantity: '1',
        })
        .expect(404);

      expect(refused.body.code).toBe(MOVEMENT_ERROR_CODES.movementProductNotFound);
    });

    it('refuses a location this company does not have', async () => {
      const { tenant, product } = await ready();

      const refused = await tenant
        .as(app.http.post(MOVEMENT_PATHS.receipts))
        .send({
          productId: product.id,
          locationId: '00000000-0000-4000-8000-000000000000',
          quantity: '1',
        })
        .expect(404);

      expect(refused.body.code).toBe(LOCATION_ERROR_CODES.locationNotFound);
    });

    /** A delivery charge is a product with a price and no shelf. */
    it('refuses something the catalogue says is not stocked', async () => {
      const tenant = await signUp();
      const location = await addLocation(tenant);
      const delivery = await addProduct(tenant, {
        code: 'DELIVERY',
        name: 'Delivery charge',
        stockable: false,
      });

      const refused = await tenant
        .as(app.http.post(MOVEMENT_PATHS.receipts))
        .send({ productId: delivery.id, locationId: location.id, quantity: '1' })
        .expect(409);

      expect(refused.body.code).toBe(MOVEMENT_ERROR_CODES.productNotStockable);
      expect(refused.body.message).toContain('Delivery charge');
    });

    /**
     * The mirror of `location_holds_stock`, and what makes that refusal worth having: if stock
     * could arrive at a deactivated location, the status would be a label rather than a rule.
     */
    it('refuses moving stock into or out of somewhere not in use', async () => {
      const { tenant, product, location } = await ready();
      await tenant
        .as(app.http.patch(LOCATION_PATHS.location(location.id)))
        .send({ status: 'inactive' })
        .expect(200);

      const body = { productId: product.id, locationId: location.id, quantity: '1' };

      const refusedReceipt = await tenant
        .as(app.http.post(MOVEMENT_PATHS.receipts))
        .send(body)
        .expect(409);
      expect(refusedReceipt.body.code).toBe(MOVEMENT_ERROR_CODES.locationNotInUse);

      await tenant.as(app.http.post(MOVEMENT_PATHS.issues)).send(body).expect(409);
    });
  });

  describe('the value and classification a journal entry would need', () => {
    it('freezes the unit cost and the value onto every movement', async () => {
      const { tenant, product, location } = await ready();

      const movement = await receive(tenant, {
        productId: product.id,
        locationId: location.id,
        quantity: '4',
      });

      expect(movement.unitCost).toEqual({ amount: '12.50', currency: 'GBP' });
      expect(movement.value).toEqual({ amount: '50.00', currency: 'GBP' });
    });

    /** Signed with the quantity, so the ledger's values sum to what the stock is worth. */
    it('signs an issue’s value the way it signs its quantity', async () => {
      const { tenant, product, location } = await ready();
      await receive(tenant, { productId: product.id, locationId: location.id, quantity: '10' });

      const out = await issue(tenant, {
        productId: product.id,
        locationId: location.id,
        quantity: '3',
      });

      expect(out.value).toEqual({ amount: '-37.50', currency: 'GBP' });
    });

    /**
     * The distinction ticket 13's valuation depends on. Null is "nobody has said what this
     * costs"; zero would be a claim that it is worthless, and a valuation cannot tell the two
     * apart if the ledger has already flattened them.
     */
    it('leaves value null when the product has no recorded cost, rather than calling it zero', async () => {
      const tenant = await signUp();
      const location = await addLocation(tenant);
      const uncosted = await addProduct(tenant, { code: 'NOCOST' });

      const movement = await receive(tenant, {
        productId: uncosted.id,
        locationId: location.id,
        quantity: '5',
      });

      expect(movement.unitCost).toBeNull();
      expect(movement.value).toBeNull();
    });

    /**
     * A ledger records what something was worth *then*. Recomputing from the product's current
     * cost would silently restate history every time somebody corrected a price.
     */
    it('does not restate an old movement when the product’s cost changes', async () => {
      const { tenant, product, location } = await ready();

      const before = await receive(tenant, {
        productId: product.id,
        locationId: location.id,
        quantity: '1',
      });

      await tenant
        .as(app.http.patch(PRODUCT_PATHS.product(product.id)))
        .send({ cost: '99.99' })
        .expect(200);

      const after = await receive(tenant, {
        productId: product.id,
        locationId: location.id,
        quantity: '1',
      });

      expect(after.unitCost).toEqual({ amount: '99.99', currency: 'GBP' });

      // The first one is untouched, which is the whole claim.
      const reread = await tenant.as(app.http.get(MOVEMENT_PATHS.movement(before.id))).expect(200);
      expect((reread.body as MovementResponse).unitCost).toEqual({
        amount: '12.50',
        currency: 'GBP',
      });
    });

    it('classifies a receipt as stock-in and an issue as stock-out', async () => {
      const { tenant, product, location } = await ready();

      const inward = await receive(tenant, {
        productId: product.id,
        locationId: location.id,
        quantity: '5',
      });
      const outward = await issue(tenant, {
        productId: product.id,
        locationId: location.id,
        quantity: '5',
      });

      expect(inward.classification).toBe('stock-in');
      expect(outward.classification).toBe('stock-out');
    });
  });

  describe('the accounting seam', () => {
    /**
     * Subscribing the way an Accounting module would.
     *
     * This is one of the two things in this file asserted below HTTP, and for the reason
     * `test-app.ts` sets out: the deliverable is an announcement to a listener that does not
     * exist yet, and no endpoint reveals whether it was made. A seam nobody has ever listened
     * to is a seam nobody knows works — which is exactly the failure this ticket exists to
     * prevent, since the whole point is that Accounting can be added later without reopening
     * this module.
     */
    function listening(): { heard: DomainEvent<StockMovementRecorded>[]; stop: () => void } {
      const heard: DomainEvent<StockMovementRecorded>[] = [];
      const stop = app.nest
        .get(DomainEvents)
        .on<StockMovementRecorded>(INVENTORY_EVENTS.movementRecorded, (event) => {
          heard.push(event);
        });

      return { heard, stop };
    }

    it('announces a movement with everything an entry would need', async () => {
      const { tenant, product, location } = await ready();
      const { heard, stop } = listening();

      try {
        const movement = await receive(tenant, {
          productId: product.id,
          locationId: location.id,
          quantity: '4',
        });

        expect(heard).toHaveLength(1);
        expect(heard[0]?.name).toBe(INVENTORY_EVENTS.movementRecorded);
        // Stamped by the platform from the acting scope, not written by the module — which is
        // what stops an entry landing on the wrong company's books.
        expect(heard[0]?.companyId).toBe(tenant.session.company.id);
        expect(heard[0]?.payload).toEqual({
          movementId: movement.id,
          kind: 'receipt',
          classification: 'stock-in',
          productId: product.id,
          locationId: location.id,
          quantity: '4',
          value: { amount: '50.00', currency: 'GBP' },
          recordedById: tenant.session.user.id,
          recordedAt: movement.recordedAt,
        });
      } finally {
        stop();
      }
    });

    it('announces issues too, signed the way the ledger records them', async () => {
      const { tenant, product, location } = await ready();
      await receive(tenant, { productId: product.id, locationId: location.id, quantity: '10' });

      const { heard, stop } = listening();
      try {
        await issue(tenant, { productId: product.id, locationId: location.id, quantity: '2' });

        expect(heard[0]?.payload.quantity).toBe('-2');
        expect(heard[0]?.payload.value).toEqual({ amount: '-25.00', currency: 'GBP' });
      } finally {
        stop();
      }
    });

    /**
     * The movement is the fact; an entry derived from it is a consequence. Letting a failed
     * consequence roll back the fact would make recording stock depend on Accounting working,
     * which is the dependency direction the whole seam exists to prevent.
     */
    it('records the movement even when a listener throws', async () => {
      const { tenant, product, location } = await ready();

      const stop = app.nest.get(DomainEvents).on(INVENTORY_EVENTS.movementRecorded, () => {
        throw new Error('the accounting module is having a bad day');
      });

      try {
        await receive(tenant, { productId: product.id, locationId: location.id, quantity: '7' });
        expect((await stock(tenant)).items[0]?.quantity).toBe('7');
      } finally {
        stop();
      }
    });

    it('says nothing when the movement was refused', async () => {
      const { tenant, location } = await ready();
      const { heard, stop } = listening();

      try {
        await tenant
          .as(app.http.post(MOVEMENT_PATHS.receipts))
          .send({
            productId: '00000000-0000-4000-8000-000000000000',
            locationId: location.id,
            quantity: '1',
          })
          .expect(404);

        expect(heard).toEqual([]);
      } finally {
        stop();
      }
    });
  });

  describe('history is permanent', () => {
    it('offers no way to change or remove a movement', async () => {
      const { tenant, product, location } = await ready();
      const movement = await receive(tenant, {
        productId: product.id,
        locationId: location.id,
        quantity: '5',
      });

      await tenant
        .as(app.http.patch(MOVEMENT_PATHS.movement(movement.id)))
        .send({ quantity: '500' })
        .expect(404);
      await tenant.as(app.http.delete(MOVEMENT_PATHS.movement(movement.id))).expect(404);

      // Still exactly what it was.
      const reread = await tenant.as(app.http.get(MOVEMENT_PATHS.movement(movement.id))).expect(200);
      expect((reread.body as MovementResponse).quantity).toBe('5');
    });

    /**
     * The stronger claim, and the reason the one above is not enough on its own: "there is no
     * endpoint" is a fact about today's controller, and somebody adds an endpoint. This is a
     * fact about the table — the tenancy extension refuses `update` and `delete` on an
     * immutable model before the query is issued, so a route added by mistake tomorrow still
     * cannot rewrite a ledger.
     */
    it('is refused by the platform even below the API', async () => {
      const { tenant, product, location } = await ready();
      const movement = await receive(tenant, {
        productId: product.id,
        locationId: location.id,
        quantity: '5',
      });

      await app.tenancy.runInCompany({ companyId: tenant.session.company.id, grants: 'all' }, async () => {
        await expect(
          app.scoped.stockMovement.update({
            where: { id: movement.id },
            data: { quantity: '500' },
          }),
        ).rejects.toThrow(/immutable/i);

        await expect(
          app.scoped.stockMovement.delete({ where: { id: movement.id } }),
        ).rejects.toThrow(/immutable/i);
      });
    });
  });

  describe('stock always reconciles with the ledger', () => {
    /**
     * The assertion this whole module rests on, made after a long mixed sequence rather than
     * after one movement.
     *
     * A projection that is wrong by a fixed amount, or that misses every second write, passes a
     * single-movement test perfectly. Twenty movements across two locations with fractions in
     * them is the shape that catches an off-by-one in the update, a lost transaction, and a
     * level that was recomputed from the wrong rows.
     */
    it('holds after a long mixed sequence across several places', async () => {
      const tenant = await signUp();
      const product = await addProduct(tenant, { cost: '3.00' });
      const warehouse = await addLocation(tenant, 'WH-1');
      const van = await addLocation(tenant, 'VAN-1');

      for (let round = 0; round < 5; round += 1) {
        await receive(tenant, {
          productId: product.id,
          locationId: warehouse.id,
          quantity: '10.5',
        });
        await issue(tenant, { productId: product.id, locationId: warehouse.id, quantity: '2.25' });
        await receive(tenant, { productId: product.id, locationId: van.id, quantity: '1' });
        await issue(tenant, { productId: product.id, locationId: van.id, quantity: '0.5' });
      }

      // 5 × (10.5 − 2.25) = 41.25 in the warehouse, 5 × (1 − 0.5) = 2.5 in the van.
      const levels = await stock(tenant, { pageSize: 100 });
      const byLocation = new Map(levels.items.map((item) => [item.locationId, item.quantity]));
      expect(byLocation.get(warehouse.id)).toBe('41.25');
      expect(byLocation.get(van.id)).toBe('2.5');

      // And the ledger says the same thing, which is the actual claim: the level is a running
      // total of these rows and not a second opinion beside them.
      const ledger = await history(tenant, { pageSize: 100 });
      expect(ledger.page.total).toBe(20);

      // Summed with the exact type rather than with `Number(...)` and `toBeCloseTo`. This is
      // the one assertion in the suite that must be exact — "approximately reconciles" is not a
      // property a ledger has — and reaching for a double to check it would be the precision
      // loss the whole exact-numbers rule exists to rule out, in the test meant to catch it.
      const summed = new Map<string, Quantity>();
      for (const movement of ledger.items) {
        summed.set(
          movement.locationId,
          (summed.get(movement.locationId) ?? Quantity.ZERO).plus(
            Quantity.parse(movement.quantity),
          ),
        );
      }
      expect(summed.get(warehouse.id)?.trimmed().toValue()).toBe('41.25');
      expect(summed.get(van.id)?.trimmed().toValue()).toBe('2.5');

      // The two sides, stated as the equality ticket 13's valuation will have to assert.
      expect(summed.get(warehouse.id)?.equals(Quantity.parse('41.25'))).toBe(true);
      expect(summed.get(van.id)?.equals(Quantity.parse('2.5'))).toBe(true);
    });

    it('keeps one running total per product per place rather than a row per movement', async () => {
      const { tenant, product, location } = await ready();

      await receive(tenant, { productId: product.id, locationId: location.id, quantity: '1' });
      await receive(tenant, { productId: product.id, locationId: location.id, quantity: '1' });
      await receive(tenant, { productId: product.id, locationId: location.id, quantity: '1' });

      const levels = await stock(tenant);
      expect(levels.items).toHaveLength(1);
      expect(levels.items[0]?.quantity).toBe('3');
    });
  });

  describe('reading what there is', () => {
    it('shows one product across all its locations', async () => {
      const tenant = await signUp();
      const product = await addProduct(tenant, { cost: '1.00' });
      const warehouse = await addLocation(tenant, 'WH-1');
      const van = await addLocation(tenant, 'VAN-1');

      await receive(tenant, { productId: product.id, locationId: warehouse.id, quantity: '8' });
      await receive(tenant, { productId: product.id, locationId: van.id, quantity: '2' });

      const held = await stock(tenant, { filters: { productId: product.id } });
      expect(held.items).toHaveLength(2);
      expect(held.items.map((item) => item.locationCode).sort()).toEqual(['VAN-1', 'WH-1']);
    });

    it('shows everything held at one place', async () => {
      const tenant = await signUp();
      const widget = await addProduct(tenant, { code: 'WIDGET-1' });
      const gadget = await addProduct(tenant, { code: 'GADGET-1', name: 'Gadget' });
      const warehouse = await addLocation(tenant, 'WH-1');
      const van = await addLocation(tenant, 'VAN-1');

      await receive(tenant, { productId: widget.id, locationId: warehouse.id, quantity: '5' });
      await receive(tenant, { productId: gadget.id, locationId: warehouse.id, quantity: '6' });
      await receive(tenant, { productId: widget.id, locationId: van.id, quantity: '7' });

      const here = await stock(tenant, { filters: { locationId: warehouse.id } });
      expect(here.items).toHaveLength(2);
      expect(here.items.map((item) => item.productCode).sort()).toEqual(['GADGET-1', 'WIDGET-1']);
    });

    /**
     * Resolved through `ProductCatalogue` rather than stored, which is what makes it the
     * *current* name: a level is a figure about now, and a reader wants to recognise the
     * product by what it is called today.
     */
    it('names the product and its unit through the products contract', async () => {
      const { tenant, product, location } = await ready();
      await receive(tenant, { productId: product.id, locationId: location.id, quantity: '1' });

      await tenant
        .as(app.http.patch(PRODUCT_PATHS.product(product.id)))
        .send({ name: 'Widget, improved' })
        .expect(200);

      expect((await stock(tenant)).items[0]?.productName).toBe('Widget, improved');
    });
  });

  describe('reading what happened', () => {
    it('lists a product’s history newest first, in the envelope every list returns', async () => {
      const { tenant, product, location } = await ready();

      await receive(tenant, { productId: product.id, locationId: location.id, quantity: '1' });
      await issue(tenant, { productId: product.id, locationId: location.id, quantity: '1' });

      const listed = await history(tenant, { pageSize: 10 });
      expect(listed.items.map((item) => item.kind)).toEqual(['issue', 'receipt']);
      expect(listed.page).toEqual({ number: 1, size: 10, total: 2, pages: 1 });
    });

    it('filters history by product, by location and by type', async () => {
      const tenant = await signUp();
      const widget = await addProduct(tenant, { code: 'WIDGET-1' });
      const gadget = await addProduct(tenant, { code: 'GADGET-1', name: 'Gadget' });
      const warehouse = await addLocation(tenant, 'WH-1');
      const van = await addLocation(tenant, 'VAN-1');

      await receive(tenant, { productId: widget.id, locationId: warehouse.id, quantity: '5' });
      await receive(tenant, { productId: gadget.id, locationId: van.id, quantity: '5' });
      await issue(tenant, { productId: widget.id, locationId: warehouse.id, quantity: '1' });

      expect((await history(tenant, { filters: { productId: widget.id } })).page.total).toBe(2);
      expect((await history(tenant, { filters: { locationId: van.id } })).page.total).toBe(1);
      expect((await history(tenant, { filters: { kind: 'issue' } })).page.total).toBe(1);
    });

    it('filters history by date, which is what a period looks like from a screen', async () => {
      const { tenant, product, location } = await ready();
      await receive(tenant, { productId: product.id, locationId: location.id, quantity: '1' });

      const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
      const yesterday = new Date(Date.now() - 86_400_000).toISOString();

      expect((await history(tenant, { filters: { 'recordedAt.lt': tomorrow } })).page.total).toBe(1);
      expect((await history(tenant, { filters: { 'recordedAt.lt': yesterday } })).page.total).toBe(
        0,
      );
    });

    it('refuses a sort by a field the ledger does not offer', async () => {
      const { tenant } = await ready();

      const refused = await tenant
        .as(app.http.get(listPath(MOVEMENT_PATHS.movements, { sort: 'unitCost' })))
        .expect(422);

      expect(refused.body.fields).toHaveProperty('sort');
    });
  });

  describe('somewhere holding stock cannot go quiet', () => {
    /**
     * The test ticket 08 had no way to write.
     *
     * The refusal, its code and its message were all written then; the count behind it could
     * not be, because until this ticket nothing could put stock into a location. This is the
     * assertion that closes it.
     */
    it('refuses to deactivate a location that still holds something', async () => {
      const { tenant, product, location } = await ready();
      await receive(tenant, { productId: product.id, locationId: location.id, quantity: '3' });

      const refused = await tenant
        .as(app.http.patch(LOCATION_PATHS.location(location.id)))
        .send({ status: 'inactive' })
        .expect(409);

      expect(refused.body.code).toBe(LOCATION_ERROR_CODES.locationHoldsStock);
      expect(refused.body.message).toContain('1 product');

      // Still in use, because the refusal actually refused rather than merely complaining.
      const reread = await tenant.as(app.http.get(LOCATION_PATHS.location(location.id))).expect(200);
      expect((reread.body as LocationResponse).status).toBe('active');
    });

    /**
     * The other half, and the one that makes deactivation possible at all: a level row is
     * created by the first movement and never removed, so somewhere emptied properly still has
     * a row per product that ever passed through it. Counting those would mean a location could
     * be used once and then never closed again.
     */
    it('lets one be deactivated once what it held has been issued back out', async () => {
      const { tenant, product, location } = await ready();
      await receive(tenant, { productId: product.id, locationId: location.id, quantity: '3' });
      await issue(tenant, { productId: product.id, locationId: location.id, quantity: '3' });

      const closed = await tenant
        .as(app.http.patch(LOCATION_PATHS.location(location.id)))
        .send({ status: 'inactive' })
        .expect(200);

      expect((closed.body as LocationResponse).status).toBe('inactive');
    });

    it('counts each product held once, however many movements put it there', async () => {
      const tenant = await signUp();
      const widget = await addProduct(tenant, { code: 'WIDGET-1' });
      const gadget = await addProduct(tenant, { code: 'GADGET-1', name: 'Gadget' });
      const location = await addLocation(tenant);

      await receive(tenant, { productId: widget.id, locationId: location.id, quantity: '1' });
      await receive(tenant, { productId: widget.id, locationId: location.id, quantity: '1' });
      await receive(tenant, { productId: gadget.id, locationId: location.id, quantity: '1' });

      const refused = await tenant
        .as(app.http.patch(LOCATION_PATHS.location(location.id)))
        .send({ status: 'inactive' })
        .expect(409);

      expect(refused.body.message).toContain('2 products');
    });
  });

  describe('adjustments', () => {
    it('records an adjustment raising stock with a mandatory reason', async () => {
      const { tenant, product, location } = await ready();

      const movement = await adjust(tenant, {
        productId: product.id,
        locationId: location.id,
        quantity: '5',
        reason: 'Found extra stock during annual count',
      });

      expect(movement).toMatchObject({
        kind: 'adjustment',
        classification: 'stock-in',
        quantity: '5',
        reason: 'Found extra stock during annual count',
      });

      const levels = (await stock(tenant)).items;
      expect(levels[0]?.quantity).toBe('5');
    });

    it('records an adjustment lowering stock', async () => {
      const { tenant, product, location } = await ready();
      await receive(tenant, { productId: product.id, locationId: location.id, quantity: '10' });

      const movement = await adjust(tenant, {
        productId: product.id,
        locationId: location.id,
        quantity: '-3',
        reason: 'Damaged item written off',
      });

      expect(movement).toMatchObject({
        kind: 'adjustment',
        classification: 'stock-out',
        quantity: '-3',
        reason: 'Damaged item written off',
      });

      const levels = (await stock(tenant)).items;
      expect(levels[0]?.quantity).toBe('7');
    });

    it('refuses an adjustment without a reason', async () => {
      const { tenant, product, location } = await ready();

      const refused = await tenant
        .as(app.http.post(MOVEMENT_PATHS.adjustments))
        .send({
          productId: product.id,
          locationId: location.id,
          quantity: '5',
          reason: '  ',
        })
        .expect(422);

      expect(refused.body.fields).toHaveProperty('reason');
    });

    it('refuses an adjustment with zero quantity', async () => {
      const { tenant, product, location } = await ready();

      const refused = await tenant
        .as(app.http.post(MOVEMENT_PATHS.adjustments))
        .send({
          productId: product.id,
          locationId: location.id,
          quantity: '0',
          reason: 'Routine check',
        })
        .expect(422);

      expect(refused.body.fields).toHaveProperty('quantity');
    });
  });

  describe('transfers', () => {
    it('transfers stock from one location to another, conserving total stock', async () => {
      const tenant = await signUp();
      const product = await addProduct(tenant, { cost: '10.00' });
      const warehouse = await addLocation(tenant, 'WH-1');
      const store = await addLocation(tenant, 'STORE-1');

      await receive(tenant, { productId: product.id, locationId: warehouse.id, quantity: '20' });

      const result = await transfer(tenant, {
        productId: product.id,
        fromLocationId: warehouse.id,
        toLocationId: store.id,
        quantity: '6',
      });

      expect(result.from).toMatchObject({
        kind: 'transfer',
        classification: 'transfer',
        locationId: warehouse.id,
        quantity: '-6',
      });
      expect(result.to).toMatchObject({
        kind: 'transfer',
        classification: 'transfer',
        locationId: store.id,
        quantity: '6',
      });
      expect(result.from.transferId).toBe(result.to.transferId);
      expect(result.from.transferId).not.toBeNull();

      const levels = await stock(tenant, { pageSize: 100 });
      const byLocation = new Map(levels.items.map((item) => [item.locationId, item.quantity]));
      expect(byLocation.get(warehouse.id)).toBe('14');
      expect(byLocation.get(store.id)).toBe('6');
    });

    it('refuses a transfer to the location it came from', async () => {
      const { tenant, product, location } = await ready();
      await receive(tenant, { productId: product.id, locationId: location.id, quantity: '10' });

      const refused = await tenant
        .as(app.http.post(MOVEMENT_PATHS.transfers))
        .send({
          productId: product.id,
          fromLocationId: location.id,
          toLocationId: location.id,
          quantity: '2',
        })
        .expect(409);

      expect(refused.body.code).toBe(MOVEMENT_ERROR_CODES.transferSameLocation);
    });

    it('proves a failed transfer leaves no partial change', async () => {
      const tenant = await signUp();
      const product = await addProduct(tenant, { cost: '5.00' });
      const warehouse = await addLocation(tenant, 'WH-1');

      await receive(tenant, { productId: product.id, locationId: warehouse.id, quantity: '10' });

      // Transfer to non-existent destination location
      await tenant
        .as(app.http.post(MOVEMENT_PATHS.transfers))
        .send({
          productId: product.id,
          fromLocationId: warehouse.id,
          toLocationId: '00000000-0000-4000-8000-000000000000',
          quantity: '5',
        })
        .expect(404);

      // Verify no changes were made to stock or movements
      const levels = await stock(tenant);
      expect(levels.items).toHaveLength(1);
      expect(levels.items[0]?.quantity).toBe('10');

      const ledger = await history(tenant);
      expect(ledger.items).toHaveLength(1);
      expect(ledger.items[0]?.kind).toBe('receipt');
    });
  });

  describe('reversals', () => {
    it('reverses a receipt, creating a new reversal ledger entry and restoring stock level', async () => {
      const { tenant, product, location } = await ready();
      const rec = await receive(tenant, {
        productId: product.id,
        locationId: location.id,
        quantity: '10',
      });

      const rev = await tenant
        .as(app.http.post(MOVEMENT_PATHS.reversal(rec.id)))
        .expect(201);

      expect(rev.body).toMatchObject({
        kind: 'reversal',
        classification: 'stock-out',
        productId: product.id,
        locationId: location.id,
        quantity: '-10',
        reversedMovementId: rec.id,
      });

      const levels = (await stock(tenant)).items;
      expect(levels[0]?.quantity).toBe('0');
    });

    it('reverses an issue, creating a stock-in reversal ledger entry and restoring stock level', async () => {
      const { tenant, product, location } = await ready();
      await receive(tenant, { productId: product.id, locationId: location.id, quantity: '10' });
      const iss = await issue(tenant, {
        productId: product.id,
        locationId: location.id,
        quantity: '4',
      });

      const rev = await tenant
        .as(app.http.post(MOVEMENT_PATHS.reversal(iss.id)))
        .expect(201);

      expect(rev.body).toMatchObject({
        kind: 'reversal',
        classification: 'stock-in',
        quantity: '4',
        reversedMovementId: iss.id,
      });

      const levels = (await stock(tenant)).items;
      expect(levels[0]?.quantity).toBe('10');
    });

    it('reverses a transfer, atomically reversing both twin movements', async () => {
      const tenant = await signUp();
      const product = await addProduct(tenant, { cost: '5.00' });
      const warehouse = await addLocation(tenant, 'WH-1');
      const store = await addLocation(tenant, 'STORE-1');

      await receive(tenant, { productId: product.id, locationId: warehouse.id, quantity: '10' });
      const xfer = await transfer(tenant, {
        productId: product.id,
        fromLocationId: warehouse.id,
        toLocationId: store.id,
        quantity: '4',
      });

      const rev = await tenant
        .as(app.http.post(MOVEMENT_PATHS.reversal(xfer.from.id)))
        .expect(201);

      expect(rev.body).toMatchObject({
        kind: 'reversal',
        classification: 'transfer',
        locationId: warehouse.id,
        quantity: '4',
        reversedMovementId: xfer.from.id,
      });

      const levels = await stock(tenant, { pageSize: 100 });
      const byLocation = new Map(levels.items.map((item) => [item.locationId, item.quantity]));
      expect(byLocation.get(warehouse.id)).toBe('10');
      expect(byLocation.get(store.id)).toBe('0');
    });

    it('refuses to reverse a movement that has already been reversed', async () => {
      const { tenant, product, location } = await ready();
      const rec = await receive(tenant, {
        productId: product.id,
        locationId: location.id,
        quantity: '10',
      });

      await tenant.as(app.http.post(MOVEMENT_PATHS.reversal(rec.id))).expect(201);

      const refused = await tenant
        .as(app.http.post(MOVEMENT_PATHS.reversal(rec.id)))
        .expect(409);

      expect(refused.body.code).toBe(MOVEMENT_ERROR_CODES.alreadyReversed);
    });
  });

  describe('negative stock policy', () => {
    it('defaults to refusing negative stock in code', async () => {
      const { tenant, product, location } = await ready();

      // Attempting to issue stock when level is 0
      const refused = await tenant
        .as(app.http.post(MOVEMENT_PATHS.issues))
        .send({
          productId: product.id,
          locationId: location.id,
          quantity: '5',
        })
        .expect(409);

      expect(refused.body.code).toBe(MOVEMENT_ERROR_CODES.negativeStockRefused);
    });

    it('allows changing negative stock policy via settings endpoint', async () => {
      const { tenant, product, location } = await ready();

      // Check default settings
      const getSettings = await tenant
        .as(app.http.get(MOVEMENT_PATHS.settings))
        .expect(200);
      expect(getSettings.body).toEqual({ allowNegativeStock: false });

      // Enable allowNegativeStock
      const updateSettings = await tenant
        .as(app.http.patch(MOVEMENT_PATHS.settings))
        .send({ allowNegativeStock: true })
        .expect(200);
      expect(updateSettings.body).toEqual({ allowNegativeStock: true });

      // Issuing stock now succeeds and drives stock negative
      const iss = await issue(tenant, {
        productId: product.id,
        locationId: location.id,
        quantity: '5',
      });
      expect(iss.quantity).toBe('-5');

      const levels = (await stock(tenant)).items;
      expect(levels[0]?.quantity).toBe('-5');
    });
  });

  describe('one company cannot see another’s stock', () => {
    it('is not a filter any of this code writes', async () => {
      const northwind = await signUp();
      const acme = await signUp({
        companyName: 'Acme',
        name: 'Bo Lindqvist',
        email: 'bo@acme.test',
      });

      const theirProduct = await addProduct(northwind, { code: 'WIDGET-1', cost: '5.00' });
      const theirLocation = await addLocation(northwind, 'WH-9');
      const theirs = await receive(northwind, {
        productId: theirProduct.id,
        locationId: theirLocation.id,
        quantity: '100',
      });

      const ourProduct = await addProduct(acme, { code: 'WIDGET-1' });
      const ourLocation = await addLocation(acme, 'WH-1');
      await receive(acme, {
        productId: ourProduct.id,
        locationId: ourLocation.id,
        quantity: '1',
      });

      expect((await stock(acme)).items.map((item) => item.quantity)).toEqual(['1']);
      expect((await history(acme)).page.total).toBe(1);

      // By its own identifier, which is the case a list filter would not cover: the id is real,
      // and the answer is the one a made-up id gets.
      await acme.as(app.http.get(MOVEMENT_PATHS.movement(theirs.id))).expect(404);

      // And a movement cannot be recorded *into* another company's location either, which is
      // the write-side half a read-only test would miss entirely.
      await acme
        .as(app.http.post(MOVEMENT_PATHS.receipts))
        .send({ productId: ourProduct.id, locationId: theirLocation.id, quantity: '1' })
        .expect(404);

      // Untouched — a write that happened and was then refused would look identical from here.
      expect((await stock(northwind)).items[0]?.quantity).toBe('100');
    });
  });

  describe('concurrency hardening and reconciliation check (Ticket 12)', () => {
    it('handles concurrent movements against the same product and location without lost updates', async () => {
      const { tenant, product, location } = await ready();
      await tenant.as(app.http.patch(MOVEMENT_PATHS.settings)).send({ allowNegativeStock: true });

      // Fire 10 concurrent movements against the same product & location simultaneously
      await Promise.all([
        receive(tenant, { productId: product.id, locationId: location.id, quantity: '10' }),
        receive(tenant, { productId: product.id, locationId: location.id, quantity: '20' }),
        receive(tenant, { productId: product.id, locationId: location.id, quantity: '30' }),
        issue(tenant, { productId: product.id, locationId: location.id, quantity: '5' }),
        issue(tenant, { productId: product.id, locationId: location.id, quantity: '15' }),
        adjust(tenant, {
          productId: product.id,
          locationId: location.id,
          quantity: '5',
          reason: 'Count adjustment A',
        }),
        adjust(tenant, {
          productId: product.id,
          locationId: location.id,
          quantity: '-2',
          reason: 'Count adjustment B',
        }),
        receive(tenant, { productId: product.id, locationId: location.id, quantity: '12' }),
        issue(tenant, { productId: product.id, locationId: location.id, quantity: '8' }),
        receive(tenant, { productId: product.id, locationId: location.id, quantity: '3' }),
      ]);

      // Expected sum: 10 + 20 + 30 - 5 - 15 + 5 - 2 + 12 - 8 + 3 = 50
      const levels = (await stock(tenant)).items;
      expect(levels).toHaveLength(1);
      expect(levels[0]?.quantity).toBe('50');

      // Verify reconciliation check reports 100% agreement
      const recon = await tenant
        .as(app.http.get(STOCK_PATHS.reconciliation))
        .expect(200);

      expect(recon.body).toEqual({
        reconciled: true,
        divergenceCount: 0,
        divergences: [],
      });
    });

    it('handles concurrent movements across different products without blocking', async () => {
      const tenant = await signUp();
      const p1 = await addProduct(tenant, { code: 'PROD-1' });
      const p2 = await addProduct(tenant, { code: 'PROD-2' });
      const loc = await addLocation(tenant, 'WH-1');

      // PROD-2 is stocked before the concurrent block, for the reason the transfer test
      // below spells out: `Promise.all` starts four requests, it does not order them. The
      // issue of 10 and the receive of 25 used to be started together, so whenever the issue
      // won it was refused for insufficient stock — a scheduling accident reported as a
      // broken feature, and one that only lost the race on a loaded machine, so it passed
      // here and failed in CI. Stocking up front leaves every interleaving valid, which is
      // what lets this assert on the thing it is named for: movements against different
      // products do not block each other.
      await receive(tenant, { productId: p2.id, locationId: loc.id, quantity: '25' });

      await Promise.all([
        receive(tenant, { productId: p1.id, locationId: loc.id, quantity: '10' }),
        receive(tenant, { productId: p1.id, locationId: loc.id, quantity: '5' }),
        issue(tenant, { productId: p2.id, locationId: loc.id, quantity: '10' }),
      ]);

      const levels = await stock(tenant, { pageSize: 100 });
      const byProduct = new Map(levels.items.map((i) => [i.productCode, i.quantity]));
      expect(byProduct.get('PROD-1')).toBe('15');
      expect(byProduct.get('PROD-2')).toBe('15');

      const recon = await tenant
        .as(app.http.get(STOCK_PATHS.reconciliation))
        .expect(200);
      expect(recon.body.reconciled).toBe(true);
    });

    it('handles concurrent transfers involving a shared location while conserving total stock', async () => {
      const tenant = await signUp();
      const product = await addProduct(tenant, { code: 'PROD-1' });
      const locA = await addLocation(tenant, 'LOC-A');
      const locB = await addLocation(tenant, 'LOC-B');
      const locC = await addLocation(tenant, 'LOC-C');

      await receive(tenant, { productId: product.id, locationId: locA.id, quantity: '100' });
      // LOC-B is stocked up front so that every one of the three transfers below is valid
      // whatever order they land in. Serialising concurrent work does not *order* it: the
      // lock guarantees that two transfers sharing a location never interleave, and
      // guarantees nothing about which goes first. A B→C transfer that depended on the A→B
      // transfer having already happened would be refused whenever it won the lock on B
      // first — an assertion about scheduling wearing the clothes of an assertion about
      // stock. What is being proved here is that three transfers contending pairwise on
      // three locations conserve the total and cannot deadlock, and that holds in all six
      // orderings.
      await receive(tenant, { productId: product.id, locationId: locB.id, quantity: '20' });

      await Promise.all([
        transfer(tenant, {
          productId: product.id,
          fromLocationId: locA.id,
          toLocationId: locB.id,
          quantity: '20',
        }),
        transfer(tenant, {
          productId: product.id,
          fromLocationId: locA.id,
          toLocationId: locC.id,
          quantity: '30',
        }),
        transfer(tenant, {
          productId: product.id,
          fromLocationId: locB.id,
          toLocationId: locC.id,
          quantity: '5',
        }),
      ]);

      // locA: 100 - 20 - 30 = 50
      // locB: 20 + 20 - 5 = 35
      // locC: 30 + 5 = 35
      // Total = 50 + 35 + 35 = 120, which is what was received and never more or less.
      const levels = await stock(tenant, { pageSize: 100 });
      const byLoc = new Map(levels.items.map((i) => [i.locationCode, i.quantity]));
      expect(byLoc.get('LOC-A')).toBe('50');
      expect(byLoc.get('LOC-B')).toBe('35');
      expect(byLoc.get('LOC-C')).toBe('35');

      const recon = await tenant
        .as(app.http.get(STOCK_PATHS.reconciliation))
        .expect(200);
      expect(recon.body.reconciled).toBe(true);
    });
  });

  describe('stock valuation (Ticket 13)', () => {
    it('returns empty valuation state when company has no stock', async () => {
      const tenant = await signUp();
      const response = await tenant
        .as(app.http.get(STOCK_PATHS.valuation))
        .expect(200);

      expect(response.body).toEqual({
        totalValue: null,
        costedProductCount: 0,
        uncostedProductCount: 0,
        totalProducts: 0,
        byProduct: [],
        byLocation: [],
        movementAccounting: {
          stockInValue: { amount: '0.00', currency: 'GBP' },
          stockOutValue: { amount: '0.00', currency: 'GBP' },
          netMovementValue: { amount: '0.00', currency: 'GBP' },
          reconciled: true,
        },
      });
    });

    it('calculates total stock valuation and breakdowns by product and location using recorded cost', async () => {
      const tenant = await signUp();
      const widget = await addProduct(tenant, { code: 'WIDGET-1', name: 'Widget', cost: '12.50' });
      const gadget = await addProduct(tenant, { code: 'GADGET-1', name: 'Gadget', cost: '40.00' });
      const wh1 = await addLocation(tenant, 'WH-1');
      const wh2 = await addLocation(tenant, 'WH-2');

      // Receipt 10 Widgets to WH-1: 10 * 12.50 = 125.00
      await receive(tenant, { productId: widget.id, locationId: wh1.id, quantity: '10' });
      // Receipt 5 Gadgets to WH-2: 5 * 40.00 = 200.00
      await receive(tenant, { productId: gadget.id, locationId: wh2.id, quantity: '5' });

      const response = await tenant
        .as(app.http.get(STOCK_PATHS.valuation))
        .expect(200);

      // Total valuation: 125.00 + 200.00 = 325.00
      expect(response.body.totalValue).toEqual({ amount: '325.00', currency: 'GBP' });
      expect(response.body.costedProductCount).toBe(2);
      expect(response.body.uncostedProductCount).toBe(0);
      expect(response.body.totalProducts).toBe(2);

      // Product breakdown
      const byProduct = response.body.byProduct;
      expect(byProduct).toHaveLength(2);
      expect(byProduct[0]).toMatchObject({
        productCode: 'GADGET-1',
        totalQuantity: '5',
        totalValue: { amount: '200.00', currency: 'GBP' },
        isCosted: true,
      });
      expect(byProduct[1]).toMatchObject({
        productCode: 'WIDGET-1',
        totalQuantity: '10',
        totalValue: { amount: '125.00', currency: 'GBP' },
        isCosted: true,
      });

      // Location breakdown
      const byLocation = response.body.byLocation;
      expect(byLocation).toHaveLength(2);
      expect(byLocation[0].locationCode).toBe('WH-1');
      expect(byLocation[0].totalValue).toEqual({ amount: '125.00', currency: 'GBP' });
      expect(byLocation[1].locationCode).toBe('WH-2');
      expect(byLocation[1].totalValue).toEqual({ amount: '200.00', currency: 'GBP' });

      // Accounting reconciliation
      expect(response.body.movementAccounting.reconciled).toBe(true);
      expect(response.body.movementAccounting.netMovementValue).toEqual({ amount: '325.00', currency: 'GBP' });
    });

    it('shows products with no recorded cost as uncosted rather than counting them as zero', async () => {
      const tenant = await signUp();
      const costedItem = await addProduct(tenant, { code: 'COSTED-1', name: 'Costed Item', cost: '15.00' });
      const uncostedItem = await addProduct(tenant, { code: 'UNCOSTED-1', name: 'Uncosted Item' }); // cost is null
      const wh1 = await addLocation(tenant, 'WH-1');

      await receive(tenant, { productId: costedItem.id, locationId: wh1.id, quantity: '4' }); // 4 * 15 = 60.00
      await receive(tenant, { productId: uncostedItem.id, locationId: wh1.id, quantity: '10' }); // Uncosted

      const response = await tenant
        .as(app.http.get(STOCK_PATHS.valuation))
        .expect(200);

      // Total value counts costed item (60.00)
      expect(response.body.totalValue).toEqual({ amount: '60.00', currency: 'GBP' });
      expect(response.body.costedProductCount).toBe(1);
      expect(response.body.uncostedProductCount).toBe(1);

      const uncostedProd = response.body.byProduct.find((p: any) => p.productCode === 'UNCOSTED-1');
      expect(uncostedProd).toMatchObject({
        productCode: 'UNCOSTED-1',
        totalQuantity: '10',
        unitCost: null,
        totalValue: null,
        isCosted: false,
      });
    });

    it('asserts that derived stock value equals sum of movement accounting values across long mixed movement sequences', async () => {
      const tenant = await signUp();
      await tenant.as(app.http.patch(MOVEMENT_PATHS.settings)).send({ allowNegativeStock: true });

      const product = await addProduct(tenant, { code: 'PROD-A', name: 'Product A', cost: '25.00' });
      const loc1 = await addLocation(tenant, 'LOC-1');
      const loc2 = await addLocation(tenant, 'LOC-2');

      // 1. Receipt 100 to LOC-1 (+2,500.00)
      const r1 = await receive(tenant, { productId: product.id, locationId: loc1.id, quantity: '100' });
      // 2. Issue 20 from LOC-1 (-500.00)
      await issue(tenant, { productId: product.id, locationId: loc1.id, quantity: '20' });
      // 3. Transfer 30 from LOC-1 to LOC-2 (LOC-1: -750.00, LOC-2: +750.00; net 0)
      await transfer(tenant, { productId: product.id, fromLocationId: loc1.id, toLocationId: loc2.id, quantity: '30' });
      // 4. Adjustment +10 to LOC-2 (+250.00)
      await adjust(tenant, { productId: product.id, locationId: loc2.id, quantity: '10', reason: 'Found stock' });
      // 5. Reverse initial receipt r1 (-100 * 25.00 = -2,500.00)
      await tenant.as(app.http.post(MOVEMENT_PATHS.reversal(r1.id))).expect(201);

      // Current stock levels:
      // LOC-1: 100 - 20 - 30 - 100 (reversed) = -50
      // LOC-2: 30 + 10 = 40
      // Total Qty: -10 * 25.00 = -250.00
      const response = await tenant
        .as(app.http.get(STOCK_PATHS.valuation))
        .expect(200);

      expect(response.body.totalValue).toEqual({ amount: '-250.00', currency: 'GBP' });
      expect(response.body.movementAccounting.netMovementValue).toEqual({ amount: '-250.00', currency: 'GBP' });
      expect(response.body.movementAccounting.reconciled).toBe(true);
    });

    it('enforces strict company scoping for stock valuation', async () => {
      const northwind = await signUp();
      const acme = await signUp({ companyName: 'Acme', name: 'Bo', email: 'bo@acme.test' });

      const prodNW = await addProduct(northwind, { code: 'NW-PROD', cost: '10.00' });
      const locNW = await addLocation(northwind, 'NW-WH');
      await receive(northwind, { productId: prodNW.id, locationId: locNW.id, quantity: '5' });

      const nwValuation = await northwind.as(app.http.get(STOCK_PATHS.valuation)).expect(200);
      expect(nwValuation.body.totalValue).toEqual({ amount: '50.00', currency: 'GBP' });

      const acmeValuation = await acme.as(app.http.get(STOCK_PATHS.valuation)).expect(200);
      expect(acmeValuation.body.totalValue).toBeNull();
      expect(acmeValuation.body.totalProducts).toBe(0);
    });
  });
});
