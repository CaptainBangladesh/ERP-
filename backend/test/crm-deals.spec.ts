import {
  AUTH_PATHS,
  DEAL_ERROR_CODES,
  DEAL_PATHS,
  PARTY_PATHS,
  STAGE_ERROR_CODES,
  STAGE_PATHS,
  listPath,
  type AuthenticatedSession,
  type CreateDealRequest,
  type CreatePartyRequest,
  type CreateStageRequest,
  type DealListResponse,
  type DealResponse,
  type PartyDealRollupResponse,
  type PartyResponse,
  type SignUpRequest,
  type StageListResponse,
  type StageResponse,
  type UpdateDealRequest,
  type UpdateStageRequest,
} from '@erp/shared';
import { createTestApp, resetDatabase, type TestApp } from './harness/test-app';

/**
 * Stages and Deals, over HTTP, against a real database. Nothing is mocked and nothing reaches
 * below the endpoint — `PartyDirectory` is exercised for real, exactly as `crm.spec.ts` and
 * `inventory.spec.ts` exercise their own contracts.
 *
 * A sibling file to `crm.spec.ts` rather than an extension of it: ticket 02's Lead tests already
 * fill that file, and Stage/Deal are their own resources with their own lifecycle, the same
 * split `movements.spec.ts` makes from `inventory.spec.ts` (locations) once a module grows a
 * second resource worth its own file.
 */
describe('crm: stages and deals', () => {
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

  async function addStage(
    tenant: Tenant,
    body: Partial<CreateStageRequest> = {},
  ): Promise<StageResponse> {
    const response = await tenant
      .as(app.http.post(STAGE_PATHS.stages))
      .send({ name: 'Discovery', ...body } satisfies CreateStageRequest)
      .expect(201);

    return response.body as StageResponse;
  }

  async function changeStage(
    tenant: Tenant,
    id: string,
    body: UpdateStageRequest,
    status = 200,
  ): Promise<StageResponse> {
    const response = await tenant.as(app.http.patch(STAGE_PATHS.stage(id))).send(body).expect(status);
    return response.body as StageResponse;
  }

  async function listStages(tenant: Tenant, query = {}): Promise<StageListResponse> {
    const response = await tenant.as(app.http.get(listPath(STAGE_PATHS.stages, query))).expect(200);
    return response.body as StageListResponse;
  }

  async function addParty(tenant: Tenant, body: Partial<CreatePartyRequest> = {}): Promise<PartyResponse> {
    const response = await tenant
      .as(app.http.post(PARTY_PATHS.parties))
      .send({ kind: 'organisation', name: 'Kapoor Trading', ...body } satisfies CreatePartyRequest)
      .expect(201);

    return response.body as PartyResponse;
  }

  async function addDeal(
    tenant: Tenant,
    stageId: string,
    partyId: string,
    body: Partial<CreateDealRequest> = {},
  ): Promise<DealResponse> {
    const response = await tenant
      .as(app.http.post(DEAL_PATHS.deals))
      .send({ name: 'Kapoor Trading — new site', stageId, partyId, amount: '1000.00', ...body } satisfies CreateDealRequest)
      .expect(201);

    return response.body as DealResponse;
  }

  async function changeDeal(
    tenant: Tenant,
    id: string,
    body: UpdateDealRequest,
    status = 200,
  ): Promise<DealResponse> {
    const response = await tenant.as(app.http.patch(DEAL_PATHS.deal(id))).send(body).expect(status);
    return response.body as DealResponse;
  }

  async function listDeals(tenant: Tenant, query = {}): Promise<DealListResponse> {
    const response = await tenant.as(app.http.get(listPath(DEAL_PATHS.deals, query))).expect(200);
    return response.body as DealListResponse;
  }

  // ─── stages ───────────────────────────────────────────────────────────────────────

  describe('stages', () => {
    it('has none until somebody says so — the board starts empty, nothing seeded', async () => {
      const tenant = await signUp();

      const listed = await listStages(tenant);
      expect(listed.items).toEqual([]);
    });

    it('appends a new stage after every existing one, never letting a client choose its position', async () => {
      const tenant = await signUp();

      const first = await addStage(tenant, { name: 'Discovery' });
      const second = await addStage(tenant, { name: 'Proposal Sent' });

      expect(first.order).toBe(1);
      expect(second.order).toBe(2);

      const listed = await listStages(tenant);
      expect(listed.items.map((item) => item.name)).toEqual(['Discovery', 'Proposal Sent']);
    });

    it('renames a stage through the ordinary PATCH', async () => {
      const tenant = await signUp();
      const stage = await addStage(tenant, { name: 'Discovery' });

      const renamed = await changeStage(tenant, stage.id, { name: 'Qualifying' });
      expect(renamed.name).toBe('Qualifying');
    });

    it('reorders by moving a stage to a position, renumbering the rest around it', async () => {
      const tenant = await signUp();
      const first = await addStage(tenant, { name: 'Discovery' });
      const second = await addStage(tenant, { name: 'Proposal' });
      const third = await addStage(tenant, { name: 'Negotiation' });

      // Move "Negotiation" (order 3) to the front.
      await changeStage(tenant, third.id, { order: 1 });

      const listed = await listStages(tenant);
      expect(listed.items.map((item) => item.name)).toEqual(['Negotiation', 'Discovery', 'Proposal']);
      expect(listed.items.map((item) => item.order)).toEqual([1, 2, 3]);

      // And every order value stays contiguous and unique — no gaps, no repeats.
      const orders = listed.items.map((item) => item.order).sort();
      expect(orders).toEqual([1, 2, 3]);
      void first;
      void second;
    });

    it('sets an outcome, and refuses a second stage with the same one', async () => {
      const tenant = await signUp();
      const won = await addStage(tenant, { name: 'Closed Won', outcome: 'won' });
      expect(won.outcome).toBe('won');

      const another = await addStage(tenant, { name: 'Also Closed' });

      const refused = await tenant
        .as(app.http.patch(STAGE_PATHS.stage(another.id)))
        .send({ outcome: 'won' } satisfies UpdateStageRequest)
        .expect(409);

      expect(refused.body.code).toBe(STAGE_ERROR_CODES.duplicateStageOutcome);
    });

    it('refuses a second stage with the same outcome at creation too', async () => {
      const tenant = await signUp();
      await addStage(tenant, { name: 'Closed Lost', outcome: 'lost' });

      const refused = await tenant
        .as(app.http.post(STAGE_PATHS.stages))
        .send({ name: 'Also Lost', outcome: 'lost' } satisfies CreateStageRequest)
        .expect(409);

      expect(refused.body.code).toBe(STAGE_ERROR_CODES.duplicateStageOutcome);
    });

    it('allows a company to hold one won stage and one lost stage at the same time', async () => {
      const tenant = await signUp();
      const won = await addStage(tenant, { name: 'Closed Won', outcome: 'won' });
      const lost = await addStage(tenant, { name: 'Closed Lost', outcome: 'lost' });

      expect(won.outcome).toBe('won');
      expect(lost.outcome).toBe('lost');
    });

    it('refuses to delete a stage while a Deal occupies it', async () => {
      const tenant = await signUp();
      const stage = await addStage(tenant);
      const party = await addParty(tenant);
      await addDeal(tenant, stage.id, party.id);

      const refused = await tenant.as(app.http.delete(STAGE_PATHS.stage(stage.id))).expect(409);
      expect(refused.body.code).toBe(STAGE_ERROR_CODES.stageHasDeals);
    });

    it('deletes a stage once it holds no Deals', async () => {
      const tenant = await signUp();
      const stage = await addStage(tenant);

      await tenant.as(app.http.delete(STAGE_PATHS.stage(stage.id))).expect(204);
      await tenant.as(app.http.get(STAGE_PATHS.stage(stage.id))).expect(404);
    });

    it('is the same 404 a made-up id gets, for a stage nobody in this company has', async () => {
      const tenant = await signUp();

      await tenant.as(app.http.get(STAGE_PATHS.stage('00000000-0000-0000-0000-000000000000'))).expect(404);
    });
  });

  // ─── deals ────────────────────────────────────────────────────────────────────────

  describe('deals', () => {
    it('creates one against a real Party and Stage, defaulting nothing that was not sent', async () => {
      const tenant = await signUp();
      const stage = await addStage(tenant, { name: 'Discovery' });
      const party = await addParty(tenant, { name: 'Kapoor Trading' });

      const created = await addDeal(tenant, stage.id, party.id, {
        name: 'Kapoor Trading — new site',
        amount: '4200.00',
      });

      expect(created).toMatchObject({
        name: 'Kapoor Trading — new site',
        partyId: party.id,
        stageId: stage.id,
        stageOutcome: null,
        assignedToUserId: null,
        originLeadId: null,
      });
    });

    it('round-trips amount as exact decimal text, never a JSON number', async () => {
      const tenant = await signUp();
      const stage = await addStage(tenant);
      const party = await addParty(tenant);

      const created = await addDeal(tenant, stage.id, party.id, { amount: '19999.01' });
      expect(created.amount).toEqual({ amount: '19999.01', currency: 'GBP' });

      const detail = await tenant.as(app.http.get(DEAL_PATHS.deal(created.id))).expect(200);
      expect((detail.body as DealResponse).amount).toEqual({ amount: '19999.01', currency: 'GBP' });
    });

    it('takes the wire shape as well as bare decimal text for amount', async () => {
      const tenant = await signUp();
      const stage = await addStage(tenant);
      const party = await addParty(tenant);

      const created = await addDeal(tenant, stage.id, party.id, {
        amount: { amount: '500.50', currency: 'GBP' },
      });
      expect(created.amount).toEqual({ amount: '500.50', currency: 'GBP' });
    });

    it('refuses a JSON number and a third decimal place', async () => {
      const tenant = await signUp();
      const stage = await addStage(tenant);
      const party = await addParty(tenant);

      const refused = await tenant
        .as(app.http.post(DEAL_PATHS.deals))
        .send({ name: 'Bad amount', stageId: stage.id, partyId: party.id, amount: 1000.5 })
        .expect(422);
      expect(refused.body.fields).toHaveProperty('amount');

      const tooPrecise = await tenant
        .as(app.http.post(DEAL_PATHS.deals))
        .send({ name: 'Bad amount', stageId: stage.id, partyId: party.id, amount: '10.005' })
        .expect(422);
      expect(tooPrecise.body.fields).toHaveProperty('amount');
    });

    it('refuses a partyId that does not resolve through PartyDirectory', async () => {
      const tenant = await signUp();
      const stage = await addStage(tenant);

      const refused = await tenant
        .as(app.http.post(DEAL_PATHS.deals))
        .send({
          name: 'Nobody',
          stageId: stage.id,
          partyId: '00000000-0000-0000-0000-000000000000',
          amount: '100.00',
        } satisfies CreateDealRequest)
        .expect(404);

      expect(refused.body.code).toBe(DEAL_ERROR_CODES.dealPartyNotFound);
    });

    it('refuses a stageId that does not resolve within this company', async () => {
      const tenant = await signUp();
      const party = await addParty(tenant);

      const refused = await tenant
        .as(app.http.post(DEAL_PATHS.deals))
        .send({
          name: 'Nowhere',
          stageId: '00000000-0000-0000-0000-000000000000',
          partyId: party.id,
          amount: '100.00',
        } satisfies CreateDealRequest)
        .expect(404);

      expect(refused.body.code).toBe(DEAL_ERROR_CODES.dealStageNotFound);
    });

    it('moves between stages by an ordinary PATCH, and closes by landing on a won/lost stage', async () => {
      const tenant = await signUp();
      const discovery = await addStage(tenant, { name: 'Discovery' });
      const won = await addStage(tenant, { name: 'Closed Won', outcome: 'won' });
      const party = await addParty(tenant);
      const deal = await addDeal(tenant, discovery.id, party.id);

      expect(deal.stageOutcome).toBeNull();

      const moved = await changeDeal(tenant, deal.id, { stageId: won.id });
      expect(moved.stageId).toBe(won.id);
      // The outcome is read off the Stage it is in now — never stored on the Deal itself.
      expect(moved.stageOutcome).toBe('won');
    });

    it('carries an optional originLeadId, purely informational', async () => {
      const tenant = await signUp();
      const stage = await addStage(tenant);
      const party = await addParty(tenant);
      const leadId = '11111111-1111-1111-1111-111111111111';

      const created = await addDeal(tenant, stage.id, party.id, { originLeadId: leadId });
      expect(created.originLeadId).toBe(leadId);
    });

    it('deletes a Deal', async () => {
      const tenant = await signUp();
      const stage = await addStage(tenant);
      const party = await addParty(tenant);
      const deal = await addDeal(tenant, stage.id, party.id);

      await tenant.as(app.http.delete(DEAL_PATHS.deal(deal.id))).expect(204);
      await tenant.as(app.http.get(DEAL_PATHS.deal(deal.id))).expect(404);
    });

    it('lists in the envelope every list endpoint returns', async () => {
      const tenant = await signUp();
      const stage = await addStage(tenant);
      const party = await addParty(tenant);
      await addDeal(tenant, stage.id, party.id, { name: 'Only deal' });

      const listed = await listDeals(tenant, { pageSize: 10 });
      expect(listed.items.map((item) => item.name)).toEqual(['Only deal']);
      expect(listed.page).toEqual({ number: 1, size: 10, total: 1, pages: 1 });
    });
  });

  // ─── tenant isolation ─────────────────────────────────────────────────────────────

  describe('tenant isolation', () => {
    it('is not a filter any of this code writes — one company cannot see another\'s Stages', async () => {
      const northwind = await signUp();
      const acme = await signUp({ companyName: 'Acme', name: 'Bo Lindqvist', email: 'bo@acme.test' });

      const theirs = await addStage(northwind, { name: 'Theirs' });
      await addStage(acme, { name: 'Ours' });

      const listed = await listStages(acme);
      expect(listed.items.map((item) => item.name)).toEqual(['Ours']);

      await acme.as(app.http.get(STAGE_PATHS.stage(theirs.id))).expect(404);
      await acme.as(app.http.patch(STAGE_PATHS.stage(theirs.id))).send({ name: 'Ours now' }).expect(404);
      await acme.as(app.http.delete(STAGE_PATHS.stage(theirs.id))).expect(404);
    });

    it('one company cannot see, move, or delete another\'s Deals', async () => {
      const northwind = await signUp();
      const acme = await signUp({ companyName: 'Acme', name: 'Bo Lindqvist', email: 'bo@acme.test' });

      const theirStage = await addStage(northwind);
      const theirParty = await addParty(northwind);
      const theirs = await addDeal(northwind, theirStage.id, theirParty.id, { name: 'Theirs' });

      const ourStage = await addStage(acme);
      const ourParty = await addParty(acme);
      await addDeal(acme, ourStage.id, ourParty.id, { name: 'Ours' });

      const listed = await listDeals(acme);
      expect(listed.items.map((item) => item.name)).toEqual(['Ours']);

      await acme.as(app.http.get(DEAL_PATHS.deal(theirs.id))).expect(404);
      await acme.as(app.http.patch(DEAL_PATHS.deal(theirs.id))).send({ name: 'Ours now' }).expect(404);
      await acme.as(app.http.delete(DEAL_PATHS.deal(theirs.id))).expect(404);
    });

    it('refuses a Deal aimed at another company\'s Stage, even by a valid id', async () => {
      const northwind = await signUp();
      const acme = await signUp({ companyName: 'Acme', name: 'Bo Lindqvist', email: 'bo@acme.test' });

      const acmeStage = await addStage(acme);
      const northwindParty = await addParty(northwind);

      const refused = await northwind
        .as(app.http.post(DEAL_PATHS.deals))
        .send({
          name: 'Cross-tenant',
          stageId: acmeStage.id,
          partyId: northwindParty.id,
          amount: '100.00',
        } satisfies CreateDealRequest)
        .expect(404);

      expect(refused.body.code).toBe(DEAL_ERROR_CODES.dealStageNotFound);
    });

    it('refuses a Deal aimed at another company\'s Party, even by a valid id', async () => {
      const northwind = await signUp();
      const acme = await signUp({ companyName: 'Acme', name: 'Bo Lindqvist', email: 'bo@acme.test' });

      const northwindStage = await addStage(northwind);
      const acmeParty = await addParty(acme);

      const refused = await northwind
        .as(app.http.post(DEAL_PATHS.deals))
        .send({
          name: 'Cross-tenant',
          stageId: northwindStage.id,
          partyId: acmeParty.id,
          amount: '100.00',
        } satisfies CreateDealRequest)
        .expect(404);

      expect(refused.body.code).toBe(DEAL_ERROR_CODES.dealPartyNotFound);
    });
  });
  // ─── deal roll-up by party ────────────────────────────────────────────────────────

  /**
   * What the Contacts board asks so that it does not ask once per row.
   *
   * The interesting cases are all about *aggregation being honest*: an outcome comes from the
   * Stage rather than the Deal, open and won money are never added together, and a party the
   * caller asked about but which has no deals is absent rather than zero-filled.
   */
  describe('deal roll-up by party', () => {
    async function rollup(tenant: Tenant, partyIds: string[]): Promise<PartyDealRollupResponse> {
      const response = await tenant
        .as(app.http.get(`${DEAL_PATHS.dealsByParty}?partyIds=${partyIds.join(',')}`))
        .expect(200);

      return response.body as PartyDealRollupResponse;
    }

    it("counts and totals a party's open deals", async () => {
      const northwind = await signUp();
      const stage = await addStage(northwind);
      const party = await addParty(northwind);

      await addDeal(northwind, stage.id, party.id, { amount: '1500.50' });
      await addDeal(northwind, stage.id, party.id, { amount: '2499.50' });

      const { items } = await rollup(northwind, [party.id]);

      expect(items).toHaveLength(1);

      const [rolled] = items;
      expect(rolled).toMatchObject({
        partyId: party.id,
        openCount: 2,
        wonCount: 0,
        lostCount: 0,
      });
      expect(rolled?.openValue.amount).toBe('4000.00');
      expect(rolled?.wonValue.amount).toBe('0.00');
    });

    it('reads won and lost from the stage, not from the deal', async () => {
      const northwind = await signUp();
      const open = await addStage(northwind, { name: 'Discovery' });
      const closed = await addStage(northwind, { name: 'Closed won' });
      const party = await addParty(northwind);

      const deal = await addDeal(northwind, open.id, party.id, { amount: '900.00' });
      await addDeal(northwind, open.id, party.id, { amount: '100.00' });

      await changeDeal(northwind, deal.id, { stageId: closed.id });
      // The stage is marked won *after* the deal moved into it. Nothing about the deal
      // changed, so a roll-up that stored the outcome would still report it open.
      await changeStage(northwind, closed.id, { outcome: 'won' });

      const { items } = await rollup(northwind, [party.id]);

      const [rolled] = items;
      expect(rolled).toMatchObject({ openCount: 1, wonCount: 1, lostCount: 0 });
      expect(rolled?.wonValue.amount).toBe('900.00');
      expect(rolled?.openValue.amount).toBe('100.00');
    });

    it('leaves out a party that has no deals rather than zero-filling it', async () => {
      const northwind = await signUp();
      const stage = await addStage(northwind);
      const withDeals = await addParty(northwind);
      const without = await addParty(northwind, { name: 'Quiet Ltd' });

      await addDeal(northwind, stage.id, withDeals.id);

      const { items } = await rollup(northwind, [withDeals.id, without.id]);

      expect(items.map((item) => item.partyId)).toEqual([withDeals.id]);
    });

    it('answers nothing when asked about nobody', async () => {
      const northwind = await signUp();

      const response = await northwind.as(app.http.get(DEAL_PATHS.dealsByParty)).expect(200);

      expect((response.body as PartyDealRollupResponse).items).toEqual([]);
    });

    it('refuses to roll up more parties than a board can show', async () => {
      const northwind = await signUp();
      const tooMany = Array.from({ length: 101 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`);

      await northwind
        .as(app.http.get(`${DEAL_PATHS.dealsByParty}?partyIds=${tooMany.join(',')}`))
        .expect(400);
    });

    it("never reports another company's deals", async () => {
      const northwind = await signUp();
      const acme = await signUp({ companyName: 'Acme', name: 'Bo Lindqvist', email: 'bo@acme.test' });

      const acmeStage = await addStage(acme);
      const acmeParty = await addParty(acme);
      await addDeal(acme, acmeStage.id, acmeParty.id, { amount: '5000.00' });

      // Northwind names Acme's party id outright. Scoping, not guesswork, is what answers.
      const { items } = await rollup(northwind, [acmeParty.id]);

      expect(items).toEqual([]);
    });
  });
});
